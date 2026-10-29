// Decision 326 (25 Oct 2026): the approved owner texts that had wording but no sender (decisions 78, 82, 89, 93, 99, 135).
// Same shape as installer-texts.server.ts (decisions 79/82/99): ONE `approved_text_prepared` workflow event per text +
// key is recorded BEFORE anything is sent, so a retry never texts twice; TEST jobs → test-send only; real owners → the ONE
// real SMS sender (`sendRealSms`: customer_comms_enabled + the per-type switch + consent + STOP + idempotency key, no
// retry; a held attempt never claims the key — decision 165). Quiet hours (8pm–7am Melbourne) are checked BEFORE the event
// is recorded, so a text due overnight goes after 7am from the 15-minute tick instead of being lost.
// Every text runs from `sweepApprovedTexts` on the 15-minute allocation tick (one-off triggers looked back 24h), never
// from a workflow module: ready-check-times / booking / allocation sit on the autoAdvanceJob import graph, which must stay
// free of senders (tests/comms.test.ts). Rules and wording: approved-texts.core.ts.
// Nothing here changes a booking, a quote, a turn or a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  APPROVED_TEXT_EVENT, APPROVED_TEXT_SMS_TYPE, APPROVED_TEXT_SWEEP_HOURS, QUIET_HOURS_WAIT, approvedTextKey, installMovedFrom, installMovedText, installTomorrowOwnerText,
  piesaBookedOwnerText, piesaTomorrowOwnerText, quoteHeldUntil, quoteReminderDay3Text, quoteReminderDue, quoteReminderExpiryText, readyCheckBookedOwnerText,
  readyCheckTimesOwnerText, readyCheckTomorrowOwnerText, visitTomorrowDue, type ApprovedTextKind, type InstallBookingRow, type VisitTextKind,
} from "./approved-texts.core";

type JobRow = {
  id: string; job_number: string; source: string | null; channel: string | null; stage: string | null; deleted_at: string | null; qa_archived_at: string | null;
  owners: { full_name: string | null; phone: string | null } | null; properties: { address_line: string | null; suburb: string | null } | null;
};
type Trade = { name: string | null; phone: string | null; isTest: boolean };

