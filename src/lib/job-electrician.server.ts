// Job electrician choice ("Your electrician or ours?") and the new-electrician invite email.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { electricianInviteEmail, type ElectricianPlan } from "./job-electrician.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

const isTestBiz = (b: { name?: string | null; onboarding_notes?: string | null } | null) =>
  /^\s*(\[TEST PARTNER\]|TEST\b)/i.test(b?.name ?? "") || (b?.onboarding_notes ?? "").includes("[TEST PARTNER]");

/** Emails the electrician the onboarding link. A one-off partner email typed on the installer's behalf: follows the
 *  manual-email rule (really sends), TEST businesses only reach Jo's test inbox. `dryRun` builds it without sending. */
export async function sendElectricianInvite(p: { actorId: string; nominationId: string; installerBusinessId: string; inviteToken: string; to: string; name: string; dryRun?: boolean }) {
  const { data: b } = await admin.from("businesses").select("name, trading_name, onboarding_notes").eq("id", p.installerBusinessId).maybeSingle();
  const test = isTestBiz(b);
  const installerName = ((b?.trading_name || b?.name) ?? "Your installer").replace(/^\[TEST PARTNER\]\s*/, "");
  const link = `${SET_PASSWORD_BASE}/electrician-onboarding?invite=${p.inviteToken}`;
  const mail = electricianInviteEmail({ electricianName: p.name, installerName, link });
  const { officeEmailTo } = await import("./office-email.core");
  const to = officeEmailTo(p.to, test);
  if (p.dryRun) return { status: "dry_run" as const, to, subject: mail.subject, message: mail.message, test };
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: p.actorId, recipient: "partner", to, contactName: p.name, subject: mail.subject, message: mail.message, label: "electrician_invite", record: { nominationId: p.nominationId, businessId: p.installerBusinessId, test } as never });
  if (r.status === "sent") {
    const now = new Date().toISOString();
    await admin.from("electrician_nominations").update({ status: "invited", invite_sent_at: now, invite_link_issued_at: now, updated_at: now }).eq("id", p.nominationId);
  }
  return { status: r.status, to, detail: r.detail, test };
}

/** Records the installer's choice on a new job. A chosen approved electrician is offered the owner's times first
 *  (never assigned directly); an invited one shows "Electrician invited – waiting to onboard". */
export async function recordJobElectricianChoice(jobId: string, installerBusinessId: string, plan: ElectricianPlan | null | undefined, actorId: string) {
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
  return {
    choice: (job?.electrician_choice as string | null) ?? null,
    assignedName: a ? a.businesses?.trading_name || a.businesses?.name || "Electrician" : null,
    chosenName: n?.business_id ? n.contact_name : null,
    invitedName: n && !n.business_id ? n.contact_name : null,
  };
}

/** Installer switches to "Home Insulation Victoria arranges" at any time before an electrician has accepted. */
export async function switchJobToHivic(jobId: string, userId: string) {
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
