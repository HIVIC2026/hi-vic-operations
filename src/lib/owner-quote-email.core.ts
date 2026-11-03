// Owner "your quote is ready" email + text, and the quote reminder emails. PURE: no I/O.
// Quote email APPROVED by Jo 24 Oct 2026 (decision 86); design docs/templates/mjml/owner_O18.mjml (MJML email refresh,
// Jo 27 Oct 2026) — "Hi {Name}, your quote is ready." / "You save {rebate} on ceiling insulation"; green rebate box and
// price box (full price crossed out, address, "Measured at your Ready Check"); View and accept; itemised "Your quote"
// (every line, m² × rate and cent amount); not included; one-line Next; held-until line. Subject, SMS and every delivery guard are unchanged (OWNER_QUOTE_EMAIL_APPROVED, customer_comms_enabled).
// Reminder emails (decisions 88/89/134, docs/templates/mjml/owner_O19.mjml): rebate + price boxes + button with a reminder line, no breakdown.
// Approved (decisions 89/134): QUOTE_REMINDER_EMAIL_APPROVED is on; the sender is approved-owner-emails.server.ts behind customer_comms_enabled.
// Decision #30 (Jo 2 Nov 2026): reminders say "Your rebate" (never "Your VEU rebate"); a 30-day quote's reminders say
// "Your quote is valid for 30 days, until {date}". A quote sent before the 30-day change keeps the held-until wording.
// Decision #29 (Jo 2 Nov 2026) — O18 v4, behind OWNER_QUOTE_EMAIL_V4_APPROVED (false until Jo OKs the pictures; flag off
// = v3 above, unchanged): "Your rebate"/"Rebate" (never "VEU rebate"); Next names the electrical safety check (PIESA);
// "What's changed from your estimate" box under the price (only changed rows, hidden when nothing changed, footnote
// QUOTE_CHANGES_FOOTNOTE); a 30-day quote says "Your quote is valid for 30 days, until {date}" (14-day quotes keep
// held-until). The sender attaches the quote documents and holds the email when they aren't ready.
// Part 10 Task 5 (Jo 2–3 Nov 2026): an installer's OWN customer gets the same v4 email with the approved lines
// (own-customer-price.core `ownCustomerRows`, by `code`: Insulation · extras · Home Insulation Victoria fee · Electrical
// safety check (PIESA) · Rebate · Your price), the installer's logo beside ours (cobrand.core, OWN_CUSTOMER_COBRAND_APPROVED)
// and the VEU program box at the bottom (owner-wording.core, Fix 1). Behind OWN_CUSTOMER_QUOTE_EMAIL_APPROVED (false):
// off = exactly Part 3's v4 email. Home Insulation Victoria leads never come through that branch.
// Quote text (decision 87, B): ownerQuoteSms below — brand prefix added by the sender.
import { currentFeeWording } from "./hiv-quote.core";
import { aud } from "./workflow";
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { QUOTE_VALID_DAYS, quoteValidLine } from "./quote-expiry.core";
import { QUOTE_CHANGES_FOOTNOTE, QUOTE_CHANGES_HEADING, type QuoteChangeRow } from "./quote-changes.core";
import type { AgreementFacts } from "./customer-agreement.core";
import type { BusinessContact } from "./owner-wording.core";
import { aud as audCents, formatValidUntil, paymentSplitCents } from "./signed-acceptance.core";
import { safetyCheckShort } from "./safety-check-amount.core";
import { OWN_CUSTOMER_COBRAND_APPROVED, cobrandLogos } from "./cobrand.core";
import { ownCustomerRows } from "./own-customer-price.core";
import { VEU_BOX_TITLE, veuBoxMj, veuBoxText } from "./owner-wording.core";

