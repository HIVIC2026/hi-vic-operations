// Deep Part 5a (Jo 4–5 Nov 2026): the "no Lead Installer picked" sweep on the 15-minute allocation tick (wording/timing in
// lead-installer-reminder.core; the clock is the ONE lock rule in prestart.core). Every confirmed installation booking
// within LEAD_REMINDER_LOOKAHEAD_DAYS, ALL installer businesses (own customers and Home Insulation Victoria leads), read
// through the same lock-state reader the writers use (lead-installer-confirm.server leadInstallerLockState: current
// confirmed booking, completed installs ignored, Lead from the install allocation else the saved crew):
//  - from 3 days before, no Lead Installer → ONE email per job + install day to the installer business's office email
//    (TEST job / TEST partner → test-send; real → held until LEAD_INSTALLER_REMINDER_APPROVED, customer comms on and the
//    trade pause lifted, recorded once as `lead_installer_reminder_held`, key not claimed; then the guarded partner
//    sender, claimed only after `sent` — its Resend Idempotency-Key = the key guards a double send);
//  - from 2 days before (the lock), still none → ONE `no_lead_installer` office event (needs_office → red Needs me row),
//    cleared by ONE `no_lead_installer_cleared` once a Lead Installer is picked.
// A read failure logs and sends nothing. Never changes a booking, a crew or a stage. Replaces the retired 9am
// "Confirm or change your Lead Installer by 5pm today" sweep (nothing else emails the office about the Lead Installer).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  LEAD_INSTALLER_REMINDER_APPROVED, LEAD_REMINDER_EVENT, LEAD_REMINDER_FLAG_CLEARED_EVENT, LEAD_REMINDER_FLAG_EVENT, LEAD_REMINDER_HELD_EVENT, LEAD_REMINDER_LOOKAHEAD_DAYS,
  leadReminderDue, leadReminderInstallYmd, leadReminderKey, noLeadInstallerLine, renderLeadInstallerReminder,
} from "./lead-installer-reminder.core";
import { leadInstallerLock } from "./prestart.core";

type Booking = { id: string; job_id: string; scheduled_start: string };
const PAGE = 200;

