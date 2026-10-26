// Owner "your quote is ready" email + text, and the quote reminder emails. PURE: no I/O.
// Quote email APPROVED by Jo 24 Oct 2026 (decision 86); design docs/templates/mjml/owner_O18.mjml (MJML email refresh,
// Jo 27 Oct 2026) — "Hi {Name}, your quote is ready." / "You save {rebate} on ceiling insulation"; green rebate box and
// price box (full price crossed out, address, "Measured at your Ready Check"); View and accept; itemised "Your quote"
// (every line, m² × rate and cent amount); not included; one-line Next; held-until line. Subject, SMS and every delivery guard are unchanged (OWNER_QUOTE_EMAIL_APPROVED, customer_comms_enabled).
// Reminder emails (decisions 88/89/134, docs/templates/mjml/owner_O19.mjml): rebate + price boxes + button with a reminder line, no breakdown.
// Approved (decisions 89/134): QUOTE_REMINDER_EMAIL_APPROVED is on; the sender is approved-owner-emails.server.ts behind customer_comms_enabled.
// Quote text (decision 87, B): ownerQuoteSms below — brand prefix added by the sender.
import { currentFeeWording } from "./hiv-quote.core";
import { aud } from "./workflow";
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";

/** v3 approved 24 Oct 2026; design applied under decision 137. */
export const OWNER_QUOTE_EMAIL_APPROVED = true as boolean;
export const OWNER_QUOTE_EMAIL_VERSION = "v3-approved-2026-10-24";
/** Jo 24 Oct 2026, decisions 89 and 134 (O19 quote reminder, day 3 + expiry): approved. Delivery still behind customer_comms_enabled. */
export const QUOTE_REMINDER_EMAIL_APPROVED = true as boolean;

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
  /** Electrical safety check price for the "Next" line (null = no amount shown). */
  safetyCheckPrice?: number | null;
  /** Shows the "TEST — only sent to Jo" pill. */
  test?: boolean;
  /** Full price before the rebate (quotes.subtotal_inc_gst). */
  subtotalIncGst?: number | null;
  /** Measured ceiling area and removal area (m²) from the Ready Check. */
  areaM2?: number | null;
  removalM2?: number | null;
  /** e.g. "Bradford Gold R5.0" (the product recorded from the Ready Check). */
  product?: string | null;
  /** Assigned installer business; EEC wording only when the installer is approved (CII verification is required for that). */
  installerName?: string | null;
  installerCertified?: boolean;
};

const money = (n: number) => aud(n);
const cleanName = (s: string | null) => s?.trim() || null;

export function formatQuoteValidUntil(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" }).format(d);
}
/** "7 November" (reminder wording). */
export function formatQuoteValidUntilShort(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long" }).format(d);
}

/** Last instant the quote is still valid, given its first expired instant (quote-expiry.core `quoteExpiresAt`). */
export const lastValidInstant = (expiresAt: Date) => new Date(expiresAt.getTime() - 1);

/** Picks the electrical safety check (PIESA) amount from the quote lines, if exactly one line matches. */
export function safetyCheckPriceFromLines(lines: OwnerQuoteLine[]): number | null {
  const m = lines.filter((l) => /PIESA|electrical safety/i.test(l.description) && l.lineTotalIncGst > 0);
  return m.length === 1 ? m[0]!.lineTotalIncGst : null;
}

/** Retained for callers/tests; the approved short quote email no longer repeats it. */
export const INSULATION_BENEFIT = "Ceiling insulation is the best barrier against summer heat and winter cold, and can save you up to 20% on your heating and cooling costs (Sustainability Victoria). Warmer winters, cooler summers, lower bills for years.";

const NOT_INCLUDED = "Not included: electrical fixes, only if the safety check finds any. They're quoted separately, and nothing is done without your OK.";
const NOT_FOR_YOU = "Not ready, or not for you? You can tell us on the same page.";
/** Rule (Jo): "Accredited Person", never "Accredited Provider" — older quote lines still carry the old fee name. */
const lineTitle = (d: string) => currentFeeWording(d);

