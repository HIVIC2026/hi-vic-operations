// Deep Part 5a (Jo 4–5 Nov 2026, "Lead Installer lock / reminders"): 3 days before the install, no Lead Installer picked →
// ONE email to the partner's business office ("Pick the Lead Installer for {address} on {date}"); 2 days before (the lock),
// still none → ONE red Needs me row for the Home Insulation Victoria office ("No Lead Installer: {HV} install {date}").
// Every installer business, own customers and Home Insulation Victoria leads alike. Replaces the 2 Nov 9am "Confirm or
// change your Lead Installer by 5pm today" email (lead-installer-confirm, retired 5 Nov 2026). PURE: wording, keys, timing.
// The clock is the ONE lock rule in prestart.core (lead-installer-lock.core). The sweep is lead-installer-reminder.server.
import { partnerEmailLayout } from "./partner-email.core";
import { leadInstallerLock } from "./prestart.core";

/** DRAFT wording (Jo's words, 4–5 Nov 2026, not yet approved on a rendered email): nothing reaches a real installer office
 *  until Jo approves it. TEST jobs / TEST partners → test-send. */
export const LEAD_INSTALLER_REMINDER_APPROVED = false as boolean;
/** Recorded once per key after a confirmed send (TEST: before the test send). */
export const LEAD_REMINDER_EVENT = "lead_installer_reminder_email" as const;
/** Recorded once per key when a real send is held (flag off / comms off / trade pause / sender refused); never claims the key. */
export const LEAD_REMINDER_HELD_EVENT = "lead_installer_reminder_held" as const;
/** The red office row (needs_office): ONE per job + install day from the lock on while no Lead Installer is picked. */
export const LEAD_REMINDER_FLAG_EVENT = "no_lead_installer" as const;
/** Written once per key when a Lead Installer is picked after the flag (the Needs me row reads flag minus cleared). */
export const LEAD_REMINDER_FLAG_CLEARED_EVENT = "no_lead_installer_cleared" as const;
/** Bookings further out than this are not looked at by the sweep. */
export const LEAD_REMINDER_LOOKAHEAD_DAYS = 4;

export const leadReminderKey = (jobId: string, installYmd: string) => `lead-reminder:v1:${jobId}:${installYmd}`;

const TZ = "Australia/Melbourne";
const parts = (iso: string, o: Intl.DateTimeFormatOptions) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return p;
};
/** The install's Melbourne day (YYYY-MM-DD) for the key. */
export function leadReminderInstallYmd(startIso: string): string {
  const p = parts(startIso, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}
/** "Fri 13 Nov" (Melbourne). */
export function leadReminderDay(startIso: string): string {
  const p = parts(startIso, { weekday: "short", day: "numeric", month: "short" });
  return `${p["weekday"]} ${p["day"]} ${p["month"]}`;
}
/** "Fri 13 Nov, 7:30am" (Melbourne). */
export function leadReminderWhen(startIso: string): string {
  const p = parts(startIso, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const h = Number(p["hour"]) % 24, m = Number(p["minute"]);
  return `${leadReminderDay(startIso)}, ${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "wait" before 3 days out; "remind" from 3 days out (the email); "flag" from 2 days out — the lock — (the office row, and
 *  the email still goes if it never went); "too_late" once the install has started. */
export function leadReminderDue(f: { startIso: string; now: Date }): "wait" | "remind" | "flag" | "too_late" {
  const now = f.now.getTime();
  if (now >= Date.parse(f.startIso)) return "too_late";
  const { reminderAt, lockAt } = leadInstallerLock(f.startIso);
  if (now >= Date.parse(lockAt)) return "flag";
  return now >= Date.parse(reminderAt) ? "remind" : "wait";
}

// DRAFT wording — Jo's words (4–5 Nov 2026); approved only once she has seen the rendered email.
export const LEAD_REMINDER_TEXT = {
  subject: (address: string, day: string) => `Pick the Lead Installer for ${address} on ${day}`,
  body: (address: string, when: string, lockLabel: string) => `Hi, ${address} is booked for install on ${when} but no Lead Installer is picked yet. Pick one on the job page in the portal by ${lockLabel} so we can lodge it with the ESC. Jo`,
  button: "Pick the Lead Installer",
} as const;

export function renderLeadInstallerReminder(i: { jobNumber: string; address: string; startIso: string; jobUrl: string; lockLabel: string; test?: boolean }): { subject: string; html: string; text: string } {
  const T = LEAD_REMINDER_TEXT;
  const subject = T.subject(i.address, leadReminderDay(i.startIso));
  const out = partnerEmailLayout({
    subject, heading: subject, test: i.test ?? false,
    blocks: [
      { kind: "p", text: T.body(i.address, leadReminderWhen(i.startIso), i.lockLabel) },
      { kind: "button", label: T.button, url: i.jobUrl },
      { kind: "small", text: `Job ${i.jobNumber}` },
    ],
  });
  return { subject, html: out.html, text: out.text };
}

/** The red Needs me line: "No Lead Installer: HV-1234 install Fri 13 Nov". */
export const noLeadInstallerLine = (jobNumber: string, startIso: string) => `No Lead Installer: ${jobNumber} install ${leadReminderDay(startIso)}`;

/** Needs me (office-needs.server): every `no_lead_installer` flag (needs_office) with no `no_lead_installer_cleared` for the
 *  same key — one per job (newest first wins), with the booking it names so the caller can drop bookings no longer
 *  confirmed or already started. */
export function openNoLeadInstallerFlags(events: readonly { job_id: string; event_type: string; created_at: string; details: { key?: string; booking_id?: string; line?: string; needs_office?: boolean } | null }[]): { jobId: string; key: string; bookingId: string; at: string; line: string }[] {
  const cleared = new Set(events.filter((e) => e.event_type === LEAD_REMINDER_FLAG_CLEARED_EVENT).map((e) => e.details?.key ?? ""));
  const seen = new Set<string>();
  const out: { jobId: string; key: string; bookingId: string; at: string; line: string }[] = [];
  for (const e of [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (e.event_type !== LEAD_REMINDER_FLAG_EVENT || e.details?.needs_office !== true) continue;
    const key = e.details?.key ?? "", bookingId = e.details?.booking_id ?? "", line = e.details?.line ?? "";
    if (!key || !bookingId || !line || cleared.has(key) || seen.has(e.job_id)) continue;
    seen.add(e.job_id);
    out.push({ jobId: e.job_id, key, bookingId, at: e.created_at, line });
  }
  return out;
}
