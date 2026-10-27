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
  // ---- Approved states (decision 234), all optional so older callers keep working. ----
  /** quotes.sent_at (M2 quote sent). */
  quoteSentAt?: string | null;
  /** When the owner declined (quote_declined event). */
  quoteDeclinedAt?: string | null;
  /** When the installer pressed Complete on the Ready Check form (latest ready_check_basics event with completed=true). */
  formCompletedAt?: string | null;
  /** Booked PIESA (assessment booking) with the electrician's name when known. */
  piesaBooking?: { electrician: string | null; start: string } | null;
  /** Ready Check basics still missing (approved words from needsFinishingList). Used for "Add N things in Mitti". */
  needsFinishingItems?: string[];
  /** Sign-rebate ticks: when the install form was completed, whether the portal has checked photos/videos, crew names. */
  installFormCompletedAt?: string | null;
  evidenceChecked?: boolean;
  crew?: string[];
  /** Decision 251: the owner's side of an install booking (consent + 10% deposit), read-only facts; null = not read. */
  ownerReady?: OwnerReadyFacts | null;
  /** Decision 279: the installer has answered something on the Mitti form beyond the pre-fill (null = not known yet). */
  formHasAnswers?: boolean | null;
  /** Decision 278 (A1): the business owner has entered the price in the portal (null = not an A1 job / not read). */
  priceEntered?: boolean | null;
  /** The viewer is the business owner (business_admin). Staff never see or set the price. */
  boss?: boolean;
  /** Decision 296: the owner has confirmed the current PIESA on their secure link (false = waiting; null/undefined = no PIESA yet or not read). */
  ownerPiesaConfirmed?: boolean | null;
};
export type JobNextPanel =
  | "sign_rebate" | "install_done" | "offer_install_days" | "install_answer_owner" | "install_waiting_owner" | "install_booked" | "install_expired"
  | "ready_check_offer_times" | "ready_check_answer_owner" | "ready_check_waiting_owner" | "ready_check_set_time" | "form_coming" | "mitti_form" | "enter_price" | "quote_status" | "waiting";
export type JobNext = { panel: JobNextPanel; title: string; sub: string | null; yours: boolean; /** Bulleted lines under the sub (needs-finishing items). */ items?: string[]; /** Green ticks (sign the rebate form). */ checks?: string[]; /** Quiet line under the button. */ note?: string | null; /** Install booked: the owner's consent + deposit line (decision 251). */ ownerReady?: OwnerReadyLine | null };

/** Decision 251 (Jo 24 Oct 2026): the owner's side of an install booking, as recorded facts only — never amounts or prices.
 *  consent: the current owner ESC consent (`owner_esc_consents`, not stale/cancelled) — "signed" once the owner has signed,
 *  "waiting" while a consent exists unsigned, null when none is recorded yet (nothing shown rather than a guess).
 *  deposit: the `install_deposit` step from the payment ledger (`owner_payment_recorded` → payments.core step state) —
 *  "paid" when the step is paid, "waiting" when requested/overdue/not yet, null when there is no invoice to read. */
export type OwnerReadyFacts = { consent: "signed" | "waiting" | null; deposit: "paid" | "waiting" | null };
export type OwnerReadyLine = { text: string; done: boolean };
export const OWNER_READY_CONSENT_DONE = "Consent signed ✓";
export const OWNER_READY_CONSENT_WAITING = "Consent not signed yet";
export const OWNER_READY_DEPOSIT_DONE = "10% deposit paid ✓";
export const OWNER_READY_DEPOSIT_WAITING = "10% deposit not paid yet";
/** "Consent signed ✓ · 10% deposit paid ✓", or which part is still outstanding. Null when neither fact is known. */
export function ownerReadyLine(f: OwnerReadyFacts | null | undefined): OwnerReadyLine | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.consent) parts.push(f.consent === "signed" ? OWNER_READY_CONSENT_DONE : OWNER_READY_CONSENT_WAITING);
  if (f.deposit) parts.push(f.deposit === "paid" ? OWNER_READY_DEPOSIT_DONE : OWNER_READY_DEPOSIT_WAITING);
  if (!parts.length) return null;
  return { text: parts.join(" · "), done: f.consent === "signed" && f.deposit === "paid" };
}

const READY_CHECK_STAGES = ["ready_check_ready_to_schedule", "ready_check_scheduled", "preliminary_estimate_ready", "new_enquiry", "eligibility_review"];
import { PRESS_COMPLETE_LINE, QUOTE_DECLINED_LINE, QUOTE_HELD_LINE, QUOTE_SENT_LINE, quoteLineYours } from "./installer-quote-status.core";
import { isPriceNextAction } from "./ready-check-basics.core";
import { OWNER_PIESA_CONFIRM_WAITING } from "./piesa-owner-confirm.core";
import { isInstallerNotOnboardedNote } from "./rec-onboarded.core";

