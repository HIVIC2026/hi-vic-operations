// Our-lead Ready Check times (Jo 24 Oct 2026, decision 52): the office-picked installer accepts the offer by offering the
// owner 3 times; the owner takes one (booked) or suggests 1–5 days; the installer takes one at a time they choose
// (booked) or offers 3 new times — back and forth, no office step. Rules: ready-check-times.core.ts.
// Storage: appointment_proposals (kind ready_check, note READY_CHECK_TIME_NOTE) — no new table. Acceptance reuses the
// atomic SQL accept_ready_check_offer (approval, Full EEC, area, stage and "nobody assigned yet" checks); every booking
// goes through confirmBooking(…, "ready_check", …) and then onReadyCheckBooked (Mitti form).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ACCEPT_OUTCOME_MESSAGE } from "./allocation.core";
import {
  READY_CHECK_TIMES_FLAG, READY_CHECK_TIME_NOTE, allowedReadyCheckDays, installerRebookBlockers, installerTimesBlockers, isReadyCheckTime, ownerDaysBlockers, readyCheckChangeBlockers,
  readyCheckOfferExpiry, readyCheckOfferOverdue, readyCheckOfferStartBlockers, readyCheckStartAt, readyCheckTurn, type ReadyCheckPick,
} from "./ready-check-times.core";
import { melbourneYmd } from "./piesa-windows.core";

async function context(jobId: string) {
  const [{ data: job }, { data: asg }, { data: booked }, { data: rows }] = await Promise.all([
    admin.from("jobs").select("id, stage, channel, source, deleted_at").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").limit(1).maybeSingle(),
    admin.from("appointment_proposals").select("id, proposer_role, starts_at, status").eq("job_id", jobId).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).order("starts_at"),
  ]);
  const { turn, open } = readyCheckTurn({ booked: !!booked, hasInstaller: !!asg, rows: rows ?? [] });
  return { job, asg, booked: !!booked, bookedAt: booked?.scheduled_start ?? null, turn, open };
}
type Ctx = Awaited<ReturnType<typeof context>>;

/** Only our leads at the Ready Check scheduling stage use this flow. */
function requireOurLead(c: Ctx) {
  if (!c.job || c.job.deleted_at) throw new WorkflowError("This job is no longer available.");
  if (c.job.channel !== "hivic_sourced") throw new WorkflowError("Installers arrange the Ready Check directly with their own customers.");
}

/** Read-only: whose move it is now (installer-texts.server uses it to hold a stale decision-79 text). */
export const readyCheckTurnFor = async (jobId: string) => (await context(jobId)).turn;

/** Decision 79: the owner suggested other days → one text to the installer (best-effort, never blocks the save). */
async function tellInstallerDaysSuggested(jobId: string, triggerEventId: string | null, suggestedAt: string) {
  if (!triggerEventId) return;
  await (await import("./installer-texts.server")).textInstallerOwnerSuggestedDays(jobId, triggerEventId, suggestedAt).catch((e) => console.error("owner suggested days text skipped", (e as Error).message));
}
/** Decision 82 (installer text A): Ready Check booked → one text to the installer per booked start (best-effort). */
async function tellInstallerBooked(jobId: string, startsAt: string) {
  await (await import("./installer-texts.server")).textInstallerReadyCheckBooked(jobId, startsAt).catch((e) => console.error("ready check booked installer text skipped", (e as Error).message));
}

const view = (c: Ctx) => ({
  turn: c.turn, booked: c.booked, bookedAt: c.bookedAt,
  open: c.open.map((p) => ({ id: p.id, starts_at: p.starts_at, by: p.proposer_role === "installer" ? "installer" as const : "owner" as const })),
});

/** Decision 80: whether the booked Ready Check can be changed (our lead, booked, not started). */
const changeBlockers = (c: Ctx, now = new Date()) => readyCheckChangeBlockers({ channel: c.job?.channel ?? null, stage: c.job?.stage ?? null, deleted: !c.job || !!c.job.deleted_at, bookedAt: c.booked ? c.bookedAt : null }, now);

