// Cancellations, no-shows, arrivals and real reliability for all four visit types.
// Rules: visit-events.core.ts. Events are permanent rows in visit_events (append-only).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, transition } from "./workflow.server";
import {
  BOOKED_STAGE, VISIT_LABEL, canMarkArrived, canMarkOwnerNotHome, ownerChangeAllowed, ownerMissOutcome, reliabilityFacts,
  reopenPlan, tradeNoShowDue, type VisitEventRow, type VisitKind, type VisitNeedsCode,
} from "./visit-events.core";

type Booking = { id: string; job_id: string; kind: VisitKind; scheduled_start: string; business_id: string | null; assignment_id: string | null; contractor_id: string | null };

async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function currentBooking(jobId: string, kind?: VisitKind): Promise<Booking | null> {
  let q = admin.from("bookings").select("id, job_id, kind, scheduled_start, business_id, assignment_id, contractor_id").eq("job_id", jobId).eq("status", "confirmed");
  if (kind) q = q.eq("kind", kind);
  const { data } = await q.order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  return (data as Booking | null) ?? null;
}

async function record(b: Booking, event: string, countsAgainst: "owner" | "trade" | "none", actorId: string | null, reason: string | null) {
  const { error } = await admin.from("visit_events").insert({ job_id: b.job_id, booking_id: b.id, business_id: b.business_id, visit_kind: b.kind, event, counts_against: countsAgainst, actor_id: actorId, reason });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  return !error;
}

async function needsOffice(jobId: string, code: VisitNeedsCode, kind: VisitKind, bookingId: string | null, summary: string) {
  await logEvent(jobId, null, "visit_needs_office", summary, { code, kind, booking_id: bookingId }, { internal: true });
  await admin.from("jobs").update({ next_action: `Needs Home Insulation Victoria: ${summary}` }).eq("id", jobId);
}

/** Queue (never send) the "please pick new times" owner message. Delivery follows the sending switches. */
async function queueOwnerNewTimes(jobId: string, b: Booking) {
  if (b.kind === 'ready_check' && !(await (await import('./ready-check-booking-access.server')).readyCheckBookingAccess(jobId)).allowed) return;
  const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "visit_times_reopened").contains("details", { booking_id: b.id }).limit(1).maybeSingle();
  if (!ev) return;
  const { error } = await admin.rpc("enqueue_external_action", {
    _job: jobId, _event: ev.id, _action: "customer_email", _target: `job:${jobId}`, _basis: "transactional_job_coordination",
    _version: "visit-new-times-v1", _payload: `visit_new_times:${b.kind}`, _facts: await sha256Hex(`${jobId}-${b.id}-new-times`), _key: `visit-new-times-${b.id}`,
  });
  if (error) console.error("new-times outbox enqueue skipped", error.message); // e.g. TEST job suppression
}

/** Cancel the booking and send the visit back to "pick times" (or to the office for rectification). */
async function reopen(b: Booking, actorId: string | null, why: string, releaseTradeOverride?: boolean) {
  const plan = reopenPlan(b.kind);
  const release = releaseTradeOverride ?? plan.releaseTrade;
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id).eq("status", "confirmed");
  if (b.kind === "installation") {
    const { clearInstallDueDate } = await import("./install-balance.server");
    await clearInstallDueDate(b.job_id, actorId).catch((e) => console.error("due date not cleared", (e as Error).message));
    const { regenerateEscNotification } = await import("./esc.server"); // existing ESC update/withdraw flags apply
    await regenerateEscNotification(b.job_id, actorId as string).catch((e) => console.error("ESC not regenerated", (e as Error).message));
  }
  if (release && b.assignment_id) {
    await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: why.slice(0, 300) }).eq("id", b.assignment_id).eq("active", true);
    await admin.from("partner_offers").update({ status: "withdrawn", superseded_at: new Date().toISOString() }).eq("job_id", b.job_id).eq("status", "pending");
  }
  const { data: job } = await admin.from("jobs").select("stage").eq("id", b.job_id).single();
  if (job?.stage === BOOKED_STAGE[b.kind]) await transition(b.job_id, plan.stage as never, actorId, `${VISIT_LABEL[b.kind]} booking cancelled: ${why}`, { booking_id: b.id });
  if (plan.office) { await needsOffice(b.job_id, "rectification_new_times", b.kind, b.id, "Electrical fixes visit cancelled — arrange new times with the electrician and owner"); return; }
  if (b.kind === 'ready_check' && !(await (await import('./ready-check-booking-access.server')).readyCheckBookingAccess(b.job_id)).allowed) return;
  await logEvent(b.job_id, actorId, "visit_times_reopened", `${VISIT_LABEL[b.kind]}: owner asked to pick new times (prepared; delivery follows the sending switches)`, { booking_id: b.id, kind: b.kind, released_trade: release }, { internal: true });
  await admin.from("jobs").update({ next_action: `Waiting for the owner to pick new ${VISIT_LABEL[b.kind]} times` }).eq("id", b.job_id);
  await queueOwnerNewTimes(b.job_id, b);
}