/** "Needs finishing: price, owner mobile/email/permission on the Mitti form" → the approved M2 list ("Your price", "The owner's email", …). */
export function needsFinishingList(nextAction: string | null | undefined): string[] {
  if (isPriceNextAction(nextAction)) return []; // decision 278: the price is entered on the job page, never in Mitti
  const m = /^Needs finishing:\s*(.+?)\s*(on the Mitti form)?\.?$/i.exec(nextAction ?? "");
  if (!m?.[1]) return [];
  const out: string[] = [];
  for (const raw of m[1].replace(/^add\s+/i, "").split(/,\s*/).map((p) => p.trim()).filter(Boolean)) {
    if (/^price$/i.test(raw)) out.push("Your price");
    else if (/^owner\s+/i.test(raw)) for (const part of raw.replace(/^owner\s+/i, "").split("/")) out.push(`The owner's ${part.trim().replace(/^mobile$/i, "mobile").replace(/^permission$/i, "permission to contact")}`);
    else if (/^ceiling area$/i.test(raw)) out.push("The ceiling area");
    else if (/^insulation product$/i.test(raw)) out.push("The insulation product");
    else out.push(raw.charAt(0).toUpperCase() + raw.slice(1));
  }
  return [...new Set(out)];
}

/** Sign-the-rebate-form ticks (M2/M4 sign-rebate states): only facts that are recorded, never assumed. */
export function signRebateChecks(f: { installFormCompletedAt: string | null; evidenceChecked: boolean; crew: string[]; piisaSigned?: boolean; swmsComplete?: boolean }): string[] {
  const out: string[] = [];
  if (f.installFormCompletedAt) out.push(`Install form Complete · ${dayAndTime(f.installFormCompletedAt)}`);
  if (f.piisaSigned) out.push(f.swmsComplete ? "SWMS and PIISA signed" : "PIISA signed");
  if (f.evidenceChecked) out.push("Photos and videos checked by the portal");
  if (f.crew.length) out.push(`Crew on the PIISA: ${f.crew.join(", ")}`);
  return out;
}
export const SIGN_REBATE_SUB = "Your part of the VEEC assignment form (Part B): you declare the install facts as the lead installer. Type your name and tap Sign.";
export const SIGN_REBATE_FIRST_CONFIRM = "First confirm the install is finished, then sign your declaration as lead installer (Section 3 Part B).";

/** Approved M2 quote states (decision 234). Null when the quote line isn't one of sent / held / declined. */
export function quoteNextWords(f: Pick<JobNextFacts, "quoteLine" | "quoteSentAt" | "quoteDeclinedAt" | "formCompletedAt">, owner: string): JobNext | null {
  if (f.quoteLine === QUOTE_SENT_LINE) {
    const named = owner !== "the owner";
    return { panel: "quote_status", title: `Nothing for you — ${owner} has the quote`, sub: `We sent ${owner} ${named ? "the" : "their"} quote${f.quoteSentAt ? ` on ${shortDay(f.quoteSentAt)}` : ""}. We'll tell you when ${named ? `${owner} accepts` : "they accept"}. Then we arrange the electrical safety check.`, yours: false };
  }
  if (f.quoteLine === QUOTE_HELD_LINE) return { panel: "quote_status", title: "Nothing for you — the office is checking the quote", sub: `${f.formCompletedAt ? `You pressed Complete in Mitti on ${shortDay(f.formCompletedAt)}. ` : ""}We check every quote before it goes to the owner. If we need anything we'll text you.`, yours: false };
  if (f.quoteLine === QUOTE_DECLINED_LINE) return { panel: "quote_status", title: `Nothing for you — ${owner} declined the quote`, sub: `${f.quoteDeclinedAt ? `Declined ${shortDay(f.quoteDeclinedAt)}. ` : ""}The office may follow up with ${owner}. If the job comes back, it shows in Action needed.`, yours: false };
  return null;
}

// ---------- Decision 279 (Jo 25 Oct 2026): ONE status line per job, on the job page and My work ----------
/** The order Jo fixed: no answers on the Mitti form → only "do the Ready Check" (no quote wording at all); answers but no
 *  boss price (A1) → "enter your price" (staff: waiting on the business owner, nothing about price); both in → the quote
 *  status. `formHasAnswers`/`priceEntered` null = not known, so older callers fall through to the quote line as before. */
export type StatusLineFacts = { channel: string | null; formLinked: boolean; formCompleted: boolean; formHasAnswers: boolean | null | undefined; priceEntered: boolean | null | undefined; boss: boolean; quoteLine: string | null };
export type StatusLine = { kind: "ready_check" | "price" | "waiting_boss" | "quote" | "none"; title: string; home: string; yours: boolean };
export const DO_READY_CHECK_TITLE = "Do the Ready Check";
export const ENTER_PRICE_TITLE = "Enter your price";
export const WAITING_BOSS_TITLE = "Nothing for you — waiting on your business owner";
export function installerStatusLine(f: StatusLineFacts): StatusLine {
  if (f.formLinked && !f.formCompleted && f.formHasAnswers === false) return { kind: "ready_check", title: DO_READY_CHECK_TITLE, home: "Next: do the Ready Check", yours: true };
  if (f.channel === "installer_sourced" && f.priceEntered === false && (f.formHasAnswers === true || f.formCompleted)) {
    if (f.boss) return { kind: "price", title: ENTER_PRICE_TITLE, home: "Next: enter your price", yours: true };
    return { kind: "waiting_boss", title: WAITING_BOSS_TITLE, home: "Next: nothing yet — waiting on your business owner", yours: false };
  }
  if (f.quoteLine) return { kind: "quote", title: f.quoteLine.replace(/^You:\s*/, ""), home: f.quoteLine, yours: quoteLineYours(f.quoteLine) };
  return { kind: "none", title: "", home: "", yours: false };
}