async function requireInstaller(jobId: string, userId: string) {
  const { data: a } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!a) throw new WorkflowError("This job has no installer yet.");
  if (a.user_id !== userId) {
    const { data: m } = await admin.from("business_members").select("id").eq("business_id", a.business_id ?? "").eq("user_id", userId).eq("active", true).maybeSingle();
    if (!m) throw new WorkflowError("Only the job's installer can arrange the Ready Check.");
  }
  return a;
}

async function insertTimes(jobId: string, userId: string, role: "installer" | "owner", assignmentId: string | null, starts: string[]) {
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed");
  const rows = starts.map((s) => ({ job_id: jobId, kind: "ready_check" as const, proposed_by: userId, proposer_role: role, assignment_id: assignmentId, starts_at: s, note: READY_CHECK_TIME_NOTE }));
  const { error } = await admin.from("appointment_proposals").insert(rows as never);
  if (error) throw new Error(error.message);
}

const startsOf = (picks: ReadyCheckPick[]) => picks.map((p) => readyCheckStartAt(p.day, p.time).toISOString());

async function tellOwner(jobId: string, starts: string[]) {
  await (await import("./ready-check-times-email.server")).emailOwnerReadyCheckTimes(jobId, starts).catch((e) => console.error("ready check times email skipped", (e as Error).message));
}

/** Owner "You're booked" (decision 80; best-effort, held until the wording is approved and messages are on). */
async function tellOwnerBooked(jobId: string, startsAt: string) {
  await (await import("./ready-check-booked-email.server")).emailOwnerReadyCheckBooked(jobId, startsAt).catch((e) => console.error("ready check booked email skipped", (e as Error).message));
}

/** Jo 29 Oct 2026 (HV-3542): the booked email/texts keep going if the phone drops the connection after the booking
 *  is saved (the platform keeps this promise alive past the request); the request still waits for it as before. */
async function tellBookedKeepGoing(jobId: string, startsAt: string) {
  const work = (async () => { await tellOwnerBooked(jobId, startsAt); await tellInstallerBooked(jobId, startsAt); })();
  const { requestContext } = await import("./background.server");
  requestContext.getStore()?.waitUntil?.(work.catch(() => undefined));
  await work;
}

/** Office picks ONE installer (decisions 49–51): one offer, open 24 hours, text + in-app to that installer only.
 *  Same eligibility list the office sees (installerCandidatesFor), TEST/real pairing and own-customer guards before writing. */
