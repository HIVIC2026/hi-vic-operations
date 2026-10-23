// Owner "your quote is ready" email + text. PURE: no I/O.
// Wording from docs/OWNER_QUOTE_MESSAGES_DRAFT.md (draft, 24 Oct 2026). NOT approved by Jo yet:
// real owners never receive this until OWNER_QUOTE_EMAIL_APPROVED is true (TEST jobs may).
// Presentation reuses the welcome `simpleEmail` shell and the campaign `campaignButton`; neither is changed.
import { simpleEmail } from "./simple-email.core";
import { campaignButton, escape } from "./estimate-email";
import { aud } from "./workflow";

/** Jo has not approved the final wording yet. Flip only on her written approval. */
export const OWNER_QUOTE_EMAIL_APPROVED = false as boolean;
export const OWNER_QUOTE_EMAIL_VERSION = "v1-draft";

export type OwnerQuoteLine = { description: string; lineTotalIncGst: number };
export type OwnerQuoteEmailInput = {
  firstName: string | null;
  address: string | null;
  /** quotes.customer_total_inc_gst */
  totalIncGst: number;
  /** quotes.veec_discount_inc_gst (positive amount; 0/null = no rebate sentence). */
  rebateIncGst: number | null;
  /** quote_items, already in display order. */
  lines: OwnerQuoteLine[];
  /** Owner's secure My job link (https). */
  quoteUrl: string;
  /** Last day the quote can be accepted (null = sentence omitted). */
  validUntil: Date | null;
  officePhone: string | null;
  /** null = footer link omitted (never for real sends; the sender requires it). */
  unsubscribeUrl: string | null;
  /** Electrical safety check price for "What happens next" step 1 (null = no amount shown). */
  safetyCheckPrice?: number | null;
  /** Shows the welcome template's "TEST — only sent to Jo" pill. */
  test?: boolean;
};

const P = "font-size:15px;line-height:1.55;margin:0 0 12px;";
const H2 = "font-size:16px;font-weight:bold;margin:18px 0 8px;";
const money = (n: number) => aud(n);
const cleanName = (s: string | null) => s?.trim() || null;

