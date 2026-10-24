// Owner "your quote is ready" email + text, and the quote reminder emails. PURE: no I/O.
// Quote email design APPROVED by Jo 24 Oct 2026 (decision 86): docs/templates/approved/O18-quote-ready.html — "Hi {Name},
// your quote is ready." / "You save {rebate} on ceiling insulation"; price box (green rebate, big price, full price
// crossed out, address, "Measured at your Ready Check"); View and accept; itemised "Your quote"; not included; one-line
// Next; held-until line. Subject, SMS and every delivery guard are unchanged (OWNER_QUOTE_EMAIL_APPROVED, customer_comms_enabled).
// Reminder emails (decisions 88/89/134, O19-quote-reminder.html): price box + button with a reminder line, no breakdown.
// They have no live sender yet (the quote-expiry sweep only queues outbox actions): QUOTE_REMINDER_EMAIL_APPROVED stays false.
import { aud } from "./workflow";
import * as K from "./email-kit.core";

/** v3 approved 24 Oct 2026; design applied under decision 137. */
export const OWNER_QUOTE_EMAIL_APPROVED = true as boolean;
export const OWNER_QUOTE_EMAIL_VERSION = "v3-approved-2026-10-24";
export const QUOTE_REMINDER_EMAIL_APPROVED = false as boolean;

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

const NOT_INCLUDED = "Not included: electrical fixes, only if the safety check finds any. Quoted separately, nothing done without your OK.";
const NOT_FOR_YOU = "Not ready, or not for you? You can let us know on the same page.";

/** Shared figures: rebate, full price, headline and the approved price box. */
function quoteFigures(i: OwnerQuoteEmailInput) {
  if (!Number.isFinite(i.totalIncGst) || i.totalIncGst < 0) throw new Error("Quote total is unavailable.");
  if (!/^https:\/\//.test(i.quoteUrl)) throw new Error("Owner quote link is unavailable.");
  const name = cleanName(i.firstName);
  const address = cleanName(i.address);
  const rebate = i.rebateIncGst != null && Number.isFinite(i.rebateIncGst) && i.rebateIncGst > 0 ? i.rebateIncGst : null;
  const full = i.subtotalIncGst != null && Number.isFinite(i.subtotalIncGst) && i.subtotalIncGst > 0 ? i.subtotalIncGst : rebate ? i.totalIncGst + rebate : null;
  const total = money(i.totalIncGst);
  const headline = rebate ? `You save ${K.whole(rebate)} on ceiling insulation` : "Your ceiling insulation quote is ready";
  const basisHtml = `${address ? `${K.esc(address)}<br>` : ""}Measured at your Ready Check`;
  const box = rebate && full
    ? K.priceBox({ rebateLabel: "Your VEU rebate", rebate, rebateNote: "Taken off upfront. Nothing for you to claim.", priceLabel: "Your price", price: total, fullPrice: money(full), basisHtml })
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.KIT.MIST};border-radius:18px;"><tr><td align="center" style="padding:18px 16px;"><div style="font-size:11px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase;color:${K.KIT.NAVY};">Your price</div><div style="font-size:42px;font-weight:bold;color:${K.KIT.BLUE};margin-top:4px;">${K.esc(total)}</div><div style="font-size:13px;font-weight:bold;color:${K.KIT.NAVY};margin-top:2px;">incl. GST</div><div style="font-size:13px;color:${K.KIT.SUB};margin-top:12px;line-height:1.5;padding-top:12px;border-top:1px solid ${K.KIT.LINE};">${basisHtml}</div></td></tr></table>`;
  const boxText = [rebate ? `Your VEU rebate: you save ${K.whole(rebate)}. Taken off upfront. Nothing for you to claim.` : null, `Your price: ${total} incl. GST${full && rebate ? ` (full price before rebate ${money(full)})` : ""}`, address, "Measured at your Ready Check"].filter((l): l is string => !!l);
  return { name, address, rebate, full, total, headline, box, boxText };
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
    return { title: d, detail, amount: money(l.lineTotalIncGst) };
  });
  if (f.full && f.rebate) rows.push({ title: "Full price", detail: "incl. GST", amount: money(f.full), bold: true }, { title: "VEU rebate", detail: "Taken off upfront, nothing to claim", amount: `−${money(f.rebate)}`, bold: true, color: K.KIT.GREEN });
  const next = `<strong>Next:</strong> accept and pay ${safety ? `${K.esc(safety)} ` : ""}→ electrician safety check → book your install day.`;
  const validity = i.validUntil ? `Your price is held until ${formatQuoteValidUntil(i.validUntil)}.` : null;
  const phone = cleanName(i.officePhone);
  const questions = phone ? `Questions? Reply to this email or call us on ${phone}.` : "Questions? Just reply to this email.";
  const closing = [validity, NOT_FOR_YOU, questions].filter(Boolean).join(" ");
  const body = [
    K.greeting(hi),
    K.h1(f.headline, 16, 0),
    f.box,
    K.button(i.quoteUrl, "View and accept your quote"),
    rows.length ? K.quoteTable({ title: "Your quote", rows, totalLabel: "You pay", total: f.total, footnote: NOT_INCLUDED }) : K.small(NOT_INCLUDED, "16px 0 0"),
    K.note(next, "16px 0 0", true),
    K.small(closing),
  ].join("\n");
  const html = K.emailShell({ body, previewText: `Your price ${f.total}${f.rebate ? ` after a ${K.whole(f.rebate)} government rebate` : ""}.`, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
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
  const introHtml = i.kind === "expiry"
    ? `${held ? `Your price is held until <strong>${K.esc(held)}</strong>. Accept by then to keep your price${f.rebate ? ` with ${K.esc(K.whole(f.rebate))} off` : ""}.` : `Your price won't be held much longer. Accept soon to keep your price${f.rebate ? ` with ${K.esc(K.whole(f.rebate))} off` : ""}.`} Any questions, reply to this email and we'll help.`
    : `Just checking you saw it.${f.rebate ? ` Your ${K.esc(K.whole(f.rebate))} rebate is ready to go,` : ""}${held ? ` ${f.rebate ? "and your" : "Your"} price is held until <strong>${K.esc(held)}</strong>.` : ""} Any questions, reply to this email and we'll help.`;
  const body = [K.h1(headline, 8), K.p(introHtml, "0 0 16px", true), f.box, K.button(i.quoteUrl, "View and accept your quote"), K.small(NOT_FOR_YOU)].join("\n");
  const html = K.emailShell({ body, previewText: K.stripTags(introHtml), unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([headline, "", K.stripTags(introHtml), "", ...f.boxText, "", `View and accept your quote: ${i.quoteUrl}`, "", NOT_FOR_YOU], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

/** SMS draft wording (docs/OWNER_QUOTE_MESSAGES_DRAFT.md). Not approved for real sends. */
export function ownerQuoteSms(firstName: string | null, totalText: string, link: string): string {
  const name = cleanName(firstName);
  return `Hi ${name ?? "there"}, your Home Insulation Victoria ceiling insulation quote is ready: ${totalText} after the VEU rebate. View and accept here: ${link}. Reply STOP to opt out.`;
}
