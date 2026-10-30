import { inHouseTradeBookingText } from "./in-house-message.core";
// "Where is this job up to?" for trades (Jo, 7 Oct 2026). One plain status line + a progress timeline, from real facts only.
// Pure. Staff (non-owner) logins never see payment amounts.
import { DEFAULT_DUE, type DueSettings } from "./waiting.core";
import { safetyCheckPayLabel, type SafetyCheckPayState } from "./payment-gate.core";

export type { SafetyCheckPayState };
export { safetyCheckPayLabel };

export type Tone = "ok" | "amber" | "rose";
export type Who = "Owner" | "You" | "Home Insulation Victoria" | string;
export type StatusBooking = { kind: string; status: string; start: string | null; end: string | null; business: string | null; mine: boolean };
import { stageWording } from "./job-wording";
const SITUATION_TRADE = { rcAccept: "Waiting for owner to accept Ready Check" } as const;
export type StatusFacts = {
  inHouseDispatch?: "in_house" | "in_house_read_failed" | null;
  stage: string; stageSince: string | null; now: Date; staff: boolean;
  bookings: StatusBooking[];
  quoteSentAt: string | null; quoteAcceptedAt: string | null;
  safetyPaidAt: string | null; ownerTimesChosenAt: string | null;
  /** Latest stored request asking the owner to pick Ready Check times, and latest owner-picked window. */
  rcTimesAskedAt?: string | null; rcTimesGivenAt?: string | null;
  rectQuoteSentAt: string | null;
  paidInFullAt: string | null; firstHalfPaidAt?: string | null; fixesPaidAt?: string | null;
  apApprovedAt: string | null;
  /** What the $349 safety check payment actually is: received, overridden, TEST-simulated, due or unknown. */
  safetyPay: SafetyCheckPayState;
  payout: { kind: "coming"; on: string } | { kind: "checking" } | { kind: "paid"; on: string } | null;
  settings?: DueSettings | null;
};
export type StatusLine = { text: string; who: Who | null; since: string | null; waitingDays: number | null; tone: Tone; money: string | null };

/** Defaults Jo to confirm when no setting exists (owner/trade use the existing due_* settings). */
export const STATUS_DEFAULTS = { ownerAmberDays: 2, officeAmberDays: 2, officeRoseDays: 5 } as const;

