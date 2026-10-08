// Job electrician choice ("Your electrician or ours?"). The invite email lives in job-electrician-invite.server.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { type ElectricianPlan } from "./job-electrician.core";

/** Records the installer's choice on a new job. A chosen approved electrician is offered the owner's times first
 *  (never assigned directly); an invited one shows "Electrician invited – waiting to onboard". */
export async function recordJobElectricianChoice(jobId: string, installerBusinessId: string, plan: ElectricianPlan | null | undefined, actorId: string) {
  if ((plan as { mode?: string } | null)?.mode === "later") {
    // "To be arranged": no electrician chosen, nothing booked or offered. Office/installer chooses later.
    await logEvent(jobId, actorId, "electrician_to_be_arranged", "Electrician to be arranged — none chosen yet", {}, { internal: true });
    return { choice: null };
  }
  if (!plan || plan.mode !== "mine") {
    await admin.from("jobs").update({ electrician_choice: "hivic_organise" }).eq("id", jobId);
    return { choice: "hivic_organise" as const };
  }
  if (plan.business_id) {
    const { data: rel } = await admin.from("partner_relationships").select("electrician_business_id").eq("installer_business_id", installerBusinessId).eq("electrician_business_id", plan.business_id).eq("active", true).maybeSingle();
    if (!rel) throw new WorkflowError("That electrician isn't one of your approved electricians.");
    const { data: eb } = await admin.from("businesses").select("name, trading_name, email, phone").eq("id", plan.business_id).maybeSingle();
    await admin.from("electrician_nominations").insert({ job_id: jobId, business_id: plan.business_id, nominating_business_id: installerBusinessId, nominated_by: actorId, nominated_for: "installer", contact_name: eb?.trading_name || eb?.name || "Your electrician", business_name: eb?.name ?? null, email: eb?.email ?? null, phone: eb?.phone ?? null, status: "approved" });
    await admin.from("jobs").update({ electrician_choice: "preferred" }).eq("id", jobId);
    await logEvent(jobId, actorId, "electrician_chosen_by_installer", `Installer chose ${eb?.trading_name || eb?.name || "their electrician"} — offered the owner's safety check times first`, { business_id: plan.business_id });
    return { choice: "preferred" as const };
  }
  if (plan.nomination_id) {
    const { data: n } = await admin.from("electrician_nominations").select("contact_name,business_name,email,phone,licence_number,rec_number,nominated_for,status,business_id").eq("id", plan.nomination_id).eq("nominating_business_id", installerBusinessId).is("job_id", null).maybeSingle();
    if (!n) throw new WorkflowError("That electrician couldn't be found. Add them again.");
    await admin.from("electrician_nominations").insert({ ...n, job_id: jobId, nominated_by: actorId, nominating_business_id: installerBusinessId });
    await admin.from("jobs").update({ electrician_choice: "nominated", next_action: `Electrician invited – waiting for ${n.contact_name} to onboard` }).eq("id", jobId);
    return { choice: "nominated" as const };
  }
  throw new WorkflowError("Choose your electrician.");
}

/** The job's current electrician choice, for the job page. */
export async function jobElectricianState(jobId: string) {
  const [{ data: job }, { data: noms }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("electrician_choice").eq("id", jobId).maybeSingle(),
    admin.from("electrician_nominations").select("id, contact_name, business_id, status").eq("job_id", jobId).is("ended_at", null).order("created_at", { ascending: false }).limit(1),
    admin.from("job_assignments").select("business_id, businesses(name, trading_name)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1),
  ]);
  const n = noms?.[0] ?? null;
  const a = asg?.[0] as { businesses?: { name?: string; trading_name?: string | null } | null } | undefined;
  const { isIntakeJob } = await import("./installer-intake.server");
  return {
    intake: await isIntakeJob(jobId),
    choice: (job?.electrician_choice as string | null) ?? null,
    assignedName: a ? a.businesses?.trading_name || a.businesses?.name || "Electrician" : null,
    chosenName: n?.business_id ? n.contact_name : null,
    invitedName: n && !n.business_id ? n.contact_name : null,
  };
}

/** Installer switches to "Home Insulation Victoria arranges" at any time before an electrician has accepted. */
/** ONE payer-change lock for every path: electrician accepted, or the owner's invoice raised on an accepted quote. */
export async function payerChangeBlocker(jobId: string): Promise<string | null> {
  const { count } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  if (count) return "An electrician has already accepted this job. Ask Home Insulation Victoria to change it.";
  const { data: acc } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted");
  if (acc?.length) { const { count: inv } = await admin.from("invoices").select("id", { count: "exact", head: true }).in("quote_id", acc.map((q) => q.id)); if (inv) return "The owner's invoice has already been raised — ask Home Insulation Victoria to change the electrician arrangement."; }
  return null;
}

/** Legacy job-card / RPC switch. Add job (intake) jobs are REFUSED here: their payer changes only through the guarded
 *  job-details editor (installerUpdateIntake) so quotes and fee declarations update together. Other jobs share the
 *  same lock and may not switch after a quote has been accepted (no reconfirmation path for them). */
export async function switchJobToHivic(jobId: string, userId: string) {
  const { isIntakeJob } = await import("./installer-intake.server");
  if (await isIntakeJob(jobId)) throw new WorkflowError("Change the electrician in this job's details below, so the owner's quote and fee confirmation update together.");
  const lock = await payerChangeBlocker(jobId);
  if (lock) throw new WorkflowError(lock);
  const { data: acc } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted").limit(1);
  const { data: j } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
  if (j?.channel === "installer_sourced" && acc?.length) throw new WorkflowError("The owner has already accepted the quote — ask Home Insulation Victoria to change the electrician arrangement.");
  return applyHivicArrangement(jobId, userId);
}

/** Internal: callers must already have applied the guards (legacy switch above, or installerUpdateIntake). */
export async function applyHivicArrangement(jobId: string, userId: string) {
  const { data: mine } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("user_id", userId).eq("active", true).maybeSingle();
  if (!mine?.business_id) throw new WorkflowError("Only the installer on this job can change this.");
  const { data: biz } = await admin.from("business_members").select("member_role").eq("business_id", mine.business_id).eq("user_id", userId).eq("active", true).maybeSingle();
  if (!biz) throw new WorkflowError("Only the installer on this job can change this.");
  const { count } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  if (count) throw new WorkflowError("An electrician has already accepted this job. Ask Home Insulation Victoria to change it.");
  const now = new Date().toISOString();
  await admin.from("electrician_nominations").update({ ended_at: now, updated_at: now }).eq("job_id", jobId).is("ended_at", null);
  await admin.from("jobs").update({ electrician_choice: "hivic_organise", next_action: "Home Insulation Victoria is arranging the electrician" }).eq("id", jobId);
  await logEvent(jobId, userId, "electrician_choice_changed", "Installer switched to: Home Insulation Victoria arranges the electrician", {});
  return { ok: true };
}

/** Job-level chosen electrician (approved), if any — offered the owner's times first. */
export async function jobChosenElectrician(jobId: string): Promise<string | null> {
  const { data } = await admin.from("electrician_nominations").select("business_id").eq("job_id", jobId).is("ended_at", null).not("business_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.business_id ?? null;
}
