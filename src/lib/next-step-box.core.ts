// The installer Job page "Next step" box: one thing to do, or one thing being waited on. Pure.
// Rules run from the end of the job back to the start; the first match wins.
import { bookBy, fmtDay, overdue } from "./next-step-dates.core";
import { melbourneToday } from "./melbourne-time.core";
import { melbourneYmd } from "./piesa-windows.core";
import type { AccessPerson } from "./rental-answers.core";
import { QUOTE_PRICE_NEXT_LINE, OWN_CUSTOMER_QUOTE_PREPARING_LINE } from "./installer-quote-status.core";
import { READY_CHECK_PERSON_WORDS } from "./ready-check-person.core";
import { PHOTO_QUOTE_WORDS, photoQuoteDueBy, photoQuoteOverdue, type QuoteMethod } from "./photo-quote.core";

export type NextStepFacts = {
  channel: string | null; stage: string; ownerFirst: string | null;
  /** Full owner name for the call line; falls back to the first name. */
  ownerName: string | null;
  ownerPhone: string | null; now: Date;
  givenAt: string | null; readyCheck: { start: string | null; done: boolean; missing: string[];
    /** G7: who's going — a name; null = booked with "Not sure yet" and nobody picked (job page only); undefined = not read (My work list). */
    person?: string | null | undefined };
  priceEntered: boolean | null; quote: "none" | "sent" | "accepted" | "declined" | "expired";
  acceptedAt: string | null; whoBooks: "office" | "electrician" | "either"; electricianName: string | null;
  piesa: { start: string | null; outcome: "pass" | "upgrades" | null; upgradesDone: boolean; certificateIn: boolean };
  access: AccessPerson | null;
  depositPaidAt: string | null; install: { start: string | null; lead: string | null; swmsSigned: number; swmsTotal: number };
  installDone: boolean; pay: { kind: "hivic_after_paperwork" | "own_after_owner_paid"; amount: number | null; paidAt: string | null } | null;
  mittiFormUrl: string | null;
  /** Photo-quote installers (Jo 5 Nov 2026): how the current give is quoted (missing = Ready Check); `givenAt` is the give
   *  time for photos. `photoQuoteSent`: the installer has sent the photo quote. */
  quoteMethod?: QuoteMethod; photoQuoteSent?: boolean;
};
export type NextStepKind = "quote_from_photos" | "own_ready_check" | "book_ready_check" | "ready_check_booked" | "ready_check_missing" | "enter_price" | "waiting_quote"
  | "book_piesa" | "waiting_electrician_book" | "piesa_booked" | "upload_certificate" | "waiting_deposit" | "book_install"
  | "install_booked" | "install_locked" | "after_install" | "closed";
export type NextStepBox = {
  kind: NextStepKind; title: string; sub: string | null; yours: boolean; bookBy: string | null;
  overdue: boolean; phone: { name: string; phone: string } | null; button: string | null; lines: string[];
  alsoBookInstall: { button: "Book the install"; warn: string } | null;
  /** G7: the booked Ready Check still needs its person — the page shows the "Who's going" pick for this start. */
  pickPerson: { start: string } | null;
};