export function formatQuoteValidUntil(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Last instant the quote is still valid, given its first expired instant (quote-expiry.core `quoteExpiresAt`). */
export const lastValidInstant = (expiresAt: Date) => new Date(expiresAt.getTime() - 1);

/** Picks the electrical safety check (PIESA) amount from the quote lines, if exactly one line matches. */
export function safetyCheckPriceFromLines(lines: OwnerQuoteLine[]): number | null {
  const m = lines.filter(
    (l) => /PIESA|electrical safety/i.test(l.description) && l.lineTotalIncGst > 0,
  );
  return m.length === 1 ? m[0]!.lineTotalIncGst : null;
}

export function renderOwnerQuoteEmail(i: OwnerQuoteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  if (!Number.isFinite(i.totalIncGst) || i.totalIncGst < 0)
    throw new Error("Quote total is unavailable.");
  if (!/^https:\/\//.test(i.quoteUrl)) throw new Error("Owner quote link is unavailable.");
  const name = cleanName(i.firstName);
  const address = cleanName(i.address);
  const rebate =
    i.rebateIncGst != null && Number.isFinite(i.rebateIncGst) && i.rebateIncGst > 0
      ? i.rebateIncGst
      : null;
  const total = money(i.totalIncGst);
  const subject = `Your ceiling insulation quote is ready${name ? `, ${name}` : ""}`;
  const heading = "Your ceiling insulation quote is ready";

  const greeting = `Hi ${name ?? "there"},`;
  const intro = `Thanks for having us out for your free Ready Check${address ? ` at ${address}` : ""}. Your ceiling insulation quote is ready.`;
  const priceTail = rebate
    ? `(including GST, after the government VEU rebate of ${money(rebate)})`
    : "(including GST)";
  const lineText = (l: OwnerQuoteLine) =>
    `${l.description.trim()} – ${l.lineTotalIncGst < 0 ? `minus ${money(-l.lineTotalIncGst)}` : money(l.lineTotalIncGst)}`;
  const included = [
    ...i.lines
      .filter((l) => l.description?.trim() && Number.isFinite(l.lineTotalIncGst))
      .map(lineText),
    ...(rebate ? [`Government VEU rebate – minus ${money(rebate)}`] : []),
  ];
  const accept =
    "How to accept: open your quote, and we'll text or email you a 6-digit code to confirm it's you. Then read the agreement and sign on screen. Take your time, there's no pressure to decide today. You'll find your rights as a customer on the same page.";
  const safety =
    i.safetyCheckPrice != null && i.safetyCheckPrice > 0 ? money(i.safetyCheckPrice) : null;
  const steps = [
    `You pay the ${safety ? `${safety} ` : ""}electrical safety check. We send the invoice after you accept.`,
    "A licensed electrician checks your ceiling wiring is safe. You choose a time that suits you.",
    "We book your installation within 30 days of the safety check.",
    "The balance is due in two halves, or in full if you prefer.",
  ];
  const validity = i.validUntil
    ? `This quote is valid until ${formatQuoteValidUntil(i.validUntil)}.`
    : null;
  const phone = cleanName(i.officePhone);
  const questions = phone
    ? `Questions? Just reply to this email or call us on ${phone}.`
    : "Questions? Just reply to this email.";
  const button = "View and accept your quote";

  const p = (t: string, extra = "") => `<p style="${P}${extra}">${t}</p>`;
  const list = included.map((t) => `<li style="margin:0 0 6px;">${escape(t)}</li>`).join("");
  const bodyHtml =
    p(escape(greeting)) +
    p(escape(intro)) +
    p(`<strong>Your price: ${escape(total)}</strong> ${escape(priceTail)}.`) +
    (included.length
      ? `<p style="${H2}">What's included</p><ul style="font-size:15px;line-height:1.55;margin:0 0 12px;padding-left:20px;">${list}</ul>`
      : "") +
    `<div style="margin:20px 0 12px;">${campaignButton(i.quoteUrl, button, 470)}</div>`;
  const afterButtonHtml =
    p(`<strong>How to accept:</strong> ${escape(accept.replace(/^How to accept: /, ""))}`) +
    `<p style="${H2}">What happens next</p><ol style="font-size:15px;line-height:1.55;margin:0 0 12px;padding-left:20px;">${steps.map((s) => `<li style="margin:0 0 6px;">${escape(s)}</li>`).join("")}</ol>` +
    p(escape([validity, questions].filter(Boolean).join(" "))) +
    p("Home Insulation Victoria", "font-weight:bold;margin-top:18px;");
  const footerHtml = i.unsubscribeUrl
    ? `<p style="font-size:12px;line-height:1.5;margin:16px 0 0;color:#5A6785;"><a href="${escape(i.unsubscribeUrl)}" style="color:#3C51C4;text-decoration:underline;">Unsubscribe</a></p>`
    : "";

  const textLines = [
    greeting,
    "",
    intro,
    "",
    `Your price: ${total} ${priceTail}.`,
    ...(included.length ? ["", "What's included", ...included.map((t) => `- ${t}`)] : []),
    "",
    `${button}: ${i.quoteUrl}`,
    "",
    accept,
    "",
    "What happens next",
    ...steps.map((s, n) => `${n + 1}. ${s}`),
    "",
    [validity, questions].filter(Boolean).join(" "),
    "",
    "Home Insulation Victoria",
    ...(i.unsubscribeUrl ? ["", `Unsubscribe: ${i.unsubscribeUrl}`] : []),
  ];
  const mail = simpleEmail(heading, [], undefined, {
    bodyHtml,
    afterButtonHtml,
    footerHtml,
    textLines,
    previewText: `Your price: ${total}${rebate ? " after the VEU rebate" : ""}.`,
    testLabel: i.test === true,
  });
  return { subject, html: mail.html, text: mail.text };
}

/** SMS draft wording (docs/OWNER_QUOTE_MESSAGES_DRAFT.md). Not approved for real sends. */
export function ownerQuoteSms(firstName: string | null, totalText: string, link: string): string {
  const name = cleanName(firstName);
  return `Hi ${name ?? "there"}, your Home Insulation Victoria ceiling insulation quote is ready: ${totalText} after the VEU rebate. View and accept here: ${link}. Reply STOP to opt out.`;
}
