// Decision 170 (Jo, 24 Oct 2026): when the 10% install deposit is not received within 48 hours and the provisional
// install day is released (payments.server sweepProvisionalBookings, decision 139), the owner is told by text + email.
// Approved wording lives here; design docs/templates/mjml/owner_O64.mjml. Pure: no I/O.
// Delivery: TEST jobs → test-send; real owners → the guarded owner-email path and the one real SMS sender (type
// `deposit_release`), both behind customer_comms_enabled. One notice per released booking (keys below).
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

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

const ROW_K = (top: boolean) => `padding:8px 0;${top ? "" : "border-top:1px solid #E4E9F5;"}color:#5A6785;white-space:nowrap;`;
const ROW_V = (top: boolean, nowrap: boolean) => `padding:8px 0 8px 12px;${top ? "" : "border-top:1px solid #E4E9F5;"}${nowrap ? "white-space:nowrap;" : ""}`;

/** Splits payments.core bankDetailLines into label/value rows for the design's bank table; null when a line isn't one
 *  of those shapes (e.g. "Bank details: … to be confirmed"), so the lines are shown as they are. */
function bankRows(lines: string[]): { k: string; v: string }[] | null {
  const rows: { k: string; v: string }[] = [];
  for (const l of lines) {
    const bsb = /^BSB (\S+) · Account (\S+)$/.exec(l);
    const kv = /^(Account name|PayID|Reference): (.+)$/.exec(l);
    if (bsb) rows.push({ k: "BSB", v: bsb[1]! }, { k: "Account", v: bsb[2]! });
    else if (kv) rows.push({ k: kv[1]!, v: kv[2]! });
    else return null;
  }
  return rows.length ? rows : null;
}

function bankTableHtml(lines: string[]): string {
  const rows = bankRows(lines);
  if (!rows) return `<mj-text padding="0 18px 16px">${lines.map(esc).join("<br />")}</mj-text>`;
  const cell = (r: { k: string; v: string }) => {
    if (r.k === "Reference") {
      const m = /^(.*\s)(\S+)$/.exec(r.v);
      return m ? `${esc(m[1]!)}<span style="white-space:nowrap;">${esc(m[2]!)}</span>` : esc(r.v);
    }
    return esc(r.v);
  };
  return `<mj-table padding="0 18px 14px">${rows.map((r, n) => `<tr><td style="${ROW_K(n === 0)}">${esc(r.k)}</td><td align="right" style="${ROW_V(n === 0, r.k === "BSB" || r.k === "Account")}"><strong>${cell(r)}</strong></td></tr>`).join("")}</mj-table>`;
}

/** Owner email: headline, the same message, bank details, See my job. */
export function renderDepositReleasedEmail(f: DepositReleaseFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const subject = `${first}, your install day was released`;
  const hi = `Hi ${first},`;
  const headline = "Your install day was released";
  const body = `We didn't receive your install deposit in time, so ${f.day} has been released. Your installer will offer new days once it's paid.`;
  const payTitle = f.depositAmount ? `Pay your ${f.depositAmount} deposit by bank transfer or PayID` : "Pay your deposit by bank transfer or PayID";
  const preview = `Pay your ${f.depositAmount ? `${f.depositAmount} ` : ""}deposit and your installer will offer new days.`;
  const lands = "Once it lands, your installer offers you new days on your job page.";
  const html = mjEmail({
    subject, preview,
    body: [
      `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text><mj-text>${esc(body)}</mj-text></mj-column></mj-section>`,
      `<mj-section><mj-column mj-class="panel"><mj-text mj-class="h2" padding="18px 18px 8px">${esc(payTitle)}</mj-text>${bankTableHtml(f.bankLines)}</mj-column></mj-section>`,
      `<mj-section><mj-column><mj-text padding="16px 12px 14px">${esc(lands)}</mj-text><mj-button href="${esc(f.link)}">See my job</mj-button><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
    ].join(""),
    unsubscribe: null, testLabel: f.test === true,
  });
  const text = K.plainText([
    hi, "", headline, "", body, "", payTitle.toUpperCase(), ...f.bankLines, "", lands, `See my job: ${f.link}`, "", "Questions? Just reply to this email.",
  ], { testLabel: f.test === true });
  return { subject, html, text };
}
