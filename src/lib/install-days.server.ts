// Owner-picked install days + quoted installer one-tap booking. Never auto-replaces the installer.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, piesaStatus } from "./workflow.server";
import {
  allowedInstallDays, installDayBlockers, installDayBounds, installDayOutsideWindow, installWindowDeadline, shouldFlagTenDaysLeft,
} from "./install-days.core";
import { melbourneYmd } from "./piesa-windows.core";

async function context(jobId: string) {
  const { clearanceFacts } = await import("./allocation.server");
  const { electricalClearance } = await import("./allocation.core");
  const { quotedAreaM2 } = await import("./install-holds.server");
  const [{ data: job }, clearance, piesa, { data: asg }, { data: booked }, { data: open }] = await Promise.all([
    admin.from("jobs").select("stage, install_10day_flagged_at").eq("id", jobId).single(),
    clearanceFacts(jobId).then(electricalClearance),
    piesaStatus(jobId),
    admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").limit(1).maybeSingle(),
    admin.from("appointment_proposals").select("id, starts_at, ends_at, status").eq("job_id", jobId).eq("install_day", true).order("starts_at"),
  ]);
  const deadline = clearance.cleared ? installWindowDeadline(clearance.timingDate, (piesa as { install_deadline?: string | null } | null)?.install_deadline ?? null) : null;
  return { job, clearance, deadline, asg, booked: !!booked, open: open ?? [] };
}

/** Owner view: can pick days, which days, open picks, deadline. */
export async function ownerInstallDayState(jobId: string) {
  const c = await context(jobId);
  const openDays = c.open.filter((p) => p.status === "proposed" && Date.parse(p.starts_at) > Date.now());
  const { count: none } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("event_type", ["install_days_none_owner", "install_days_declined"]);
  const expired = !!c.deadline && melbourneYmd(new Date()) > c.deadline;
  const canPick = c.job?.stage === "installation_scheduling" && c.clearance.cleared && !!c.asg && !c.booked && !openDays.length && !none && !expired;
  return {
    canPick, expired, booked: c.booked, deadline: c.deadline, fallback: !!none,
    days: canPick ? allowedInstallDays({ deadline: c.deadline }) : [],
    openDays: openDays.map((p) => ({ id: p.id, starts_at: p.starts_at })),
  };
}

export async function submitOwnerInstallDays(jobId: string, userId: string, picks: string[]) {
  const s = await ownerInstallDayState(jobId);
  if (s.expired) throw new WorkflowError("New PIESA needed: the 30-day installation window has passed.");
  if (!s.canPick) throw new WorkflowError("Install days can't be chosen right now.");
  const b = installDayBlockers(picks, s.days);
  if (b.length) throw new WorkflowError(b.join(" "));
  const rows = picks.map((d) => ({ job_id: jobId, kind: "installation" as const, proposed_by: userId, proposer_role: "owner", install_day: true, ...installDayBounds(d) }));
  const { error } = await admin.from("appointment_proposals").insert(rows as never);
  if (error) throw new Error(error.message);
  await logEvent(jobId, userId, "install_days_offered", `Owner chose ${picks.length} install days for the quoted installer (offer prepared; delivery follows the sending switches)`, { days: picks }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to take one of the owner's install days" }).eq("id", jobId);
  return { ok: true };
}

/** Owner: none of the offered days suit -> old propose/confirm path (24h reminder / 48h flag). */
export async function ownerNoInstallDays(jobId: string, userId: string) {
  const { releaseInstallationContacts } = await import("./allocation.server");
  await releaseInstallationContacts(jobId, userId);
  await logEvent(jobId, userId, "install_days_none_owner", "Owner: none of the install days work — owner and installer to arrange a day", {}, { internal: true });
  await admin.from("jobs").update({ next_action: "Owner and installer to agree an installation day" }).eq("id", jobId);
  return { ok: true };
}

async function requireInstaller(jobId: string, userId: string) {
  const { data: a } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) throw new WorkflowError("This job has no quoted installer.");
  if (a.user_id !== userId) {
    const { data: m } = await admin.from("business_members").select("id").eq("business_id", a.business_id ?? "").eq("user_id", userId).eq("active", true).maybeSingle();
    if (!m) throw new WorkflowError("Only the quoted installer can respond to these days.");
  }
  return a;
}

