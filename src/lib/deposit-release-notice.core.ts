// Decision 170 (Jo, 24 Oct 2026): when the 10% install deposit is not received within 48 hours and the provisional
// install day is released (payments.server sweepProvisionalBookings, decision 139), the owner is told by text + email.
// Approved wording lives here; design docs/templates/approved/O64-deposit-released.html. Pure: no I/O.
// Delivery: TEST jobs → test-send; real owners → the guarded owner-email path and the one real SMS sender (type
// `deposit_release`), both behind customer_comms_enabled. One notice per released booking (keys below).
import * as K from "./email-kit.core";

/** Jo 24 Oct 2026 (decision 170): wording approved. */
export const PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED = true as boolean;
export const DEPOSIT_RELEASE_SMS_TYPE = "deposit_release";
/** Recorded once per released booking BEFORE anything is sent, so a tick retry never repeats the notice. */
export const DEPOSIT_RELEASE_NOTICE_EVENT = "install_booking_released_owner_notice";

export type DepositReleaseFacts = {
  firstName: string | null;
  /** The released day, e.g. "Tuesday 11 November" (formatInstallDay without the time). */
  day: string;
  /** Secure My job link. */
  link: string;
  /** Deposit still owing, e.g. "$185.10". */
  depositAmount: string | null;
  /** payments.core bankDetailLines(bank, reference). */
  bankLines: string[];
  test?: boolean;
};

/** Idempotency keys: one text and one email per released booking. */
export const depositReleaseKeys = (bookingId: string) => ({ email: `deposit-release:v1:${bookingId}:email`, sms: `deposit-release:v1:${bookingId}:sms` });

const message = (first: string, day: string) => `Hi ${first}, we didn't receive your install deposit in time, so ${day} has been released. Your installer will offer new days once it's paid`;

/** Owner text (brand prefix is added by brandSmsBody). Under 2 segments; STOP line last. */
export function depositReleaseText(f: Pick<DepositReleaseFacts, "firstName" | "day" | "link">): string {
  const first = K.cleanName(f.firstName) ?? "there";
  return `${message(first, f.day)}: ${f.link} Reply STOP to opt out.`;
}

/** Owner email: headline, the same message, bank details, See my job. */
export function renderDepositReleasedEmail(f: DepositReleaseFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const headline = `${first}, your install day was released`;
  const body = `${message(first, f.day)}.`;
  const payTitle = f.depositAmount ? `Pay your ${f.depositAmount} deposit by bank transfer or PayID` : "Pay your deposit by bank transfer or PayID";
  const html = K.emailShell({
    body: [
      K.h1(headline),
      K.p(body),
      K.mistBox(payTitle, `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.5;">${f.bankLines.map(K.esc).join("<br>")}</div>`, { padding: "14px 16px", radius: 14 }),
      K.note("Once it lands, your installer offers you new days on your job page.", "14px 0 0"),
      K.button(f.link, "See my job"),
      K.small("Questions? Just reply to this email."),
    ].join("\n"),
    previewText: body, testLabel: f.test === true, unsubscribe: null,
  });
  const text = K.plainText([
    headline, "", body, "", payTitle.toUpperCase(), ...f.bankLines, "", "Once it lands, your installer offers you new days on your job page.", `See my job: ${f.link}`, "", "Questions? Just reply to this email.",
  ], { testLabel: f.test === true });
  return { subject: headline, html, text };
}