export type AutoOfferMeta = { attempt: number; basis: string; activeJobs: number; distanceKm: number | null };
export async function officePickReadyCheckInstaller(jobId: string, actorId: string | null, businessIds: string[], opts: { auto?: AutoOfferMeta } = {}) {
  await (await import("./ready-check-booking-access.server")).assertOwnerReadyCheckBooking(jobId);
  const picks = [...new Set(businessIds)];
  const [{ data: job }, { count: inst }, { count: open }] = await Promise.all([
    admin.from("jobs").select("stage, channel, deleted_at, job_number, property_id").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "installer").eq("active", true),
    admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "pending"),
  ]);
  const b = readyCheckOfferStartBlockers({ channel: job?.channel ?? null, stage: job?.stage ?? "", deleted: !job || !!job.deleted_at, hasInstaller: !!inst, openOffers: open ?? 0, picks: picks.length });
  if (b.length) throw new WorkflowError(`The Ready Check offer can't be sent: ${b.join(" ")}`);
  const { candidates } = await (await import("./readycheck-booking.server")).installerCandidatesFor(jobId);
  const c = candidates.find((x) => x.business_id === picks[0]);
  if (!c) throw new WorkflowError("That installer isn't an approved installer for this job.");
  if (c.blocker) throw new WorkflowError(`${c.name} can't take this Ready Check: ${c.blocker}`);
  await (await import("./offer-guard.server")).assertOfferPairsAllowed(jobId, [c.business_id], "ready_check");
  const [{ data: prior }, { data: prop }] = await Promise.all([
    admin.from("partner_offers").select("batch").eq("job_id", jobId).eq("kind", "ready_check"),
    job!.property_id ? admin.from("properties").select("suburb, postcode").eq("id", job!.property_id).maybeSingle() : Promise.resolve({ data: null as { suburb: string | null; postcode: string | null } | null }),
  ]);
  const { READY_CHECK_UNPAID_NOTE } = await import("./readycheck-booking.core");
  const expires = readyCheckOfferExpiry();
  // Decision 246: an automatic offer is the same one-installer offer, flagged so a miss counts towards the 2-miss hand-back.
  const summary = { job_number: job!.job_number ?? "", suburb: prop?.suburb ?? null, postcode: prop?.postcode ?? null, visit: "ready_check", unpaid_note: READY_CHECK_UNPAID_NOTE, office_choice: true, [READY_CHECK_TIMES_FLAG]: true, ...(opts.auto ? { auto_offer: true } : {}) };
  const { data: row, error } = await admin.from("partner_offers").insert({ job_id: jobId, business_id: c.business_id, kind: "ready_check", batch: Math.max(0, ...(prior ?? []).map((o) => Number(o.batch))) + 1, summary: summary as never, offered_by: actorId, expires_at: expires }).select("id").single();
  if (error || !row) throw new Error(error?.message ?? "The offer could not be saved.");
  if (opts.auto) await logEvent(jobId, actorId, "auto_offer_sent", `Automatic installer offer: ${c.name} for the Ready Check (offer ${opts.auto.attempt} of 2, open 24 hours)`, { kind: "ready_check", business_id: c.business_id, business_name: c.name, offer_id: row.id, attempt: opts.auto.attempt, basis: opts.auto.basis, active_jobs: opts.auto.activeJobs, distance_km: opts.auto.distanceKm, expires_at: expires }, { internal: true });
  else await logEvent(jobId, actorId, "trade_chosen_by_office", `Office chose ${c.name} for the Ready Check — offer sent only to them (open 24 hours)`, { kind: "ready_check", business_ids: [c.business_id], business_names: [c.name], business_id: c.business_id, business_name: c.name, expires_at: expires, offer_id: row.id }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to offer the owner Ready Check times" }).eq("id", jobId);
  await (await import("./ready-check-offer-text.server")).textInstallerAboutOffer(row.id).catch((e) => console.error("job offer text skipped", (e as Error).message));
  // Decision 106: the offer email alongside the text (same wording + the offer link).
  await (await import("./ready-check-offer-text.server")).emailInstallerAboutOffer(row.id).catch((e) => console.error("job offer email skipped", (e as Error).message));
  return { offered: 1, exhausted: false, offerId: row.id as string };
}

/** The offer came back (Not for me, or 24 hours passed): back to the office to choose another installer. Never re-offers.
 *  The office item itself is derived from the offer rows (readyCheckOfficeItem), so there is only ever one per job. */
async function offerReturned(jobId: string, actorId: string | null, why: "declined" | "expired", businessId: string) {
  await logEvent(jobId, actorId, "ready_check_offer_returned", why === "declined" ? "The installer said Not for me — back to the office to choose another installer" : "The installer didn't offer times within 24 hours — back to the office to choose another installer", { business_id: businessId, why }, { internal: true });
  await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: choose another installer for the Ready Check" }).eq("id", jobId).eq("stage", "ready_check_ready_to_schedule");
}

/** Installer: "Not for me". */
export async function declineReadyCheckOffer(offerId: string, userId: string, reason: string | null) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, business_id").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "ready_check") throw new WorkflowError("Offer not found.");
  const { data: d } = await admin.from("partner_offers").update({ status: "declined", responded_by: userId, responded_at: new Date().toISOString(), decline_reason: reason }).eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
  if (!d) throw new WorkflowError("This offer is no longer open.");
  await logEvent(o.job_id, userId, "partner_offer_declined", "Installer declined the Ready Check offer", { reason, business_id: o.business_id }, { internal: true });
  await offerReturned(o.job_id, userId, "declined", o.business_id);
  // Decision 246: with Automatic installer offers on, the next match gets it straight away (or the job goes back to the office).
  await (await import("./auto-offer.server")).autoOfferForJob(o.job_id, "ready_check").catch((e) => console.error("automatic installer offer skipped", (e as Error).message));
  return { ok: true };
}

