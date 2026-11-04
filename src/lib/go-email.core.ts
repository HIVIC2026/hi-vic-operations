// Part 9 Task 7 (Jo 2 Nov 2026, "GO / DON'T START"): after each GO slot run (2pm the day before, 6:30am on the day) the
// installer office gets ONE email per slot — GO, or DON'T START with the list of what is missing. By email only (no text
// to the Lead Installer); info@homeinsulationvictoria.com.au gets a copy of every DON'T START, never of GO. PURE: wording
// and key. Wording APPROVED by Jo 4 Nov 2026 14:40; GO_EMAIL_APPROVED stays false until go-live flips it; the sender is go-email.server.
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";
import type { GoSlot, PrestartFailure } from "./prestart.core";

/** Wording APPROVED by Jo 4 Nov 2026 14:40 (GO as drafted; DON'T START split into "must move" / "fix before 6:30am").
 *  The switch stays false until the coordinator flips it (nothing reaches a real installer office, nothing is recorded). */
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

// Wording approved by Jo 4 Nov 2026 14:40 ("tomorrow"/"today" follows the slot).
export const GO_EMAIL_TEXT = {
  goSubject: (jobNumber: string, slot: GoSlot, time: string) => `${jobNumber}: GO for ${slot === "day_before_2pm" ? "tomorrow" : "today"} ${time}`,
  goBody: (address: string, when: string, lead: string) => `All set for ${address}, ${when}. Lead Installer: ${lead}.`,
  noLead: "not picked yet",
  /** Every failure fixable before the start. */
  dontStartSubject: (jobNumber: string, n: number) => `${jobNumber}: DON'T START — ${n} ${n === 1 ? "thing" : "things"} missing`,
  dontStartIntro: (address: string, when: string) => `Don't start the install at ${address} on ${when} until these are fixed:`,
  /** At least one timing rule already broken → the install has to be rebooked. */
  mustMoveSubject: (jobNumber: string) => `${jobNumber}: DON'T START — the install must move`,
  mustMoveIntro: (address: string, when: string) => `Don't start the install at ${address} on ${when}.`,
  mustMoveList: "This can't be fixed in time — rebook the install for a later day and call the owner:",
  /** Heading of the fixable list: Jo's "Fix before 6:30am:" at the 2pm run; the 6:30am run says "before the start". */
  fixList: (slot: GoSlot) => (slot === "day_before_2pm" ? "Fix before 6:30am:" : "Fix before the install starts:"),
  checkAgain: "We'll check again at 6:30am.", // 2pm run only, and only when everything is fixable
  button: "Open the job",
} as const;

/** `failures` carry their class (prestart.core `classifyPrestartFailures`; unknown = must_move, fail closed). */
export function goEmail(i: { jobNumber: string; address: string; startIso: string; lead: string | null; failures: PrestartFailure[]; slot: GoSlot; link: string; test?: boolean }): { subject: string; text: string; html: string } {
  const T = GO_EMAIL_TEXT;
  const when = goEmailWhen(i.startIso);
  const go = i.failures.length === 0;
  const mustMove = i.failures.filter((f) => f.cls === "must_move").map((f) => f.line);
  const fixable = i.failures.filter((f) => f.cls === "fixable").map((f) => f.line);
  // Plain bullets (the layout's `list` draws ticks, which would read as "done").
  const bullets = (lines: string[]): PartnerBlock[] => lines.map((f) => ({ kind: "p", text: `• ${f}` }));
  const subject = go ? T.goSubject(i.jobNumber, i.slot, clock(i.startIso)) : mustMove.length ? T.mustMoveSubject(i.jobNumber) : T.dontStartSubject(i.jobNumber, i.failures.length);
  const blocks: PartnerBlock[] = go
    ? [{ kind: "p", text: T.goBody(i.address, when, i.lead ?? T.noLead) }]
    : mustMove.length
      ? [
        { kind: "p", text: T.mustMoveIntro(i.address, when) },
        { kind: "p", text: T.mustMoveList },
        ...bullets(mustMove),
        ...(fixable.length ? [{ kind: "p", text: T.fixList(i.slot) } as PartnerBlock, ...bullets(fixable)] : []),
      ]
      : [
        { kind: "p", text: T.dontStartIntro(i.address, when) },
        { kind: "p", text: T.fixList(i.slot) },
        ...bullets(fixable),
        ...(i.slot === "day_before_2pm" ? [{ kind: "p", text: T.checkAgain } as PartnerBlock] : []),
      ];
  blocks.push({ kind: "button", label: T.button, url: i.link });
  const m = partnerEmailLayout({ subject, heading: subject, blocks, test: i.test ?? false });
  return { subject, text: m.text, html: m.html };
}