/** Fix round 1 (Jo 28 Oct 2026, spec rule 3): the business owner's price card on an installer job shows the
 *  not-signed-up note with the switch button, so the job page's Next panel says this short line instead (note once). */
export const NOT_ONBOARDED_NEXT_TITLE = "Waiting on your electrician to sign up";
const noteOnPriceCard = (f: Pick<JobNextFacts, "quoteLine" | "boss" | "channel">) => f.boss === true && f.channel === "installer_sourced" && isInstallerNotOnboardedNote(f.quoteLine);

/** The one thing on the job page (decisions 36/41/196). Nothing about the install shows until the install is cleared;
 *  nothing about the rebate form until the Mitti install form is Complete. */
export function jobNext(f: JobNextFacts): JobNext {
  const owner = f.ownerFirstName ?? "the owner";
  const left = f.installDaysLeft != null ? ` · ${f.installDaysLeft} day${f.installDaysLeft === 1 ? "" : "s"} left` : "";
  const window = f.installDeadline ? `${f.clearedOn ? `Safety check cleared ${shortDate(f.clearedOn)} · ` : ""}Install by ${ymdShort(f.installDeadline, true)}${left}` : null;
  if (f.rebateSigned) return { panel: "install_done", title: "All done — your part of the rebate form is signed", sub: "We check the photos and sign it off. Your pay shows under Money.", yours: false };
  if (f.installFormComplete) return { panel: "sign_rebate", title: "Sign the rebate form", sub: f.installationRecorded ? SIGN_REBATE_SUB : SIGN_REBATE_FIRST_CONFIRM, yours: true, checks: signRebateChecks({ installFormCompletedAt: f.installFormCompletedAt ?? null, evidenceChecked: f.evidenceChecked === true, crew: f.crew ?? [] }) };
  // Approved state M2-install-booked: "Install booked · Tue 27 Oct at 7:30am" / "Install by Fri 21 Nov · 25 days left."
  if (f.installTurn === "booked" && f.installBookedAt) return { panel: "install_booked", title: `Install booked · ${dayAndTime(f.installBookedAt)}`, sub: f.installDeadline ? `Install by ${ymdShort(f.installDeadline, true)}${left}.` : "The install form is in the 6:30am text that morning. Press Complete in Mitti when it's fully finished.", yours: false, note: "The install form is in the 6:30am text that morning. Press Complete in Mitti when it's fully finished.", ownerReady: ownerReadyLine(f.ownerReady) };
  if (f.installTurn === "expired") return { panel: "install_expired", title: "A new safety check is needed", sub: "The 30-day window after the safety check has passed. Home Insulation Victoria arranges the new check.", yours: false };
  // Decision 296: the install day can't be booked until the owner confirms the safety check on their secure link — nothing for the installer until then.
  if (f.ownerPiesaConfirmed === false && ["installer_to_offer", "installer_to_answer", "owner_to_answer"].includes(f.installTurn ?? "")) return { panel: "waiting", title: OWNER_PIESA_CONFIRM_WAITING, sub: `${window ? `${window} · ` : ""}We've asked ${owner} by email and text. Once they confirm, you offer 3 install days.`, yours: false };
  if (f.installTurn === "installer_to_offer") return { panel: "offer_install_days", title: `Offer ${owner} 3 install days`, sub: window, yours: true };
  if (f.installTurn === "installer_to_answer") return { panel: "install_answer_owner", title: `${owner} suggested other days — pick one or offer 3 new days`, sub: window, yours: true };
  if (f.installTurn === "owner_to_answer") return { panel: "install_waiting_owner", title: `Waiting for ${owner} to pick an install day`, sub: window, yours: false };
  if (f.channel === "hivic_sourced") {
    if (f.readyCheckTurn === "installer_to_offer") return { panel: "ready_check_offer_times", title: `Offer ${owner} 3 Ready Check times`, sub: "Three different days in the next 3 weeks, 7am–5pm.", yours: true };
    if (f.readyCheckTurn === "installer_to_answer") return { panel: "ready_check_answer_owner", title: `${owner} suggested other days — pick one or offer 3 new times`, sub: null, yours: true };
    if (f.readyCheckTurn === "owner_to_answer") return { panel: "ready_check_waiting_owner", title: `Waiting for ${owner} to pick a Ready Check time`, sub: null, yours: false };
  }
  // Approved state M2-piesa-booked (decisions 27/157/186): nothing for the installer until clearance.
  if (f.piesaBooking && !f.clearedOn) {
    const who = f.piesaBooking.electrician ? `${f.piesaBooking.electrician} (Home Insulation Victoria electrician)` : "The Home Insulation Victoria electrician";
    return { panel: "waiting", title: "Nothing for you — safety check booked", sub: `${who} does the PIESA on ${dayAndTime(f.piesaBooking.start)}. Once it's cleared, you offer ${owner} 3 install days within 30 days.`, yours: false };
  }
  // Approved states M2-quote-sent / -held / -declined: the plain "Nothing for you" wording, dates only when recorded.
  const quoteState = quoteNextWords(f, owner);
  if (quoteState) return quoteState;
  if (f.formLinked) {
    const status = installerStatusLine({ channel: f.channel, formLinked: f.formLinked, formCompleted: f.formCompleted, formHasAnswers: f.formHasAnswers, priceEntered: f.priceEntered, boss: f.boss === true, quoteLine: f.quoteLine });
    // Decision 279: an empty form says only "do the Ready Check" — never a quote line and never a list of missing things.
    if (status.kind === "ready_check") return { panel: "mitti_form", title: status.title, sub: f.readyCheckBookedAt ? `Ready Check ${dayAndTime(f.readyCheckBookedAt)}. Fill in the Mitti form on site and press Complete when it's finished.` : "Fill in the Mitti form on site and press Complete when it's finished.", yours: true };
    const items = f.needsFinishingItems ?? [];
    if (items.length) {
      // Approved state M2-needs-finishing: "Add 4 things in Mitti" + the list from ready-check-basics, one button Open Mitti form.
      const visit = f.readyCheckBookedAt ? `Ready Check done ${dayAndTime(f.readyCheckBookedAt)}. ` : "";
      return { panel: "mitti_form", title: `Add ${items.length} thing${items.length === 1 ? "" : "s"} in Mitti`, sub: `${visit}The form is still missing:`, yours: true, items, note: `Press Complete only when it's fully finished — that sends ${owner} their quote.` };
    }
    if (f.needsFinishing) return { panel: "mitti_form", title: f.needsFinishing, sub: "Add it on the Mitti form, then press Complete.", yours: true };
    // Decision 278: the boss enters the price in the portal once the form has answers; staff see nothing about price.
    // Decision 289: price + what it includes only — the electrician was chosen at Add a job.
    if (status.kind === "price") return { panel: "enter_price", title: status.title, sub: "Your price and what it includes. We add the $349 fee and the electrical safety check, take off the rebate and prepare the owner's quote.", yours: true };
    if (status.kind === "waiting_boss") return { panel: "waiting", title: status.title, sub: "Nothing else is needed from you on this job right now.", yours: false };
    if (f.quoteLine) {
      const yours = quoteLineYours(f.quoteLine);
      if (noteOnPriceCard(f)) return { panel: "quote_status", title: NOT_ONBOARDED_NEXT_TITLE, sub: null, yours };
      return { panel: "quote_status", title: f.quoteLine.replace(/^You:\s*/, "").replace(/^Waiting on (owner|office):\s*/i, (_, w) => `Waiting on ${w}: `), sub: null, yours };
    }
    if (!f.formCompleted && f.readyCheckTurn === "booked" && f.readyCheckBookedAt) return { panel: "mitti_form", title: `Ready Check ${dayAndTime(f.readyCheckBookedAt)}`, sub: "Fill in the Mitti form on site and press Complete when it's finished — we then send the owner their quote.", yours: true };
    // Approved state M2-own-before-ready-check: the installer arranges the visit with the owner directly (decisions 110/116).
    if (!f.formCompleted && f.channel === "installer_sourced") return { panel: "ready_check_set_time", title: "Do the Ready Check and fill in the Mitti form", sub: `You arrange the visit with ${owner} directly. Measurements, photos and product all go in the form.`, yours: true };
    if (!f.formCompleted) return { panel: "mitti_form", title: "Do the Ready Check in Mitti", sub: "Press Complete when it's fully finished — we then send the owner their quote.", yours: true };
    return { panel: "waiting", title: "Waiting on office: checking the quote", sub: null, yours: false };
  }
  if (f.channel === "installer_sourced" && READY_CHECK_STAGES.includes(f.stage ?? "")) {
    if (f.readyCheckBookedAt) return { panel: "form_coming", title: `Ready Check ${dayAndTime(f.readyCheckBookedAt)}`, sub: "Your Ready Check form is being set up in Mitti. It appears within about 15 minutes.", yours: false };
    return { panel: "ready_check_set_time", title: "Your Ready Check form is being set up in Mitti", sub: "It appears within about 15 minutes. Enter the visit day and time below if you've agreed one with the owner.", yours: false };
  }
  if (f.quoteLine) return { panel: "quote_status", title: noteOnPriceCard(f) ? NOT_ONBOARDED_NEXT_TITLE : f.quoteLine.replace(/^You:\s*/, ""), sub: null, yours: quoteLineYours(f.quoteLine) };
  return { panel: "waiting", title: "Nothing for you right now", sub: "We'll tell you when something needs you.", yours: false };
}