// Wording. Lines quoted in the plan's Global Constraints are approved; every line marked DRAFT is not yet seen by Jo.
export const NEXT_STEP_WORDS = {
  bookReadyCheckTitle: "Book the Ready Check", // approved (plan Task 3 table)
  bookButton: "Book", // approved (plan Task 3 table)
  mittiButton: "Open the Mitti form", // approved (plan Task 3 table)
  enterPriceTitle: "Enter your price", // approved (plan Task 3 table)
  bookInstallTitle: "Book the install", // approved (plan Task 3 table)
  bookInstallButton: "Book the install", // approved (plan Task 3 table)
  uploadCertificateTitle: "Upload the Certificate of Electrical Safety", // DRAFT
  lockedLine: "Locked: ESC has been told. Email us to move this install.", // approved (Global Constraints)
  beforeUpgradesWarn: "Electrical upgrades aren't done yet. The install can't start until the Part C and certificate are in.", // approved (Part 9 Task 10 text in the plan)
  readyCheckLine: (when: string) => `Ready Check · ${when}`, // approved (plan Task 3 table)
  stillNeeds: (items: string) => `Still needs: ${items}`, // approved (plan Task 3 table)
  bookReadyCheckSub: (name: string, by: string | null) => `Give ${name} a call and agree a day, then add it here.${by ? ` Book by ${by}.` : ""}`, // DRAFT
  readyCheckBookedTitle: "Ready Check booked", // DRAFT
  readyCheckBookedSub: "Fill in the Mitti form on the day.", // DRAFT
  readyCheckMissingTitle: "Finish the Ready Check", // DRAFT
  waitingQuoteTitle: "Waiting for the owner to decide", // DRAFT
  waitingQuoteSub: "Nothing for you to do.", // approved fragment (plan Task 3 table)
  quotePreparingTitle: "Quote being prepared", // DRAFT (fix wave I5: no quote has gone to the owner yet)
  quoteCheckingSub: "Home Insulation Victoria is checking the quote.", // DRAFT (fix wave I5)
  quotePriceNextSub: QUOTE_PRICE_NEXT_LINE, // DRAFT (installer-quote-status.core; own customer, price not in yet)
  quoteDeclinedSub: "The owner didn't take this one up. Nothing for you to do.", // DRAFT
  bookPiesaTitle: "Book the PIESA", // DRAFT
  bookPiesaSub: (name: string, by: string | null) => `${name} has said yes. Give ${name} a call, agree a day for the PIESA, then add it here.${by ? ` Book by ${by}.` : ""}`, // DRAFT
  waitingElectricianTitle: "Waiting for the electrician", // DRAFT
  waitingElectricianSub: (who: string, by: string | null) => `Waiting for ${who} to book the PIESA.${by ? ` Book by ${by}.` : ""}`, // approved (plan Task 3 table)
  piesaBookedTitle: "PIESA booked", // DRAFT
  piesaBookedLine: (when: string) => `PIESA · ${when}`, // DRAFT
  piesaBookedSub: "The electrician does the PIESA. Nothing for you to do.", // DRAFT
  depositLine: (name: string) => `Deposit: waiting for ${name}.`, // DRAFT
  uploadCertificateSub: "Upload the certificate once the electrical upgrades are done.", // DRAFT
  waitingDepositTitle: "Waiting for the deposit", // DRAFT
  waitingDepositSub: (name: string) => `Waiting for ${name} to pay the deposit. Nothing for you to do.`, // approved (plan Task 3 table)
  bookInstallSub: (name: string, possessive: string, by: string) => `${possessive} deposit is in. Give ${name} a call, agree a day, then add it here. Book by ${by}.`, // approved (plan Task 3 table)
  installBookedTitle: "Install booked", // DRAFT
  installLine: (when: string) => `Install · ${when}`, // DRAFT
  swmsLine: (n: number, total: number) => `Safety plan signed ${n} of ${total}`, // approved (plan Task 3 table)
  locksLine: (label: string) => `Lead Installer locks ${label}`, // approved (plan Task 3 table)
  installLockedTitle: "Install locked in", // DRAFT
  afterInstallTitle: "Install done", // DRAFT
  paidSub: (date: string) => `Paid ✓ ${date}`, // approved (plan Task 3 table)
  hivicPaySub: (money: string) => `Your ${money} is paid 7 days after we approve the install paperwork.`, // DRAFT sentence from the approved Money line
  ownPaySub: (money: string, _name: string) => `You're paid ${money} once the owner has paid in full.`, // Jo 5 Nov exact sentence
  closedTitle: "Closed", // DRAFT
  theOwner: "the owner", // DRAFT
  theOwnersPossessive: "The owner's", // approved (plan Task 3 table)
  quoteFromPhotosTitle: PHOTO_QUOTE_WORDS.boxTitle, // approved (spec decision 4)
  quoteFromPhotosSub: (by: string) => `Look at the owner's photos, fill this in and send it. Due by ${by}.`, // DRAFT (photo-quote plan Task 6)
} as const;
const W = NEXT_STEP_WORDS;

// ---- Lead Installer lock: the ONE rule lives in prestart.core (Part 9 Task 9); this screen only shows it ----------
import { leadInstallerLock, leadInstallerLocked } from "./lead-installer-lock.core";

