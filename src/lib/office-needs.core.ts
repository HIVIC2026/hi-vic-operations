// O1 Needs me (decisions 220, 221, 240, 243, 245, 247; approved mock-up O1). The office home: three groups
// Today / This week / Watch, one line per row (job · surname · suburb · one short line · age · one button), partner &
// system items as one fold line, no numbers strip, no "Later". One row per job: its most urgent office action.
// PURE: the server gathers facts; this decides the row, its group and its one button. Never moves a job.

export type NeedsGroup = "today" | "week" | "watch";
export const NEEDS_GROUPS: { key: NeedsGroup; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "watch", label: "Watch" },
];

export type NeedsKind =
  | "choose_again" | "quote_check" | "fixes_quote_check" | "sign_consent" | "esc_window" | "final_check" | "send_failed" | "email_change" | "email_unmatched"
  | "choose_installer" | "choose_electrician" | "sign_veec_a"
  | "payment_not_in_xero" | "payment_overdue" | "ten_days_left" | "second_no_access" | "veec_day_10" | "lapsed_window";

/** Where the one button takes the office. `section` is the Job page stage card id; `act` are inline row actions. */
export type NeedsButton =
  | { label: string; to: "job"; section?: JobSection }
  | { label: string; to: "act"; act: "apply" | "ignore" | "match" | "not_customer" };
export type JobSection = "ready-check" | "quote" | "piesa" | "install" | "final-check" | "money" | "contact";

export type NeedsRow = {
  key: string; group: NeedsGroup; kind: NeedsKind; jobId: string | null; jobNumber: string | null; surname: string; suburb: string | null;
  line: string; since: string; button: NeedsButton; secondary?: NeedsButton; eventId?: string; isTest?: boolean;
  /** Email change rows: the backend intent (cancel · reschedule · contact_change · attachment). */
  intent?: string;
};

/** Facts per job (any may be absent). Times are ISO strings. */
export type NeedsFacts = {
  jobId: string; jobNumber: string; surname: string; suburb: string | null; isTest?: boolean;
  /** 24-hour installer / electrician offer lapsed or said Not for me (decision 220): "Choose again". */
  offerLapsed?: { role: "installer" | "electrician"; name: string | null; declined: boolean; at: string; note?: string } | null;
  /** Spot saved, no installer chosen yet (decision 239). */
  spotSaved?: { at: string } | null;
  /** Quote accepted and $349 paid, no PIESA offer yet (decisions 157/173). */
  electricianToChoose?: { at: string; usual: string | null } | null;
  /** Quotes to check (held with reasons, or a ready draft waiting for Send). */
  quoteToCheck?: { at: string; reason: string | null; ready: boolean } | null;
  /** Electrical fixes quote to price / review before it goes to the owner. */
  fixesQuoteToCheck?: { at: string; reason: string | null } | null;
  /** ESC owner consent signed by the owner, waiting for the AP signature; dueAt = 24h before install. */
  consentToSign?: { at: string; dueAt: string | null } | null;
  /** VEEC form: installer Part B signed, AP Part A not; prerequisites still missing. */
  veecPartA?: { at: string; missing: number } | null;
  /** ESC install notification not sent yet; window closes 24h before the install. */
  escWindow?: { closesAt: string; opensAt: string | null } | null;
  /** Install complete, at Final check. */
  finalCheck?: { at: string; flags: number } | null;
  /** Failed customer email / text (send-failed.core row text). */
  sendFailed?: { at: string; text: string } | null;
  /** Payment watch rows (decision 240): never "Record payment". */
  paymentNotInXero?: { at: string; text: string } | null;
  paymentOverdue?: { at: string; text: string } | null;
  tenDaysLeft?: { at: string; deadline: string | null } | null;
  secondNoAccess?: { at: string; reason: string | null } | null;
  veecDay10?: { at: string } | null;
  lapsedWindow?: { deadline: string } | null;
};

const HOUR = 3_600_000;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).replace(/\s?([ap]m)$/i, (m) => m.trim().toLowerCase());
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });

type Candidate = Omit<NeedsRow, "key" | "jobId" | "jobNumber" | "surname" | "suburb" | "isTest"> & { rank: number };