/** Decision 23/137, installer wording (never the owner's box). */
export function thirtyDayLine(deadline: string | null): string | null {
  return deadline ? `Install within 30 days of the safety check (by ${ymdShort(deadline)}) or a new check is needed, and whoever's move it was pays for it.` : null;
}

/** Quote group: read-only status (installer-quote-status is the rule; this only shortens it for the row). */
export function quoteStatusRow(q: { sent: boolean; accepted: boolean; declined: boolean; held: boolean; formCompleted: boolean; acceptedAt?: string | null; sentAt?: string | null; declinedAt?: string | null } | null, ctx: { needsFinishing?: boolean; formLinked?: boolean } = {}): { label: string; tone: "green" | "plain" | "sub" } {
  // Approved M2 states: "Not drafted yet · waiting on the form" / "Prepared once you press Complete in Mitti" before a quote exists.
  if (!q) return ctx.needsFinishing ? { label: "Not drafted yet · waiting on the form", tone: "sub" } : ctx.formLinked ? { label: "Prepared once you press Complete in Mitti", tone: "sub" } : { label: "Not prepared yet", tone: "sub" };
  if (q.declined) return { label: `Declined${q.declinedAt ? ` ${shortDay(q.declinedAt)}` : " by the owner"}`, tone: "sub" };
  if (q.accepted) return { label: `Accepted${q.acceptedAt ? ` ${shortDate(q.acceptedAt)}` : ""}`, tone: "green" };
  if (q.sent) return { label: `Sent${q.sentAt ? ` ${shortDay(q.sentAt)}` : " to the owner"} · waiting on the owner`, tone: "plain" };
  if (q.held || q.formCompleted) return { label: "Being checked by the office", tone: "plain" };
  return { label: "Prepared · press Complete in Mitti", tone: "plain" };
}