/** Shared figures: rebate, full price, headline and the approved rebate + price boxes (MJML). */
function quoteFigures(i: OwnerQuoteEmailInput) {
  if (!Number.isFinite(i.totalIncGst) || i.totalIncGst < 0) throw new Error("Quote total is unavailable.");
  if (!/^https:\/\//.test(i.quoteUrl)) throw new Error("Owner quote link is unavailable.");
  const name = cleanName(i.firstName);
  const address = cleanName(i.address);
  const rebate = i.rebateIncGst != null && Number.isFinite(i.rebateIncGst) && i.rebateIncGst > 0 ? i.rebateIncGst : null;
  const full = i.subtotalIncGst != null && Number.isFinite(i.subtotalIncGst) && i.subtotalIncGst > 0 ? i.subtotalIncGst : rebate ? i.totalIncGst + rebate : null;
  const total = money(i.totalIncGst);
  const headline = rebate ? `You save ${K.whole(rebate)} on ceiling insulation` : "Your ceiling insulation quote is ready";
  const both = !!(rebate && full);
  const rebateBox = both
    ? `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your VEU rebate</mj-text><mj-text mj-class="big-green">You save ${esc(K.whole(rebate!))}</mj-text><mj-text mj-class="center" font-size="14px" line-height="20px" padding="0 16px 18px">Taken off upfront. Nothing for you to claim.</mj-text></mj-column></mj-section>`
    : "";
  const priceBox = `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your price</mj-text><mj-text mj-class="big-blue">${esc(total)}</mj-text><mj-text mj-class="center" font-size="14px" line-height="20px" font-weight="700">incl. GST${both ? ` · full price before rebate <span class="strike">${esc(money(full!))}</span>` : ""}</mj-text><mj-text mj-class="small center" padding="0 16px 18px">${address ? `${esc(address)}<br />` : ""}Measured at your Ready Check</mj-text></mj-column></mj-section>`;
  const box = rebateBox + priceBox;
  const boxText = [rebate ? `Your VEU rebate: you save ${K.whole(rebate)}. Taken off upfront. Nothing for you to claim.` : null, `Your price: ${total} incl. GST${both ? ` (full price before rebate ${money(full!)})` : ""}`, address, "Measured at your Ready Check"].filter((l): l is string => !!l);
  return { name, address, rebate, full, total, headline, box, boxText };
}
const mjButton = (href: string) => `<mj-button href="${esc(href)}" padding="14px 12px 14px">View and accept your quote</mj-button>`;

/** One "Your quote" row: title + grey detail on the left, amount on the right. */
function quoteRowHtml(r: K.QuoteRow, first: boolean): string {
  const bt = first ? "" : "border-top:1px solid #E4E9F5;";
  const left = `<strong${r.color ? ` style="color:${r.color};"` : ""}>${esc(r.title)}</strong>${r.detail ? `<br /><span class="muted" style="font-size:13px;line-height:19px;">${esc(r.detail)}</span>` : ""}`;
  const amount = r.bold ? `<strong>${esc(r.amount)}</strong>` : esc(r.amount);
  return `<tr><td valign="top" style="${bt}padding:${first ? "0 12px 12px 0" : "12px 12px 12px 0"};">${left}</td><td align="right" valign="top" style="${bt}padding:${first ? "0 0 12px" : "12px 0"};white-space:nowrap;${r.color ? `color:${r.color};` : ""}">${amount}</td></tr>`;
}

export function renderOwnerQuoteEmail(i: OwnerQuoteEmailInput): { subject: string; html: string; text: string } {
  const f = quoteFigures(i);
  const subject = f.rebate ? `${f.name ? `${f.name}, your` : "Your"} quote is ready – save ${K.whole(f.rebate)} on ceiling insulation` : `Your ceiling insulation quote is ready${f.name ? `, ${f.name}` : ""}`;
  const hi = f.name ? `Hi ${f.name}, your quote is ready.` : "Your quote is ready.";
  const area = i.areaM2 != null && i.areaM2 > 0 ? i.areaM2 : null;
  const removal = i.removalM2 != null && i.removalM2 > 0 ? i.removalM2 : null;
  const installer = cleanName(i.installerName ?? null);
  const safety = i.safetyCheckPrice != null && i.safetyCheckPrice > 0 ? money(i.safetyCheckPrice) : null;
  // Itemised rows from the quote lines, with the approved detail lines where the facts are known.
  const perM2 = (amount: number, m: number) => `${K.m2(m)} × ${money(amount / m)} per m²`;
  const rows: K.QuoteRow[] = i.lines.map((l) => {
    const d = l.description;
    const isRemoval = /remov/i.test(d), isPiesa = /PIESA|electrical safety/i.test(d), isAp = /accredited|management|compliance/i.test(d);
    const isProduct = !isRemoval && !isPiesa && !isAp && /insulation|batts|R\d/i.test(d);
    const detail = isPiesa ? "By a licensed electrician, before any insulation goes in"
      : isAp ? `Home Insulation Victoria (VEU ${K.AP_NUMBER}): your quote, compliance checks, paperwork and rebate claim`
        : isRemoval && removal ? perM2(l.lineTotalIncGst, removal)
          : isProduct ? [area ? perM2(l.lineTotalIncGst, area) : null, `VEU-approved (AS/NZS 4859.1)${i.installerCertified ? `, installed by ${installer ?? "an EEC-certified installer"}, EEC-certified (AS 3999)` : ""}`].filter(Boolean).join(". ")
            : null;
    return { title: lineTitle(d), detail, amount: money(l.lineTotalIncGst) };
  });
  if (f.full && f.rebate) rows.push({ title: "Full price", detail: "incl. GST", amount: money(f.full), bold: true }, { title: "VEU rebate", detail: "Taken off upfront, nothing to claim", amount: `−${money(f.rebate)}`, bold: true, color: "#057D40" });
  const next = `<strong>Next:</strong> accept and pay ${safety ? `${esc(safety)} ` : ""}→ electrician safety check → book your install day.`;
  const validity = i.validUntil ? `Your price is held until ${formatQuoteValidUntil(i.validUntil)}.` : null;
  // Jo 26 Oct: no HIV phone number and no "call us" in owner emails — owners reply by email only.
  const questions = "Questions? Just reply to this email.";
  const closing = [validity, NOT_FOR_YOU, questions].filter(Boolean).join(" ");
  const youPay = `<tr><td valign="middle" style="border-top:2px solid #22376B;padding:12px 12px 12px 0;font-size:18px;"><strong>You pay</strong></td><td align="right" valign="middle" style="border-top:2px solid #22376B;padding:12px 0;white-space:nowrap;font-size:18px;color:#3C51C4;"><strong>${esc(f.total)}</strong></td></tr>`;
  const quote = rows.length
    ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Your quote</mj-text><mj-table padding="0 18px 6px">${rows.map((r, n) => quoteRowHtml(r, n === 0)).join("")}${youPay}</mj-table><mj-text mj-class="small" padding="0 18px 18px">${esc(NOT_INCLUDED)}</mj-text></mj-column></mj-section>`
    : `<mj-section><mj-column><mj-text mj-class="small" padding="0 12px 0">${esc(NOT_INCLUDED)}</mj-text></mj-column></mj-section>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(f.headline)}</mj-text></mj-column></mj-section>`,
    f.box,
    `<mj-section><mj-column>${mjButton(i.quoteUrl)}</mj-column></mj-section>`,
    quote,
    `<mj-section><mj-column><mj-text padding="18px 12px 14px">${next}</mj-text><mj-text mj-class="small" padding="0 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const preview = [`You pay ${f.total}${f.rebate ? " after the rebate" : ""}.`, validity].filter(Boolean).join(" ");
  const html = mjEmail({ subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([
    hi, "", f.headline, "", ...f.boxText, "", `View and accept your quote: ${i.quoteUrl}`, "",
    ...(rows.length ? ["YOUR QUOTE", ...rows.map((r) => `${r.title}${r.detail ? ` (${r.detail})` : ""}: ${r.amount}`), `You pay: ${f.total}`, ""] : []),
    NOT_INCLUDED, "", K.stripTags(next), "", closing,
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

export type QuoteReminderKind = "day3" | "expiry";
/** Decisions 88/89/134: a short reminder 3 days after the quote is sent, and again 2 days before the price expires. */
export function renderQuoteReminderEmail(i: OwnerQuoteEmailInput & { kind: QuoteReminderKind }): { subject: string; html: string; text: string } {
  const f = quoteFigures(i);
  const first = f.name ?? "there";
  const held = i.validUntil ? formatQuoteValidUntilShort(i.validUntil) : null;
  const subject = i.kind === "expiry" && held ? `${first}, your quote price is held until ${held}` : `${first}, your quote is waiting`;
  const headline = `${first}, your quote is waiting`;
  const off = f.rebate ? ` with ${esc(K.whole(f.rebate))} off` : "";
  // The main line (also the inbox preview), then "Just checking you saw it." (day 3) and the questions line.
  const coreHtml = i.kind === "expiry"
    ? held ? `Your price is held until <strong>${esc(held)}</strong>. Accept by then to keep your price${off}.` : `Your price won't be held much longer. Accept soon to keep your price${off}.`
    : f.rebate
      ? `Your ${esc(K.whole(f.rebate))} rebate is ready to go${held ? `, and your price is held until ${esc(held)}.` : "."}`
      : held ? `Your price is held until ${esc(held)}.` : "";
  const questions = "Any questions? Reply to this email and we'll help.";
  const introHtml = [i.kind === "day3" ? "Just checking you saw it." : null, coreHtml || null, questions].filter(Boolean).join(" ");
  const preview = K.stripTags(coreHtml) || "Just checking you saw it.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${introHtml}</mj-text></mj-column></mj-section>`,
    f.box,
    `<mj-section><mj-column>${mjButton(i.quoteUrl)}<mj-text mj-class="small" padding="0 12px 0">${esc(NOT_FOR_YOU)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([headline, "", K.stripTags(introHtml), "", ...f.boxText, "", `View and accept your quote: ${i.quoteUrl}`, "", NOT_FOR_YOU], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

/** Quote ready text, approved by Jo 24 Oct 2026 (decision 87, version B). The "Home Insulation Victoria: " prefix is added by brandSmsBody. */
export function ownerQuoteSms(firstName: string | null, link: string): string {
  const name = cleanName(firstName);
  return `Your ceiling insulation quote is ready${name ? `, ${name}` : ""}. See it here: ${link} Reply STOP to opt out.`;
}
