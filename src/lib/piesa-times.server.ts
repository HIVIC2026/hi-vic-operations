// Decision 333 (Jo, 25 Oct 2026): the electrician offers the owner 3 safety check (PIESA) times; the owner takes one
// (booked) or suggests 1–5 days; the electrician takes one at a time they choose (booked) or offers 3 new times — back and
// forth until agreed, no office step. Rules: piesa-times.core.ts. Storage: appointment_proposals (kind assessment, note
// PIESA_TIME_NOTE). Every booking goes through confirmBooking(…, "assessment", …) — the same stage, payment-gate and
// assignment guards as before — which also sends the O26 booked email. Offering times sends O26 "safety check times"
// (owner-email-triggers.server onSafetyCheckTimesOffered, best-effort). Old jobs mid-flow under the owner-window way
// (allocation.server submitOwnerPiesaWindows / accept_partner_offer_slot) are untouched and still finish that way.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  OWNER_DAY_ANCHOR_TIME, PIESA_TIMES_NEXT_ACTION, PIESA_TIME_NOTE, allowedPiesaTimeDays, electricianPiesaTimesBlockers, electricianTakeDayBlocker, ownerPiesaDaysBlockers, ownerPiesaMoveBlocker,
  piesaStartAt, piesaTimeTurn, type PiesaProposalRow, type PiesaTimePick,
} from "./piesa-times.core";
import { melbourneYmd } from "./piesa-windows.core";

const PIESA_STAGES = ["piesa_and_install_window_pending", "piesa_scheduled"];

async function context(jobId: string) {
  const nowIso = new Date().toISOString();
  const [{ data: job }, { data: asg }, { data: booked }, { data: rows }, { count: legacyOpen }] = await Promise.all([
    admin.from("jobs").select("id, stage, source, deleted_at").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed").limit(1).maybeSingle(),
    admin.from("appointment_proposals").select("id, proposer_role, starts_at, status, note, piesa_window_round, electrician_window, install_day").eq("job_id", jobId).eq("kind", "assessment").order("starts_at"),
    admin.from("appointment_proposals").select("id", { count: "exact", head: true }).eq("job_id", jobId).not("piesa_window_round", "is", null).eq("status", "proposed").gt("starts_at", nowIso),
  ]);
  const { turn, open } = piesaTimeTurn({ booked: !!booked, hasElectrician: !!asg, legacyOwnerWindowsOpen: legacyOpen ?? 0, rows: (rows ?? []) as PiesaProposalRow[] });
  return { job, asg, booked: !!booked, bookedAt: booked?.scheduled_start ?? null, turn, open };
}
type Ctx = Awaited<ReturnType<typeof context>>;

const view = (c: Ctx) => ({
  turn: c.turn, booked: c.booked, bookedAt: c.bookedAt,
  open: c.open.map((p) => ({ id: p.id, starts_at: p.starts_at, by: p.proposer_role === "electrician" ? "electrician" as const : "owner" as const })),
});

function requireStage(c: Ctx) {
  if (!c.job || c.job.deleted_at) throw new WorkflowError("This job is no longer available.");
  if (c.job.stage !== "piesa_and_install_window_pending") throw new WorkflowError("Safety check times can't be arranged right now.");
}

