// Install days, installer offers first (Jo 24 Oct 2026): installer offers 3 → owner takes one or suggests days →
// installer takes one or offers 3 new ones, until a day is agreed. Agreement books it. The office is never involved
// (only the 10-days-left alert below). Never auto-replaces the installer.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, piesaStatus } from "./workflow.server";
import {
  INSTALL_DAY_LEAD_HOURS, allowedInstallDays, dayOfferBlockers, installDayBounds, installStartAt, isInstallTime, installDayOutsideWindow, installDayTurn, installDaysLeft, installWindowDeadline, shouldFlagTenDaysLeft,
} from "./install-days.core";
import { melbourneYmd } from "./piesa-windows.core";

async function context(jobId: string) {
  const { clearanceFacts } = await import("./allocation.server");
  const { electricalClearance } = await import("./allocation.core");
  const [{ data: job }, clearance, piesa, { data: asg }, { data: booked }, { data: rows }] = await Promise.all([
    admin.from("jobs").select("stage, install_10day_flagged_at").eq("id", jobId).single(),
    clearanceFacts(jobId).then(electricalClearance),
    piesaStatus(jobId),
    admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").limit(1).maybeSingle(),
    admin.from("appointment_proposals").select("id, proposer_role, starts_at, ends_at, status").eq("job_id", jobId).eq("install_day", true).order("starts_at"),
  ]);
  const deadline = clearance.cleared ? installWindowDeadline(clearance.timingDate, (piesa as { install_deadline?: string | null } | null)?.install_deadline ?? null) : null;
  const expired = !!deadline && melbourneYmd(new Date()) > deadline;
  const ready = job?.stage === "installation_scheduling" && clearance.cleared && !!asg;
  const { turn, open } = installDayTurn({ ready, booked: !!booked, expired, rows: rows ?? [] });
  return { job, clearance, deadline, asg, booked: !!booked, bookedAt: booked?.scheduled_start ?? null, expired, turn, open };
}

type Ctx = Awaited<ReturnType<typeof context>>;
/** Read-only window facts for the 30-day rule sweep (decision 158, thirty-day-rule.server.ts). */
export const installDayContext = (jobId: string) => context(jobId);
const view = (c: Ctx) => ({
  turn: c.turn, deadline: c.deadline, daysLeft: c.deadline ? installDaysLeft(c.deadline) : null, booked: c.booked, bookedAt: c.bookedAt, expired: c.expired,
  open: c.open.map((p) => ({ id: p.id, starts_at: p.starts_at, by: p.proposer_role === "installer" ? "installer" as const : "owner" as const })),
});

/** Owner view (secure link or owner portal). `days` = days the owner may suggest when it's their move. */
export async function ownerInstallDayState(jobId: string) {
  const c = await context(jobId);
  return { ...view(c), days: c.turn === "owner_to_answer" ? allowedInstallDays({ deadline: c.deadline }) : [] };
}

async function requireInstaller(jobId: string, userId: string) {
  const { data: a } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) throw new WorkflowError("This job has no quoted installer.");
  if (a.user_id !== userId) {
    const { data: m } = await admin.from("business_members").select("id").eq("business_id", a.business_id ?? "").eq("user_id", userId).eq("active", true).maybeSingle();
    if (!m) throw new WorkflowError("Only the quoted installer can arrange these days.");
  }
  return a;
}

/** Installer view. `days` = days the installer may offer when it's their move. */
export async function installerInstallDayState(jobId: string, userId: string) {
  await requireInstaller(jobId, userId);
  const c = await context(jobId);
  const canOffer = c.turn === "installer_to_offer" || c.turn === "installer_to_answer";
  return { ...view(c), days: canOffer ? allowedInstallDays({ deadline: c.deadline }) : [] };
}

async function propose(jobId: string, userId: string, role: "installer" | "owner", picks: { day: string; time?: string }[], allowed: string[]) {
  const b = dayOfferBlockers(picks.map((p) => p.day), allowed, role);
  if (role === "installer" && picks.some((p) => !p.time || !isInstallTime(p.time))) b.push("Please choose an arrival time for each day.");
  if (picks.some((p) => p.time && installStartAt(p.day, p.time).getTime() < Date.now() + INSTALL_DAY_LEAD_HOURS * 3_600_000)) b.push("Each time must be at least 24 hours away.");
  if (b.length) throw new WorkflowError(b.join(" "));
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("install_day", true).eq("status", "proposed");
  const rows = picks.map((p) => ({ job_id: jobId, kind: "installation" as const, proposed_by: userId, proposer_role: role, install_day: true, ...installDayBounds(p.day, p.time) }));
  const { error } = await admin.from("appointment_proposals").insert(rows as never);
  if (error) throw new Error(error.message);
}