/** Owner misses (late change or not home): first = one free rebook, second = office. */
async function ownerMiss(b: Booking, event: "owner_late_change" | "owner_no_show", actorId: string | null, reason: string | null) {
  const { count } = await admin.from("visit_events").select("id", { count: "exact", head: true }).eq("job_id", b.job_id).eq("visit_kind", b.kind).in("event", ["owner_late_change", "owner_no_show"]);
  const fresh = await record(b, event, "owner", actorId, reason);
  if (!fresh) return { outcome: "already_recorded" as const };
  if (ownerMissOutcome(count ?? 0) === "rebook") { await reopen(b, actorId, event === "owner_no_show" ? "owner not home (one free rebook)" : "owner changed within 24 hours (one free rebook)", b.kind === "installation" ? false : undefined); return { outcome: "rebook" as const }; }
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id).eq("status", "confirmed");
  await needsOffice(b.job_id, "owner_no_show_repeat", b.kind, b.id, `Owner missed the ${VISIT_LABEL[b.kind]} a second time`);
  // Stage 5 (Jo 23 Oct): second missed Ready Check releases the Mitti form (rebooking creates a fresh one).
  if (b.kind === "ready_check") await (await import("./mitti-pickup.server")).releaseReadyCheckFormOnCancel(b.job_id, actorId, "owner missed the visit twice").catch(() => undefined);
  return { outcome: "needs_office" as const };
}

/** Owner (by link or owner page): reschedule or cancel. Within 24h it counts as a no-show. */
export async function ownerChangeVisit(jobId: string, kind: VisitKind, action: "reschedule" | "cancel", actorId: string | null, reason: string | null, now = new Date()) {
  const b = await currentBooking(jobId, kind);
  if (!b) throw new WorkflowError("There is no booked visit to change.");
  if (Date.parse(b.scheduled_start) <= now.getTime()) throw new WorkflowError("This visit has already started.");
  if (!ownerChangeAllowed(b.scheduled_start, now)) return { late: true, ...(await ownerMiss(b, "owner_late_change", actorId, reason ?? `Owner ${action} within 24 hours`)) };
  await record(b, action === "reschedule" ? "owner_rescheduled" : "owner_cancelled", "none", actorId, reason);
  if (action === "reschedule") { await reopen(b, actorId, "owner rescheduled", b.kind === "installation" ? false : undefined); return { late: false, outcome: "rebook" as const }; }
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id).eq("status", "confirmed");
  if (b.kind === "installation") {
    const { clearInstallDueDate } = await import("./install-balance.server");
    await clearInstallDueDate(jobId, actorId).catch(() => undefined);
    const { regenerateEscNotification } = await import("./esc.server");
    await regenerateEscNotification(jobId, actorId as string).catch(() => undefined);
  }
  await needsOffice(jobId, "owner_cancelled_visit", b.kind, b.id, `Owner cancelled the ${VISIT_LABEL[b.kind]}${reason ? ` (${reason})` : ""}`);
  // Stage 5 (Jo 23 Oct): a cancelled Ready Check releases the Mitti form so a rebooking creates a fresh one.
  if (b.kind === "ready_check") await (await import("./mitti-pickup.server")).releaseReadyCheckFormOnCancel(jobId, actorId, "owner cancelled the visit").catch(() => undefined);
  return { late: false, outcome: "cancelled" as const };
}

/** Decision 337: the booked safety check as the owner's secure My job link shows it (times only), or null. */
export async function ownerPiesaBookingState(jobId: string, now = new Date()) {
  const [b, { data: job }] = await Promise.all([currentBooking(jobId, "assessment"), admin.from("jobs").select("stage").eq("id", jobId).maybeSingle()]);
  if (!b || job?.stage !== BOOKED_STAGE.assessment) return null;
  const started = Date.parse(b.scheduled_start) <= now.getTime();
  return { startsAt: b.scheduled_start, canChange: !started, late: !started && !ownerChangeAllowed(b.scheduled_start, now) };
}