/** v3 approved 24 Oct 2026; design applied under decision 137. */
export const OWNER_QUOTE_EMAIL_APPROVED = true as boolean;
export const OWNER_QUOTE_EMAIL_VERSION = "v3-approved-2026-10-24";
/** Decision #29 (Jo 2 Nov 2026): v4 wording + What's changed box + quote documents attached. Off until Jo OKs the pictures. */
export const OWNER_QUOTE_EMAIL_V4_APPROVED = false as boolean;
export const OWNER_QUOTE_EMAIL_V4_VERSION = "v4-approved-2026-11-02";
/** Part 10 Task 5: the own-customer variant (approved lines, co-brand, VEU box) of the v4 email. Off until Jo OKs the picture. */
export const OWN_CUSTOMER_QUOTE_EMAIL_APPROVED: boolean = false;
/** The v4 quote email is never sent without its documents: the sender holds it with this note instead. */
export const QUOTE_DOCUMENTS_HELD = "Quote documents not ready";
/** Jo 24 Oct 2026, decisions 89 and 134 (O19 quote reminder, day 3 + expiry): approved. Delivery still behind customer_comms_enabled. */
export const QUOTE_REMINDER_EMAIL_APPROVED = true as boolean;

export type OwnerQuoteLine = { description: string; lineTotalIncGst: number; /** quote_items.code (own customers: the rows are built from it, never from the description). */ code?: string | null };
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
  /** quote-expiry.core `quoteValidDaysFor(sent_at)`: 30 = "valid for 30 days, until" wording in the reminders; 14/absent = held-until. */
  validDays?: 14 | 30;
  /** Decision #29 v4 wording (the sender passes OWNER_QUOTE_EMAIL_V4_APPROVED; TEST always previews it). */
  v4?: boolean;
  /** quote-changes.core `quoteChangeRows` — v4 only; empty/absent = no box. */
  changes?: QuoteChangeRow[];
  /** Part 10 Task 5: set on an installer's own customer (channel installer_sourced): the installer's name and Part 5's
   *  https logo URL (null = our logo alone). Ignored unless v4 and OWN_CUSTOMER_QUOTE_EMAIL_APPROVED. */
  ownCustomer?: { installerName: string; installerLogoUrl: string | null } | null;
};
/** Test seam for the two Task 5 switches; callers never pass it (the constants decide). */
export type OwnCustomerSeam = { ownCustomerApproved?: boolean; cobrandApproved?: boolean };

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
export const INSULATION_BENEFIT = "Ceiling insulation is the best barrier against summer heat and winter cold, and can save you up to 20% on your heating and cooling costs (Sustainability Victoria). Warmer winters, cooler summers.";

const NOT_INCLUDED = "Not included: electrical upgrades, only if the electrical safety check (PIESA) finds any. Your electrician quotes these directly, and nothing is done without your OK.";
const NOT_FOR_YOU = "Not ready, or not for you? You can tell us on the same page.";
/** Rule (Jo): "Accredited Person", never "Accredited Provider" — older quote lines still carry the old fee name. */
const lineTitle = (d: string) => currentFeeWording(d);

/** Shared figures: rebate, full price, headline and the approved rebate + price boxes (MJML). */
function quoteFigures(i: OwnerQuoteEmailInput, rebateLabel = "Your VEU rebate") {
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
    ? `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">${esc(rebateLabel)}</mj-text><mj-text mj-class="big-green">You save ${esc(K.whole(rebate!))}</mj-text><mj-text mj-class="center" font-size="14px" line-height="20px" padding="0 16px 18px">Taken off upfront. Nothing for you to claim.</mj-text></mj-column></mj-section>`
    : "";
  const priceBox = `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your price</mj-text><mj-text mj-class="big-blue">${esc(total)}</mj-text><mj-text mj-class="center" font-size="14px" line-height="20px" font-weight="700">incl. GST${both ? ` · full price before rebate <span class="strike">${esc(money(full!))}</span>` : ""}</mj-text><mj-text mj-class="small center" padding="0 16px 18px">${address ? `${esc(address)}<br />` : ""}Measured at your Ready Check</mj-text></mj-column></mj-section>`;
  const box = rebateBox + priceBox;
  const boxText = [rebate ? `${rebateLabel}: you save ${K.whole(rebate)}. Taken off upfront. Nothing for you to claim.` : null, `Your price: ${total} incl. GST${both ? ` (full price before rebate ${money(full!)})` : ""}`, address, "Measured at your Ready Check"].filter((l): l is string => !!l);
  return { name, address, rebate, full, total, headline, box, boxText };
}
const mjButton = (href: string) => `<mj-button href="${esc(href)}" padding="14px 12px 14px">View and accept your quote</mj-button>`;