/** M2 Quote group "Electrician" row: booked PIESA → "Sam Lee · PIESA Thu 29 Oct at 9:00am"; passed → "PIESA passed Thu 29 Oct[ · fixes note]". */
export function electricianRow(f: { name: string | null; piesaBookedAt: string | null; piesaPassedOn: string | null; fixesNote: string | null }): { label: string; value: string } | null {
  if (f.piesaPassedOn) return { label: "Electrician", value: [`${f.name ? `${f.name} · ` : ""}PIESA passed ${shortDay(f.piesaPassedOn)}`, f.fixesNote].filter(Boolean).join(" · ") };
  if (f.piesaBookedAt) return { label: "Electrician", value: `${f.name ?? "Home Insulation Victoria electrician"} · PIESA ${dayAndTime(f.piesaBookedAt)}` };
  if (f.name) return { label: "Electrician", value: f.name };
  return null;
}

/** M2 sign-rebate state "Install" row: "Done Tue 27 Oct · 137.6 m² · 40 m² removed". */
export function installRow(f: { doneAt: string | null; areaM2: number | null; removalM2: number | null }): string | null {
  if (!f.doneAt) return null;
  return [`Done ${shortDay(f.doneAt)}`, f.areaM2 ? `${Number(f.areaM2)} m²` : null, f.removalM2 ? `${Number(f.removalM2)} m² removed` : null].filter(Boolean).join(" · ");
}

// ---------- M2 · complete (read-only summary; owner contact hidden by contactVisible) ----------
export type CompleteFacts = {
  jobNumber: string | number | null; suburb: string | null; channel: string | null; completedAt: string | null;
  product: string | null; areaM2: number | null; removalM2: number | null; crew: string[];
  pay: { amount: number | null; state: { kind: PayKind; on?: string } } | null;
  piisaSignedAt: string | null; installerSignedAt: string | null; ownerSignedAt: string | null; apSignedAt: string | null;
};
export type CompleteView = { heading: string; sub: string; done: { title: string; body: string }; summary: [string, string][]; paperwork: [string, string][] };
export function completeView(f: CompleteFacts): CompleteView {
  const payWords = (p: CompleteFacts["pay"]) => {
    if (!p || p.amount == null) return "Shown under Money once recorded";
    const amt = `$${Math.round(p.amount).toLocaleString("en-AU")}`;
    return p.state.kind === "paid" && p.state.on ? `${amt} · Paid ${shortDay(p.state.on)}` : p.state.kind === "coming" && p.state.on ? `${amt} · Coming ${shortDay(p.state.on)}` : `${amt} · Being checked`;
  };
  const signed = (iso: string | null) => (iso ? `Signed ${shortDay(iso)}` : "Not signed yet");
  const bothSigned = !!f.installerSignedAt && !!f.ownerSignedAt;
  return {
    heading: [f.jobNumber, f.suburb].filter(Boolean).join(" · "),
    sub: [sourceLabel(f.channel), f.completedAt ? `Job complete ${shortDay(f.completedAt)}` : "Job complete"].filter(Boolean).join(" · "),
    done: { title: "Nothing more to do", body: `${bothSigned ? "Rebate form signed by you and the owner." : f.installerSignedAt ? "Your part of the rebate form is signed." : "The job is closed."} ${f.apSignedAt ? "Part A of the rebate form is signed." : "Part A of the rebate form signs itself once every check is recorded; the office does the final check."} Owner contact details are no longer shown.` },
    summary: [
      ["Installed", [f.product, f.areaM2 ? `${Number(f.areaM2)} m²` : null].filter(Boolean).join(" · ") || "To be confirmed"],
      ["Removed", f.removalM2 ? `${Number(f.removalM2)} m²` : "None"],
      ["Crew", f.crew.length ? f.crew.join(", ") : "Not recorded"],
      ["Your pay", payWords(f.pay)],
    ],
    paperwork: [["PIISA", signed(f.piisaSignedAt)], ["Rebate form Part B", signed(f.installerSignedAt)], ["Owner's part", signed(f.ownerSignedAt)]],
  };
}