const DAY = 86_400_000;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).replace(",", "");
function fmtSlot(start: string, end: string | null) {
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).replace(":00", "").replace(/\s/g, "").toLowerCase();
  if (!end) return `${fmtDay(start)}, ${t(start)}`;
  const a = t(start), b = t(end);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${fmtDay(start)}, ${sameHalf ? a.slice(0, -2) : a}–${b}`;
}
export const statusDay = fmtDay;

function days(from: string | null, now: Date) { return from ? Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY)) : null; }
const waitTxt = (d: number | null) => (d == null ? null : d === 0 ? "waiting under a day" : `waiting ${d} day${d === 1 ? "" : "s"}`);

/** Staleness vs normal timing. Owner: amber after 2 days, rose after the owner reminder setting (3 days). Trades: due_trade_reply hours. Office: 2 / 5 days. */
export function toneFor(who: Who | null, since: string | null, now: Date, s?: DueSettings | null): Tone {
  if (!who || !since) return "ok";
  const cfg = s ?? DEFAULT_DUE;
  const h = (now.getTime() - new Date(since).getTime()) / 3_600_000;
  if (who === "Owner") return h > cfg.ownerReminderDays * 24 ? "rose" : h > STATUS_DEFAULTS.ownerAmberDays * 24 ? "amber" : "ok";
  if (who === "Home Insulation Victoria") return h > STATUS_DEFAULTS.officeRoseDays * 24 ? "rose" : h > STATUS_DEFAULTS.officeAmberDays * 24 ? "amber" : "ok";
  return h > cfg.tradeExceptionHours ? "rose" : h > cfg.tradeWarnHours ? "amber" : "ok";
}

function latest(b: StatusBooking[], kind: string, status?: string) {
  return b.filter((x) => x.kind === kind && x.start && (!status || x.status === status)).sort((a, c) => (c.start ?? "").localeCompare(a.start ?? ""))[0] ?? null;
}

export function jobStatusLine(f: StatusFacts): StatusLine {
  const S = f.stage;
  const heldVisit = f.inHouseDispatch ? inHouseTradeBookingText(S) : null;
  if (heldVisit) return { text: f.inHouseDispatch === "in_house" ? heldVisit : "Visit booking details unavailable", who: "You", since: f.stageSince, waitingDays: null, tone: "ok", money: null };
    const wait = (text: string, who: Who, since: string | null, sentLabel = "sent"): StatusLine => {
    const d = days(since, f.now);
    return { text: [text, since ? `${sentLabel} ${fmtDay(since)}` : null, waitTxt(d), who].filter(Boolean).join(" · "), who, since, waitingDays: d, tone: toneFor(who, since, f.now, f.settings), money: null };
  };
  const booked = (text: string, b: StatusBooking): StatusLine => ({ text: `${text} · ${fmtSlot(b.start!, b.end)} · ${b.mine ? "You" : b.business ?? "Booked"}`, who: null, since: null, waitingDays: null, tone: "ok", money: null });
  const office = (text: string, since: string | null): StatusLine => ({ text: `${text}${since ? ` · since ${fmtDay(since)}` : ""}`, who: "Home Insulation Victoria", since, waitingDays: days(since, f.now), tone: toneFor("Home Insulation Victoria", since, f.now, f.settings), money: null });
  const balance = (): string | null => {
    if (f.staff || f.paidInFullAt || !f.safetyPaidAt) return null;
    return "Owner payment — office checks the agreed payment option";
  };
  let out: StatusLine;
  switch (S) {
    case "ready_check_awaiting_acceptance": case "preliminary_estimate_ready": out = wait(SITUATION_TRADE.rcAccept, "Owner", f.stageSince); break;
    case "ready_check_ready_to_schedule": {
      // Only "choosing times" when the owner was actually asked and has not picked times since (Jo, 21 Oct).
      const asked = f.rcTimesAskedAt ?? null, given = f.rcTimesGivenAt ?? null;
      out = asked && (!given || given < asked) ? wait("Owner choosing Ready Check times", "Owner", asked, "asked") : office(stageWording("ready_check_ready_to_schedule").trade!, f.stageSince); break;
    }
    case "ready_check_scheduled": { const b = latest(f.bookings, "ready_check", "confirmed"); out = b ? booked(stageWording("ready_check_scheduled").trade!, b) : wait(stageWording("ready_check_ready_to_schedule").trade!, "Owner", f.stageSince, "since"); break; }
    case "ready_check_complete": out = office(stageWording("ready_check_complete").trade!, f.stageSince); break;
    case "measured_estimate_ready": case "awaiting_quote_acceptance": out = wait(stageWording("measured_estimate_ready").trade!, "Owner", f.quoteSentAt ?? f.stageSince); break;
    case "measured_quote_accepted": case "awaiting_deposit_payment": out = wait(stageWording("measured_quote_accepted").trade!, "Owner", f.quoteAcceptedAt ?? f.stageSince); break;
    case "piesa_and_install_window_pending": case "awaiting_electrician": case "assessment_booking":
      out = f.ownerTimesChosenAt ? wait("Owner's times sent to the electrician", "Electrician", f.ownerTimesChosenAt) : wait("Owner choosing PIESA times", "Owner", f.safetyPaidAt ?? f.stageSince, "since"); break;
    case "piesa_scheduled": case "assessment_booked": { const b = latest(f.bookings, "assessment", "confirmed"); out = b ? booked(stageWording("piesa_scheduled").trade!, b) : office(stageWording("piesa_and_install_window_pending").trade!, f.stageSince); break; }
    case "piesa_complete": case "assessment_complete": out = office(stageWording("piesa_complete").trade!, f.stageSince); break;
    case "rectification_required": case "awaiting_owner_rectification_approval": case "electrical_variation_pending": out = wait(stageWording("awaiting_owner_rectification_approval").trade!, "Owner", f.rectQuoteSentAt ?? f.stageSince); break;
    case "rectification_scheduling": out = wait(stageWording("rectification_scheduling").trade!, "Electrician", f.stageSince, "since"); break;
    case "rectification_booked": { const b = latest(f.bookings, "rectification", "confirmed"); out = b ? booked(stageWording("rectification_booked").trade!, b) : office(stageWording("rectification_scheduling").trade!, f.stageSince); break; }
    case "installation_scheduling": out = wait(stageWording("installation_scheduling").trade!, "Installer", f.stageSince, "since"); break;
    case "installation_booked": { const b = latest(f.bookings, "installation", "confirmed"); out = b ? booked(stageWording("installation_booked").trade!, b) : office(stageWording("installation_scheduling").trade!, f.stageSince); break; }
    case "evidence_outstanding": out = wait(stageWording("evidence_outstanding").trade!, "Installer", f.stageSince, "since"); break;
    case "ap_review": out = office("Being checked by Home Insulation Victoria", f.apApprovedAt ? null : f.stageSince); break;
    case "ready_for_veec": case "complete":
      out = f.payout?.kind === "paid" ? { text: `Paid to you ${fmtDay(f.payout.on)}`, who: null, since: null, waitingDays: null, tone: "ok", money: null }
        : f.payout?.kind === "coming" ? { text: `Payment coming ${fmtDay(f.payout.on)}`, who: null, since: null, waitingDays: null, tone: new Date(f.payout.on).getTime() < f.now.getTime() ? "rose" : "ok", money: null }
        : office("Being checked by Home Insulation Victoria", f.stageSince); break;
    case "on_hold": out = office("On hold", f.stageSince); break;
    default: out = office("Home Insulation Victoria is working on this", f.stageSince);
  }
  return { ...out, money: balance() };
}

/** The installer/electrician name "Installer"/"Electrician" turns into "You" when it's the viewer's move. */
export function forViewer(l: StatusLine, viewer: "installer" | "electrician"): StatusLine {
  const me = viewer === "installer" ? "Installer" : "Electrician";
  if (l.who !== me) return l;
  return { ...l, who: "You", text: l.text.replace(/ · Installer$| · Electrician$/, " · You") };
}

export type TimelineStep = { key: string; label: string; state: "done" | "next" | "later" | "skipped"; date: string | null; dateLabel: string | null };

export function jobTimeline(f: StatusFacts): TimelineStep[] {
  const done = (k: string) => latest(f.bookings, k, "completed");
  const conf = (k: string) => latest(f.bookings, k, "confirmed");
  const rc = done("ready_check"), piesa = done("assessment"), rect = done("rectification"), inst = done("installation");
  const instBooked = conf("installation");
  const fixesNeeded = !!rect || !!conf("rectification") || ["rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked", "electrical_variation_pending"].includes(f.stage);
  const p = f.payout;
  const raw: { key: string; label: string; done: string | null; expected: string | null; skip?: boolean }[] = [
    { key: "ready_check", label: "Ready Check", done: rc?.start ?? null, expected: conf("ready_check")?.start ?? null },
    { key: "quote", label: "Quote accepted", done: f.quoteAcceptedAt, expected: null },
    { key: "safety_paid", label: safetyCheckPayLabel(f.safetyPay, f.staff), done: f.safetyPay.kind === "paid" ? f.safetyPaidAt : null, expected: null },
    { key: "safety_check", label: "PIESA", done: piesa?.start ?? null, expected: conf("assessment")?.start ?? null },
    { key: "fixes", label: "Electrical fixes (if any)", done: rect?.start ?? null, expected: conf("rectification")?.start ?? null, skip: !!piesa && !fixesNeeded },
    { key: "fixes_paid", label: f.staff ? "Fixes paid" : "Fix costs paid", done: f.fixesPaidAt ?? null, expected: null, skip: !fixesNeeded && !f.fixesPaidAt },
    { key: "first_half", label: "Agreed owner payment", done: f.firstHalfPaidAt ?? null, expected: null },
    { key: "install", label: "Install", done: inst?.start ?? null, expected: instBooked?.start ?? null },
    { key: "final_half", label: "Paid in full", done: f.paidInFullAt, expected: null },
    { key: "checked", label: "Checked by Home Insulation Victoria", done: f.apApprovedAt, expected: null },
    { key: "paid", label: "Paid to you", done: p?.kind === "paid" ? p.on : null, expected: p?.kind === "coming" ? p.on : null },
  ];
  let nextGiven = false;
  return raw.map((r) => {
    if (r.skip) return { key: r.key, label: r.label, state: "skipped" as const, date: null, dateLabel: "Not needed" };
    if (r.done) return { key: r.key, label: r.label, state: "done" as const, date: r.done, dateLabel: fmtDay(r.done) };
    const state = nextGiven ? "later" as const : "next" as const; nextGiven = true;
    return { key: r.key, label: r.label, state, date: r.expected, dateLabel: r.expected ? `Expected ${fmtDay(r.expected)}` : null };
  });
}

/** Contact rules: installer's own customers show owner contacts; Home Insulation Victoria leads get a reminder request instead. */
export function chaseMode(j: { channel: string | null; originatingBusinessId: string | null }, viewerBusinessId: string): "own_customer" | "ask_office" {
  return j.channel === "installer_sourced" && j.originatingBusinessId === viewerBusinessId ? "own_customer" : "ask_office";
}

export function needsChasing(l: StatusLine) { return l.tone !== "ok"; }

export function reminderRequestMessage(x: { jobNumber: string; status: string; by: string | null }) {
  return `Reminder request for ${x.jobNumber}: please send the owner a reminder. Status: ${x.status}.${x.by ? ` Asked by ${x.by}.` : ""}`;
}

type PayInvoice = { kind?: string | null; status: string | null; deposit_paid_at: string | null; balance_paid_at: string | null; paid_at: string | null; created_at?: string | null };
const first = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
const last = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
/** Payment dates from the existing invoice (Xero-mirrored) and $349 payment records. First half = first instalment paid; final half = balance paid on a fully paid install invoice.
 *  Batch 3b: fixes paid = the job's NEWEST fixes invoice (a replaced fixes quote's old invoice never counts); the repeat
 *  safety check invoice never counts as install or fixes money. */
export function paymentDates(invoices: PayInvoice[], safetyPayments: { paid_at: string | null }[]) {
  const inst = invoices.filter((x) => (x.kind ?? "installation") === "installation");
  const rect = invoices.filter((x) => x.kind === "rectification").sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 1);
  const fullyPaid = inst.length > 0 && inst.every((x) => x.status === "fully_paid");
  return {
    safetyPaidAt: first(safetyPayments.map((p) => p.paid_at)),
    firstHalfPaidAt: first(inst.map((x) => x.deposit_paid_at ?? (x.status === "fully_paid" ? x.paid_at : null))),
    finalHalfPaidAt: fullyPaid ? last(inst.map((x) => x.balance_paid_at ?? x.paid_at)) : null,
    fixesPaidAt: rect.length && rect.every((x) => x.status === "fully_paid") ? last(rect.map((x) => x.paid_at ?? x.balance_paid_at)) : null,
  };
}