/** 15-minute timer: pending Ready Check offers past 24 hours close and go back to the office (once each). Passed owner
 *  windows (history only) are closed. Stops while owner Ready Check booking is switched off, like every Ready Check timer. */
export async function sweepOfficePickedOffers(actorId: string | null = null, now = new Date(), testJobId?: string) {
  if (testJobId !== undefined) {
    if (!testJobId.trim()) throw new WorkflowError("A TEST job id is required.");
    const { data: job, error } = await admin.from("jobs").select("source").eq("id", testJobId).maybeSingle();
    if (error || job?.source !== "qa_test") throw new WorkflowError("Offer timing QA requires one TEST job.");
  }
  const { data: gate, error: gateError } = await admin.from("workflow_settings").select("ready_check_booking_enabled").eq("id", 1).maybeSingle();
  if (gateError || gate?.ready_check_booking_enabled !== true) return { expired: 0, started: 0 };
  let pendingQuery = admin.from("partner_offers").select("id, job_id, business_id, offered_at, expires_at").eq("kind", "ready_check").eq("status", "pending");
  if (testJobId !== undefined) pendingQuery = pendingQuery.eq("job_id", testJobId);
  const { data: pending, error: pendingError } = await pendingQuery;
  if (pendingError) throw new WorkflowError(pendingError.message);
  let expired = 0;
  for (const o of (pending ?? []).filter((x) => readyCheckOfferOverdue(x, now))) {
    const { data: u } = await admin.from("partner_offers").update({ status: "expired" }).eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!u) continue;
    expired++;
    await logEvent(o.job_id, actorId, "partner_offer_expired", "An installer Ready Check offer closed after 24 hours without times", { kind: "ready_check", business_id: o.business_id }, { internal: true });
    await offerReturned(o.job_id, actorId, "expired", o.business_id);
  }
  let windowsQuery = admin.from("ready_check_windows").update({ status: "closed" }).eq("status", "open").lt("starts_at", now.toISOString());
  if (testJobId !== undefined) windowsQuery = windowsQuery.eq("job_id", testJobId);
  const { error: windowsError } = await windowsQuery;
  if (windowsError) throw new WorkflowError(windowsError.message);
  return { expired, started: 0 };
}

/** Installer accepts an office-picked offer by offering the owner 3 times (decision 52). Times are checked BEFORE accepting. */
export async function acceptOfferWithTimes(offerId: string, userId: string, picks: ReadyCheckPick[], now = new Date()) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, status, business_id, offered_at, expires_at").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "ready_check") throw new WorkflowError("Offer not found.");
  if (o.status !== "pending") throw new WorkflowError("This offer is no longer open.");
  if (readyCheckOfferOverdue(o, now)) throw new WorkflowError("This offer has closed (24 hours passed).");
  const c0 = await context(o.job_id);
  requireOurLead(c0);
  const b = installerTimesBlockers(picks, now);
  if (b.length) throw new WorkflowError(b.join(" "));
  const { data: isInstaller } = await admin.rpc("has_role", { _user_id: userId, _role: "installer" });
  if (!isInstaller) throw new WorkflowError("Only an installer team member can accept a Ready Check.");
  const { data, error } = await admin.rpc("accept_ready_check_offer", { _offer: offerId, _user: userId, _window: null as unknown as string });
  if (error) throw new Error(error.message);
  const outcome = (data as { outcome?: string }[] | null)?.[0]?.outcome ?? "not_found";
  if (outcome === "not_qualified") throw new WorkflowError("Your business needs an approved installer with a Full, current EEC certification recorded by Home Insulation Victoria.");
  if (outcome !== "accepted") throw new WorkflowError(ACCEPT_OUTCOME_MESSAGE[outcome] ?? "This offer could not be accepted.");
  const a = await requireInstaller(o.job_id, userId);
  const starts = startsOf(picks);
  await insertTimes(o.job_id, userId, "installer", a.id, starts);
  await logEvent(o.job_id, userId, "ready_check_times_offered", `Installer accepted the Ready Check and offered the owner ${starts.length} times`, { offer_id: offerId, starts_at: starts, business_id: o.business_id }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the owner to pick one of the installer's Ready Check times" }).eq("id", o.job_id);
  await tellOwner(o.job_id, starts);
  return { ok: true };
}