// ---------- M2 · change allocation sheet (decision 161) ----------
export type AllocationSheetOption = { workerId: string; name: string; role?: string | null; mobile: string | null; mittiLinked?: boolean | null; allowed: boolean; reason: string | null; picked: boolean };
export function allocationSheet(f: { kind: "ready_check" | "install"; visitAt: string | null; suburb: string | null; options: AllocationSheetOption[]; chosen: string | null }): { title: string; sub: string; rows: { workerId: string; name: string; line: string; status: string; tone: "green" | "rose" | "sub"; allowed: boolean; picked: boolean }[]; button: string | null } {
  const where = [f.visitAt ? dayAndTime(f.visitAt) : null, f.suburb].filter(Boolean).join(" · ");
  const what = f.kind === "install" ? "install day" : "Ready Check";
  const chosen = f.options.find((o) => o.workerId === f.chosen) ?? null;
  return {
    title: `Who does the ${what}?`,
    sub: `${where ? `${where}. ` : ""}The Mitti ${f.kind === "install" ? "install form" : "Ready Check form"} and the 6:30am text go to this person.`,
    rows: f.options.map((o) => ({
      workerId: o.workerId, name: o.name, allowed: o.allowed, picked: o.picked,
      line: [o.role ?? null, o.mobile ?? "no mobile", o.mittiLinked == null ? null : o.mittiLinked ? "Mitti ✓" : "Mitti not set"].filter(Boolean).join(" · "),
      status: f.kind === "install" ? (o.allowed ? "CII cleared" : `${o.reason?.replace(/\.$/, "") ?? "Not cleared"} · can't do installs`) : o.allowed ? "Can take Ready Checks" : (o.reason?.replace(/\.$/, "") ?? "Not available"),
      tone: o.allowed ? "green" : "rose",
    })),
    button: chosen && chosen.allowed && !chosen.picked ? `Allocate to ${firstName(chosen.name) ?? chosen.name}` : null,
  };
}

// ---------- M4 · the three checks per visit, "What we know", couldn't-get-in sheet, the declaration ----------
/** Install: power off; our-lead Ready Check: the pricing rule (decision 28). The first two never change. */
export function dayChecks(f: { kind: DayKind; channel: string | null }): readonly string[] {
  if (f.kind === "ready_check" && f.channel === "hivic_sourced") return [DAY_CHECKS[0], DAY_CHECKS[1], "I will not discuss pricing with the owner"] as const;
  if (f.kind === "ready_check") return [DAY_CHECKS[0], DAY_CHECKS[1], "Power off before you go in the roof"] as const;
  return DAY_CHECKS;
}
/** M4 Ready Check day "What we know": owner's own words only, free visit, pay after the install. No prices. */
export function whatWeKnow(f: { areaM2: number | null; insulation: InsulationNow | null }): [string, string][] {
  const says = [f.areaM2 && f.areaM2 > 0 ? `~${Math.round(f.areaM2)} m²` : null, f.insulation === "none" ? "no insulation" : f.insulation === "some" ? "some insulation" : f.insulation === "unknown" ? "not sure about insulation" : null].filter(Boolean).join(" · ");
  return [["Owner says", says || "No details yet"], ["Ready Check", "Free visit, as in your agreement"], ["Your pay", "Agreed rates × measured area, after the install"]];
}
/** M4 "Couldn't get in?" sheet (decisions 214/215): install days name the owner, the no-charge rule and the 30-day end date. */
export function couldntGetInSheet(f: { kind: DayKind; ownerFirstName: string | null; installDeadline: string | null }): { title: string; sub: string; cancel: string } {
  if (f.kind === "install") {
    const owner = f.ownerFirstName ?? "The owner";
    return { title: "Couldn't get in?", sub: `Pick what happened. ${owner} is texted and emailed straight away, nobody is charged for the trip, and you'll be asked to offer 3 new install days. The 30-day clock keeps running${f.installDeadline ? ` (ends ${ymdShort(f.installDeadline, true)})` : ""}.`, cancel: "Cancel" };
  }
  return { title: "Couldn't get in?", sub: "Pick what happened. We'll take it from here.", cancel: "Cancel" };
}
/** M4 sign-rebate: the lead installer's declaration sentence from recorded facts only (blank parts are left out, never invented). */
export function leadInstallerDeclaration(f: { address: string | null; installedOn: string | null; product: string | null; areaM2: number | null; removalM2: number | null }): string {
  const where = f.address ? ` at ${f.address}` : "";
  const when = f.installedOn ? ` on ${new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(f.installedOn)).replace(",", "")}` : "";
  const facts = [f.product, f.areaM2 ? `${Number(f.areaM2)} m²` : null, f.removalM2 ? `${Number(f.removalM2)} m² removed` : null].filter(Boolean).join(", ");
  return `I was the lead installer${where}${when}.${facts ? ` ${facts}.` : ""} The information in Section 2 is true and correct.`;
}
export function signRebateThen(ownerFirstName: string | null, pay: number | null, channel: string | null): [string, string][] {
  const owner = ownerFirstName ?? "The owner";
  const rows: [string, string][] = [["Owner", `${owner} signs their part by secure link`], ["Office", "Does the final check; Part A of the form signs itself"]];
  if (pay != null) rows.push(["Your pay", `$${Math.round(pay).toLocaleString("en-AU")} · ${channel === "installer_sourced" ? "when the owner pays their balance" : "within 7 days of our approval"}`]);
  return rows;
}

