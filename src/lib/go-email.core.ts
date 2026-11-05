// Part 9 Task 7 (Jo 2 Nov 2026, "GO / DON'T START"): after each GO slot run (2pm the day before, 6:30am on the day) the
// installer office gets ONE email per slot — GO, or DON'T START with the list of what is missing. By email only (no text
// to the Lead Installer); info@homeinsulationvictoria.com.au gets a copy of every DON'T START, never of GO. PURE: wording
// and key. Wording APPROVED by Jo 4 Nov 2026 14:40; GO_EMAIL_APPROVED stays false until go-live flips it; the sender is go-email.server.
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";
import { isReadErrorLine, onDayGoCheck, type GoSlot, type PrestartFailure } from "./prestart.core";

/** Wording APPROVED by Jo 4 Nov 2026 14:40 (GO as drafted; DON'T START split into "must move" / "fix before 6:30am").
 *  The switch stays false until the coordinator flips it (nothing reaches a real installer office, nothing is recorded). */
export const GO_EMAIL_APPROVED = true as boolean; // ON at go-live 5 Nov 2026 (Jo approved 4 Nov 14:40)
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
  /** Heading of the fixable list: Jo's "Fix before 6:30am:" at the 2pm run; the 6:30am run says "before the start".
   *  G6 N1: the time is the on-day check's ("6:00am" for an install starting at or before 6:30am); no on-day check
   *  possible (start at or before 6:00am) → "before the install starts" at the 2pm run too. */
  fixList: (slot: GoSlot, onDayLabel: string | null = "6:30am") => (slot === "day_before_2pm" && onDayLabel ? `Fix before ${onDayLabel}:` : "Fix before the install starts:"),
  checkAgain: (onDayLabel = "6:30am") => `We'll check again at ${onDayLabel}.`, // 2pm run only, and only when everything is fixable AND an on-day check runs
  button: "Open the job",
} as const;

