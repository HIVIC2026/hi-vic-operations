// Installer screens M2 (Job page), M4 (Today's job), M5 (Job offer) and M6 (Money) — approved by Jo 24 Oct 2026
// (decisions 196–203). PURE presentation: turns facts the server already decided into the one "Next" panel, the row
// labels and the plain lines each screen shows. Never decides workflow, eligibility, pay, allocation or sending.

const TZ = "Australia/Melbourne";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).format(new Date(iso));
/** "22 Oct" */
export const shortDate = (iso: string) => fmt(iso, { day: "numeric", month: "short" });
/** "Fri 21 Nov" */
export const shortDay = (iso: string) => fmt(iso, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "7:30am" */
export const clock = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").replace(":00", "").toLowerCase();
/** "Mon 20 Oct at 7:30am" */
export const dayAndTime = (iso: string) => `${shortDay(iso)} at ${clock(iso)}`;
/** Date-only "YYYY-MM-DD" → "21 Nov" / "Fri 21 Nov" (no timezone shift). */
export const ymdShort = (ymd: string, withWeekday = false) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", ...(withWeekday ? { weekday: "short" } : {}) }).format(new Date(`${ymd}T12:00:00Z`)).replace(",", "");
export const firstName = (full: string | null | undefined): string | null => (full ?? "").trim().split(/\s+/)[0] || null;

/** Decision 48: the quiet source label. Never the installer's own business name repeated back. */
export function sourceLabel(channel: string | null | undefined): string | null {
  if (channel === "installer_sourced") return "Your customer";
  if (channel === "hivic_sourced") return "Home Insulation Victoria lead";
  return null;
}

// ---------- M2 · Job page: ONE "Next" panel ----------
export type InstallTurn = "not_ready" | "expired" | "booked" | "installer_to_offer" | "owner_to_answer" | "installer_to_answer";
export type ReadyCheckTurn = "no_installer" | "booked" | "installer_to_offer" | "owner_to_answer" | "installer_to_answer" | null;
export type JobNextFacts = {
  channel: string | null;
  stage: string | null;
  ownerFirstName: string | null;
  /** Mitti Ready Check form linked to the job. */
  formLinked: boolean;
  /** The installer pressed Complete on the Ready Check form (latest basics event). */
  formCompleted: boolean;
  /** The quote status line from installer-quote-status.core (null when no quote yet). */
  quoteLine: string | null;
  /** "Needs finishing: …" task from the job (null when nothing is missing). */
  needsFinishing: string | null;
  /** Our-lead Ready Check times (ready-check-times.core readyCheckTurn), null when it doesn't apply. */
  readyCheckTurn: ReadyCheckTurn;
  readyCheckBookedAt: string | null;
  /** Install days (install-days.core installDayTurn). */
  installTurn: InstallTurn | null;
  installBookedAt: string | null;
  installDeadline: string | null;
  installDaysLeft: number | null;
  clearedOn: string | null;
  /** The Mitti install form (PIISA) is Complete — decision 196. */
  installFormComplete: boolean;
  /** jobs.installation_completed_at is recorded. */
  installationRecorded: boolean;
  /** Lead installer already signed Section 3 Part B. */
  rebateSigned: boolean;
};
export type JobNextPanel =
  | "sign_rebate" | "install_done" | "offer_install_days" | "install_answer_owner" | "install_waiting_owner" | "install_booked" | "install_expired"
  | "ready_check_offer_times" | "ready_check_answer_owner" | "ready_check_waiting_owner" | "ready_check_set_time" | "form_coming" | "mitti_form" | "quote_status" | "waiting";
export type JobNext = { panel: JobNextPanel; title: string; sub: string | null; yours: boolean };

const READY_CHECK_STAGES = ["ready_check_ready_to_schedule", "ready_check_scheduled", "preliminary_estimate_ready", "new_enquiry", "eligibility_review"];

/** The one thing on the job page (decisions 36/41/196). Nothing about the install shows until the install is cleared;
 *  nothing about the rebate form until the Mitti install form is Complete. */
export function jobNext(f: JobNextFacts): JobNext {
  const owner = f.ownerFirstName ?? "the owner";
  const left = f.installDaysLeft != null ? ` · ${f.installDaysLeft} day${f.installDaysLeft === 1 ? "" : "s"} left` : "";
  const window = f.installDeadline ? `${f.clearedOn ? `Safety check cleared ${shortDate(f.clearedOn)} · ` : ""}Install by ${ymdShort(f.installDeadline, true)}${left}` : null;
  if (f.rebateSigned) return { panel: "install_done", title: "All done — your part of the rebate form is signed", sub: "We check the photos and sign it off. Your pay shows under Money.", yours: false };
  if (f.installFormComplete) return { panel: "sign_rebate", title: "Sign the rebate form", sub: f.installationRecorded ? "Your declaration as lead installer (Section 3 Part B)." : "First confirm the install is finished, then sign your declaration as lead installer (Section 3 Part B).", yours: true };
  if (f.installTurn === "booked" && f.installBookedAt) return { panel: "install_booked", title: `Install ${dayAndTime(f.installBookedAt)}`, sub: "The install form is in the 6:30am text that morning. Press Complete in Mitti when it's fully finished.", yours: false };
  if (f.installTurn === "expired") return { panel: "install_expired", title: "A new safety check is needed", sub: "The 30-day window after the safety check has passed. Home Insulation Victoria arranges the new check.", yours: false };
  if (f.installTurn === "installer_to_offer") return { panel: "offer_install_days", title: `Offer ${owner} 3 install days`, sub: window, yours: true };
  if (f.installTurn === "installer_to_answer") return { panel: "install_answer_owner", title: `${owner} suggested other days — pick one or offer 3 new days`, sub: window, yours: true };
  if (f.installTurn === "owner_to_answer") return { panel: "install_waiting_owner", title: `Waiting for ${owner} to pick an install day`, sub: window, yours: false };
  if (f.channel === "hivic_sourced") {
    if (f.readyCheckTurn === "installer_to_offer") return { panel: "ready_check_offer_times", title: `Offer ${owner} 3 Ready Check times`, sub: "Three different days in the next 3 weeks, 7am–5pm.", yours: true };
    if (f.readyCheckTurn === "installer_to_answer") return { panel: "ready_check_answer_owner", title: `${owner} suggested other days — pick one or offer 3 new times`, sub: null, yours: true };
    if (f.readyCheckTurn === "owner_to_answer") return { panel: "ready_check_waiting_owner", title: `Waiting for ${owner} to pick a Ready Check time`, sub: null, yours: false };
  }
  if (f.formLinked) {
    if (f.needsFinishing) return { panel: "mitti_form", title: f.needsFinishing, sub: "Add it on the Mitti form, then press Complete.", yours: true };
    if (f.quoteLine) {
      const yours = f.quoteLine.startsWith("You:");
      return { panel: "quote_status", title: f.quoteLine.replace(/^You:\s*/, "").replace(/^Waiting on (owner|office):\s*/i, (_, w) => `Waiting on ${w}: `), sub: null, yours };
    }
    if (!f.formCompleted && f.readyCheckTurn === "booked" && f.readyCheckBookedAt) return { panel: "mitti_form", title: `Ready Check ${dayAndTime(f.readyCheckBookedAt)}`, sub: "Fill in the Mitti form on site and press Complete when it's finished — we then send the owner their quote.", yours: true };
    if (!f.formCompleted) return { panel: "mitti_form", title: "Do the Ready Check in Mitti", sub: "Press Complete when it's fully finished — we then send the owner their quote.", yours: true };
    return { panel: "waiting", title: "Waiting on office: checking the quote", sub: null, yours: false };
  }
  if (f.channel === "installer_sourced" && READY_CHECK_STAGES.includes(f.stage ?? "")) {
    if (f.readyCheckBookedAt) return { panel: "form_coming", title: `Ready Check ${dayAndTime(f.readyCheckBookedAt)}`, sub: "Your Ready Check form is being set up in Mitti. It appears within about 15 minutes.", yours: false };
    return { panel: "ready_check_set_time", title: "Your Ready Check form is being set up in Mitti", sub: "It appears within about 15 minutes. Enter the visit day and time below if you've agreed one with the owner.", yours: false };
  }
  if (f.quoteLine) return { panel: "quote_status", title: f.quoteLine.replace(/^You:\s*/, ""), sub: null, yours: f.quoteLine.startsWith("You:") };
  return { panel: "waiting", title: "Nothing for you right now", sub: "We'll tell you when something needs you.", yours: false };
}

/** Decision 23/137, installer wording (never the owner's box). */
export function thirtyDayLine(deadline: string | null): string | null {
  return deadline ? `Install within 30 days of the safety check (by ${ymdShort(deadline)}) or a new check is needed, and whoever's move it was pays for it.` : null;
}

/** Quote group: read-only status (installer-quote-status is the rule; this only shortens it for the row). */
export function quoteStatusRow(q: { sent: boolean; accepted: boolean; declined: boolean; held: boolean; formCompleted: boolean; acceptedAt?: string | null; sentAt?: string | null } | null): { label: string; tone: "green" | "plain" | "sub" } {
  if (!q) return { label: "Not prepared yet", tone: "sub" };
  if (q.declined) return { label: "Declined by the owner", tone: "sub" };
  if (q.accepted) return { label: `Accepted${q.acceptedAt ? ` ${shortDate(q.acceptedAt)}` : ""}`, tone: "green" };
  if (q.sent) return { label: `Sent to the owner${q.sentAt ? ` ${shortDate(q.sentAt)}` : ""}`, tone: "plain" };
  if (q.held || q.formCompleted) return { label: "Office checking", tone: "plain" };
  return { label: "Prepared · press Complete in Mitti", tone: "plain" };
}

/** "Your agreed rates × 137.6 m² measured at the Ready Check, incl. 40 m² removal. Paid within 7 days of our approval after the install." */
export function payNote(f: { channel: string | null; areaM2: number | null; removalM2: number | null }): string {
  const area = f.areaM2 ? `${Number(f.areaM2)} m² measured at the Ready Check${f.removalM2 ? `, incl. ${Number(f.removalM2)} m² removal` : ""}` : "the area measured at the Ready Check";
  const when = f.channel === "installer_sourced" ? "Paid when the owner pays their balance." : "Paid within 7 days of our approval after the install.";
  return `Your agreed rates × ${area}. ${when}`;
}

/** Ready Check group rows. */
export function readyCheckRows(f: { bookedAt: string | null; done: boolean; formLinked: boolean; formCompleted: boolean; missing: number }): { visit: string; form: { label: string; tone: "green" | "plain" | "sub" } | null } {
  const visit = f.bookedAt ? `${f.done ? "Done" : "Booked"} ${dayAndTime(f.bookedAt)}` : f.done ? "Done" : "Not booked yet";
  const form = !f.formLinked ? null : f.formCompleted && f.missing === 0 ? { label: "Complete · nothing missing", tone: "green" as const } : f.formCompleted ? { label: `Complete · ${f.missing} thing${f.missing === 1 ? "" : "s"} missing`, tone: "plain" as const } : f.missing ? { label: `${f.missing} thing${f.missing === 1 ? "" : "s"} still missing`, tone: "plain" as const } : { label: "In progress", tone: "sub" as const };
  return { visit, form };
}

// ---------- M4 · Today's job ----------
export type DayKind = "safety_check" | "ready_check" | "install";
export const DAY_WHAT: Record<DayKind, string> = { safety_check: "Pre Insulation Electrical Safety Assessment (PIESA)", ready_check: "Ready Check", install: "Install" };

/** "Today · Tue 27 Oct · 8:00am" — exact arrival time, never a window (decision 43). */
export function arrivalPill(startIso: string | null, now: Date = new Date()): string | null {
  if (!startIso) return null;
  const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const today = ymd(new Date(startIso)) === ymd(now);
  return `${today ? "Today · " : ""}${shortDay(startIso)} · ${clock(startIso)}`;
}

/** The NEXT panel on the day page: Mitti form per visit kind; after the install form is Complete → sign the rebate form. */
export function dayNext(f: { kind: DayKind; channel: string | null; installFormComplete: boolean; rebateSigned: boolean }): { title: string; sub: string; button: string; signRebate: boolean } {
  if (f.kind === "install" && f.rebateSigned) return { title: "All done", sub: "Your part of the rebate form is signed. We check the photos and sign it off.", button: "Open install form", signRebate: false };
  if (f.kind === "install" && f.installFormComplete) return { title: "Sign the rebate form", sub: "The install form is Complete. Sign your declaration as lead installer (Section 3 Part B).", button: "Sign the rebate form", signRebate: true };
  if (f.kind === "install") return { title: "Start the install in Mitti", sub: "PIISA, before and after photos and bag labels all go in the install form. Press Complete when it's fully finished.", button: "Open install form", signRebate: false };
  if (f.kind === "ready_check") return { title: "Start the Ready Check in Mitti", sub: f.channel === "hivic_sourced" ? "Measure and photos go in the Ready Check form; we price the owner's quote from your agreed rates. Press Complete when it's fully finished." : "Measure, photos and your quote all go in the Ready Check form. Press Complete when it's fully finished.", button: "Open Ready Check form", signRebate: false };
  return { title: "Start the safety check in Mitti", sub: "Open the PIESA form. We pick it up from there.", button: "Open PIESA form", signRebate: false };
}

/** Decision 199: the three phone checks, short. */
export const DAY_CHECKS = ["Location on (photos are geotagged)", "Phone charged", "Power off before you go in the roof"] as const;

/** Electrician-on-site card, only when the signed PIESA requires one at the start (B1 "not possible"). */
export function electricianOnSite(f: { required: boolean; name: string | null; arrival: string | null; reason: string | null }): { title: string; body: string; call: string | null } | null {
  if (!f.required) return null;
  const who = f.name ? `${f.name} (Home Insulation Victoria electrician)` : "The Home Insulation Victoria electrician";
  const first = f.name ? firstName(f.name) ?? f.name : "the electrician";
  return {
    title: "An electrician must be on site",
    body: `${f.reason ? `The safety check found ${f.reason}. ` : "The safety check requires an electrician at the start. "}${who}${f.arrival ? ` arrives ${f.arrival}` : " will be there at the start"}. Don't start in the roof until ${first} says the power is off.`,
    call: f.name ? `Call ${first}` : null,
  };
}

export const ACCESS_LABEL: Record<string, string> = { easy: "Easy", standard: "Standard", moderate: "Moderate", hard: "Difficult", difficult: "Difficult" };
export function areaLine(f: { areaM2: number | null; removalM2: number | null }): string | null {
  if (!f.areaM2) return null;
  return `${Number(f.areaM2)} m²${f.removalM2 ? ` · removal ${Number(f.removalM2)} m²` : ""}`;
}

// ---------- M5 · Job offer (decision 201) ----------
export type InsulationNow = "none" | "some" | "unknown";
/** Two plain lines: size omitted when the enquiry has none; insulation always. Nothing about aerial or job type. */
export function offerTopLines(f: { areaM2: number | null; insulation: InsulationNow }): string[] {
  const lines: string[] = [];
  if (f.areaM2 && f.areaM2 > 0) lines.push(`Owner says ~${Math.round(f.areaM2)} m²`);
  lines.push(f.insulation === "none" ? "Owner says no insulation" : f.insulation === "some" ? "Owner says some insulation" : "Owner isn't sure about existing insulation");
  return lines;
}
export const OFFER_PAY_LINE = "The Ready Check visit is free, as in your agreement. You're paid for the install at your agreed rates × the measured area, within 7 days of our approval. The owner's price is set by Home Insulation Victoria.";
export const OFFER_STEPS = [
  "The owner picks one of your times. You get a text with the day, time and address.",
  "Do the Ready Check and fill in the Mitti form. Don't discuss pricing with the owner.",
  "Press Complete — we send the owner their quote. Once the safety check is cleared, you offer 3 install days.",
] as const;
export const OFFER_ONLY_YOU = "This offer is only for you and stays open 24 hours. If it's not for you, it goes back to the office.";
/** Decision 49: the office picks one installer — there is no race, so a closed offer never says "another trade got it". */
export function offerClosed(status: string, declinedHere = false): { title: string; body: string } {
  if (declinedHere || status === "declined") return { title: "Offer declined", body: "It goes back to the office." };
  return { title: "This offer has closed", body: "It timed out or the office took it back. Nothing more to do here." };
}

// ---------- M6 · Money (decision 203) ----------
export type PayKind = "coming" | "checking" | "paid";
export type MoneyRowFacts = { amount: number | null; state: { kind: PayKind; on?: string }; doneAt: string | null; channel: string | null };
const monthKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date(iso));
export function moneyTotals(rows: MoneyRowFacts[], now: Date = new Date()): { coming: { total: number; next: string | null }; checking: { total: number; jobs: number }; thisMonth: { total: number; installs: number }; lastMonth: { total: number; installs: number } } {
  const sum = (xs: MoneyRowFacts[]) => xs.reduce((t, r) => t + (r.amount ?? 0), 0);
  const coming = rows.filter((r) => r.state.kind === "coming");
  const checking = rows.filter((r) => r.state.kind === "checking");
  const paid = rows.filter((r) => r.state.kind === "paid");
  const thisKey = monthKey(now.toISOString());
  const lm = new Date(now); lm.setUTCDate(1); lm.setUTCMonth(lm.getUTCMonth() - 1);
  const lastKey = monthKey(lm.toISOString());
  const paidIn = (k: string) => paid.filter((r) => r.state.on && monthKey(r.state.on) === k);
  return {
    coming: { total: sum(coming), next: coming.map((r) => r.state.on!).filter(Boolean).sort()[0] ?? null },
    checking: { total: sum(checking), jobs: checking.length },
    thisMonth: { total: sum(paidIn(thisKey)), installs: paidIn(thisKey).length },
    lastMonth: { total: sum(paidIn(lastKey)), installs: paidIn(lastKey).length },
  };
}
/** "Home Insulation Victoria lead · Install 27 Oct" */
export function moneyRowSub(f: { channel: string | null; doneAt: string | null }): string {
  return [sourceLabel(f.channel), f.doneAt ? `Install ${shortDate(f.doneAt)}` : null].filter(Boolean).join(" · ");
}
export const HOW_PAY_WORKS = [
  { who: "Your customers", how: "Paid when the owner pays their balance" },
  { who: "Our leads", how: "Paid within 7 days of our approval" },
] as const;
export const READY_CHECKS_FREE = "Ready Check visits are free, so they never appear here. Nothing to invoice us.";
/** "BSB 063-xxx · account ending 471" — never the full numbers. */
export function bankLine(f: { bsbStart: string | null; accountEnding: string | null }): string {
  if (!f.bsbStart && !f.accountEnding) return "No bank account saved yet";
  return [f.bsbStart ? `BSB ${f.bsbStart}-xxx` : null, f.accountEnding ? `account ending ${f.accountEnding}` : null].filter(Boolean).join(" · ");
}