/** Decision 337: the owner changes the booked safety check from their secure My job link. Same rules as the signed-in
 *  owner page (`ownerChangeVisit` reschedule: within 24h = one free rebook, a second miss = office), then the electrician
 *  business that held the booking (read BEFORE it is released) is told once. New times go out as a new PIESA offer. */
export async function ownerChangeBookedPiesa(jobId: string, actorId: string | null, now = new Date()) {
  const b = await currentBooking(jobId, "assessment");
  if (!b) throw new WorkflowError("There is no booked safety check to change.");
  const { data: job } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (job?.stage !== BOOKED_STAGE.assessment) throw new WorkflowError("Your safety check can't be changed here right now.");
  let electricianBusinessId = b.business_id;
  if (!electricianBusinessId && b.assignment_id) {
    const { data: a } = await admin.from("job_assignments").select("business_id").eq("id", b.assignment_id).maybeSingle();
    electricianBusinessId = a?.business_id ?? null;
  }
  const r = await ownerChangeVisit(jobId, "assessment", "reschedule", actorId, "Owner changed the safety check time on My job", now);
  try {
    const { data: ev } = await admin.from("visit_events").select("id, created_at").eq("booking_id", b.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) await (await import("./installer-texts.server")).textTradeOwnerChangedVisit({ jobId, kind: "assessment", triggerEventId: ev.id, changedAt: ev.created_at, wasIso: b.scheduled_start, electricianBusinessId });
  } catch (e) { console.error("owner changed safety check electrician text skipped", (e as Error).message); }
  return r;
}

async function requireBookingTrade(b: Booking, userId: string) {
  if (b.contractor_id === userId) return;
  const { data: m } = await admin.from("business_members").select("id").eq("business_id", b.business_id ?? "").eq("user_id", userId).eq("active", true).maybeSingle();
  if (!m) throw new WorkflowError("Only the booked trade can do this.");
}

export async function tradeArrived(jobId: string, userId: string, now = new Date()) {
  const b = await currentBooking(jobId);
  if (!b) throw new WorkflowError("No booked visit.");
  await requireBookingTrade(b, userId);
  if (!canMarkArrived(b.scheduled_start, now)) throw new WorkflowError("Arrival can be marked from 2 hours before the visit until 4 hours after it starts.");
  await record(b, "trade_arrived", "none", userId, null);
  await logEvent(jobId, userId, "trade_arrived", `${VISIT_LABEL[b.kind]}: trade marked arrived`, { booking_id: b.id }, { internal: true });
  return { ok: true };
}

export async function tradeOwnerNotHome(jobId: string, userId: string, note: string | null, now = new Date()) {
  const b = await currentBooking(jobId);
  if (!b) throw new WorkflowError("No booked visit.");
  await requireBookingTrade(b, userId);
  if (!canMarkOwnerNotHome(b.scheduled_start, now)) throw new WorkflowError("You can mark the owner not home once the visit time has started.");
  await record(b, "trade_arrived", "none", userId, "arrived; owner not home");
  return ownerMiss(b, "owner_no_show", userId, note ?? "Owner not home");
}

/** Trade cancels: owner automatically offered new times; reliability drops. Installer is never replaced. */
export async function tradeCancelVisit(jobId: string, userId: string, reason: string) {
  const b = await currentBooking(jobId);
  if (!b) throw new WorkflowError("No booked visit.");
  await requireBookingTrade(b, userId);
  await record(b, "trade_cancelled", "trade", userId, reason);
  await reopen(b, userId, `trade cancelled: ${reason}`);
  return { ok: true };
}

/** Timer: trade no-show 4h after start with no arrival and no evidence -> needs attention; reliability drops. */
export async function sweepTradeNoShows(now = new Date()) {
  const from = new Date(now.getTime() - 7 * 86_400_000).toISOString(), to = new Date(now.getTime() - 4 * 3_600_000).toISOString();
  const { data } = await admin.from("bookings").select("id, job_id, kind, scheduled_start, business_id, assignment_id, contractor_id, jobs!inner(deleted_at, source)").is("jobs.deleted_at", null).eq("status", "confirmed").gte("scheduled_start", from).lte("scheduled_start", to);
  let flagged = 0;
  for (const raw of data ?? []) {
    if ((raw.jobs as { source?: string | null } | null)?.source === "qa_test") continue; // Test Centre jobs never enter automation
    const b = raw as unknown as Booking;
    const [{ count: ev }, { count: arr }] = await Promise.all([
      admin.from("evidence_files").select("id", { count: "exact", head: true }).eq("job_id", b.job_id).gte("uploaded_at", b.scheduled_start),
      admin.from("visit_events").select("id", { count: "exact", head: true }).eq("booking_id", b.id).in("event", ["trade_arrived", "trade_no_show"]),
    ]);
    if (!tradeNoShowDue({ startIso: b.scheduled_start, arrived: !!arr, evidenceSinceStart: ev ?? 0 }, now)) continue;
    if (!(await record(b, "trade_no_show", "trade", null, "No arrival and no evidence 4 hours after the visit start"))) continue;
    await needsOffice(b.job_id, "trade_no_show", b.kind, b.id, `Trade did not arrive for the ${VISIT_LABEL[b.kind]}`);
    flagged++;
  }
  return { flagged };
}