/** Installer offers 3 days (first offer, or instead of the owner's suggested days). */
export async function installerOfferDays(jobId: string, userId: string, picks: { day: string; time: string }[]) {
  await requireInstaller(jobId, userId);
  const c = await context(jobId);
  if (c.expired) throw new WorkflowError("New PIESA needed: the 30-day installation window has passed.");
  if (c.turn !== "installer_to_offer" && c.turn !== "installer_to_answer") throw new WorkflowError("Install days can't be offered right now.");
  await propose(jobId, userId, "installer", picks, allowedInstallDays({ deadline: c.deadline }));
  await logEvent(jobId, userId, "install_days_offered_by_installer", `Installer offered ${picks.length} install day${picks.length === 1 ? "" : "s"} to the owner`, { days: picks, instead_of_owner_days: c.turn === "installer_to_answer" }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the owner to pick one of the installer's install days" }).eq("id", jobId);
  return { ok: true };
}

/** Owner: none of the installer's days suit → suggest their own (1–5). */
export async function ownerSuggestDays(jobId: string, userId: string, picks: string[]) {
  const c = await context(jobId);
  if (c.expired) throw new WorkflowError("New PIESA needed: the 30-day installation window has passed.");
  if (c.turn !== "owner_to_answer") throw new WorkflowError("Install days can't be suggested right now.");
  await propose(jobId, userId, "owner", picks.map((day) => ({ day })), allowedInstallDays({ deadline: c.deadline }));
  await logEvent(jobId, userId, "install_days_offered", `Owner suggested ${picks.length} other install day${picks.length === 1 ? "" : "s"} for the installer`, { days: picks }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to take one of the owner's days or offer new ones" }).eq("id", jobId);
  return { ok: true };
}

const TAKE_OUTCOME: Record<string, string> = {
  not_found: "That day is not available.", not_installer: "Only the quoted installer can take this day.", day_unavailable: "That day has just been taken or has passed.",
  outside_window: "That day is outside the 30-day installation window and can't be booked.", already_booked: "The installation is already booked.",
};

/** Agreed day → confirmed booking + contact release for the install visit only. A failed booking reopens nothing. */
async function bookAgreedDay(jobId: string, proposalId: string, startsAt: string, userId: string, roleLabel: string) {
  const { releaseInstallationContacts } = await import("./allocation.server");
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "installation", startsAt, userId, roleLabel);
    await releaseInstallationContacts(jobId, userId);
    // Decision 139: the day is provisional for 48h until the 10% install deposit is received (bank transfer / PayID).
    await (await import("./payments.server")).noteProvisionalBooking(jobId, userId).catch((e) => console.error("provisional booking note skipped", (e as Error).message));
    // Owner "Your install is booked" email (best-effort; held until Jo approves the wording and messages are on).
    await (await import("./install-booked-email.server")).emailOwnerInstallBooked(jobId, startsAt).catch((e) => console.error("install booked email skipped", (e as Error).message));
    return { ok: true, booked: true };
  } catch (e) {
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("id", proposalId);
    await logEvent(jobId, userId, "install_day_booking_blocked", `Install day agreed but booking not confirmed: ${(e as Error).message}`, { proposal_id: proposalId }, { internal: true });
    throw e;
  }
}