/** The job's active electrician (or a member of their business). */
async function requireElectrician(jobId: string, userId: string) {
  const { data: a } = await admin.from("job_assignments").select("id, user_id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!a) throw new WorkflowError("This job has no electrician yet.");
  if (a.user_id !== userId) {
    const { data: m } = await admin.from("business_members").select("id").eq("business_id", a.business_id ?? "").eq("user_id", userId).eq("active", true).maybeSingle();
    if (!m) throw new WorkflowError("Only the job's electrician can arrange the safety check.");
  }
  return a;
}

/** Same PIESA gate the old "propose a time" panel and confirmBooking use (payment rule, quote, Ready Check…). */
async function requirePiesaGate(jobId: string) {
  const { piesaRequestFacts } = await import("./workflow.server");
  const { piesaRequestBlockers } = await import("./payment-gate.core");
  const gate = piesaRequestBlockers(await piesaRequestFacts(jobId));
  if (gate.length) throw new WorkflowError(`The safety check cannot be arranged yet: ${gate.join(" ")}`);
}

async function insertTimes(jobId: string, userId: string | null, role: "electrician" | "owner", assignmentId: string | null, starts: string[]) {
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").is("piesa_window_round", null).eq("electrician_window", false).eq("status", "proposed");
  const rows = starts.map((s) => ({ job_id: jobId, kind: "assessment" as const, proposed_by: userId, proposer_role: role, assignment_id: assignmentId, starts_at: s, note: PIESA_TIME_NOTE }));
  const { error } = await admin.from("appointment_proposals").insert(rows as never);
  if (error) throw new Error(error.message);
}

/** Compare-and-swap: a time is taken once. */
async function claim(proposalId: string, assignmentId: string, userId: string | null, note: string, startsAt?: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.from("appointment_proposals").update({ status: "accepted", assignment_id: assignmentId, responded_by: userId, responded_at: nowIso, response_note: note, ...(startsAt ? { starts_at: startsAt } : {}) } as never)
    .eq("id", proposalId).eq("status", "proposed").gt("starts_at", nowIso).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new WorkflowError("That time has just been taken or has passed.");
}

/** Agreed time → confirmed PIESA booking (confirmBooking: stage, PIESA gate, electrician; O26 booked email). */
async function bookAgreedTime(jobId: string, proposalId: string, startsAt: string, actorId: string | null, roleLabel: string) {
  try {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(jobId, "assessment", startsAt, actorId as string, roleLabel);
  } catch (e) {
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("id", proposalId);
    await logEvent(jobId, actorId, "piesa_time_booking_blocked", `Safety check time agreed but booking not confirmed: ${(e as Error).message}`, { proposal_id: proposalId }, { internal: true });
    throw e;
  }
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("note", PIESA_TIME_NOTE).eq("status", "proposed");
  return { ok: true, booked: true };
}

const startsOf = (picks: PiesaTimePick[]) => picks.map((p) => piesaStartAt(p.day, p.time).toISOString());

// ---------- Electrician ----------

/** Electrician view: whose move, open times, and the days they may offer. */
export async function electricianPiesaTimesState(jobId: string, userId: string) {
  const [, c] = await Promise.all([requireElectrician(jobId, userId), context(jobId)]);
  const canOffer = c.job?.stage === "piesa_and_install_window_pending" && (c.turn === "electrician_to_offer" || c.turn === "electrician_to_answer");
  return { ...view(c), applies: !!c.job && PIESA_STAGES.includes(c.job.stage as string), days: canOffer ? allowedPiesaTimeDays() : [] };
}

/** Electrician offers 3 times (first offer, instead of the owner's days, or after their own times all passed). */
export async function electricianOfferPiesaTimes(jobId: string, userId: string, picks: PiesaTimePick[]) {
  const a = await requireElectrician(jobId, userId);
  const c = await context(jobId);
  requireStage(c);
  if (c.turn !== "electrician_to_offer" && c.turn !== "electrician_to_answer") throw new WorkflowError("Safety check times can't be offered right now.");
  const b = electricianPiesaTimesBlockers(picks);
  if (b.length) throw new WorkflowError(b.join(" "));
  await requirePiesaGate(jobId);
  const starts = startsOf(picks);
  await insertTimes(jobId, userId, "electrician", a.id, starts);
  // First contact counts towards the electrician's 48h response clock (appointmentSla), as the old propose-a-time did.
  await admin.from("job_assignments").update({ first_response_at: new Date().toISOString() }).eq("id", a.id).is("first_response_at", null);
  await logEvent(jobId, userId, "piesa_times_offered", `Electrician offered the owner ${starts.length} safety check times`, { starts_at: starts, instead_of_owner_days: c.turn === "electrician_to_answer" }, { internal: true });
  await admin.from("jobs").update({ next_action: PIESA_TIMES_NEXT_ACTION.owner_to_answer }).eq("id", jobId);
  // O26 "Pick a time for your electrical safety check" (best-effort; the offer stands either way).
  await (await import("./owner-email-triggers.server")).onSafetyCheckTimesOffered(jobId, starts).catch((e) => console.error("safety check times email skipped", (e as Error).message));
  return { ok: true };
}

/** Electrician takes one of the owner's suggested days at the arrival time they choose = booked. */
export async function electricianTakeOwnerPiesaDay(jobId: string, proposalId: string, userId: string, time: string) {
  const a = await requireElectrician(jobId, userId);
  const c = await context(jobId);
  requireStage(c);
  const p = c.turn === "electrician_to_answer" ? c.open.find((x) => x.id === proposalId) : undefined;
  if (!p) throw new WorkflowError("That day is not available.");
  const day = melbourneYmd(new Date(p.starts_at));
  const blocker = electricianTakeDayBlocker(day, time);
  if (blocker) throw new WorkflowError(blocker);
  const start = piesaStartAt(day, time).toISOString();
  await claim(proposalId, a.id, userId, "Electrician took the owner's day", start);
  await logEvent(jobId, userId, "piesa_time_taken", "Electrician took one of the owner's safety check days", { proposal_id: proposalId, starts_at: start }, { internal: true });
  return bookAgreedTime(jobId, proposalId, start, userId, "electrician (owner's suggested day)");
}

/** Trade offer page: accept a PIESA offer that carries no owner windows by offering the owner 3 times. The times are
 *  checked BEFORE the offer is accepted, so a bad pick never leaves an accepted offer without times. */
export async function acceptPiesaOfferWithTimes(offerId: string, userId: string, picks: PiesaTimePick[]) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, kind, status").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "piesa") throw new WorkflowError("Offer not found.");
  if (o.status !== "pending") throw new WorkflowError("This offer is no longer open.");
  const b = electricianPiesaTimesBlockers(picks);
  if (b.length) throw new WorkflowError(b.join(" "));
  const { respondToRecOffer } = await import("./allocation.server");
  await respondToRecOffer(offerId, userId, true, null, null);
  return electricianOfferPiesaTimes(o.job_id, userId, picks);
}

