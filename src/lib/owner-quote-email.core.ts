// Owner "your quote is ready" email + text. PURE: no I/O.
// Wording from docs/OWNER_QUOTE_MESSAGES_DRAFT.md (draft, 24 Oct 2026). NOT approved by Jo yet:
// real owners never receive this until OWNER_QUOTE_EMAIL_APPROVED is true (TEST jobs may).
// v2 (Jo 24 Oct "it doesn't sell"): own branded layout; reuses the campaign `campaignButton` unchanged.
import { campaignButton, escape } from "./estimate-email";
import { aud } from "./workflow";

/** Jo approved v2 on 24 Oct 2026 ("really happy with the layout and wording"; no phone; 14 days; replies to
 *  info@homeinsulationvictoria.com.au). Office Send still needs every delivery guard, incl. customer_comms_enabled. */
export const OWNER_QUOTE_EMAIL_APPROVED = true as boolean;
export const OWNER_QUOTE_EMAIL_VERSION = "v2-approved-2026-10-24";

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

/** Brand colours (portal tokens). */
const NAVY = "#22376B", BLUE = "#3C51C4", GREEN = "#07BF61", MIST = "#F2F4FC", LINE = "#E4E9F5", SUB = "#5A6785";
const TICK = `<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:${GREEN};color:#fff;font-size:13px;font-weight:bold;text-align:center;">&#10003;</span>`;
const fmtM2 = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} m²`;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** Jo 24 Oct: v2 — leads with the saving and the price after the rebate, says exactly what they get (product, m²,
 *  removal, EEC-certified installer, licensed electrician), explains who we are, and never mentions the signing code. */
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
  const rebate = i.rebateIncGst != null && Number.isFinite(i.rebateIncGst) && i.rebateIncGst > 0 ? i.rebateIncGst : null;
  const full = i.subtotalIncGst != null && Number.isFinite(i.subtotalIncGst) && i.subtotalIncGst > 0 ? i.subtotalIncGst : rebate ? i.totalIncGst + rebate : null;
  const total = money(i.totalIncGst);
  const headline = rebate ? `You could save ${whole(rebate)} on ceiling insulation` : "Your ceiling insulation quote is ready";
  const subject = rebate ? `${name ? `${name}, your` : "Your"} quote is ready – save ${whole(rebate)} on ceiling insulation` : `Your ceiling insulation quote is ready${name ? `, ${name}` : ""}`;
  const area = i.areaM2 != null && i.areaM2 > 0 ? i.areaM2 : null;
  const removal = i.removalM2 != null && i.removalM2 > 0 ? i.removalM2 : null;
  const installer = cleanName(i.installerName ?? null);
  const gets = [
    `${cleanName(i.product ?? null) ?? "Ceiling insulation"} supplied and installed${area ? ` – ${fmtM2(area)}` : ""}`,
    ...(removal ? [`Your old insulation removed and taken away – ${fmtM2(removal)}`] : []),
    ...(i.installerCertified ? [`Installed by ${installer ? `${installer}, ` : ""}an EEC-certified installer we have checked and approved`] : []),
    "Electrical safety check (PIESA) by a licensed electrician, required before any ceiling insulation goes in",
    "We look after the program compliance, the paperwork and your rebate – nothing for you to claim",
  ];
  const safety = i.safetyCheckPrice != null && i.safetyCheckPrice > 0 ? money(i.safetyCheckPrice) : null;
  const steps = [
    "Accept your quote online – it takes about 2 minutes.",
    `Pay the ${safety ? `${safety} ` : ""}electrical safety check. We send the invoice once you accept.`,
    "A licensed electrician checks your ceiling wiring is safe, at a time you choose.",
    "Your installation is booked within 30 days of the safety check.",
    // Jo 24 Oct: the installation payment terms are being worked out (deposit rules) — no balance line until decided.
  ];
  const validity = i.validUntil ? `Your price is held until ${formatQuoteValidUntil(i.validUntil)}.` : null;
  const phone = cleanName(i.officePhone);
  const questions = phone ? `Questions? Reply to this email or call us on ${phone}.` : "Questions? Just reply to this email.";
  const button = "View and accept your quote";
  const about = "Home Insulation Victoria is an Accredited Person under the Victorian Government's Victorian Energy Upgrades (VEU) program. We take your rebate straight off the price, organise the licensed electrician, check the installer's work and handle all the paperwork. Lower bills for years.";
  const legal = "Home Insulation Victoria · DC Construction Solutions Pty Ltd · ABN 44 671 613 979 · VEU Accredited Person A003654";
  const lines = i.lines.filter((l) => l.description?.trim() && Number.isFinite(l.lineTotalIncGst));

  const btn = `<div style="margin:18px 0 6px;">${campaignButton(i.quoteUrl, button, 470)}</div>`;
  const row = (l: string, r: string, style = "") => `<tr><td style="padding:7px 0;font-size:14px;line-height:1.4;color:${NAVY};${style}">${l}</td><td align="right" style="padding:7px 0 7px 12px;font-size:14px;white-space:nowrap;color:${NAVY};${style}">${r}</td></tr>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${NAVY};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(`Your price ${total}${rebate ? ` after a ${whole(rebate)} government rebate` : ""}.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" style="max-width:540px;background:#FBFCFA;border:1px solid ${LINE};border-radius:22px;" cellpadding="0" cellspacing="0"><tr><td style="padding:26px 22px;">
<div style="font-size:13px;font-weight:bold;color:${BLUE};">Home Insulation Victoria</div>
${i.test === true ? `<div style="display:inline-block;margin-top:6px;background:#FDF2F6;color:${NAVY};font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</div>` : ""}
<p style="font-size:15px;margin:16px 0 4px;">${escape(name ? `Hi ${name}, your quote is ready.` : "Your quote is ready.")}</p>
<h1 style="font-size:26px;line-height:1.2;margin:4px 0 16px;color:${NAVY};">${escape(headline)}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MIST};border-radius:16px;"><tr><td style="padding:18px 18px 16px;">
<div style="font-size:13px;color:${SUB};">Your price${address ? ` for ${escape(address)}` : ""}</div>
<div style="font-size:34px;font-weight:bold;color:${GREEN};margin:4px 0 2px;">${escape(total)}</div>
<div style="font-size:13px;color:${SUB};">including GST${rebate ? ", after the government rebate" : ""}</div>
${rebate && full ? `<div style="font-size:14px;margin-top:10px;color:${NAVY};">Full price <span style="text-decoration:line-through;">${escape(money(full))}</span> &nbsp;·&nbsp; <strong>VEU rebate −${escape(money(rebate))}</strong></div><div style="font-size:13px;color:${SUB};margin-top:4px;">Taken off upfront – nothing for you to claim.</div>` : ""}
</td></tr></table>
${btn}
<p style="font-size:17px;font-weight:bold;margin:22px 0 10px;">What you're getting</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${gets.map((g) => `<tr><td valign="top" style="padding:0 10px 10px 0;width:22px;">${TICK}</td><td style="padding:0 0 10px;font-size:15px;line-height:1.45;">${escape(g)}</td></tr>`).join("")}</table>
${lines.length ? `<p style="font-size:17px;font-weight:bold;margin:18px 0 6px;">Your price in full</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">${lines.map((l) => row(escape(l.description.trim()), escape(l.lineTotalIncGst < 0 ? `−${money(-l.lineTotalIncGst)}` : money(l.lineTotalIncGst)), `border-bottom:1px solid ${LINE};`)).join("")}${rebate ? row("Government VEU rebate", `−${escape(money(rebate))}`, `border-bottom:1px solid ${LINE};`) : ""}${row("<strong>You pay (inc GST)</strong>", `<strong>${escape(total)}</strong>`, "font-size:15px;")}</table>` : ""}
<p style="font-size:17px;font-weight:bold;margin:22px 0 10px;">What happens next</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps.map((t, n) => `<tr><td valign="top" style="padding:0 10px 10px 0;width:24px;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${BLUE};color:#fff;font-size:12px;font-weight:bold;text-align:center;">${n + 1}</span></td><td style="padding:1px 0 10px;font-size:15px;line-height:1.45;">${escape(t)}</td></tr>`).join("")}</table>
${btn}
<p style="font-size:14px;line-height:1.5;margin:10px 0 0;color:${SUB};">${escape([validity, questions].filter(Boolean).join(" "))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${LINE};"><tr><td style="padding-top:14px;">
<p style="font-size:14px;font-weight:bold;margin:0 0 6px;">Who we are</p>
<p style="font-size:14px;line-height:1.5;margin:0;color:${NAVY};">${escape(about)}</p>
</td></tr></table>
<p style="font-size:11px;line-height:1.5;margin:18px 0 0;color:${SUB};">${escape(legal)}${i.unsubscribeUrl ? ` · <a href="${escape(i.unsubscribeUrl)}" style="color:${BLUE};text-decoration:underline;">Unsubscribe</a>` : ""}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    name ? `Hi ${name}, your quote is ready.` : "Your quote is ready.",
    "",
    headline,
    "",
    `Your price${address ? ` for ${address}` : ""}: ${total} including GST${rebate ? ", after the government rebate" : ""}.`,
    ...(rebate && full ? [`Full price ${money(full)} · VEU rebate −${money(rebate)}. Taken off upfront – nothing for you to claim.`] : []),
    "",
    `${button}: ${i.quoteUrl}`,
    "",
    "What you're getting",
    ...gets.map((g) => `- ${g}`),
    ...(lines.length ? ["", "Your price in full", ...lines.map((l) => `- ${l.description.trim()}: ${l.lineTotalIncGst < 0 ? `−${money(-l.lineTotalIncGst)}` : money(l.lineTotalIncGst)}`), ...(rebate ? [`- Government VEU rebate: −${money(rebate)}`] : []), `You pay (inc GST): ${total}`] : []),
    "",
    "What happens next",
    ...steps.map((t, n) => `${n + 1}. ${t}`),
    "",
    [validity, questions].filter(Boolean).join(" "),
    "",
    "Who we are",
    about,
    "",
    legal,
    ...(i.unsubscribeUrl ? [`Unsubscribe: ${i.unsubscribeUrl}`] : []),
    ...(i.test === true ? ["", "TEST — only sent to Jo."] : []),
  ].join("\n");
  return { subject, html, text };
}

/** SMS draft wording (docs/OWNER_QUOTE_MESSAGES_DRAFT.md). Not approved for real sends. */
export function ownerQuoteSms(firstName: string | null, totalText: string, link: string): string {
  const name = cleanName(firstName);
  return `Hi ${name ?? "there"}, your Home Insulation Victoria ceiling insulation quote is ready: ${totalText} after the VEU rebate. View and accept here: ${link}. Reply STOP to opt out.`;
}