async function loadJob(jobId: string): Promise<JobRow | null> {
  const { data } = await admin.from("jobs").select("id, job_number, source, channel, stage, deleted_at, qa_archived_at, owners(full_name, phone), properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  if (!data) return null;
  const job = data as unknown as JobRow;
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  return isClosedOrArchivedJob(job) ? null : job;
}

/** The trade the owner is told about: the active installer (Ready Check / install) or electrician (safety check). */
async function tradeFor(jobId: string, role: "installer" | "electrician"): Promise<Trade> {
  const { data } = await admin.from("job_assignments").select("businesses(name, trading_name, phone, onboarding_notes)").eq("job_id", jobId).eq("role", role).eq("active", true).limit(1).maybeSingle();
  const b = (data?.businesses ?? null) as { name: string | null; trading_name: string | null; phone: string | null; onboarding_notes: string | null } | null;
  const { isTestPartner } = await import("./test-send.core");
  return { name: (b?.trading_name ?? b?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, phone: b?.phone?.trim() || null, isTest: isTestPartner(b) };
}

async function alreadyPrepared(jobId: string, key: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", APPROVED_TEXT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  return !!data;
}

const firstNameOf = async (full: string | null | undefined) => (await import("./worker-links.core")).firstName(full ?? null);
const ownerLink = async (jobId: string) => (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);

/** Quiet-hours wait (pure check) BEFORE the event, so nothing is recorded while texts may not go. */
async function quietNow(kind: ApprovedTextKind, now: Date): Promise<boolean> {
  const { SMS_MESSAGE_TYPES } = await import("./sms.core");
  if (!SMS_MESSAGE_TYPES[APPROVED_TEXT_SMS_TYPE[kind]].quietHours) return false;
  return !!(await import("./quote-hold.core")).smsQuietReason(now.toISOString());
}

/** Record ONE event, then send through the TEST sender (TEST job / TEST trade) or the one real sender. Never throws on send problems. */
async function deliver(p: { kind: ApprovedTextKind; key: string; job: JobRow; body: string; summary: string; details: Record<string, unknown>; event?: { at: string; current: boolean }; tradeIsTest?: boolean }): Promise<string> {
  await logEvent(p.job.id, null, APPROVED_TEXT_EVENT, `${p.summary} — text prepared (decision 326)`, { text: p.kind, key: p.key, ...p.details }, { internal: true });
  const to = p.job.owners?.phone ?? null;
  try {
    if (p.job.source === "qa_test") {
      const { sendTestSms } = await import("./test-send.server");
      const r = await sendTestSms({ jobId: p.job.id, jobSource: p.job.source, partnerIsTest: p.tradeIsTest === true, label: `${p.kind}:${p.key}`, actorId: null }, to ?? "", p.body);
      return `owner sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: APPROVED_TEXT_SMS_TYPE[p.kind], idempotencyKey: p.key, to, body: p.body, jobId: p.job.id, ...(p.event ? { event: p.event } : {}) });
    return `owner sms ${r.status}: ${r.detail}`;
  } catch (e) { return `owner sms not sent — ${(e as Error).message}`; }
}

/** Shared "not sent" outcomes (the sweeps count everything else as handled). */
export const NOT_HANDLED = ["skipped", "already handled", "not due", "not an our-lead job", "no longer current", "owner link missing", "missing facts", QUIET_HOURS_WAIT] as const;
const handled = (r: string) => !(NOT_HANDLED as readonly string[]).includes(r);

/** Decision 78: the installer offered the owner Ready Check times → one text per offer event (our leads). */
export async function textOwnerReadyCheckTimes(jobId: string, triggerEventId: string, offeredAt: string, now = new Date()): Promise<string> {
  const job = await loadJob(jobId);
  if (!job) return "skipped";
  if (job.channel !== "hivic_sourced") return "not an our-lead job";
  const key = approvedTextKey.readyCheckTimesOwner(jobId, triggerEventId);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  const { readyCheckTurnFor } = await import("./ready-check-times.server");
  if ((await readyCheckTurnFor(jobId)) !== "owner_to_answer") return "no longer current";
  if (await quietNow("ready_check_times_owner", now)) return QUIET_HOURS_WAIT;
  const link = await ownerLink(jobId);
  if (!link) return "owner link missing";
  const body = readyCheckTimesOwnerText({ firstName: await firstNameOf(job.owners?.full_name), suburb: job.properties?.suburb ?? null, link });
  if (!body) return "missing facts";
  const trade = await tradeFor(jobId, "installer");
  return deliver({ kind: "ready_check_times_owner", key, job, body, summary: "Owner texted: the installer's Ready Check times are ready (decision 78)", details: { trigger_event_id: triggerEventId, offered_at: offeredAt }, event: { at: offeredAt, current: true }, tradeIsTest: trade.isTest });
}

/** Decision 82 (B): our-lead Ready Check booked → one text per booked start. */
export async function textOwnerReadyCheckBooked(jobId: string, startIso: string, bookedAt: string, now = new Date()): Promise<string> {
  // Jo 29 Oct 2026 (HV-3542): no silent skips — each not-sent reason is recorded once for the office.
  let outcome: string;
  try { outcome = await attemptBookedOwnerText(jobId, startIso, bookedAt, now); } catch (e) { outcome = `error — ${(e as Error).message}`; }
  await (await import("./ready-check-booked-email.server")).recordBookedNotSent(jobId, startIso, "text", outcome);
  return outcome;
}

async function attemptBookedOwnerText(jobId: string, startIso: string, bookedAt: string, now: Date): Promise<string> {
  const { READY_CHECK_BOOKED_TEXT_APPROVED } = await import("./ready-check-booked-email.core");
  if (!READY_CHECK_BOOKED_TEXT_APPROVED) return "skipped";
  const job = await loadJob(jobId);
  if (!job) return "skipped";
  if (job.channel !== "hivic_sourced") return "not an our-lead job";
  const key = approvedTextKey.readyCheckBookedOwner(jobId, startIso);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  if (!(await stillBooked(jobId, "ready_check", startIso))) return "no longer current";
  if (await quietNow("ready_check_booked_owner", now)) return QUIET_HOURS_WAIT;
  const link = await ownerLink(jobId);
  if (!link) return "owner link missing";
  const trade = await tradeFor(jobId, "installer");
  const body = readyCheckBookedOwnerText({ startIso, installer: trade.name, phone: trade.phone, link });
  if (!body) return "missing facts";
  return deliver({ kind: "ready_check_booked_owner", key, job, body, summary: "Owner texted: Ready Check booked (decision 82)", details: { starts_at: startIso, booked_at: bookedAt }, event: { at: bookedAt, current: true }, tradeIsTest: trade.isTest });
}

/** Decision 93 (A): safety check (PIESA) booked → one text per booked start. */
export async function textOwnerSafetyCheckBooked(jobId: string, startIso: string, bookedAt: string, now = new Date()): Promise<string> {
  const job = await loadJob(jobId);
  if (!job) return "skipped";
  const key = approvedTextKey.piesaBookedOwner(jobId, startIso);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  if (!(await stillBooked(jobId, "assessment", startIso))) return "no longer current";
  if (await quietNow("piesa_booked_owner", now)) return QUIET_HOURS_WAIT;
  const link = await ownerLink(jobId);
  if (!link) return "owner link missing";
  const trade = await tradeFor(jobId, "electrician");
  const body = piesaBookedOwnerText({ startIso, electrician: trade.name, phone: trade.phone, link });
  if (!body) return "missing facts";
  return deliver({ kind: "piesa_booked_owner", key, job, body, summary: "Owner texted: electrical safety check booked (decision 93)", details: { starts_at: startIso, booked_at: bookedAt }, event: { at: bookedAt, current: true }, tradeIsTest: trade.isTest });
}

/** Decisions 82 / 93 / 99: the afternoon before a booked Ready Check (our leads), safety check or install → "See you tomorrow". */
export async function textOwnerVisitTomorrow(kind: VisitTextKind, jobId: string, booking: { id: string; scheduled_start: string }, now = new Date()): Promise<string> {
  if (!visitTomorrowDue(now, booking.scheduled_start)) return "not due";
  const job = await loadJob(jobId);
  if (!job) return "skipped";
  if (kind === "ready_check" && job.channel !== "hivic_sourced") return "not an our-lead job";
  const textKind: ApprovedTextKind = kind === "ready_check" ? "ready_check_tomorrow_owner" : kind === "assessment" ? "piesa_tomorrow_owner" : "install_tomorrow_owner";
  const key = approvedTextKey.visitTomorrowOwner(kind, jobId, booking.id, booking.scheduled_start);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  if (await quietNow(textKind, now)) return QUIET_HOURS_WAIT;
  const trade = await tradeFor(jobId, kind === "assessment" ? "electrician" : "installer");
  const f = { startIso: booking.scheduled_start, phone: trade.phone };
  const body = kind === "ready_check" ? readyCheckTomorrowOwnerText({ ...f, installer: trade.name })
    : kind === "assessment" ? piesaTomorrowOwnerText({ ...f, electrician: trade.name })
    : installTomorrowOwnerText({ ...f, installer: trade.name });
  if (!body) return "missing facts";
  return deliver({ kind: textKind, key, job, body, summary: `Owner texted: see you tomorrow (${kind === "ready_check" ? "Ready Check, decision 82" : kind === "assessment" ? "safety check, decision 93" : "install, decision 99"})`, details: { booking_id: booking.id, starts_at: booking.scheduled_start, visit: kind }, tradeIsTest: trade.isTest });
}

type QuoteRow = { id: string; job_id: string; kind: string; status: string; release_state: string | null; sent_at: string | null; veec_discount_inc_gst: number | null };

/** Decisions 88/89: quote reminder texts — 3 days after the quote, and 2 days before the price expires. */
export async function textOwnerQuoteReminder(q: QuoteRow, now = new Date()): Promise<string> {
  const step = quoteReminderDue(q, now);
  if (!step || !q.sent_at) return "not due";
  const job = await loadJob(q.job_id);
  if (!job) return "skipped";
  const kind: ApprovedTextKind = step === "day3" ? "quote_reminder_day3" : "quote_reminder_expiry";
  const key = approvedTextKey.quoteReminder(q.id, step);
  if (await alreadyPrepared(q.job_id, key)) return "already handled";
  if (await quietNow(kind, now)) return QUIET_HOURS_WAIT;
  const link = await ownerLink(q.job_id);
  if (!link) return "owner link missing";
  const quoteUrl = `${link}?screen=quote`;
  const firstName = await firstNameOf(job.owners?.full_name);
  const rebate = q.veec_discount_inc_gst == null ? null : Number(q.veec_discount_inc_gst);
  const body = step === "day3" ? quoteReminderDay3Text({ firstName, rebate, link: quoteUrl }) : quoteReminderExpiryText({ firstName, rebate, heldUntilIso: quoteHeldUntil(q.sent_at), link: quoteUrl });
  if (!body) return "missing facts";
  return deliver({ kind, key, job, body, summary: `Owner texted: quote reminder (${step === "day3" ? "3 days after the quote" : "2 days before the price expires"}, decision 89)`, details: { quote_id: q.id, step } });
}

/** Decision 135: the agreed install day changed and a new day is booked → one text per new booking. */
export async function textOwnerInstallMoved(jobId: string, booking: InstallBookingRow, wasStart: string, now = new Date()): Promise<string> {
  const job = await loadJob(jobId);
  if (!job) return "skipped";
  const key = approvedTextKey.installMoved(jobId, booking.id);
  if (await alreadyPrepared(jobId, key)) return "already handled";
  if (!(await stillBooked(jobId, "installation", booking.scheduled_start))) return "no longer current";
  if (await quietNow("install_moved_owner", now)) return QUIET_HOURS_WAIT;
  const link = await ownerLink(jobId);
  if (!link) return "owner link missing";
  const trade = await tradeFor(jobId, "installer");
  return deliver({ kind: "install_moved_owner", key, job, body: installMovedText({ startIso: booking.scheduled_start, link }), summary: "Owner texted: the install has moved (decision 135)", details: { booking_id: booking.id, starts_at: booking.scheduled_start, was: wasStart }, event: { at: booking.created_at, current: true }, tradeIsTest: trade.isTest });
}

async function stillBooked(jobId: string, kind: "ready_check" | "assessment" | "installation", startIso: string): Promise<boolean> {
  const { data } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", kind).eq("status", "confirmed");
  return (data ?? []).some((b) => Date.parse(b.scheduled_start) === Date.parse(startIso));
}

/** 15-minute tick: due day-before texts, quote reminders, and a 24h catch-up for every one-off text above. */
export async function sweepApprovedTexts(now = new Date()) {
  const out = { readyCheckTimes: 0, readyCheckBooked: 0, safetyCheckBooked: 0, tomorrow: 0, quoteReminders: 0, installMoved: 0 };
  const since = new Date(now.getTime() - APPROVED_TEXT_SWEEP_HOURS * 3_600_000).toISOString();
  const in48h = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const [offered, recent, upcoming, quotes] = await Promise.all([
    admin.from("workflow_events").select("id, job_id, created_at").eq("event_type", "ready_check_times_offered").gte("created_at", since).limit(500),
    admin.from("bookings").select("id, job_id, kind, scheduled_start, status, created_at").in("kind", ["ready_check", "assessment", "installation"]).eq("status", "confirmed").gte("created_at", since).limit(500),
    admin.from("bookings").select("id, job_id, kind, scheduled_start").in("kind", ["ready_check", "assessment", "installation"]).eq("status", "confirmed").gt("scheduled_start", now.toISOString()).lte("scheduled_start", in48h).limit(500),
    admin.from("quotes").select("id, job_id, kind, status, release_state, sent_at, veec_discount_inc_gst").eq("kind", "installation").eq("status", "issued").eq("release_state", "released").not("sent_at", "is", null).limit(500),
  ]);
  for (const r of [offered, recent, upcoming, quotes]) if (r.error) throw new Error(`approved texts sweep: ${r.error.message}`);
  const run = async (label: string, f: () => Promise<string>, count: keyof typeof out) => {
    try { if (handled(await f())) out[count]++; } catch (e) { console.error(`${label} text failed`, (e as Error).message); }
  };
  for (const e of offered.data ?? []) if (e.job_id) await run("ready check times", () => textOwnerReadyCheckTimes(e.job_id!, e.id, e.created_at, now), "readyCheckTimes");
  for (const b of recent.data ?? []) {
    if (b.kind === "ready_check") await run("ready check booked", () => textOwnerReadyCheckBooked(b.job_id, b.scheduled_start, b.created_at, now), "readyCheckBooked");
    else if (b.kind === "assessment") await run("safety check booked", () => textOwnerSafetyCheckBooked(b.job_id, b.scheduled_start, b.created_at, now), "safetyCheckBooked");
    else {
      const { data: all } = await admin.from("bookings").select("id, scheduled_start, status, created_at").eq("job_id", b.job_id).eq("kind", "installation");
      const was = installMovedFrom(b as InstallBookingRow, (all ?? []) as InstallBookingRow[]);
      if (was) await run("install moved", () => textOwnerInstallMoved(b.job_id, b as InstallBookingRow, was, now), "installMoved");
    }
  }
  for (const b of upcoming.data ?? []) await run("see you tomorrow", () => textOwnerVisitTomorrow(b.kind as VisitTextKind, b.job_id, b, now), "tomorrow");
  for (const q of (quotes.data ?? []) as QuoteRow[]) await run("quote reminder", () => textOwnerQuoteReminder(q, now), "quoteReminders");
  return out;
}