/** One "Your quote" row: title + grey detail on the left, amount on the right. */
function quoteRowHtml(r: K.QuoteRow, first: boolean): string {
  const bt = first ? "" : "border-top:1px solid #E4E9F5;";
  const left = `<strong${r.color ? ` style="color:${r.color};"` : ""}>${esc(r.title)}</strong>${r.detail ? `<br /><span class="muted" style="font-size:13px;line-height:19px;">${esc(r.detail)}</span>` : ""}`;
  const amount = r.bold ? `<strong>${esc(r.amount)}</strong>` : esc(r.amount);
  return `<tr><td valign="top" style="${bt}padding:${first ? "0 12px 12px 0" : "12px 12px 12px 0"};">${left}</td><td width="110" align="right" valign="top" style="${bt}padding:${first ? "0 0 12px" : "12px 0"};white-space:nowrap;min-width:110px;word-break:keep-all;overflow-wrap:normal;word-wrap:normal;${r.color ? `color:${r.color};` : ""}">${amount}</td></tr>`;
}

/** Decision #29: the Estimate vs Quote box (only changed rows), with its footnote. Empty when nothing changed. */
function changesBox(rows: QuoteChangeRow[]): { html: string; text: string[] } {
  if (!rows.length) return { html: "", text: [] };
  const cell = (v: string, align: string, extra = "") => `<td align="${align}" style="padding:8px 0 8px 8px;border-top:1px solid #E4E9F5;${extra}">${esc(v)}</td>`;
  const head = `<tr><td></td><td align="right" style="padding:0 0 6px 8px;font-size:13px;color:#5A6785;">Estimate</td><td align="right" style="padding:0 0 6px 8px;font-size:13px;color:#5A6785;">Quote</td></tr>`;
  const body = rows.map((r) => `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid #E4E9F5;"><strong>${esc(r.label)}</strong></td>${cell(r.estimate, "right", "white-space:nowrap;")}${cell(r.quote, "right", "white-space:nowrap;font-weight:700;")}</tr>`).join("");
  const html = `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">${esc(QUOTE_CHANGES_HEADING)}</mj-text><mj-table padding="0 18px 6px">${head}${body}</mj-table><mj-text mj-class="small" padding="0 18px 18px">${esc(QUOTE_CHANGES_FOOTNOTE)}</mj-text></mj-column></mj-section>`;
  return { html, text: [QUOTE_CHANGES_HEADING, ...rows.map((r) => `${r.label}: estimate ${r.estimate}, quote ${r.quote}`), QUOTE_CHANGES_FOOTNOTE, ""] };
}

/** Part 10 Task 5: the own-customer rows by `code` (never a description regex). Null = fall back to Part 3's rows (a
 *  malformed line set never guesses a label or a fee; `ownCustomerRows` throws on anything unexpected). */
function ownCustomerQuoteRows(i: OwnerQuoteEmailInput): K.QuoteRow[] | null {
  const items = i.lines.map((l) => ({ code: l.code ?? null, description: l.description, line_total_inc_gst: l.lineTotalIncGst }));
  let rows: ReturnType<typeof ownCustomerRows>;
  try { rows = ownCustomerRows(items, i.rebateIncGst ?? 0, i.totalIncGst); } catch { return null; }
  return rows.map((r) => ({
    title: r.label,
    detail: r.detail,
    amount: r.key === "rebate" ? `−${money(Math.abs(r.amountIncGst))}` : money(r.amountIncGst),
    ...(r.key === "rebate" ? { bold: true, color: "#057D40" } : r.key === "total" ? { bold: true } : {}),
  }));
}