// ---------- Owner (secure link or owner portal; the caller has already checked who they are) ----------

/** Owner view. `days` = days the owner may suggest when it's their move; `ackNeeded` = the 30-day box (decision 307). */
export async function ownerPiesaTimesState(jobId: string) {
  const [c, ack] = await Promise.all([context(jobId), (await import("./thirty-day-ack.server")).ownerThirtyDayAckState(jobId)]);
  // measured_quote_accepted: accepted, electrician not yet chosen — the owner is told their electrician will offer times.
  return { ...view(c), applies: !!c.job && ["measured_quote_accepted", ...PIESA_STAGES].includes(c.job.stage as string), days: c.turn === "owner_to_answer" ? allowedPiesaTimeDays() : [], thirtyDayAck: { needed: ack.needed, wording: ack.wording } };
}

type OwnerMeta = { understandsThirtyDays: boolean | undefined; ip: string | null; userAgent: string | null };

/** Turn + 30-day box first (refuses without the tick), then records the acknowledgement once per cycle. */
async function ownerGuard(jobId: string, userId: string | null, meta: OwnerMeta) {
  const c = await context(jobId);
  requireStage(c);
  const tsa = await import("./thirty-day-ack.server");
  const ack = await tsa.ownerThirtyDayAckState(jobId);
  const b = ownerPiesaMoveBlocker({ turn: c.turn, ackNeeded: ack.needed, understandsThirtyDays: meta.understandsThirtyDays });
  if (b) throw new WorkflowError(b);
  await tsa.requireOwnerThirtyDayAck({ jobId, userId, understandsThirtyDays: meta.understandsThirtyDays, ip: meta.ip, userAgent: meta.userAgent });
  return c;
}

/** Owner takes one of the electrician's times = booked. */
export async function ownerTakePiesaTime(jobId: string, proposalId: string, userId: string | null, meta: OwnerMeta) {
  const c = await ownerGuard(jobId, userId, meta);
  const p = c.open.find((x) => x.id === proposalId);
  if (!p || !c.asg) throw new WorkflowError("That time is not available.");
  await claim(proposalId, c.asg.id, userId, "Owner took this electrician safety check time");
  await logEvent(jobId, userId, "piesa_time_taken", "Owner took one of the electrician's safety check times", { proposal_id: proposalId, starts_at: p.starts_at }, { internal: true });
  return bookAgreedTime(jobId, proposalId, p.starts_at, userId, "owner (electrician's offered time)");
}

/** Owner: none of the electrician's times suit → suggest 1–5 days; the electrician picks the time. */
export async function ownerSuggestPiesaDays(jobId: string, userId: string | null, days: string[], meta: OwnerMeta) {
  const b = ownerPiesaDaysBlockers(days);
  if (b.length) throw new WorkflowError(b.join(" "));
  const c = await ownerGuard(jobId, userId, meta);
  await insertTimes(jobId, userId, "owner", c.asg?.id ?? null, days.map((d) => piesaStartAt(d, OWNER_DAY_ANCHOR_TIME).toISOString()));
  await logEvent(jobId, userId, "piesa_days_suggested", `Owner suggested ${days.length} other safety check day${days.length === 1 ? "" : "s"}`, { days }, { internal: true });
  await admin.from("jobs").update({ next_action: PIESA_TIMES_NEXT_ACTION.electrician_to_answer }).eq("id", jobId);
  return { ok: true };
}

/** Electrician job list: owner-suggested days waiting on the electrician (no owner details). */
export async function electricianOpenPiesaDays(jobIds: string[]) {
  if (!jobIds.length) return [];
  const { data } = await admin.from("appointment_proposals").select("id, job_id, starts_at, proposer_role").in("job_id", jobIds).eq("kind", "assessment").eq("note", PIESA_TIME_NOTE).eq("status", "proposed").order("starts_at");
  const now = Date.now();
  return (data ?? []).filter((r) => r.proposer_role === "owner" && Date.parse(r.starts_at) > now);
}