/** Installer view: whose move, open times, and the days/times they may offer. */
export async function installerReadyCheckState(jobId: string, userId: string) {
  // Speed (decision 280): the access check and the read-only context run together; a refused check still throws first.
  const [, c] = await Promise.all([requireInstaller(jobId, userId), context(jobId)]);
  const canOffer = c.job?.channel === "hivic_sourced" && c.job.stage === "ready_check_ready_to_schedule" && (c.turn === "installer_to_offer" || c.turn === "installer_to_answer");
  const canChange = c.turn === "booked" && changeBlockers(c).length === 0;
  return { ...view(c), applies: c.job?.channel === "hivic_sourced", canChange, days: canOffer || canChange ? allowedReadyCheckDays() : [] };
}

/** Installer offers 3 new times (instead of the owner's days, or after their own times all passed). */
export async function installerOfferNewTimes(jobId: string, userId: string, picks: ReadyCheckPick[]) {
  const a = await requireInstaller(jobId, userId);
  const c = await context(jobId);
  requireOurLead(c);
  if (c.job!.stage !== "ready_check_ready_to_schedule" || (c.turn !== "installer_to_offer" && c.turn !== "installer_to_answer")) throw new WorkflowError("Ready Check times can't be offered right now.");
  const b = installerTimesBlockers(picks);
  if (b.length) throw new WorkflowError(b.join(" "));
  const starts = startsOf(picks);
  await insertTimes(jobId, userId, "installer", a.id, starts);
  await logEvent(jobId, userId, "ready_check_times_offered", `Installer offered the owner ${starts.length} new Ready Check times`, { starts_at: starts, instead_of_owner_days: c.turn === "installer_to_answer" }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the owner to pick one of the installer's Ready Check times" }).eq("id", jobId);
  await tellOwner(jobId, starts);
  return { ok: true };
}

/** Agreed time → confirmed Ready Check booking (all booking guards and stage move), then the Mitti form. */
async function bookAgreedTime(jobId: string, proposalId: string, startsAt: string, actorId: string, roleLabel: string) {
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "ready_check", startsAt, actorId, roleLabel);
    // Confirmed booking starts the Mitti form in the background (never undoes the booking if it can't).
    await (await import("./mitti-create.server")).onReadyCheckBooked(jobId, actorId).catch((err) => console.error("ready check form not scheduled", (err as Error).message));
    await tellBookedKeepGoing(jobId, startsAt);
  } catch (e) {
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("id", proposalId);
    await logEvent(jobId, actorId, "ready_check_time_booking_blocked", `Ready Check time agreed but booking not confirmed: ${(e as Error).message}`, { proposal_id: proposalId }, { internal: true });
    throw e;
  }
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed");
  await admin.from("jobs").update({ next_action: "Ready Check booked" }).eq("id", jobId);
  return { ok: true, booked: true };
}

/** Compare-and-swap: a time is taken once. */
async function claim(proposalId: string, assignmentId: string, userId: string, note: string, startsAt?: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.from("appointment_proposals").update({ status: "accepted", assignment_id: assignmentId, responded_by: userId, responded_at: nowIso, response_note: note, ...(startsAt ? { starts_at: startsAt } : {}) })
    .eq("id", proposalId).eq("status", "proposed").gt("starts_at", nowIso).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new WorkflowError("That time has just been taken or has passed.");
}