const OUTCOME: Record<string, string> = {
  not_found: "That day is not available.", not_installer: "Only the quoted installer can take this day.", day_unavailable: "That day has just been taken or has passed.",
  outside_window: "That day is outside the 30-day installation window and can't be booked.", already_booked: "The installation is already booked.",
};

/** Quoted installer taps a day: locked take + confirmed booking + contact release for the install visit only. */
export async function installerTakeDay(jobId: string, proposalId: string, userId: string) {
  const a = await requireInstaller(jobId, userId);
  const c = await context(jobId);
  if (!c.clearance.cleared) throw new WorkflowError(`Installation cannot be arranged yet: ${c.clearance.blocker}`);
  const p = c.open.find((x) => x.id === proposalId);
  if (!p) throw new WorkflowError(OUTCOME["not_found"]!);
  if (installDayOutsideWindow(p.starts_at, c.deadline)) throw new WorkflowError(OUTCOME["outside_window"]!);
  const { data, error } = await admin.rpc("accept_install_day", { _proposal: proposalId, _assignment: a.id, _user: userId, _deadline: c.deadline as string });
  if (error) throw new Error(error.message);
  if (data !== "accepted") throw new WorkflowError(OUTCOME[data as string] ?? "That day could not be booked.");
  const { releaseInstallationContacts } = await import("./allocation.server");
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "installation", p.starts_at, userId, "installer (owner's chosen day)");
    await releaseInstallationContacts(jobId, userId);
    return { ok: true, booked: true };
  } catch (e) {
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("id", proposalId);
    await logEvent(jobId, userId, "install_day_booking_blocked", `Install day taken but booking not confirmed: ${(e as Error).message}`, { proposal_id: proposalId }, { internal: true });
    throw e;
  }
}

/** Quoted installer: none of the owner's days work -> needs attention + old propose/confirm path. Never replaced automatically. */
export async function installerDeclineDays(jobId: string, userId: string, reason: string | null) {
  await requireInstaller(jobId, userId);
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("install_day", true).eq("status", "proposed");
  await logEvent(jobId, userId, "install_days_declined", `Installer could not do any of the owner's install days${reason ? `: ${reason}` : ""}. Needs Home Insulation Victoria`, { reason }, { internal: true });
  const { releaseInstallationContacts } = await import("./allocation.server");
  await releaseInstallationContacts(jobId, userId).catch((e) => console.error("install contact release skipped", (e as Error).message));
  await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: installer could not do the owner's days" }).eq("id", jobId);
  return { ok: true };
}

/** Timer: close passed / out-of-window days; raise the 10-days-left flag once. */
export async function sweepInstallDays(now = new Date()) {
  const { data: past } = await admin.from("appointment_proposals").update({ status: "superseded" }).eq("install_day", true).eq("status", "proposed").lt("starts_at", now.toISOString()).select("id");
  const { data: jobs } = await admin.from("jobs").select("id, source").eq("stage", "installation_scheduling").is("install_10day_flagged_at", null);
  let flagged = 0;
  for (const j of jobs ?? []) {
    const c = await context(j.id);
    if (!shouldFlagTenDaysLeft({ deadline: c.deadline, booked: c.booked, flaggedAt: c.job?.install_10day_flagged_at ?? null, now })) continue;
    const { data: u } = await admin.from("jobs").update({ install_10day_flagged_at: now.toISOString() }).eq("id", j.id).is("install_10day_flagged_at", null).select("id").maybeSingle();
    if (!u) continue;
    await logEvent(j.id, null, "install_ten_days_left", `10 days or fewer left in the 30-day window (last day ${c.deadline}) and no installation booked. Needs Home Insulation Victoria`, { deadline: c.deadline }, { internal: true });
    flagged++;
  }
  return { closedDays: past?.length ?? 0, tenDaysLeft: flagged };
}

/** Installer dashboard: open owner days for jobs where this business is the quoted installer (no owner details). */
export async function installerOpenDays(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("appointment_proposals").select("id, job_id, starts_at").in("job_id", jobIds).eq("install_day", true).eq("status", "proposed").gt("starts_at", new Date().toISOString()).order("starts_at");
  return data ?? [];
}