// ---------- M5 · accepted + not-for-me ----------
export function offerAcceptedView(f: { ownerFirstName: string | null; suburb: string | null; jobNumber: string | number | null; times: string[] }): { pill: string; title: string; line2: string; next: { title: string; sub: string }; times: string[]; change: string; owner: [string, string][]; what: [string, string][] } {
  const owner = f.ownerFirstName ?? "the owner";
  return {
    pill: "You've taken this job", title: `Ready Check in ${f.suburb ?? "Victoria"}`, line2: [f.jobNumber, "Home Insulation Victoria lead"].filter(Boolean).join(" · "),
    next: { title: "Nothing for you — the owner is picking a time", sub: `We've sent ${owner} your ${f.times.length || 3} times. You get a text with the day, time and address as soon as ${f.ownerFirstName ? `${owner} picks` : "they pick"} one. If none suit, ${f.ownerFirstName ? owner : "they"} suggest${f.ownerFirstName ? "s" : ""} other days and it comes back to you.` },
    times: f.times.map((t) => dayAndTime(t)), change: "Change these times",
    owner: [["Name", f.ownerFirstName ? owner : "Shown once a time is booked"], ["Address", "Shown once a time is booked"]],
    what: [["Ready Check", "Free visit · fill in the Mitti form"], ["Your pay", "Agreed rates × measured area, after the install"]],
  };
}
export const NOT_FOR_ME_SHEET = { title: "Not for me?", body: "The offer goes back to the office to pick another installer. It won't come back to you. Nothing counts against you.", yes: "Yes, not for me", keep: "Keep the offer" } as const;

// ---------- M6 · all paid grouped by month, per-job detail ----------
export type PaidRowFacts = { jobId: string; jobNumber: string | number | null; suburb: string | null; surname: string | null; amount: number | null; paidOn: string; doneAt: string | null; channel: string | null };
const monthLabel = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, month: "long" }).format(new Date(iso));
/** "October · $6,840" groups, newest month first, rows newest paid first. */
export function paidByMonth(rows: PaidRowFacts[]): { key: string; label: string; total: number; rows: PaidRowFacts[] }[] {
  const groups = new Map<string, PaidRowFacts[]>();
  for (const r of [...rows].sort((a, b) => b.paidOn.localeCompare(a.paidOn))) { const k = monthKey(r.paidOn); groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, rs]) => { const total = rs.reduce((t, r) => t + (r.amount ?? 0), 0); return { key, label: `${monthLabel(rs[0]!.paidOn)} · $${Math.round(total).toLocaleString("en-AU")}`, total, rows: rs }; });
}
export type MoneyJobFacts = {
  jobNumber: string | number | null; suburb: string | null; channel: string | null; doneAt: string | null; amount: number | null; state: { kind: PayKind; on?: string }; accountEnding: string | null;
  product: string | null; areaM2: number | null; removalM2: number | null; crew: string[];
  installerSignedAt: string | null; ownerSignedAt: string | null; apApprovedAt: string | null; ownerPaidInFullAt: string | null;
};
export function moneyJobDetail(f: MoneyJobFacts): { heading: string; sub: string; pay: string; pill: { kind: PayKind; on?: string }; payNote: string; work: [string, string][]; timeline: [string, string][]; footnote: string } {
  const own = f.channel === "installer_sourced";
  const timeline: [string, string][] = [];
  if (f.doneAt) timeline.push(["Install done", shortDay(f.doneAt)]);
  if (f.installerSignedAt) timeline.push(["Rebate form signed", `${shortDay(f.installerSignedAt)} · ${f.ownerSignedAt ? "you and the owner" : "you"}`]);
  if (f.apApprovedAt) timeline.push(["Office approved", shortDay(f.apApprovedAt)]);
  if (own && f.ownerPaidInFullAt) timeline.push(["Owner paid the balance", shortDay(f.ownerPaidInFullAt)]);
  if (f.state.kind === "coming" && f.state.on) timeline.push(["Pay due", `${shortDay(f.state.on)} · 7 days after ${own ? "both" : "approval"}`]);
  if (f.state.kind === "paid" && f.state.on) timeline.push(["Paid", shortDay(f.state.on)]);
  return {
    heading: [f.jobNumber, f.suburb].filter(Boolean).join(" · "),
    sub: [sourceLabel(f.channel), f.doneAt ? `Install ${shortDay(f.doneAt)}` : null].filter(Boolean).join(" · "),
    pay: f.amount != null ? `$${Math.round(f.amount).toLocaleString("en-AU")}` : "To be confirmed", pill: f.state,
    payNote: `Inc GST${f.accountEnding ? ` · paid to the account ending ${f.accountEnding}` : ""}`,
    work: [["Installed", [f.product, f.areaM2 ? `${Number(f.areaM2)} m²` : null].filter(Boolean).join(" · ") || "To be confirmed"], ["Removed", f.removalM2 ? `${Number(f.removalM2)} m²` : "None"], ["Crew", f.crew.length ? f.crew.join(", ") : "Not recorded"]],
    timeline,
    footnote: own ? "Your customers are paid once the office approves the paperwork and the owner has paid their balance." : "Our leads are paid within 7 days of the office approving the paperwork.",
  };
}