/** Installer takes one of the owner's suggested days at the arrival time they choose = booked. */
export async function installerTakeOwnerDay(jobId: string, proposalId: string, userId: string, time: string) {
  if (!isReadyCheckTime(time)) throw new WorkflowError("Please choose a time.");
  const a = await requireInstaller(jobId, userId);
  const c = await context(jobId);
  requireOurLead(c);
  const p = c.turn === "installer_to_answer" ? c.open.find((x) => x.id === proposalId) : undefined;
  if (!p) throw new WorkflowError("That day is not available.");
  const start = readyCheckStartAt(melbourneYmd(new Date(p.starts_at)), time);
  if (start.getTime() < Date.now() + 24 * 3_600_000) throw new WorkflowError("The time must be at least 24 hours away.");
  await claim(proposalId, a.id, userId, "Installer took the owner's day", start.toISOString());
  await logEvent(jobId, userId, "ready_check_time_taken", "Installer took one of the owner's Ready Check days", { proposal_id: proposalId, starts_at: start.toISOString() }, { internal: true });
  return bookAgreedTime(jobId, proposalId, start.toISOString(), userId, "installer (owner's suggested day)");
}

/** Owner view (secure link). `days` = days the owner may suggest when it's their move. Never shows the owner's details. */
export async function ownerReadyCheckTimesState(jobId: string) {
  const c = await context(jobId);
  if (!c.job || c.job.channel !== "hivic_sourced") return { applies: false as const };
  const access = await (await import("./ready-check-booking-access.server")).readyCheckBookingAccess(jobId);
  const waiting = c.job.stage === "ready_check_ready_to_schedule" || c.job.stage === "ready_check_scheduled";
  return { applies: waiting, allowed: access.allowed, ...view(c), canChange: access.allowed && c.turn === "booked" && changeBlockers(c).length === 0, days: c.turn === "owner_to_answer" ? allowedReadyCheckDays() : [] };
}

async function ownerGuard(jobId: string) {
  await (await import("./ready-check-booking-access.server")).assertOwnerReadyCheckBooking(jobId);
  const c = await context(jobId);
  requireOurLead(c);
  if (c.job!.stage !== "ready_check_ready_to_schedule") throw new WorkflowError("Your Ready Check can't be changed here right now.");
  return c;
}

/** Owner takes one of the installer's times = booked. */
export async function ownerTakeReadyCheckTime(jobId: string, proposalId: string, userId: string) {
  const c = await ownerGuard(jobId);
  const p = c.turn === "owner_to_answer" ? c.open.find((x) => x.id === proposalId) : undefined;
  if (!p || !c.asg) throw new WorkflowError("That time is not available.");
  await claim(proposalId, c.asg.id, userId, "Owner took this installer Ready Check time");
  await logEvent(jobId, userId, "ready_check_time_taken", "Owner took one of the installer's Ready Check times", { proposal_id: proposalId, starts_at: p.starts_at }, { internal: true });
  return bookAgreedTime(jobId, proposalId, p.starts_at, userId, "owner (installer's offered time)");
}