// ---- Formatting (Melbourne) -----------------------------------------------------------------------------------------
const fmtDayMonth = (ymd: string): string => fmtDay(ymd).split(" ").slice(1).join(" ");
function fmtHour(at: Date, minutes = false): string {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const m = get("minute");
  const ap = get("dayPeriod").toLowerCase();
  return minutes || m !== "00" ? `${get("hour")}:${m}${ap}` : `${get("hour")}${ap}`;
}
const fmtWhen = (iso: string): string => `${fmtDay(melbourneYmd(new Date(iso)))}, ${fmtHour(new Date(iso), true)}`;
const fmtMoney = (n: number): string => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

// ---- The box -----------------------------------------------------------------------------------------------------------
const box = (kind: NextStepKind, title: string, o: Partial<Omit<NextStepBox, "kind" | "title">> = {}): NextStepBox => ({
  sub: null, yours: false, bookBy: null, overdue: false, phone: null, button: null, lines: [], alsoBookInstall: null, pickPerson: null, ...o, kind, title,
});

export function nextStepBox(f: NextStepFacts): NextStepBox {
  const first = f.ownerFirst?.trim() || null;
  const name = first ?? W.theOwner;
  const possessive = first ? `${first}'s` : W.theOwnersPossessive;
  const fullName = f.ownerName?.trim() || first || W.theOwner.replace(/^t/, "T");
  // Trades call whoever lets them in; the owner's own number stays on the Owner row.
  const callPhone = (): NextStepBox["phone"] => {
    const a = f.access;
    if (a && a.who !== "owner" && a.mobile) return { name: `${a.name} (${a.who === "tenant" ? "tenant" : "property manager"})`, phone: a.mobile };
    return f.ownerPhone ? { name: fullName, phone: f.ownerPhone } : null;
  };
  const withBookBy = (step: "ready_check" | "piesa" | "install", from: string | null) => {
    const by = from ? bookBy(step, from) : null;
    return { by, label: by ? fmtDay(by) : null, late: by ? overdue(by, f.now) : false };
  };
  const swms = f.install.swmsTotal > 0 ? [W.swmsLine(f.install.swmsSigned, f.install.swmsTotal)] : [];
  const upgradesPending = f.piesa.outcome === "upgrades" && !f.piesa.certificateIn;

  // closed
  if (f.stage === "cancelled" || (f.stage === "complete" && !f.pay)) return box("closed", W.closedTitle);

  // after the install
  if (f.installDone) {
    let sub: string | null = null;
    if (f.pay?.paidAt) sub = W.paidSub(fmtDayMonth(melbourneToday(new Date(f.pay.paidAt))));
    else if (f.pay) {
      const money = f.pay.amount != null ? fmtMoney(f.pay.amount) : "pay";
      sub = f.pay.kind === "own_after_owner_paid" ? W.ownPaySub(money, name) : W.hivicPaySub(money);
    }
    return box("after_install", W.afterInstallTitle, { sub });
  }

  // install booked / locked
  if (f.install.start) {
    const when = W.installLine(fmtWhen(f.install.start));
    if (leadInstallerLocked(f.install.start, f.now)) {
      return box("install_locked", W.installLockedTitle, { sub: when, lines: [...swms, W.lockedLine] });
    }
    return box("install_booked", W.installBookedTitle, { sub: when, lines: [...swms, W.locksLine(leadInstallerLock(f.install.start).lockLabel)] });
  }

  const piesaCleared = f.piesa.outcome === "pass" || (f.piesa.outcome === "upgrades" && f.piesa.certificateIn);
  if (piesaCleared && f.depositPaidAt) {
    const d = withBookBy("install", f.depositPaidAt);
    return box("book_install", W.bookInstallTitle, {
      sub: W.bookInstallSub(name, possessive, d.label ?? ""), yours: true, bookBy: d.by, overdue: d.late, phone: callPhone(), button: W.bookInstallButton,
    });
  }
  if (piesaCleared) return box("waiting_deposit", W.waitingDepositTitle, { sub: W.waitingDepositSub(name) });
  if (upgradesPending) {
    return box("upload_certificate", W.uploadCertificateTitle, {
      sub: W.uploadCertificateSub, yours: true,
      lines: f.depositPaidAt ? [] : [W.depositLine(name)],
      alsoBookInstall: f.depositPaidAt ? { button: "Book the install", warn: W.beforeUpgradesWarn } : null,
    });
  }
  if (f.piesa.start) return box("piesa_booked", W.piesaBookedTitle, { sub: W.piesaBookedSub, lines: [W.piesaBookedLine(fmtWhen(f.piesa.start))] });

  // the owner has said yes: book the PIESA
  if (f.quote === "accepted") {
    const d = withBookBy("piesa", f.acceptedAt);
    if (f.whoBooks === "electrician") {
      return box("waiting_electrician_book", W.waitingElectricianTitle, {
        sub: W.waitingElectricianSub(f.electricianName?.trim() || "the electrician", d.label), bookBy: d.by, overdue: d.late,
      });
    }
    return box("book_piesa", W.bookPiesaTitle, {
      sub: W.bookPiesaSub(name, d.label), yours: true, bookBy: d.by, overdue: d.late, phone: callPhone(), button: W.bookButton,
    });
  }

  // Photo-quote installers: no Ready Check on a From photos give — the photo quote stands in for it.
  const photos = f.quoteMethod === "photos";
  if (photos && !f.photoQuoteSent) {
    const due = f.givenAt ? photoQuoteDueBy(f.givenAt) : null;
    return box("quote_from_photos", W.quoteFromPhotosTitle, {
      sub: W.quoteFromPhotosSub(due ? fmtDay(due) : ""), yours: true, bookBy: due, overdue: f.givenAt ? photoQuoteOverdue(f.givenAt, f.now) : false,
    });
  }

  // Jo 5 Nov: own-customer A1 has no booking or attendance clock, even with a legacy visit stored.
  if (f.channel === "installer_sourced") {
    if (f.quote !== "none") return box("waiting_quote", W.waitingQuoteTitle, { sub: f.quote === "declined" || f.quote === "expired" ? W.quoteDeclinedSub : W.waitingQuoteSub });
    if (f.priceEntered === true) return box("waiting_quote", OWN_CUSTOMER_QUOTE_PREPARING_LINE);
    // Photo quotes: the photo quote stands in for the Ready Check — never "Do it in Mitti" or "Mitti form done".
    if (photos) return box("enter_price", W.enterPriceTitle, { yours: true });
    if (f.readyCheck.done) return box("enter_price", "Mitti form done — enter your price", { yours: true });
    return box("own_ready_check", "Ready Check", { yours: true, button: "Do it in Mitti" });
  }

  // Ready Check done (or, for photos, the photo quote sent)
  if (f.readyCheck.done || photos) {
    if (!photos && f.readyCheck.missing.length) {
      return box("ready_check_missing", W.readyCheckMissingTitle, { sub: W.stillNeeds(f.readyCheck.missing.join(", ")), yours: true, button: W.mittiButton });
    }
    if (f.priceEntered === false) return box("enter_price", W.enterPriceTitle, { yours: true });
    // Fix wave I5: before any quote has gone to the owner there is nobody "deciding" — the own customer's price step is
    // next (price not in yet), otherwise Home Insulation Victoria is checking the quote (own customer with the price in, or our lead).
    if (f.quote === "none") {
      const own = f.channel === "installer_sourced";
      return box("waiting_quote", W.quotePreparingTitle, { sub: own && f.priceEntered !== true ? W.quotePriceNextSub : W.quoteCheckingSub });
    }
    return box("waiting_quote", W.waitingQuoteTitle, { sub: f.quote === "declined" || f.quote === "expired" ? W.quoteDeclinedSub : W.waitingQuoteSub });
  }
  if (f.readyCheck.start) {
    // G7 (Jo 4 Nov 2026): booked with "Not sure yet" → "Pick who's going by 5pm the day before" and the pick, no Mitti button
    // (the form is made when the person is picked).
    if (f.readyCheck.person === null) {
      return box("ready_check_booked", W.readyCheckBookedTitle, { sub: READY_CHECK_PERSON_WORDS.pickBy, yours: true, lines: [W.readyCheckLine(fmtWhen(f.readyCheck.start)), READY_CHECK_PERSON_WORDS.nobodyYet], pickPerson: { start: f.readyCheck.start } });
    }
    return box("ready_check_booked", W.readyCheckBookedTitle, { sub: W.readyCheckBookedSub, yours: true, lines: [W.readyCheckLine(fmtWhen(f.readyCheck.start))], button: W.mittiButton });
  }
  const d = withBookBy("ready_check", f.givenAt);
  return box("book_ready_check", W.bookReadyCheckTitle, {
    sub: W.bookReadyCheckSub(name, d.label), yours: true, bookBy: d.by, overdue: d.late, phone: callPhone(), button: W.bookButton,
  });
}
