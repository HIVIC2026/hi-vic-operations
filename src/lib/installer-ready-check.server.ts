// Ready Check for installer-supplied customers the installer hasn't quoted (Jo, 7 Oct 6pm).
// Reuses confirmBooking (stage + approved-installer guard). The supplying installer is already assigned, so no offer
// round runs and no other trade is ever offered the job. Decision 180 (Jo, 24 Oct 2026): the owner "choose 3–5 times"
// email, its secure /times link and the owner-window states were retired; installers arrange the visit directly and
// enter the agreed time themselves. Nothing here sends to the owner.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { READY_CHECK_BOOKED, installerReadyCheckAction, ownBookingBlocker, type InstallerRcAction } from "./installer-ready-check.core";

/** Job + the caller's right to act: a member of the installer business that supplied this customer. */
async function load(jobId: string, userId: string) {
  const { data: j } = await admin.from("jobs").select("id, job_number, stage, source, channel, installer_quoted, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your supplied customers.");
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id);
  return j;
}

export async function installerRcState(jobId: string) {
  const { data: j, error: je } = await admin.from("jobs").select("channel, stage, installer_quoted, installer_site_check").eq("id", jobId).maybeSingle();
  if (je) throw new WorkflowError("The Ready Check status could not load. Please retry.");
  if (!j) throw new WorkflowError("The Ready Check status could not load: the job was not found."); // never "unknown attendance"
  const [{ count: booked, error: be }, { count: done, error: de }, { data: m, error: me }] = await Promise.all([
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "completed"),
    admin.from("ceiling_measurements").select("provenance, verified_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (be || de || me || booked == null || done == null) throw new WorkflowError("The Ready Check status could not load. Please retry."); // fail closed, never "nothing to do"
  const attended = j.installer_site_check === "yes" || j.installer_site_check === "no" ? j.installer_site_check : null;
  const onsiteDone = (done ?? 0) > 0 || (await import("./installer-intake.core")).onsiteMeasuredFrom(m ?? null, attended);
  const { data: bk, error: bke } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (bke) throw new WorkflowError("The Ready Check status could not load. Please retry.");
  const action: InstallerRcAction = installerReadyCheckAction({ channel: j.channel, stage: j.stage, quoted: j.installer_quoted as "yes" | "no" | null, attended, onsiteDone, booked: !!booked });
  return { action, bookedAt: bk?.scheduled_start ?? null };
}

async function requireAction(jobId: string, want: InstallerRcAction) {
  const s = await installerRcState(jobId);
  if (s?.action !== want) throw new WorkflowError(s?.action === "booked" ? "This Ready Check is already booked." : "This job isn't waiting for that step.");
}

/** The installer agreed a time with the owner. Nothing is sent to the owner. */
export async function bookOwnReadyCheck(jobId: string, userId: string, startIso: string) {
  await load(jobId, userId);
  const b = ownBookingBlocker(startIso);
  if (b) throw new WorkflowError(b);
  await requireAction(jobId, "book");
  const { confirmBooking } = await import("./booking.server");
  await confirmBooking(jobId, "ready_check", new Date(startIso).toISOString(), userId, "installer (time agreed with the owner)");
  await admin.from("jobs").update({ next_action: READY_CHECK_BOOKED }).eq("id", jobId);
  await (await import("./mitti-create.server")).onReadyCheckBooked(jobId, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message)); // T3: confirmed booking starts the form in the background
  await logEvent(jobId, userId, "installer_ready_check_self_booked", "Installer booked the Ready Check at a time agreed with the owner (nothing sent to the owner)", { starts_at: startIso });
  return { ok: true };
}