/** Office: clear a wrong no-show (reason required). The original row stays. */
export async function clearNoShow(eventId: string, actorId: string, reason: string) {
  const { data: e } = await admin.from("visit_events").select("id, job_id, event").eq("id", eventId).single();
  if (!e || !["trade_no_show", "owner_no_show", "owner_late_change"].includes(e.event)) throw new WorkflowError("Only a no-show can be cleared.");
  const { error } = await admin.from("visit_events").insert({ job_id: e.job_id, event: "no_show_cleared", clears_event_id: e.id, reason, actor_id: actorId });
  if (error) throw new WorkflowError(/duplicate|unique/i.test(error.message) ? "Already cleared." : error.message);
  await logEvent(e.job_id, actorId, "no_show_cleared", `No-show cleared: ${reason}`, { event_id: e.id });
  return { ok: true };
}

/** Evidence rejected by the office: count it against the uploader's business. */
export async function recordEvidenceRejected(requirementId: string, actorId: string, reason: string | null) {
  const { data: f } = await admin.from("evidence_files").select("job_id, uploaded_by").eq("requirement_id", requirementId).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (!f?.uploaded_by) return;
  const { data: m } = await admin.from("business_members").select("business_id").eq("user_id", f.uploaded_by).eq("active", true).limit(1).maybeSingle();
  if (!m?.business_id) return;
  await admin.from("visit_events").insert({ job_id: f.job_id, business_id: m.business_id, event: "evidence_rejected", counts_against: "trade", actor_id: actorId, reason });
}

/** Real reliability facts for ranking (last 90 days). */
export async function reliabilityFor(businessIds: string[]) {
  if (!businessIds.length) return new Map<string, { no_shows: number; evidence_rejections: number; trade_cancellations: number }>();
  const since = new Date(Date.now() - 91 * 86_400_000).toISOString();
  const { data } = await admin.from("visit_events").select("id, business_id, event, counts_against, clears_event_id, created_at").gte("created_at", since)
    .or(`business_id.in.(${businessIds.join(",")}),event.eq.no_show_cleared`);
  return reliabilityFacts((data ?? []) as VisitEventRow[]);
}

/** Owner/trade view of the current booked visit (no other party's details). */
export async function visitChangeState(jobId: string, now = new Date()) {
  const b = await currentBooking(jobId);
  if (!b) return null;
  const { count: arrived } = await admin.from("visit_events").select("id", { count: "exact", head: true }).eq("booking_id", b.id).eq("event", "trade_arrived");
  // Stage 5 (Jo 23 Oct): the booked installer's top card links straight to the job's Mitti Ready Check form.
  let formUrl: string | null = null;
  if (b.kind === "ready_check") {
    const { data: f } = await admin.from("ready_checks").select("external_mitti_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (f?.external_mitti_id) { const { mittiFormUrl } = await import("./onsite-ready-check.core"); formUrl = mittiFormUrl(f.external_mitti_id); }
  }
  return {
    kind: b.kind, label: VISIT_LABEL[b.kind], starts_at: b.scheduled_start, ownerCanChange: ownerChangeAllowed(b.scheduled_start, now),
    started: Date.parse(b.scheduled_start) <= now.getTime(), arrived: !!arrived, canArrive: canMarkArrived(b.scheduled_start, now), canMarkNotHome: canMarkOwnerNotHome(b.scheduled_start, now), formUrl,
  };
}

/** True when a booked visit of this kind was cancelled and the owner was asked for new times after the latest round. */
export async function timesReopenedSince(jobId: string, kind: VisitKind, sinceIso: string | null) {
  let q = admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "visit_times_reopened").contains("details", { kind });
  if (sinceIso) q = q.gt("created_at", sinceIso);
  const { count } = await q;
  return !!count;
}