export function renderOwnerQuoteEmail(i: OwnerQuoteEmailInput, seam: OwnCustomerSeam = {}): { subject: string; html: string; text: string } {
  const v4 = i.v4 === true;
  // Part 10 Task 5: the own-customer variant is a v4 extension; off (or no ownCustomer) = Part 3's email exactly.
  const own = v4 && !!i.ownCustomer && (seam.ownCustomerApproved ?? OWN_CUSTOMER_QUOTE_EMAIL_APPROVED) ? i.ownCustomer : null;
  const partnerLogo = own && (seam.cobrandApproved ?? OWN_CUSTOMER_COBRAND_APPROVED) ? cobrandLogos({ installerName: own.installerName, logoUrl: own.installerLogoUrl }).installer : null;
  const ownRows = own ? ownCustomerQuoteRows(i) : null;
  const f = quoteFigures(i, v4 ? "Your rebate" : "Your VEU rebate");
  const changes = v4 ? changesBox(i.changes ?? []) : { html: "", text: [] };
  const subject = f.rebate ? `${f.name ? `${f.name}, your` : "Your"} quote is ready – save ${K.whole(f.rebate)} on ceiling insulation` : `Your ceiling insulation quote is ready${f.name ? `, ${f.name}` : ""}`;
  const hi = f.name ? `Hi ${f.name}, your quote is ready.` : "Your quote is ready.";
  const area = i.areaM2 != null && i.areaM2 > 0 ? i.areaM2 : null;
  const removal = i.removalM2 != null && i.removalM2 > 0 ? i.removalM2 : null;
  const installer = cleanName(i.installerName ?? null);
  const safety = i.safetyCheckPrice != null && i.safetyCheckPrice > 0 ? money(i.safetyCheckPrice) : null;
  // Itemised rows from the quote lines, with the approved detail lines where the facts are known.
  const perM2 = (amount: number, m: number) => `${K.m2(m)} × ${money(amount / m)} per m²`;
  const rows: K.QuoteRow[] = ownRows ?? i.lines.map((l) => {
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
  if (!ownRows && f.full && f.rebate) rows.push({ title: "Full price", detail: "incl. GST", amount: money(f.full), bold: true }, { title: v4 ? "Rebate" : "VEU rebate", detail: "Taken off upfront, nothing to claim", amount: `−${money(f.rebate)}`, bold: true, color: "#057D40" });
  const next = `<strong>Next:</strong> accept and pay ${safety ? `${esc(safety)} ` : ""}→ ${v4 ? "electrical safety check (PIESA)" : "electrician safety check"} → book your install day.`;
  const validity = !i.validUntil ? null : v4 && i.validDays === 30 ? quoteValidLine(i.validUntil) : `Your price is held until ${formatQuoteValidUntil(i.validUntil)}.`;
  // Jo 26 Oct: no HIV phone number and no "call us" in owner emails — owners reply by email only.
  const questions = "Questions? Just reply to this email.";
  const closing = [validity, NOT_FOR_YOU, questions].filter(Boolean).join(" ");
  const youPay = `<tr><td valign="middle" style="border-top:2px solid #22376B;padding:12px 12px 12px 0;font-size:18px;"><strong>You pay</strong></td><td width="110" align="right" valign="middle" style="border-top:2px solid #22376B;padding:12px 0;white-space:nowrap;min-width:110px;word-break:keep-all;overflow-wrap:normal;word-wrap:normal;font-size:18px;color:#3C51C4;"><strong>${esc(f.total)}</strong></td></tr>`;
  // Own customers (approved rows): "Your price" is the last approved row, so the "You pay" row is not repeated.
  const quote = rows.length
    ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Your quote</mj-text><mj-table padding="0 18px 6px">${rows.map((r, n) => quoteRowHtml(r, n === 0)).join("")}${ownRows ? "" : youPay}</mj-table><mj-text mj-class="small" padding="0 18px 18px">${esc(NOT_INCLUDED)}</mj-text></mj-column></mj-section>`
    : `<mj-section><mj-column><mj-text mj-class="small" padding="0 12px 0">${esc(NOT_INCLUDED)}</mj-text></mj-column></mj-section>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(f.headline)}</mj-text></mj-column></mj-section>`,
    f.box,
    changes.html,
    `<mj-section><mj-column>${mjButton(i.quoteUrl)}</mj-column></mj-section>`,
    quote,
    `<mj-section><mj-column><mj-text padding="18px 12px 14px">${next}</mj-text><mj-text mj-class="small" padding="0 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
    // Part 10 Task 5 / VEU Fix 1: the program box at the bottom of an own customer's first email.
    own ? veuBoxMj() : "",
  ].join("");
  const preview = [`You pay ${f.total}${f.rebate ? " after the rebate" : ""}.`, validity].filter(Boolean).join(" ");
  const html = mjEmail({ subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true, ...(partnerLogo ? { partnerLogo } : {}) });
  const veu = own ? ["", `${VEU_BOX_TITLE} — ${veuBoxText()[1]}`, veuBoxText()[2]!] : [];
  const text = K.plainText([
    hi, "", f.headline, "", ...f.boxText, "", ...changes.text, `View and accept your quote: ${i.quoteUrl}`, "",
    ...(rows.length ? ["YOUR QUOTE", ...rows.map((r) => `${r.title}${r.detail ? ` (${r.detail})` : ""}: ${r.amount}`), ...(ownRows ? [] : [`You pay: ${f.total}`]), ""] : []),
    NOT_INCLUDED, "", K.stripTags(next), "", closing, ...veu,
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

/** Customer Agreement v1.3 facts for the quote email's documents (decision #33), from the quote email facts and the
 *  installer's OFFICE contact. null when any fact is missing (the sender then holds the email — never a blank or a worker's number). */
export function quoteAgreementFacts(p: { input: OwnerQuoteEmailInput | Omit<OwnerQuoteEmailInput, "unsubscribeUrl" | "test">; ownerName: string | null; jobNumber: string | null; installer: BusinessContact | null; safetyCents: number }): AgreementFacts | null {
  const i = p.input;
  const owner = cleanName(p.ownerName), address = cleanName(i.address), job = cleanName(p.jobNumber), product = cleanName(i.product ?? null);
  const inst = p.installer, phone = cleanName(inst?.officePhone ?? null), email = cleanName(inst?.email ?? null);
  const area = i.areaM2 != null && Number.isFinite(i.areaM2) && i.areaM2 > 0 ? i.areaM2 : null;
  if (!owner || !address || !job || !product || !inst || !phone || !email || area == null || !i.validUntil) return null;
  if (!Number.isFinite(i.totalIncGst) || i.totalIncGst < 0 || !(p.safetyCents > 0)) return null;
  const rebate = i.rebateIncGst != null && Number.isFinite(i.rebateIncGst) && i.rebateIncGst > 0 ? i.rebateIncGst : 0;
  const before = i.subtotalIncGst != null && Number.isFinite(i.subtotalIncGst) && i.subtotalIncGst > 0 ? i.subtotalIncGst : i.totalIncGst + rebate;
  const split = paymentSplitCents(Math.round(i.totalIncGst * 100), p.safetyCents);
  return {
    owner_name: owner, address, job_number: job,
    installer_name: (inst.tradingName ?? inst.name).replace(/^\[TEST PARTNER\]\s*/, ""), installer_phone: phone, installer_email: email,
    product, area_m2: String(Math.round(area * 10) / 10),
    price_before_rebate: audCents(before), rebate: audCents(rebate), your_price: audCents(i.totalIncGst),
    valid_until: formatValidUntil(i.validUntil),
    safety_check: safetyCheckShort(split.safety), deposit: audCents(split.deposit / 100), rest: audCents(split.rest / 100),
  };
}

export type QuoteReminderKind = "day3" | "expiry";
/** Decisions 88/89/134: a short reminder 3 days after the quote is sent, and again 2 days before the price expires. */
export function renderQuoteReminderEmail(i: OwnerQuoteEmailInput & { kind: QuoteReminderKind }): { subject: string; html: string; text: string } {
  const f = quoteFigures(i, "Your rebate");
  const first = f.name ?? "there";
  const held = i.validUntil ? formatQuoteValidUntilShort(i.validUntil) : null;
  const thirty = i.validDays === 30 && i.validUntil ? i.validUntil : null;
  const subject = i.kind === "expiry" && held ? `${first}, your quote price is held until ${held}` : `${first}, your quote is waiting`;
  const headline = `${first}, your quote is waiting`;
  const off = f.rebate ? ` with ${esc(K.whole(f.rebate))} off` : "";
  // The main line (also the inbox preview), then "Just checking you saw it." (day 3) and the questions line.
  const coreHtml = thirty
    ? i.kind === "expiry"
      ? `Your quote is valid for ${QUOTE_VALID_DAYS} days, until <strong>${esc(formatQuoteValidUntil(thirty))}</strong>. Accept by then to keep your price${off}.`
      : `${f.rebate ? `Your ${esc(K.whole(f.rebate))} rebate is ready to go. ` : ""}${esc(quoteValidLine(thirty))}`
    : i.kind === "expiry"
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
