// Part 9 Task 7 (Jo 2 Nov 2026, "GO / DON'T START"): after each GO slot run (2pm the day before, 6:30am on the day) the
// installer office gets ONE email per slot — GO, or DON'T START with the list of what is missing. By email only (no text
// to the Lead Installer); info@homeinsulationvictoria.com.au gets a copy of every DON'T START, never of GO. PURE: wording
// and key. No approved body text exists → DRAFT behind GO_EMAIL_APPROVED (false); the sender is go-email.server.
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";
import type { GoSlot } from "./prestart.core";

/** DRAFT wording: nothing reaches a real installer office (and nothing is recorded) until Jo approves the rendered email. */
export const GO_EMAIL_APPROVED = false as boolean;
/** Recorded once per key + recipient after a confirmed send (TEST: before the test send). */
export const GO_EMAIL_EVENT = "go_email_sent" as const;
/** Recorded once per key when a real send is held (comms off / trade pause / sender blocked); never claims the key. */
export const GO_EMAIL_HELD_EVENT = "go_email_held" as const;
export const GO_EMAIL_OFFICE_COPY_TO = "info@homeinsulationvictoria.com.au";

/** One send per job + install start + slot; the info@ copy of a DON'T START adds `:office`. */
export const goEmailKey = (jobId: string, startIso: string, slot: GoSlot) => `go-email:v1:${jobId}:${startIso}:${slot}`;

/** "8:00am" and "Thu 12 Nov, 8:00am" (Melbourne; minutes always shown, as in the draft). */
function parts(startIso: string): Record<string, string> {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startIso))) p[x.type] = x.value;
  return p;
}
function clock(startIso: string): string {
  const p = parts(startIso);
  const h = Number(p["hour"]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${p["minute"]}${h < 12 ? "am" : "pm"}`;
}
export function goEmailWhen(startIso: string): string {
  const p = parts(startIso);
  return `${p["weekday"]} ${p["day"]} ${p["month"]}, ${clock(startIso)}`;
}

// DRAFT wording (plan Task 7 draft; "tomorrow"/"today" follows the slot).
export const GO_EMAIL_TEXT = {
  goSubject: (jobNumber: string, slot: GoSlot, time: string) => `${jobNumber}: GO for ${slot === "day_before_2pm" ? "tomorrow" : "today"} ${time}`, // DRAFT
  goBody: (address: string, when: string, lead: string) => `All set for ${address}, ${when}. Lead Installer: ${lead}.`, // DRAFT
  noLead: "not picked yet", // DRAFT
  dontStartSubject: (jobNumber: string, n: number) => `${jobNumber}: DON'T START — ${n} ${n === 1 ? "thing" : "things"} missing`, // DRAFT
  dontStartIntro: (address: string, when: string) => `Don't start the install at ${address} on ${when} until these are fixed:`, // DRAFT
  checkAgain: "We'll check again at 6:30am.", // DRAFT (2pm run only)
  button: "Open the job", // DRAFT
} as const;

export function goEmail(i: { jobNumber: string; address: string; startIso: string; lead: string | null; failures: string[]; slot: GoSlot; link: string; test?: boolean }): { subject: string; text: string; html: string } {
  const T = GO_EMAIL_TEXT;
  const when = goEmailWhen(i.startIso);
  const go = i.failures.length === 0;
  const subject = go ? T.goSubject(i.jobNumber, i.slot, clock(i.startIso)) : T.dontStartSubject(i.jobNumber, i.failures.length);
  const blocks: PartnerBlock[] = go
    ? [{ kind: "p", text: T.goBody(i.address, when, i.lead ?? T.noLead) }]
    : [
      { kind: "p", text: T.dontStartIntro(i.address, when) },
      // Plain bullets (the layout's `list` draws ticks, which would read as "done").
      ...i.failures.map((f): PartnerBlock => ({ kind: "p", text: `• ${f}` })),
      ...(i.slot === "day_before_2pm" ? [{ kind: "p", text: T.checkAgain } as PartnerBlock] : []),
    ];
  blocks.push({ kind: "button", label: T.button, url: i.link });
  const m = partnerEmailLayout({ subject, heading: subject, blocks, test: i.test ?? false });
  return { subject, text: m.text, html: m.html };
}