/** Every candidate row for one job, most urgent first (rank). The caller keeps the first. */
export function needsCandidates(f: NeedsFacts, now: number): Candidate[] {
  const out: Candidate[] = [];
  const add = (c: Candidate) => out.push(c);
  if (f.sendFailed) add({ rank: 10, group: "today", kind: "send_failed", line: `Send failed · ${f.sendFailed.text}`, since: f.sendFailed.at, button: { label: "Open job", to: "job", section: "contact" } });
  if (f.offerLapsed) add({ rank: 20, group: "today", kind: "choose_again", line: f.offerLapsed.note ? f.offerLapsed.note : `${f.offerLapsed.role === "installer" ? "Installer" : "Electrician"} offer ${f.offerLapsed.declined ? `declined${f.offerLapsed.name ? ` by ${f.offerLapsed.name}` : ""}` : "lapsed · no reply in 24h"}`, since: f.offerLapsed.at, button: { label: "Choose again", to: "job", section: f.offerLapsed.role === "installer" ? "ready-check" : "piesa" } });
  if (f.consentToSign) {
    const due = f.consentToSign.dueAt ? Date.parse(f.consentToSign.dueAt) : null;
    const soon = due == null || due - now <= 48 * HOUR;
    add({ rank: soon ? 30 : 110, group: soon ? "today" : "week", kind: "sign_consent", line: `ESC consent · AP signature due ${f.consentToSign.dueAt ? fmtWhen(f.consentToSign.dueAt) : "before the install"}`, since: f.consentToSign.at, button: { label: "Sign", to: "job", section: "install" } });
  }
  if (f.escWindow) {
    const closes = Date.parse(f.escWindow.closesAt);
    const soon = closes - now <= 48 * HOUR;
    add({ rank: soon ? 35 : 115, group: soon ? "today" : "week", kind: "esc_window", line: `ESC notice window closes ${fmtWhen(f.escWindow.closesAt)}`, since: f.escWindow.opensAt ?? f.escWindow.closesAt, button: { label: "Open Registry block", to: "job", section: "install" } });
  }
  if (f.quoteToCheck) add({ rank: 40, group: "today", kind: "quote_check", line: f.quoteToCheck.ready ? "Quote ready · all checks passed · press Send" : `Quote held · ${f.quoteToCheck.reason ?? "something is missing"}`, since: f.quoteToCheck.at, button: { label: "Check & send", to: "job", section: "quote" } });
  if (f.fixesQuoteToCheck) add({ rank: 45, group: "today", kind: "fixes_quote_check", line: `Electrical fixes quote to check${f.fixesQuoteToCheck.reason ? ` · ${f.fixesQuoteToCheck.reason}` : ""}`, since: f.fixesQuoteToCheck.at, button: { label: "Review and send", to: "job", section: "piesa" } });
  if (f.finalCheck) add({ rank: 50, group: "today", kind: "final_check", line: `Final check · install complete · ${f.finalCheck.flags ? `${f.finalCheck.flags} flag${f.finalCheck.flags === 1 ? "" : "s"}` : "no flags"}`, since: f.finalCheck.at, button: { label: "Approve", to: "job", section: "final-check" } });
  if (f.spotSaved) add({ rank: 100, group: "week", kind: "choose_installer", line: "Spot saved · waiting for an installer", since: f.spotSaved.at, button: { label: "Choose installer", to: "job", section: "ready-check" } });
  if (f.electricianToChoose) add({ rank: 105, group: "week", kind: "choose_electrician", line: `Quote accepted · $349 paid · PIESA next${f.electricianToChoose.usual ? ` · usual electrician ${f.electricianToChoose.usual}` : ""}`, since: f.electricianToChoose.at, button: { label: "Send offer", to: "job", section: "piesa" } });
  if (f.veecPartA) add({ rank: 120, group: "week", kind: "sign_veec_a", line: f.veecPartA.missing ? `VEEC Part A · ${f.veecPartA.missing} prerequisite${f.veecPartA.missing === 1 ? "" : "s"} still to record` : "VEEC Part A · prerequisites recorded", since: f.veecPartA.at, button: { label: "Sign", to: "job", section: "final-check" } });
  if (f.lapsedWindow) add({ rank: 200, group: "watch", kind: "lapsed_window", line: `30-day window lapsed ${fmtDay(f.lapsedWindow.deadline)} · no install`, since: f.lapsedWindow.deadline, button: { label: "Open job", to: "job", section: "install" } });
  if (f.secondNoAccess) add({ rank: 210, group: "watch", kind: "second_no_access", line: `Couldn’t get in · second time${f.secondNoAccess.reason ? ` · ${f.secondNoAccess.reason}` : ""}`, since: f.secondNoAccess.at, button: { label: "Open job", to: "job", section: "install" } });
  if (f.tenDaysLeft) add({ rank: 220, group: "watch", kind: "ten_days_left", line: `10 days left on the 30-day clock${f.tenDaysLeft.deadline ? ` · last day ${fmtDay(f.tenDaysLeft.deadline)}` : ""}`, since: f.tenDaysLeft.at, button: { label: "Open job", to: "job", section: "install" } });
  if (f.veecDay10) add({ rank: 230, group: "watch", kind: "veec_day_10", line: "VEEC form unsigned · day 10", since: f.veecDay10.at, button: { label: "Open job", to: "job", section: "final-check" } });
  if (f.paymentNotInXero) add({ rank: 240, group: "watch", kind: "payment_not_in_xero", line: `${f.paymentNotInXero.text} · not in Xero yet`, since: f.paymentNotInXero.at, button: { label: "Open job", to: "job", section: "money" } });
  if (f.paymentOverdue) add({ rank: 245, group: "watch", kind: "payment_overdue", line: `Payment overdue · chase · ${f.paymentOverdue.text}`, since: f.paymentOverdue.at, button: { label: "Open job", to: "job", section: "money" } });
  return out.sort((a, b) => a.rank - b.rank);
}

