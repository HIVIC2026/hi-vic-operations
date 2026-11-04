// G7 (Jo 4 Nov 2026, pack 2 batch 4): the 5pm-the-day-before sweep for Ready Checks booked with "Not sure yet" for who's
// going (15-minute allocation tick; wording/timing in ready-check-person.core). Every confirmed Ready Check starting
// before the lookahead whose booking is still "person pending": from 5pm Melbourne the day before, ONE email to the
// installer business's office email (TEST job / TEST partner → test-send; real → held until READY_CHECK_PERSON_EMAIL_APPROVED,
// customer comms on and the trade pause lifted; then the existing guarded partner sender, claimed only after `sent`) and
// ONE `ready_check_person_missing` office event (needs_office → the Needs me row). No text to anyone. Never changes a
// booking. A read failure logs and sends nothing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  READY_CHECK_PERSON_EMAIL_APPROVED, READY_CHECK_PERSON_EMAIL_EVENT, READY_CHECK_PERSON_HELD_EVENT, READY_CHECK_PERSON_MISSING_EVENT, READY_CHECK_PERSON_PENDING_EVENT,
  personEmailDue, readyCheckPersonKey, readyCheckPersonMissingLine, readyCheckPersonState, renderReadyCheckPersonEmail,
} from "./ready-check-person.core";
import { VISIT_ALLOCATED_EVENT } from "./visit-allocation.core";

type Booking = { id: string; job_id: string; scheduled_start: string };
const PAGE = 200;
const LOOKAHEAD_DAYS = 2;

export async function sweepReadyCheckPerson(now = new Date(), opts: { approved?: boolean } = {}): Promise<{ checked: number; sent: number; held: number }> {
  const approved = opts.approved ?? READY_CHECK_PERSON_EMAIL_APPROVED;
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const out = { checked: 0, sent: 0, held: 0 };
  const bookings: Booking[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "ready_check").eq("status", "confirmed")
      .gte("scheduled_start", now.toISOString()).lte("scheduled_start", until).order("scheduled_start", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error("ready check person sweep: bookings could not be read", error.message); return out; }
    bookings.push(...((data ?? []) as Booking[]));
    if ((data ?? []).length < PAGE) break;
  }
  for (const b of bookings) {
    if (personEmailDue({ startIso: b.scheduled_start, now }) !== "send") continue;
    out.checked++;
    try {
      const r = await remindOne(b, now, approved);
      if (r.startsWith("email")) out.sent++;
      else if (r.startsWith("held")) out.held++;
    } catch (e) { console.error("ready check person email failed", b.job_id, (e as Error).message); }
  }
  return out;
}

async function once(jobId: string, type: string, key: string): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", { key }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function remindOne(b: Booking, now: Date, approved: boolean): Promise<string> {
  const key = readyCheckPersonKey(b.job_id, b.id);
  const { data: evs, error: ee } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", b.job_id).in("event_type", [READY_CHECK_PERSON_PENDING_EVENT, VISIT_ALLOCATED_EVENT]).order("created_at", { ascending: false }).limit(50);
  if (ee) throw new Error(ee.message);
  const state = readyCheckPersonState((evs ?? []) as { event_type: string; details: unknown; created_at: string }[], b.id);
  if (!state.pending) return "skipped: person picked";
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, stage, properties(address_line, suburb, postcode)").eq("id", b.job_id).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", b.job_id).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  const j = job as { id: string; job_number: string; source: string | null; deleted_at: string | null; stage: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
  if (!j || j.deleted_at || j.stage === "cancelled") return "skipped: job not open";
  const p = j.properties;
  const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ") || j.job_number;
  // The office row first (needs_office): once per booking, whatever happens to the email.
  if (!(await once(j.id, READY_CHECK_PERSON_MISSING_EVENT, key))) {
    await logEvent(j.id, null, READY_CHECK_PERSON_MISSING_EVENT, readyCheckPersonMissingLine(address), { key, booking_id: b.id, start: b.scheduled_start, line: readyCheckPersonMissingLine(address), needs_office: true }, { internal: true });
  }
  if (await once(j.id, READY_CHECK_PERSON_EMAIL_EVENT, key)) return "skipped: already sent";
  const bizId = (asg as { business_id: string | null } | null)?.business_id ?? null;
  if (!bizId) return "skipped: no installer assigned";
  const { data: biz, error: be } = await admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", bizId).maybeSingle();
  if (be) throw new Error(be.message);
  const bz = biz as { id: string; name: string | null; email: string | null; onboarding_notes: string | null } | null;
  const to = bz?.email?.trim().toLowerCase() ?? "";
  const hold = async (reason: string) => {
    if (!(await once(j.id, READY_CHECK_PERSON_HELD_EVENT, key))) await logEvent(j.id, null, READY_CHECK_PERSON_HELD_EVENT, `Who's-doing-the-Ready-Check email held: ${reason}`, { key, booking_id: b.id, business_id: bz?.id ?? null, reason }, { internal: true });
    return `held: ${reason}`;
  };
  if (!to) return hold("installer business has no office email");
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(bz ?? {});
  const test = j.source === "qa_test" || partnerIsTest;
  if (!test) {
    const { customerCommsEnabled } = await import("./comms.server");
    const reason = !approved ? "wording not approved yet"
      : !(await customerCommsEnabled()) ? "customer communications are off"
      : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: bz!.id });
    if (reason) return hold(reason);
  }
  const { TEST_APP_BASE } = await import("./test-send.server");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const mail = renderReadyCheckPersonEmail({ jobNumber: j.job_number, address, startIso: b.scheduled_start, jobUrl: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${j.id}`, test });
  const claim = () => logEvent(j.id, null, READY_CHECK_PERSON_EMAIL_EVENT, "Who's-doing-the-Ready-Check email to the installer office", { key, booking_id: b.id, business_id: bz!.id, to, test }, { internal: true });
  if (test) {
    await claim();
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: j.id, jobSource: j.source, partnerIsTest, label: `ready_check_person:${b.id}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    return `email (test) ${r.status}: ${r.detail}`;
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bz!.name, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: key, record: { businessId: bz!.id }, idempotencyKey: key });
  if (r.status !== "sent") return hold(r.status === "blocked" ? r.detail : `send failed: ${r.detail}`);
  await claim();
  return `email ${r.status}: ${r.detail}`;
}