// G6 S5 (final Part 9 review, 4 Nov 2026) → Deep Part 5a (Jo 4–5 Nov 2026): the GO check's lines are written for the office
// (Needs me). The installer office's email shows a plain line per failure instead — EVERY pre-start blocker mapped here,
// never a database error (that stays on the office event), never office voice, "Lead Installer" in full, "electrical
// upgrades" never "fixes". DRAFT wording (JO-APPROVAL-LIST); the approved GO / DON'T START frame is unchanged. Unknown
// lines pass through with "Lead Installer" capitalised (fail open on wording, never on the check itself).
export const GO_EMAIL_PLAIN = {
  couldNotCheck: "Something couldn't be checked — Home Insulation Victoria is looking into it.",
  noLead: "No Lead Installer is chosen for this install.",
  leadCertNotVerified: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""}: CII/EEC certificate not verified by Home Insulation Victoria.`,
  leadCertRecheck: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""}: CII/EEC certificate needs checking by Home Insulation Victoria.`,
  leadCertProvisional: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""}: CII/EEC certificate is provisional, not full.`,
  leadCertExpired: (ymd: string) => `Lead Installer's CII/EEC certificate expired on ${ymd}.`,
  leadNoticeNotAcknowledged: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""} hasn't acknowledged the ESC privacy collection notice — they need to open their link and tick it.`,
  leadWhiteCard: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""}: White Card not verified by Home Insulation Victoria.`,
  leadNotEscRegistered: (name: string | null) => `Lead Installer${name ? ` ${name}` : ""} isn't registered with the ESC yet — Home Insulation Victoria registers them.`,
  escNotSent: "ESC notice not sent yet — Home Insulation Victoria sends it.",
  escTooLate: "ESC notice went in less than 24 hours before the start — the install has to move.",
  escTooEarly: "ESC notice went in too early (more than 5 days before) — Home Insulation Victoria will send it again.",
  notCleared: (why: string) => `Safety check (PIESA) not cleared yet: ${why}`,
  windowEnded: (ymd: string) => `The 30-day window after the safety check ended on ${ymd} — a new safety check is needed.`,
  windowUnknown: "No 30-day window date is recorded — Home Insulation Victoria is checking it.",
  consentNotSigned: (by: string) => `The owner hasn't signed the ESC consent yet — it must be signed by ${by}.`,
  consentNotComplete: (by: string) => `The owner's ESC consent isn't complete yet — it must be signed by ${by}.`,
  consentStale: "The owner's ESC consent is for an earlier booking — a new one is needed.",
  consentTooLate: "The owner's ESC consent was signed less than 24 hours before the start — the install has to move.",
  consentUnreadable: "The owner's ESC consent couldn't be checked — Home Insulation Victoria is looking into it.",
  noInstallBooked: "No install booking found for this job.",
  piesaDateMissing: "The safety check (PIESA) completion date isn't recorded.",
  piisaWindow: "More than 30 days since the safety check — the install can't go ahead. A new safety check is needed.",
  readyCheckCondition: (what: string) => `Ready Check: the original condition isn't recorded for ${what}.`,
  siteHold: "Site conditions differ from the Ready Check — Home Insulation Victoria is reviewing it.",
  business: (problem: string) => `Your business: ${problem}`,
  swms: (who: string) => `Safety plan not signed: ${who}`,
  depositNotPaid: "The owner's deposit isn't paid yet.",
  piesaCopy: (who: "owner" | "installer", by: string) => `The signed safety check copy hasn't gone to ${who === "owner" ? "the owner" : "you"} — needed by ${by}.`,
  piesaCopyUpdated: (who: "owner" | "installer", by: string) => `The updated safety check (with the electrical upgrades Part C) hasn't gone to ${who === "owner" ? "the owner" : "you"} — needed by ${by}.`,
  certificateNotIn: "The Certificate of Electrical Safety for the electrical upgrades isn't in yet.",
  certificateNotChecked: (why: string) => `The Certificate of Electrical Safety hasn't been checked by Home Insulation Victoria yet (${why}).`,
  electricianNotConfirmed: "The electrician needs to be at the install and hasn't confirmed yet.",
  lifeSupportPlan: "Life support at this home — the written consent or medical plan isn't on file with Home Insulation Victoria.",
} as const;
const NAME = "(?: (.+?))?";
/** One office GO-check line → the line the installer office reads. Unknown lines pass through with "Lead Installer" capitalised. */
export function tradeSafeFailureLine(line: string): string {
  const P = GO_EMAIL_PLAIN;
  let m: RegExpExecArray | null;
  // The certificate line first: its reason can read like a read error ("the AI couldn't read it") but it is the office's tick.
  if ((m = /^Check electrical certificate — (.+)$/.exec(line))) return P.certificateNotChecked(m[1]!);
  if (isReadErrorLine(line)) return P.couldNotCheck;
  if (/^No lead installer is recorded for this job\.$/.test(line)) return P.noLead;
  if ((m = new RegExp(`^Lead installer${NAME} has no office-verified EEC CII certification\\.$`).exec(line))) return P.leadCertNotVerified(m[1] ?? null);
  if ((m = new RegExp(`^Lead installer${NAME}: re-record certification as Full with expiry date\\.$`).exec(line))) return P.leadCertRecheck(m[1] ?? null);
  if ((m = new RegExp(`^Lead installer${NAME} holds a provisional certification, not full\\.$`).exec(line))) return P.leadCertProvisional(m[1] ?? null);
  if ((m = /^Lead installer's certification expired on (\S+)\.$/.exec(line))) return P.leadCertExpired(m[1]!);
  if ((m = new RegExp(`^Lead installer${NAME}: ESC privacy collection notice not acknowledged`).exec(line))) return P.leadNoticeNotAcknowledged(m[1] ?? null);
  if ((m = new RegExp(`^Lead installer${NAME}: White Card not verified$`).exec(line))) return P.leadWhiteCard(m[1] ?? null);
  if ((m = new RegExp(`^Lead Installer${NAME} is not registered with the ESC yet\\.$`).exec(line))) return P.leadNotEscRegistered(m[1] ?? null);
  if (/^ESC notification is not marked submitted for this install date\.$/.test(line)) return P.escNotSent;
  if (/^ESC notification was sent less than 24h before start/.test(line)) return P.escTooLate;
  if (/^ESC notification is too early/.test(line)) return P.escTooEarly;
  if ((m = /^Electrical clearance is not valid: (.+)$/.exec(line))) return P.notCleared(m[1]!);
  if ((m = /^The 30-day window ended on (\S+)\. New PIESA needed\.$/.exec(line))) return P.windowEnded(m[1]!);
  if (/^No 30-day window date is recorded\.$/.test(line)) return P.windowUnknown;
  if ((m = /^Owner consent: Owner ESC consent not generated – must be signed by (.+?) \(24h before start\)$/.exec(line))) return P.consentNotSigned(m[1]!);
  if ((m = /^Owner consent: Owner ESC consent not complete \(owner \+ AP representative\) – must be signed by (.+)$/.exec(line))) return P.consentNotComplete(m[1]!);
  if (/^Owner consent: Owner ESC consent is stale/.test(line)) return P.consentStale;
  if (/^Owner consent: Owner ESC consent was completed less than 24h/.test(line)) return P.consentTooLate;
  if (/^Owner consent: Owner ESC consent signature dates are unreadable/.test(line)) return P.consentUnreadable;
  if (/^Owner consent: No installation booked$/.test(line)) return P.noInstallBooked;
  if (/^PIESA completion date is missing\.$/.test(line)) return P.piesaDateMissing;
  if (/^The installer safety form \(PIISA\) can only be done within 30 days of the PIESA\.$/.test(line)) return P.piisaWindow;
  if ((m = /^Ready Check original condition not recorded: (.+)\.$/.exec(line))) return P.readyCheckCondition(m[1]!);
  if (/^Site conditions differ/.test(line)) return P.siteHold;
  if ((m = /^Installer business: (.+)$/.exec(line))) return P.business(m[1]!);
  if ((m = /^Safety plan not signed: (.+)$/.exec(line))) return P.swms(m[1]!);
  if (/^Install deposit not paid$/.test(line)) return P.depositNotPaid;
  if ((m = /^Signed PIESA copy delivery to (owner|installer) must be recorded by (.+)$/.exec(line))) return P.piesaCopy(m[1] as "owner" | "installer", m[2]!);
  if ((m = /^Updated PIESA \(with Part C\) not delivered to the (owner|installer) by (.+)$/.exec(line))) return P.piesaCopyUpdated(m[1] as "owner" | "installer", m[2]!);
  if (/^Certificate of Electrical Safety not in yet$/.test(line)) return P.certificateNotIn;
  if ((m = /^Check electrical certificate — (.+)$/.exec(line))) return P.certificateNotChecked(m[1]!);
  if (/^The PIESA needs an electrician at the install and they haven't confirmed\.$/.test(line)) return P.electricianNotConfirmed;
  if (/^Life support at this home: the written consent or medical plan isn't on file\.$/.test(line)) return P.lifeSupportPlan;
  return line.replace(/\b[Ll]ead installer\b/g, "Lead Installer");
}
/** Every failure as the installer office reads it, in order, one line each (two read errors = one plain line). */
export function tradeSafeFailures(failures: readonly PrestartFailure[]): PrestartFailure[] {
  const out: PrestartFailure[] = [];
  for (const f of failures) {
    const line = tradeSafeFailureLine(f.line);
    if (!out.some((x) => x.line === line && x.cls === f.cls)) out.push({ line, cls: f.cls });
  }
  return out;
}

// ── Deep Part 5a (Jo 4–5 Nov 2026): Jo's own GO / DON'T START wording, built in OFF. The approved 4 Nov frame above keeps
// sending until she approves the rendered V2; flipping GO_EMAIL_V2_APPROVED swaps the wording only (same slots, keys,
// recipients, info@ copy, guards). DRAFT until approved.
export const GO_EMAIL_V2_APPROVED = false as boolean;
export const GO_EMAIL_V2_TEXT = {
  goSubject: (jobNumber: string, address: string, day: string) => `${jobNumber} ${address} – GO for ${day}`,
  goBody: (address: string, slot: GoSlot, day: string, time: string, lead: string, crew: string) => `GO for ${address} ${slot === "day_before_2pm" ? "tomorrow" : "today"} ${day} ${time}. Lead Installer: ${lead}. Crew: ${crew}. Everything's in place: deposit paid, safety check clear, ESC notice lodged, safety plan signed.`,
  noLead: "not picked yet",
  noCrew: "none",
  dontStartSubject: (jobNumber: string, address: string, day: string) => `${jobNumber} ${address} – DON'T START ${day}`,
  dontStartIntro: (address: string, day: string) => `DON'T START at ${address} on ${day}. Fix these first:`,
  callUs: "Call Home Insulation Victoria on 0477 511 901 if you need a hand.",
  button: "Open the job",
} as const;
/** "Thu 12 Nov" (Melbourne). */
function dayLabel(startIso: string): string {
  const p = parts(startIso);
  return `${p["weekday"]} ${p["day"]} ${p["month"]}`;
}

/** `failures` carry their class (prestart.core `classifyPrestartFailures`; unknown = must_move, fail closed). */
export function goEmail(i: { jobNumber: string; address: string; startIso: string; lead: string | null; crew?: string[]; failures: PrestartFailure[]; slot: GoSlot; link: string; test?: boolean; v2?: boolean }): { subject: string; text: string; html: string } {
  const T = GO_EMAIL_TEXT;
  const when = goEmailWhen(i.startIso);
  const failures = tradeSafeFailures(i.failures); // S5: plain trade lines, never the office / database text
  if (i.v2 ?? GO_EMAIL_V2_APPROVED) return goEmailV2(i, failures);
  const onDay = onDayGoCheck(i.startIso)?.label ?? null; // N1: "6:30am", "6:00am" or none
  const go = failures.length === 0;
  const mustMove = failures.filter((f) => f.cls === "must_move").map((f) => f.line);
  const fixable = failures.filter((f) => f.cls === "fixable").map((f) => f.line);
  // Plain bullets (the layout's `list` draws ticks, which would read as "done").
  const bullets = (lines: string[]): PartnerBlock[] => lines.map((f) => ({ kind: "p", text: `• ${f}` }));
  const subject = go ? T.goSubject(i.jobNumber, i.slot, clock(i.startIso)) : mustMove.length ? T.mustMoveSubject(i.jobNumber) : T.dontStartSubject(i.jobNumber, failures.length);
  const blocks: PartnerBlock[] = go
    ? [{ kind: "p", text: T.goBody(i.address, when, i.lead ?? T.noLead) }]
    : mustMove.length
      ? [
        { kind: "p", text: T.mustMoveIntro(i.address, when) },
        { kind: "p", text: T.mustMoveList },
        ...bullets(mustMove),
        ...(fixable.length ? [{ kind: "p", text: T.fixList(i.slot, onDay) } as PartnerBlock, ...bullets(fixable)] : []),
      ]
      : [
        { kind: "p", text: T.dontStartIntro(i.address, when) },
        { kind: "p", text: T.fixList(i.slot, onDay) },
        ...bullets(fixable),
        ...(i.slot === "day_before_2pm" && onDay ? [{ kind: "p", text: T.checkAgain(onDay) } as PartnerBlock] : []),
      ];
  blocks.push({ kind: "button", label: T.button, url: i.link });
  const m = partnerEmailLayout({ subject, heading: subject, blocks, test: i.test ?? false });
  return { subject, text: m.text, html: m.html };
}

/** Jo's V2 wording (4–5 Nov 2026): GO with the Lead Installer, the crew and the four facts; DON'T START with every blocker
 *  as a plain bullet and the office phone line. Same button, same layout. */
function goEmailV2(i: { jobNumber: string; address: string; startIso: string; lead: string | null; crew?: string[]; slot: GoSlot; link: string; test?: boolean }, failures: PrestartFailure[]): { subject: string; text: string; html: string } {
  const T = GO_EMAIL_V2_TEXT;
  const day = dayLabel(i.startIso);
  const go = failures.length === 0;
  const subject = go ? T.goSubject(i.jobNumber, i.address, day) : T.dontStartSubject(i.jobNumber, i.address, day);
  const blocks: PartnerBlock[] = go
    ? [{ kind: "p", text: T.goBody(i.address, i.slot, day, clock(i.startIso), i.lead ?? T.noLead, i.crew?.length ? i.crew.join(", ") : T.noCrew) }]
    : [{ kind: "p", text: T.dontStartIntro(i.address, day) }, ...failures.map((f): PartnerBlock => ({ kind: "p", text: `• ${f.line}` })), { kind: "p", text: T.callUs }];
  blocks.push({ kind: "button", label: T.button, url: i.link });
  const m = partnerEmailLayout({ subject, heading: subject, blocks, test: i.test ?? false });
  return { subject, text: m.text, html: m.html };
}