/** Owner: none of the installer's times suit → suggest 1–5 days; the installer picks the time. */
export async function ownerSuggestReadyCheckDays(jobId: string, userId: string, days: string[]) {
  const c = await ownerGuard(jobId);
  if (c.turn !== "owner_to_answer") throw new WorkflowError("Ready Check days can't be suggested right now.");
  const b = ownerDaysBlockers(days);
  if (b.length) throw new WorkflowError(b.join(" "));
  const { melbourneAt } = await import("./piesa-windows.core");
  await insertTimes(jobId, userId, "owner", c.asg?.id ?? null, days.map((d) => melbourneAt(d, 7).toISOString()));
  await logEvent(jobId, userId, "ready_check_days_suggested", `Owner suggested ${days.length} other Ready Check day${days.length === 1 ? "" : "s"}`, { days }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to take one of the owner's days or offer new times" }).eq("id", jobId);
  // Decision 79: the installer is told once per suggestion (the event just written is the trigger and the key).
  const { data: ev } = await admin.from("workflow_events").select("id, created_at").eq("job_id", jobId).eq("event_type", "ready_check_days_suggested").order("created_at", { ascending: false }).limit(1).maybeSingle();
  await tellInstallerDaysSuggested(jobId, ev?.id ?? null, ev?.created_at ?? new Date().toISOString());
  return { ok: true };
}

/** Decision 80 (Jo 24 Oct 2026), owner side: "Change time" cancels the booked Ready Check and hands it back to the same
 *  installer to offer 3 new times (back and forth as before; the installer's job list shows it as their move). Mirrors
 *  changeInstallDay: the booking is restored if the stage can't move back. No office step, nothing sent. */
export async function ownerChangeReadyCheck(jobId: string, userId: string) {
  await (await import("./ready-check-booking-access.server")).assertOwnerReadyCheckBooking(jobId);
  const c = await context(jobId);
  const b = changeBlockers(c);
  if (b.length) throw new WorkflowError(b.join(" "));
  if (!c.asg) throw new WorkflowError("This job has no installer yet.");
  const { data: rows, error } = await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").select("id");
  if (error) throw new Error(error.message);
  if (!rows?.length) throw new WorkflowError("There is no booked Ready Check to change.");
  const { transition } = await import("./workflow.server");
  try {
    await transition(jobId, "ready_check_ready_to_schedule", userId, "Ready Check time changed by the owner – the installer offers new times", { booking_ids: rows.map((r) => r.id) });
  } catch (e) {
    await admin.from("bookings").update({ status: "confirmed" }).in("id", rows.map((r) => r.id));
    throw e;
  }
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed");
  await logEvent(jobId, userId, "ready_check_changed", "Owner changed the booked Ready Check time — back to the installer to offer 3 new times", { by: "owner", booking_ids: rows.map((r) => r.id), was: c.bookedAt, business_id: c.asg.business_id }, { internal: true });
  await admin.from("jobs").update({ next_action: "Waiting for the installer to offer the owner new Ready Check times" }).eq("id", jobId);
  // Decision 337: the installer is told straight away (once per change; best-effort, never undoes the change).
  try {
    const { data: ev } = await admin.from("workflow_events").select("id, created_at").eq("job_id", jobId).eq("event_type", "ready_check_changed").contains("details", { by: "owner" }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) await (await import("./installer-texts.server")).textTradeOwnerChangedVisit({ jobId, kind: "ready_check", triggerEventId: ev.id, changedAt: ev.created_at, wasIso: c.bookedAt ?? null });
  } catch (e) { console.error("owner changed Ready Check installer text skipped", (e as Error).message); }
  return { ok: true };
}

/** Decision 80, installer side: "Change time" = the installer sets a new day + time directly (same rules as offers) and it
 *  rebooks through confirmBooking (reschedule at ready_check_scheduled: old booking cancelled, new one confirmed). */
export async function installerChangeReadyCheck(jobId: string, userId: string, pick: ReadyCheckPick, now = new Date()) {
  await requireInstaller(jobId, userId);
  const c = await context(jobId);
  const b = [...changeBlockers(c, now)];
  if (!b.length) b.push(...installerRebookBlockers(pick, c.bookedAt, now));
  if (b.length) throw new WorkflowError(b.join(" "));
  const start = readyCheckStartAt(pick.day, pick.time).toISOString();
  const { confirmBooking } = await import("./booking.server");
  await confirmBooking(jobId, "ready_check", start, userId, "installer (changed time)");
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed");
  await logEvent(jobId, userId, "ready_check_changed", "Installer changed the booked Ready Check to a new time", { by: "installer", was: c.bookedAt, starts_at: start }, { internal: true });
  await admin.from("jobs").update({ next_action: "Ready Check booked" }).eq("id", jobId);
  await tellBookedKeepGoing(jobId, start);
  return { ok: true, booked: true };
}

/** Installer dashboard: owner-suggested days waiting on this installer (no owner details). */
export async function installerOpenReadyCheckDays(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("appointment_proposals").select("id, job_id, starts_at, proposer_role").in("job_id", jobIds).eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed").order("starts_at");
  const now = Date.now();
  return (data ?? []).filter((r) => r.proposer_role === "owner" && Date.parse(r.starts_at) > now);
}
