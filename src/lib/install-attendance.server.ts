// Decision 327 (Jo 25 Oct 2026) I/O. Rules in pure install-attendance.core.ts.
//  - `onInstallBooked` (from confirmBooking kind installation, after the booking is written): when the A3 needs the
//    electrician at the start, record the request for THIS booking BEFORE any send, then either text the request
//    ("I'll be there" / "Can't make it" on the job page) or — when the day is one the electrician already said they can
//    do — record an automatic confirmation and text them that they're booked.
//  - `sweepElectricianAttendance` (15-minute tick): asks any booking not yet asked; re-offers an unanswered request's SAME
//    key (a quiet-hours hold goes once in the morning); one reminder at 24h (recorded before sending).
//  - `declineAttendance` ("Can't make it"): release the booked day through install-days `changeInstallDay` (reason
//    recorded), record the reason + days, and tell the installer ONCE (text; the job page shows the same line).
// Sends: TEST jobs / TEST partners → test-send only; real partners → the ONE real sender (`sendRealSms`: master switch, the
// type's own switch, quiet hours, STOP, partner consent; no fallback connection; a held attempt never claims the key).
// Never changes a price.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  ATTENDANCE_CONFIRMED_EVENT, ATTENDANCE_DECLINED_EVENT, ATTENDANCE_EVENTS, ATTENDANCE_INSTALLER_SMS_TYPE, ATTENDANCE_INSTALLER_TOLD_EVENT,
  ATTENDANCE_OFFICE_AFTER_MS, ATTENDANCE_REMINDED_EVENT, ATTENDANCE_REQUESTED_EVENT, ATTENDANCE_SMS_TYPE, attendanceAnswerBlocker, attendanceBookedText,
  attendanceInstallerKey, attendanceKey, attendanceLink, attendanceReasonLabel, attendanceReminderKey, attendanceReminderText, attendanceRequestBlocker, attendanceRequired,
  attendanceSmsText, attendanceState, autoConfirmOnBooking, canDoRestriction, declineBlockers, installerCantAttendText, reminderDue,
  type AttendanceEv, type AttendanceReason,
} from "./install-attendance.core";
import { installerTextAddress } from "./installer-texts.core";
import { melbourneYmd } from "./piesa-windows.core";