/** Installer takes one of the owner's suggested days (locked take) at the arrival time they select = booked. */
export async function installerTakeDay(jobId: string, proposalId: string, userId: string, time: string) {
  if (!isInstallTime(time)) throw new WorkflowError("Please choose an arrival time.");
  const a = await requireInstaller(jobId, userId);
  const c = await context(jobId);
  if (!c.clearance.cleared) throw new WorkflowError(`Installation cannot be arranged yet: ${c.clearance.blocker}`);
  const p = c.turn === "installer_to_answer" ? c.open.find((x) => x.id === proposalId) : undefined;
  if (!p) throw new WorkflowError(TAKE_OUTCOME["not_found"]!);
  if (installDayOutsideWindow(p.starts_at, c.deadline)) throw new WorkflowError(TAKE_OUTCOME["outside_window"]!);
  const { data, error } = await admin.rpc("accept_install_day", { _proposal: proposalId, _assignment: a.id, _user: userId, _deadline: c.deadline as string });
  if (error) throw new Error(error.message);
  if (data !== "accepted") throw new WorkflowError(TAKE_OUTCOME[data as string] ?? "That day could not be booked.");
  const start = installStartAt(melbourneYmd(new Date(p.starts_at)), time).toISOString();
  await admin.from("appointment_proposals").update({ starts_at: start }).eq("id", proposalId);
  return bookAgreedDay(jobId, proposalId, start, userId, "installer (owner's suggested day)");
}

/** Owner takes one of the installer's offered days = booked. Compare-and-swap on the proposal so a day is taken once. */
export async function ownerTakeDay(jobId: string, proposalId: string, userId: string) {
  const c = await context(jobId);
  if (!c.clearance.cleared) throw new WorkflowError(`Installation cannot be arranged yet: ${c.clearance.blocker}`);
  const p = c.turn === "owner_to_answer" ? c.open.find((x) => x.id === proposalId) : undefined;
  if (!p) throw new WorkflowError(TAKE_OUTCOME["not_found"]!);
  if (installDayOutsideWindow(p.starts_at, c.deadline)) throw new WorkflowError(TAKE_OUTCOME["outside_window"]!);
  const { data: took, error } = await admin.from("appointment_proposals").update({ status: "accepted", assignment_id: c.asg!.id, responded_by: userId, responded_at: new Date().toISOString(), response_note: "Owner took this installer install day" })
    .eq("id", proposalId).eq("status", "proposed").gt("starts_at", new Date().toISOString()).select("id");
  if (error) throw new Error(error.message);
  if (!took?.length) throw new WorkflowError(TAKE_OUTCOME["day_unavailable"]!);
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("install_day", true).eq("status", "proposed");
  await logEvent(jobId, userId, "install_day_taken", "Owner took one of the installer's install days", { proposal_id: proposalId, starts_at: p.starts_at }, { internal: true });
  return bookAgreedDay(jobId, proposalId, p.starts_at, userId, "owner (installer's offered day)");
}

/** Jo 24 Oct: either side can change a booked day. The booking is cancelled, the job goes back to scheduling and the
 *  installer offers 3 new days inside the same 30-day window (back and forth as before). No office step. */
export async function changeInstallDay(jobId: string, userId: string, who: "installer" | "owner") {
  if (who === "installer") await requireInstaller(jobId, userId);
  const c = await context(jobId);
  if (c.turn !== "booked" || c.job?.stage !== "installation_booked") throw new WorkflowError("There is no booked install day to change.");
  if (c.bookedAt && Date.parse(c.bookedAt) <= Date.now()) throw new WorkflowError("The install day has already started.");
  const { data: rows, error } = await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").select("id");
  if (error) throw new Error(error.message);
  if (!rows?.length) throw new WorkflowError("There is no booked install day to change.");
  const { transition } = await import("./workflow.server");
  try {
    await transition(jobId, "installation_scheduling", userId, `Install day changed by the ${who} – the installer offers new days`, { booking_ids: rows.map((r) => r.id) });
  } catch (e) {
    await admin.from("bookings").update({ status: "confirmed" }).in("id", rows.map((r) => r.id));
    throw e;
  }
  const { clearInstallDueDate } = await import("./install-balance.server");
  await clearInstallDueDate(jobId, userId);
  const { regenerateEscNotification } = await import("./esc.server");
  await regenerateEscNotification(jobId, userId);
  await logEvent(jobId, userId, "install_day_changed", `${who === "owner" ? "Owner" : "Installer"} changed the booked install day (${c.bookedAt ? new Date(c.bookedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne" }) : "booked day"})`, { booking_ids: rows.map((r) => r.id), was: c.bookedAt, who }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to offer new install days" }).eq("id", jobId);
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

/** Installer dashboard: owner-suggested days waiting on this installer (no owner details). */
export async function installerOpenDays(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("appointment_proposals").select("id, job_id, starts_at").in("job_id", jobIds).eq("install_day", true).eq("status", "proposed").neq("proposer_role", "installer").gt("starts_at", new Date().toISOString()).order("starts_at");
  return data ?? [];
}