/** "Your agreed rates × 137.6 m² measured at the Ready Check, incl. 40 m² removal. Paid within 7 days of our approval after the install." */
export function payNote(f: { channel: string | null; areaM2: number | null; removalM2: number | null }): string {
  const area = f.areaM2 ? `${Number(f.areaM2)} m² measured at the Ready Check${f.removalM2 ? `, incl. ${Number(f.removalM2)} m² removal` : ""}` : "the area measured at the Ready Check";
  const when = f.channel === "installer_sourced" ? "Paid when the owner pays their balance." : "Paid within 7 days of our approval after the install.";
  return `Your agreed rates × ${area}. ${when}`;
}

/** Ready Check group rows. */
export function readyCheckRows(f: { bookedAt: string | null; done: boolean; formLinked: boolean; formCompleted: boolean; missing: number; /** Decision 279: false = nothing answered yet → "Not started" (never "nothing filled in" beside a quote line). */ hasAnswers?: boolean | null }): { visit: string; form: { label: string; tone: "green" | "plain" | "sub" } | null } {
  const visit = f.bookedAt ? `${f.done ? "Done" : "Booked"} ${dayAndTime(f.bookedAt)}` : f.done ? "Done" : "Not booked yet";
  const form = !f.formLinked ? null : f.formCompleted && f.missing === 0 ? { label: "Complete · nothing missing", tone: "green" as const } : f.formCompleted ? { label: `Complete · ${f.missing} thing${f.missing === 1 ? "" : "s"} missing`, tone: "plain" as const } : f.hasAnswers === false ? { label: "Not started", tone: "sub" as const } : f.missing ? { label: `${f.missing} thing${f.missing === 1 ? "" : "s"} still missing`, tone: "plain" as const } : { label: "In progress", tone: "sub" as const };
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
export function dayNext(f: { kind: DayKind; channel: string | null; installFormComplete: boolean; rebateSigned: boolean; ownerFirstName?: string | null }): { title: string; sub: string; button: string; signRebate: boolean } {
  const owner = f.ownerFirstName ?? "the owner";
  if (f.kind === "install" && f.rebateSigned) return { title: "All done", sub: "Your part of the rebate form is signed. We check the photos and sign it off.", button: "Open install form", signRebate: false };
  // Approved state M4-sign-rebate-form (decision 213): "That's a wrap. One last step: your part of the VEEC assignment form (Part B)."
  if (f.kind === "install" && f.installFormComplete) return { title: "Sign the rebate form", sub: "That's a wrap. One last step: your part of the VEEC assignment form (Part B).", button: "Sign the rebate form", signRebate: true };
  if (f.kind === "install") return { title: "Start the install in Mitti", sub: "PIISA, before and after photos and bag labels all go in the install form. Press Complete when it's fully finished.", button: "Open install form", signRebate: false };
  // Approved state M4-ready-check-day: "Do the Ready Check in Mitti" — our lead: we price the owner's quote from the agreed rates.
  if (f.kind === "ready_check") return { title: "Do the Ready Check in Mitti", sub: f.channel === "hivic_sourced" ? `Measure every ceiling area (length × width), photos, existing insulation, access and hazards. We price ${owner === "the owner" ? "the owner's" : `${owner}'s`} quote from your agreed rates.` : "Measure every ceiling area (length × width), photos, existing insulation, access and hazards. Press Complete when it's fully finished.", button: "Open Mitti form", signRebate: false };
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