type JobRow = { id: string; source: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type Person = { business_id: string | null; profiles: { full_name: string | null; phone: string | null } | null; businesses: { id: string; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null };
type Booking = { id: string; scheduled_start: string };

/** Does the stored A3 PIESA snapshot need the electrician on site at the start of the install day? No snapshot = false. */
export async function attendanceRequiredFor(jobId: string): Promise<boolean> {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as unknown as { label: string; value: string | null }[]) : [];
  if (!entries.length) return false;
  const { shortAnswersFromEntries } = await import("./official-short.core");
  return attendanceRequired(shortAnswersFromEntries("piesa", entries));
}

/** The job's current confirmed installation booking (latest written). */
export async function currentInstallBooking(jobId: string): Promise<Booking | null> {
  const { data } = await admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id && data.scheduled_start ? { id: data.id, scheduled_start: data.scheduled_start } : null;
}

/** The decision-327 events on one job (requests, answers, reminders), oldest first. */
export async function attendanceEvents(jobId: string): Promise<AttendanceEv[]> {
  const { data } = await admin.from("workflow_events").select("job_id, event_type, created_at, details").eq("job_id", jobId).in("event_type", [...ATTENDANCE_EVENTS]).order("created_at");
  return (data ?? []) as unknown as AttendanceEv[];
}

async function person(jobId: string, role: "electrician" | "installer"): Promise<{ row: Person | null; to: string | null; test: boolean }> {
  const { data } = await admin.from("job_assignments").select("business_id, profiles:user_id(full_name, phone), businesses(id, signer_mobile, phone, onboarding_notes)").eq("job_id", jobId).eq("role", role).eq("active", true).limit(1).maybeSingle();
  const row = data as unknown as Person | null;
  const { isTestPartner } = await import("./test-send.core");
  // The person's own mobile, else their business's (the same rule as the other trade texts).
  return { row, to: row?.profiles?.phone ?? row?.businesses?.signer_mobile ?? row?.businesses?.phone ?? null, test: isTestPartner(row?.businesses ?? {}) };
}

async function jobRow(jobId: string): Promise<JobRow | null> {
  const { data } = await admin.from("jobs").select("id, source, deleted_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  return data as unknown as JobRow | null;
}
const addressOf = (j: JobRow) => installerTextAddress(j.properties?.address_line, j.properties?.suburb);

/** One text through the right sender. `at` = the trigger time (decision 165 freshness); `current` re-checked by the caller. */
async function text(p: { j: JobRow; jobId: string; who: { row: Person | null; to: string | null; test: boolean }; type: typeof ATTENDANCE_SMS_TYPE | typeof ATTENDANCE_INSTALLER_SMS_TYPE; key: string; body: (base: string) => string; at: string; current: boolean; repeat?: boolean }): Promise<string> {
  if (!p.who.to) return "not sent: no mobile";
  if (p.j.source === "qa_test" || p.who.test) {
    if (p.repeat) return "test send not repeated";
    const { TEST_APP_BASE, sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId: p.jobId, jobSource: p.j.source, partnerIsTest: p.who.test, label: `${p.type}:${p.key}`, actorId: null }, p.who.to, p.body(TEST_APP_BASE));
    return `sms (test) ${r.status}: ${r.detail}`;
  }
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const { sendRealSms } = await import("./sms.server");
  const r = await sendRealSms({ type: p.type, idempotencyKey: p.key, to: p.who.to, body: p.body(SET_PASSWORD_BASE), jobId: p.jobId, businessId: p.who.row?.business_id ?? null, event: { at: p.at, current: p.current } });
  return `sms ${r.status}: ${r.detail}`;
}

/** confirmBooking hook (kind installation). Never throws to its caller. */
export async function onInstallBooked(jobId: string, actorId: string | null): Promise<string> {
  try {
    const [j, booking, required, events] = await Promise.all([jobRow(jobId), currentInstallBooking(jobId), attendanceRequiredFor(jobId), attendanceEvents(jobId)]);
    if (!j) return "skipped: job not found";
    const who = await person(jobId, "electrician");
    const blocker = attendanceRequestBlocker({ deleted: !!j.deleted_at, required, bookingConfirmed: !!booking, startAhead: !!booking && Date.parse(booking.scheduled_start) > Date.now(),
      alreadyRequested: !!attendanceState(events, booking?.id), electricianAssigned: !!who.row?.business_id });
    if (blocker || !booking || !who.row?.business_id) return `skipped: ${blocker}`;
    const key = attendanceKey(jobId, booking.id);
    const limit = canDoRestriction(events);
    const auto = autoConfirmOnBooking(booking.scheduled_start, limit);
    const nowIso = new Date().toISOString();
    // Recorded once, before any send: the page card, the tick and the Needs me rule all read these events.
    await logEvent(jobId, null, ATTENDANCE_REQUESTED_EVENT, auto
      ? "Electrician booked for the start of the install on a day they said they can do (decision 327) — text prepared"
      : `Electrician asked to confirm they'll be on site at the start of the install (decision 327) — text prepared${who.to ? "" : " (no electrician mobile on file)"}`,
      { key, booking_id: booking.id, start: booking.scheduled_start, business_id: who.row.business_id, to: who.to, auto }, { internal: true });
    if (auto) {
      await logEvent(jobId, actorId, ATTENDANCE_CONFIRMED_EVENT, "Electrician confirmed for the start of the install automatically (they said they can do this day)", { booking_id: booking.id, start: booking.scheduled_start, auto: true, from_decline_booking: limit!.bookingId }, { internal: true });
      // The owner is told the day moved through the existing install-day-changed email (its own approval flag + guards).
      const was = await previousStart(jobId, limit!.bookingId);
      if (was) await (await import("./approved-owner-emails.server")).emailOwnerInstallDayChanged(jobId, booking.scheduled_start, was).catch((e) => console.error("install day changed email skipped", (e as Error).message));
    }
    const address = addressOf(j);
    return await text({ j, jobId, who, type: ATTENDANCE_SMS_TYPE, key, at: nowIso, current: true,
      body: (base) => (auto ? attendanceBookedText : attendanceSmsText)({ address, startIso: booking.scheduled_start, link: attendanceLink(base, jobId) }) });
  } catch (e) { return `attendance not handled — ${(e as Error).message}`; }
}

async function previousStart(jobId: string, bookingId: string): Promise<string | null> {
  const { data } = await admin.from("bookings").select("scheduled_start").eq("id", bookingId).eq("job_id", jobId).maybeSingle();
  return data?.scheduled_start ?? null;
}

/** 15-minute tick. Bounded; never throws. */
export async function sweepElectricianAttendance(now = new Date()): Promise<{ checked: number; results: string[] }> {
  const { data } = await admin.from("bookings").select("job_id").eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", now.toISOString()).order("scheduled_start").limit(200);
  const jobIds = [...new Set((data ?? []).map((b) => b.job_id).filter((x): x is string => !!x))];
  const results: string[] = [];
  for (const jobId of jobIds) {
    try {
      const [booking, events] = await Promise.all([currentInstallBooking(jobId), attendanceEvents(jobId)]);
      if (!booking) continue;
      const s = attendanceState(events, booking.id);
      // Not asked yet (e.g. the booking hook failed): ask now through the same path.
      if (!s) { const r = await onInstallBooked(jobId, null); if (!r.startsWith("skipped")) results.push(`${jobId}: ${r}`); continue; }
      if (s.state !== "waiting") continue;
      const age = now.getTime() - Date.parse(s.requestedAt);
      if (age >= ATTENDANCE_OFFICE_AFTER_MS) continue; // Needs me row from here (needs.server); nothing more is sent
      const j = await jobRow(jobId);
      if (!j || j.deleted_at) continue;
      const who = await person(jobId, "electrician");
      const address = addressOf(j);
      const link = (base: string) => attendanceLink(base, jobId);
      if (reminderDue(s, now, true)) {
        await logEvent(jobId, null, ATTENDANCE_REMINDED_EVENT, "Electrician reminded to confirm the start of the install (24 hours, no answer) — text prepared", { booking_id: booking.id, key: attendanceReminderKey(jobId, booking.id) }, { internal: true });
        results.push(`${jobId}: reminder ${await text({ j, jobId, who, type: ATTENDANCE_SMS_TYPE, key: attendanceReminderKey(jobId, booking.id), at: now.toISOString(), current: true, body: (b) => attendanceReminderText({ address, startIso: booking.scheduled_start, link: link(b) }) })}`);
        continue;
      }
      // Re-offer the SAME key to the real sender (quiet-hours holds); "already" once it went. TEST sends never repeat.
      const key = s.reminded ? attendanceReminderKey(jobId, booking.id) : attendanceKey(jobId, booking.id);
      const at = s.reminded ? (events.find((e) => e.event_type === ATTENDANCE_REMINDED_EVENT && e.details?.["booking_id"] === booking.id)?.created_at ?? s.requestedAt) : s.requestedAt;
      const r = await text({ j, jobId, who, type: ATTENDANCE_SMS_TYPE, key, at, current: true, repeat: true,
        body: (b) => (s.reminded ? attendanceReminderText : attendanceSmsText)({ address, startIso: booking.scheduled_start, link: link(b) }) });
      if (!/already|not repeated/.test(r)) results.push(`${jobId}: ${r}`);
    } catch (e) { results.push(`${jobId}: ${(e as Error).message}`); }
  }
  return { checked: jobIds.length, results };
}

/** The electrician's "I'll be there" (append-only; the latest answer wins). The caller has checked the electrician. */
export async function confirmAttendance(jobId: string, userId: string, bookingId: string) {
  const { booking, state } = await answerContext(jobId, bookingId);
  if (state?.state === "confirmed") return { ok: true };
  await logEvent(jobId, userId, ATTENDANCE_CONFIRMED_EVENT, "Electrician confirmed they'll be on site at the start of the install", { booking_id: booking.id, start: booking.scheduled_start }, { internal: true });
  return { ok: true };
}

async function answerContext(jobId: string, bookingId: string) {
  const [booking, events] = await Promise.all([currentInstallBooking(jobId), attendanceEvents(jobId)]);
  const state = booking?.id === bookingId ? attendanceState(events, bookingId) : null;
  const b = attendanceAnswerBlocker({ electrician: true, requested: !!state, bookingCurrent: booking?.id === bookingId, startAhead: !!booking && Date.parse(booking.scheduled_start) > Date.now() });
  if (b) throw new WorkflowError(b);
  return { booking: booking!, state, events };
}

/** "Can't make it": reason + 1–5 days they can do (or none). Releases the booked day, records, tells the installer. */
export async function declineAttendance(jobId: string, userId: string, i: { bookingId: string; reason: AttendanceReason; otherText: string | null; days: string[]; noDays: boolean }) {
  const { booking } = await answerContext(jobId, i.bookingId);
  const { installDayContext, changeInstallDay } = await import("./install-days.server");
  const { allowedInstallDays } = await import("./install-days.core");
  const c = await installDayContext(jobId);
  const allowed = allowedInstallDays({ deadline: c.deadline });
  const bookedDay = melbourneYmd(new Date(booking.scheduled_start));
  const b = declineBlockers({ reason: i.reason, otherText: i.otherText, days: i.days, noDays: i.noDays, allowed, bookedDay });
  if (b.length) throw new WorkflowError(b.join(" "));
  const reason = attendanceReasonLabel(i.reason, i.otherText);
  // The booked day is released through the ONE install-day change path (stage back to scheduling, due date + ESC notice redone).
  await changeInstallDay(jobId, userId, "electrician", { electricianCantAttend: reason });
  const days = i.noDays ? [] : [...new Set(i.days)].sort();
  await logEvent(jobId, userId, ATTENDANCE_DECLINED_EVENT, i.noDays
    ? `Electrician can't make the install day (${reason}) and can't do any other day inside the 30-day window`
    : `Electrician can't make the install day (${reason}) — they can do ${days.length} other day${days.length === 1 ? "" : "s"}`,
    { booking_id: booking.id, was: booking.scheduled_start, reason: i.reason, reason_text: i.reason === "other" ? i.otherText?.trim() ?? null : null, can_do_days: days, no_days: i.noDays, deadline: c.deadline }, { internal: true });
  if (!i.noDays) await tellInstaller(jobId, booking, reason, days).catch((e) => console.error("installer cant-attend text skipped", (e as Error).message));
  return { ok: true };
}

async function tellInstaller(jobId: string, booking: Booking, reason: string, days: string[]): Promise<string> {
  const key = attendanceInstallerKey(jobId, booking.id);
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", ATTENDANCE_INSTALLER_TOLD_EVENT).contains("details", { key });
  if (count) return "already told";
  const [j, who] = await Promise.all([jobRow(jobId), person(jobId, "installer")]);
  if (!j) return "skipped";
  const body = installerCantAttendText({ wasStartIso: booking.scheduled_start, reason, days });
  // Recorded once, before any send (the installer's job page shows the same line from the decline event).
  await logEvent(jobId, null, ATTENDANCE_INSTALLER_TOLD_EVENT, `Installer told the electrician can't make the install day — text prepared${who.to ? "" : " (no installer mobile on file)"}`, { key, booking_id: booking.id, days, to: who.to }, { internal: true });
  return text({ j, jobId, who, type: ATTENDANCE_INSTALLER_SMS_TYPE, key, at: new Date().toISOString(), current: true, body: (base) => `${body} ${base.replace(/\/+$/, "")}/field/${jobId}` });
}