export async function sweepLeadInstallerReminder(now = new Date(), opts: { approved?: boolean } = {}): Promise<{ checked: number; sent: number; held: number; flagged: number }> {
  const approved = opts.approved ?? LEAD_INSTALLER_REMINDER_APPROVED;
  const until = new Date(now.getTime() + LEAD_REMINDER_LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const out = { checked: 0, sent: 0, held: 0, flagged: 0 };
  const bookings: Booking[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed")
      .gte("scheduled_start", now.toISOString()).lte("scheduled_start", until).order("scheduled_start", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error("lead installer reminder sweep: bookings could not be read", error.message); return out; }
    bookings.push(...((data ?? []) as Booking[]));
    if ((data ?? []).length < PAGE) break;
  }
  for (const b of bookings) {
    out.checked++;
    try {
      const r = await remindOne(b, now, approved);
      if (r.email.startsWith("email")) out.sent++;
      else if (r.email.startsWith("held")) out.held++;
      if (r.flagged) out.flagged++;
    } catch (e) { console.error("lead installer reminder failed", b.job_id, (e as Error).message); }
  }
  return out;
}

async function once(jobId: string, type: string, key: string): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", { key }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function remindOne(b: Booking, now: Date, approved: boolean): Promise<{ email: string; flagged: boolean }> {
  const day = leadReminderInstallYmd(b.scheduled_start);
  const key = leadReminderKey(b.job_id, day);
  const due = leadReminderDue({ startIso: b.scheduled_start, now });
  if (due === "wait" || due === "too_late") return { email: `skipped: ${due}`, flagged: false };
  // The same reader the Lead/crew/time writers use: current confirmed booking (a completed install = none), Lead from the
  // install allocation else the saved crew. A read error throws (logged by the sweep; nothing sent).
  const s = await (await import("./lead-installer-confirm.server")).leadInstallerLockState(b.job_id, now);
  if (!s.start || s.bookingId !== b.id) return { email: "skipped: not the current install booking", flagged: false };
  if (s.leadId) {
    // Picked: clear an earlier flag once (the Needs me row reads flag minus cleared); nothing else to do.
    if ((await once(b.job_id, LEAD_REMINDER_FLAG_EVENT, key)) && !(await once(b.job_id, LEAD_REMINDER_FLAG_CLEARED_EVENT, key)))
      await logEvent(b.job_id, null, LEAD_REMINDER_FLAG_CLEARED_EVENT, "Lead Installer picked", { key, booking_id: b.id, start: b.scheduled_start, lead_worker_id: s.leadId }, { internal: true });
    return { email: "skipped: Lead Installer picked", flagged: false };
  }
  const { data: job, error: je } = await admin.from("jobs").select("id, job_number, source, deleted_at, stage, properties(address_line, suburb, postcode)").eq("id", b.job_id).maybeSingle();
  if (je) throw new Error(je.message);
  const j = job as { id: string; job_number: string; source: string | null; deleted_at: string | null; stage: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
  if (!j || j.deleted_at || j.stage === "cancelled") return { email: "skipped: job not open", flagged: false };
  // 2 days before (the lock): the red office row, once per job + install day, whatever happens to the email.
  let flagged = false;
  if (due === "flag" && !(await once(j.id, LEAD_REMINDER_FLAG_EVENT, key))) {
    const line = noLeadInstallerLine(j.job_number, b.scheduled_start);
    await logEvent(j.id, null, LEAD_REMINDER_FLAG_EVENT, line, { key, booking_id: b.id, start: b.scheduled_start, line, needs_office: true }, { internal: true });
    flagged = true;
  }
  return { email: await emailOnce(j, b, key, day, approved), flagged };
}

async function emailOnce(j: { id: string; job_number: string; source: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null }, b: Booking, key: string, day: string, approved: boolean): Promise<string> {
  if (await once(j.id, LEAD_REMINDER_EVENT, key)) return "skipped: already sent";
  const { data: asg, error: ae } = await admin.from("job_assignments").select("business_id").eq("job_id", j.id).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (ae) throw new Error(ae.message);
  const bizId = (asg as { business_id: string | null } | null)?.business_id ?? null;
  if (!bizId) return "skipped: no installer assigned";
  const { data: biz, error: be } = await admin.from("businesses").select("id, name, email, onboarding_notes").eq("id", bizId).maybeSingle();
  if (be) throw new Error(be.message);
  const bz = biz as { id: string; name: string | null; email: string | null; onboarding_notes: string | null } | null;
  const to = bz?.email?.trim().toLowerCase() ?? "";
  const hold = async (reason: string) => {
    if (!(await once(j.id, LEAD_REMINDER_HELD_EVENT, key))) await logEvent(j.id, null, LEAD_REMINDER_HELD_EVENT, `Pick-the-Lead-Installer email held: ${reason}`, { key, install_date: day, booking_id: b.id, business_id: bz?.id ?? null, reason }, { internal: true });
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
      : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: bz!.id, jobId: j.id });
    if (reason) return hold(reason);
  }
  const p = j.properties;
  const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ") || j.job_number;
  const { TEST_APP_BASE } = await import("./test-send.server");
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const mail = renderLeadInstallerReminder({ jobNumber: j.job_number, address, startIso: b.scheduled_start, jobUrl: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/day/${j.id}`, lockLabel: leadInstallerLock(b.scheduled_start).lockLabel, test });
  const claim = () => logEvent(j.id, null, LEAD_REMINDER_EVENT, `Pick-the-Lead-Installer email to the installer office for the ${day} install`, { key, install_date: day, booking_id: b.id, business_id: bz!.id, to, test }, { internal: true });
  if (test) {
    // TEST sends are recorded once before the send (the test sender has no idempotency key of its own).
    await claim();
    const { sendTestEmail } = await import("./test-send.server");
    const r = await sendTestEmail({ jobId: j.id, jobSource: j.source, partnerIsTest, label: `lead_installer_reminder:${day}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    return `email (test) ${r.status}: ${r.detail}`;
  }
  const { sendOfficeEmail } = await import("./office-email.server");
  const r = await sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: bz!.name, subject: mail.subject, message: mail.text, html: mail.html, text: mail.text, label: key, record: { businessId: bz!.id }, idempotencyKey: key, pauseJobId: j.id });
  // The sender can still block (comms off, trade pause, recipient rule) or fail; only a sent email claims the key.
  if (r.status !== "sent") return hold(r.status === "blocked" ? r.detail : `send failed: ${r.detail}`);
  await claim();
  return `email ${r.status}: ${r.detail}`;
}
