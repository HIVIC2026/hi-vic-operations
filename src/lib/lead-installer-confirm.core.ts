// Part 7 Task 6 (Jo 2 Nov 2026, "Lead Installer / ESC 24h rule"): ESC must know the Lead Installer ≥24h before the
// install, so the installer's office gets ONE email at 9am two days before — "Confirm or change your Lead Installer by
// 5pm today" (+ pick the crew) — and from 5pm that day the Lead Installer is locked (a change means moving the install
// day). Replaces the 2pm day-before crew reminder (#110). PURE: wording, key, timing. The clock itself is Part 9's rule in
// prestart.core (leadInstallerLock / leadInstallerLocked / LEAD_LOCKED_MESSAGE). No approved body text exists → DRAFT.
import { partnerEmailLayout } from "./partner-email.core";
import { leadInstallerLock } from "./prestart.core";

/** DRAFT wording: nothing reaches a real installer office until Jo approves the rendered email. */
export const LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED = false as boolean;
/** Recorded once per key BEFORE a send (TEST or real). */
export const LEAD_CONFIRM_EVENT = "lead_installer_confirm_email" as const;
/** Recorded once per key when a real send is held (flag off / trade messages paused); never claims the key. */
export const LEAD_CONFIRM_HELD_EVENT = "lead_installer_confirm_held" as const;
/** Bookings further out than this are not looked at by the sweep. */
export const LEAD_CONFIRM_LOOKAHEAD_DAYS = 3;

export const leadConfirmKey = (jobId: string, installYmd: string) => `lead-confirm:v1:${jobId}:${installYmd}`;

const TZ = "Australia/Melbourne";
/** The install's Melbourne day (YYYY-MM-DD) for the key. */
export function leadConfirmInstallYmd(startIso: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startIso))) p[x.type] = x.value;
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}

/** "send" from 9am two days before (or at once when booked after that) until the 5pm lock; "too_late" from the lock on. */
export function leadConfirmDue(f: { startIso: string; bookedAt: string; now: Date }): "send" | "wait" | "too_late" {
  const { emailAt, lockAt } = leadInstallerLock(f.startIso);
  const now = f.now.getTime();
  if (now >= Date.parse(lockAt)) return "too_late";
  const from = Math.max(Date.parse(emailAt), Number.isNaN(Date.parse(f.bookedAt)) ? 0 : Date.parse(f.bookedAt));
  return now >= from ? "send" : "wait";
}

/** "Fri 13 Nov, 7:30am" (Melbourne). */
export function leadConfirmWhen(startIso: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startIso))) p[x.type] = x.value;
  const h = Number(p["hour"]) % 24, m = Number(p["minute"]);
  return `${p["weekday"]} ${p["day"]} ${p["month"]}, ${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

// DRAFT wording (no approved body exists; the heading line and the 5pm rule are the decision's words).
export const LEAD_CONFIRM_TEXT = {
  heading: "Confirm or change your Lead Installer by 5pm today",
  subject: (jobNumber: string) => `${jobNumber}: Confirm or change your Lead Installer by 5pm today`, // DRAFT
  intro: "Your install is in two days. Check the Lead Installer and crew below on the job, and change them if you need to.", // DRAFT
  noLead: "Not picked yet", // DRAFT
  noCrew: "None picked yet", // DRAFT
  button: "Confirm on the job", // DRAFT
  lockLine: "After 5pm the Lead Installer is locked because the ESC is told. To change it after that, the install day has to move.", // DRAFT
  rows: { install: "Install", address: "Address", lead: "Lead Installer", crew: "Crew" },
} as const;

export function renderLeadInstallerConfirm(i: { jobNumber: string; owner: string; startIso: string; address: string; lead: string | null; crew: string[]; jobUrl: string; lockLabel: string; business?: string | null; test?: boolean }): { subject: string; html: string; text: string } {
  const T = LEAD_CONFIRM_TEXT;
  const hi = i.business?.trim() ? `Hi ${i.business.trim()},` : "Hi,"; // suite look (Jo 5 Nov 2026): greeting line above the heading
  const rows = [
    `${T.rows.install}: ${leadConfirmWhen(i.startIso)}`,
    `${T.rows.address}: ${i.address}${i.owner ? ` (${i.owner})` : ""}`,
    `${T.rows.lead}: ${i.lead ?? T.noLead}`,
    `${T.rows.crew}: ${i.crew.length ? i.crew.join(", ") : T.noCrew}`,
  ];
  const subject = T.subject(i.jobNumber);
  const out = partnerEmailLayout({
    subject, heading: T.heading, test: i.test ?? false,
    blocks: [
      { kind: "hi", text: hi },
      { kind: "p", text: T.intro },
      { kind: "list", items: rows },
      { kind: "button", label: T.button, url: i.jobUrl },
      { kind: "p", text: T.lockLine },
      { kind: "small", text: `Job ${i.jobNumber} · locked from ${i.lockLabel}` },
    ],
  });
  return { subject, html: out.html, text: out.text };
}