/** Email rows (decisions 245/247) — always Today, one per email, two taps (Apply / Ignore, Match / Not a customer). */
/** Decision 245 wording "Owner asks to …" per backend intent (email-intent.core CHANGE_INTENTS). */
export const CHANGE_LINE = {
  cancel: "Owner asks to cancel",
  reschedule: "Owner can't make the day",
  contact_change: "Owner asks to change contact details",
  attachment: "Owner sent a photo or document",
  other: "Owner asks for a change",
} as const;

export type EmailRowInput =
  | { type: "change"; eventId: string; jobId: string; jobNumber: string | null; surname: string; suburb: string | null; line: string; at: string; intent?: string | null }
  | { type: "unmatched"; eventId: string; guessJobId: string | null; jobNumber: string | null; surname: string; suburb: string | null; line: string; at: string };

export function emailRow(e: EmailRowInput): NeedsRow {
  if (e.type === "change") return { key: `email:${e.eventId}`, group: "today", kind: "email_change", eventId: e.eventId, ...(e.intent ? { intent: e.intent } : {}), jobId: e.jobId, jobNumber: e.jobNumber, surname: e.surname, suburb: e.suburb, line: e.line, since: e.at, button: { label: "Apply", to: "act", act: "apply" }, secondary: { label: "Ignore", to: "act", act: "ignore" } };
  return { key: `email:${e.eventId}`, group: "today", kind: "email_unmatched", eventId: e.eventId, jobId: e.guessJobId, jobNumber: e.jobNumber, surname: e.surname, suburb: e.suburb, line: e.line, since: e.at, button: { label: "Match", to: "act", act: "match" }, secondary: { label: "Not a customer", to: "act", act: "not_customer" } };
}

const GROUP_ORDER: Record<NeedsGroup, number> = { today: 0, week: 1, watch: 2 };

/** One row per job (its most urgent action), email rows on top of Today, oldest first inside a group. */
export function buildNeedsRows(i: { now: number; jobs: NeedsFacts[]; emails?: EmailRowInput[] }): Record<NeedsGroup, NeedsRow[]> {
  const rows: (NeedsRow & { rank: number })[] = [];
  for (const f of i.jobs) {
    const top = needsCandidates(f, i.now)[0];
    if (!top) continue;
    const { rank, ...c } = top;
    rows.push({ ...c, rank, key: `${f.jobId}:${c.kind}`, jobId: f.jobId, jobNumber: f.jobNumber, surname: f.surname, suburb: f.suburb, ...(f.isTest ? { isTest: true } : {}) });
  }
  for (const e of i.emails ?? []) rows.push({ ...emailRow(e), rank: 5 });
  rows.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.rank - b.rank || a.since.localeCompare(b.since));
  const out: Record<NeedsGroup, NeedsRow[]> = { today: [], week: [], watch: [] };
  for (const { rank: _r, ...r } of rows) out[r.group].push(r);
  return out;
}

/** "1d", "3h", "40m", "today" — the age column. */
export function ageLabel(since: string, now: number): string {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms)) return "";
  if (ms < 0) return "today";
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 24 * HOUR) return `${Math.round(ms / HOUR)}h`;
  return `${Math.floor(ms / (24 * HOUR))}d`;
}

/** Partner & system fold (decision 221): one fold line; each item one line with one button. */
export type SystemRow = { key: string; tag: string; who: string; line: string; since: string | null; button: string; href: string; jobId?: string };
