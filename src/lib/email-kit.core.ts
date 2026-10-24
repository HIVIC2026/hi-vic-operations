// Shared email kit for the approved designs in docs/templates/approved/*.html (Jo, 24 Oct 2026, decisions 66–137).
// PURE: strings only. Every owner/installer email renderer builds its HTML from these pieces so the real emails match
// the approved files (390px, email-safe tables + inline styles, no flex, logo as the bundled PNG data URI, the shared
// campaign button). Wording lives in each renderer; this file holds presentation only.
import { campaignButton } from "./estimate-email";
import { LOGO_PNG } from "./email-hero-assets";
import { UNSUBSCRIBE_LINK_SLOT } from "./emailsafety.core";

export const KIT = {
  NAVY: "#22376B", BLUE: "#3C51C4", GREEN: "#07BF61", MIST: "#F2F4FC", LINE: "#E4E9F5", SUB: "#5A6785",
  MINT: "#E9FBF1", CARD: "#FBFCFA", WHITE: "#FFFFFF", AMBER_BG: "#FFF7EA", AMBER_LINE: "#F3D9A8", PLUS_BG: "#FFF1DB", PLUS_FG: "#B26A00",
  RED_BG: "#FDECEA", RED_LINE: "#F4C7C2", RED: "#B42318", STAR: "#F2A900", MINT_LINE: "#BFEBD2",
} as const;

export const AP_NUMBER = "A003654";
export const ENTITY_LINE = "DC Construction Solutions Pty Ltd";
export const ABN_LINE = "ABN 44 671 613 979";
export const FOOTER_TEXT = `Home Insulation Victoria · VEU Accredited Person ${AP_NUMBER} · ${ENTITY_LINE} · ${ABN_LINE}`;
export const LOGO_DATA_URI = `data:image/png;base64,${LOGO_PNG}`;

/** A file sent with an email (Resend `attachments`): base64 content, a filename the owner will see, and its media type. */
export type EmailAttachment = { filename: string; content: string; contentType: string };

/** Escapes text for HTML. Apostrophes stay literal, as in the approved files. */
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "$1,610" (whole dollars) and "$2,200.00" (cents) in en-AU. */
export const whole = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
export const cents = (n: number) => `$${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const m2 = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} m²`;
/** Trimmed first name, or null. */
export const cleanName = (s: string | null | undefined) => s?.trim().replace(/\s+/g, " ").split(" ")[0] || null;

const TICK = `<span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;background:${KIT.GREEN};color:#fff;font-size:12px;font-weight:bold;text-align:center;">&#10003;</span>`;
const PLUS = `<span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;background:${KIT.PLUS_BG};color:${KIT.PLUS_FG};font-size:13px;font-weight:bold;text-align:center;">+</span>`;
const CAPS = `font-size:11px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase;color:${KIT.NAVY};`;
const TABLE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"`;

export type ShellInput = {
  /** Inner HTML, built from the pieces below. */
  body: string;
  /** Hidden preview text (optional). */
  previewText?: string | null;
  /** Unsubscribe link: a URL, the secure slot (`withUnsubscribe` fills it), or null for no link (installer emails). */
  unsubscribe?: string | "slot" | null;
  /** "TEST — only sent to Jo" pill under the logo. */
  testLabel?: boolean;
};

/** The approved card: white page, 540px card on #FBFCFA with the logo, the body and the AP/ABN footer. */
export function emailShell(i: ShellInput): string {
  const unsub = i.unsubscribe === "slot" ? ` · ${UNSUBSCRIBE_LINK_SLOT}` : i.unsubscribe ? ` · <a href="${esc(i.unsubscribe)}" style="color:${KIT.BLUE};">Unsubscribe</a>` : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${KIT.NAVY};">
${i.previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(i.previewText)}</div>\n` : ""}${TABLE}><tr><td align="center" style="padding:20px 10px;">
${TABLE} style="max-width:540px;background:${KIT.CARD};border:1px solid ${KIT.LINE};border-radius:22px;"><tr><td style="padding:26px 22px;">
<img src="${LOGO_DATA_URI}" width="116" alt="Home Insulation Victoria" style="display:block;">
${i.testLabel ? `<div style="display:inline-block;margin-top:10px;background:#FDF2F6;color:${KIT.NAVY};font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</div>\n` : ""}${i.body}
<p style="font-size:11px;line-height:1.5;margin:22px 0 0;color:${KIT.SUB};">${esc(FOOTER_TEXT)}${unsub}</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Headline. `bottom` = margin below (8/10/6 in the approved files). */
export const h1 = (text: string, bottom = 10, top = 20) => `<h1 style="font-size:25px;line-height:1.2;margin:${top}px 0 ${bottom}px;color:${KIT.NAVY};">${esc(text)}</h1>`;
/** "Hi Helen, your quote is ready." line above the quote headline. */
export const greeting = (text: string) => `<p style="font-size:15px;margin:20px 0 4px;color:${KIT.NAVY};">${esc(text)}</p>`;
/** Body paragraph; `html` = already-escaped markup (for <strong>). */
export const p = (text: string, margin = "0 0 16px", html = false) => `<p style="font-size:15px;line-height:1.55;margin:${margin};">${html ? text : esc(text)}</p>`;
/** Bold 16px section title. */
export const sectionTitle = (text: string, margin = "24px 0 8px") => `<p style="font-size:16px;font-weight:bold;margin:${margin};">${esc(text)}</p>`;
/** Green 17px line under a headline ("Your $1,610 rebate is waiting."). */
export const greenLead = (text: string) => `<p style="font-size:17px;font-weight:bold;color:${KIT.GREEN};margin:0 0 14px;">${esc(text)}</p>`;
/** Grey 13px note (small print / "Questions? Just reply"); `size: 14` is the grey 14px line under a button (O61/O62). */
export const small = (text: string, margin = "14px 0 0", opts: { center?: boolean; html?: boolean; size?: 13 | 14 } = {}) => `<p style="font-size:${opts.size ?? 13}px;line-height:1.5;margin:${margin};color:${KIT.SUB};${opts.center ? "text-align:center;" : ""}">${opts.html ? text : esc(text)}</p>`;
/** 14px navy paragraph (e.g. "Next: accept and pay…"); `html` for <strong>. */
export const note = (text: string, margin = "16px 0 0", html = false) => `<p style="font-size:14px;line-height:1.55;margin:${margin};color:${KIT.NAVY};">${html ? text : esc(text)}</p>`;
export const strong = (text: string) => `<strong>${esc(text)}</strong>`;
export const link = (href: string, text: string) => `<a href="${esc(href)}" style="color:${KIT.BLUE};font-weight:bold;">${esc(text)}</a>`;
export const spacer = (px = 8) => `<div style="height:${px}px"></div>`;

/** The one approved green button (campaignButton, VML fallback), full width. */
export const button = (href: string, label: string, margin = "16px 0 4px") => `<div style="margin:${margin};">${campaignButton(href, label, 470)}</div>`;

export type PriceBoxInput = {
  rebateLabel: string; rebate: number;
  /** Line under the rebate figure (quote emails: "Taken off upfront. Nothing for you to claim."). */
  rebateNote?: string | null;
  priceLabel: string; price: string; fullPrice: string;
  /** Lines under the price (escaped HTML allowed via `basisHtml`). */
  basis?: string | null; basisHtml?: string | null;
  calculator?: { href: string; label: string } | null;
};
/** Mist box: green rebate pill, big blue price, struck-through full price, basis line + calculator link. */
export function priceBox(i: PriceBoxInput): string {
  const basis = i.basisHtml ?? (i.basis ? esc(i.basis) : "");
  const calc = i.calculator ? `${basis ? "<br>" : ""}${link(i.calculator.href, i.calculator.label)}` : "";
  return `${TABLE} style="background:${KIT.MIST};border-radius:18px;"><tr><td style="padding:18px 16px;">
${TABLE} style="background:${KIT.MINT};border:2px solid ${KIT.GREEN};border-radius:14px;"><tr><td align="center" style="padding:16px 10px;"><div style="${CAPS}">${esc(i.rebateLabel)}</div><div style="font-size:32px;font-weight:bold;color:${KIT.GREEN};margin-top:4px;">You save ${esc(whole(i.rebate))}</div>${i.rebateNote ? `<div style="font-size:13px;color:${KIT.NAVY};margin-top:2px;">${esc(i.rebateNote)}</div>` : ""}</td></tr></table>
<div style="text-align:center;padding:18px 0 4px;"><div style="${CAPS}">${esc(i.priceLabel)}</div><div style="font-size:42px;font-weight:bold;color:${KIT.BLUE};margin-top:4px;">${esc(i.price)}</div><div style="font-size:13px;font-weight:bold;color:${KIT.NAVY};margin-top:2px;">incl. GST · full price before rebate <span style="text-decoration:line-through;">${esc(i.fullPrice)}</span></div>
${basis || calc ? `<div style="font-size:13px;color:${KIT.SUB};margin-top:12px;line-height:1.5;padding-top:12px;border-top:1px solid ${KIT.LINE};">${basis}${calc}</div>` : ""}</div>
</td></tr></table>`;
}

/** Two-figure mist box: VEU rebate / You pay about, with a note row. */
export function twoFigureBox(i: { rebate: number; price: number; note: string; margin?: string }): string {
  return `${TABLE} style="background:${KIT.MIST};border-radius:16px;${i.margin ? `margin-top:${i.margin};` : ""}"><tr>
<td width="50%" align="center" style="padding:16px 8px;border-right:1px solid ${KIT.LINE};"><div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${KIT.NAVY};">VEU rebate</div><div style="font-size:26px;font-weight:bold;color:${KIT.GREEN};margin-top:4px;">${esc(whole(i.rebate))}</div></td>
<td width="50%" align="center" style="padding:16px 8px;"><div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${KIT.NAVY};">You pay about</div><div style="font-size:26px;font-weight:bold;color:${KIT.BLUE};margin-top:4px;">${esc(whole(i.price))}</div></td>
</tr>
<tr><td colspan="2" align="center" style="padding:0 12px 14px;font-size:12px;color:${KIT.SUB};">${esc(i.note)}</td></tr></table>`;
}

export type TickItem = { title: string; detail?: string | null } | string;
const tickRow = (item: TickItem, pad: string, size: number) => {
  const inner = typeof item === "string" ? item : `<strong>${esc(item.title)}</strong>${item.detail ? `<br><span style="color:${KIT.SUB}">${esc(item.detail)}</span>` : ""}`;
  return `<tr><td valign="top" style="padding:1px 10px ${pad} 0;width:20px;">${TICK}</td><td style="padding:0 0 ${pad};font-size:${size}px;line-height:1.45;color:${KIT.NAVY};">${inner}</td></tr>`;
};
/** White bordered card with a bold title and ✓ rows (title + grey detail). */
export function includedCard(title: string, items: TickItem[], marginTop = 14): string {
  return `${TABLE} style="margin-top:${marginTop}px;border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:14px 16px 8px;"><div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};margin:0 0 10px;">${esc(title)}</div>${TABLE}>${items.map((it) => tickRow(it, "7px", 14)).join("\n")}</table></td></tr></table>`;
}
/** White bordered card with + rows. Items are escaped HTML fragments (`<strong>` allowed). */
export function notIncludedCard(title: string, itemsHtml: string[]): string {
  return `${TABLE} style="margin-top:14px;border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:14px 16px 8px;"><div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};margin:0 0 10px;">${esc(title)}</div>${TABLE}>${itemsHtml.map((h) => `<tr><td valign="top" style="padding:1px 10px 7px 0;width:20px;">${PLUS}</td><td style="padding:0 0 7px;font-size:14px;line-height:1.45;color:${KIT.NAVY};">${h}</td></tr>`).join("\n")}</table></td></tr></table>`;
}
/** Plain ✓ list (15px) used for "Before they arrive", "On the day", "What happens now". Items are escaped HTML. */
export function checkList(itemsHtml: string[], size = 15, pad = "10px"): string {
  return `${TABLE}>\n${itemsHtml.map((h) => `<tr><td valign="top" style="padding:1px 10px ${pad} 0;width:20px;">${TICK}</td><td style="padding:0 0 ${pad};font-size:${size}px;line-height:1.5;color:${KIT.NAVY};">${h}</td></tr>`).join("\n")}\n</table>`;
}

/** "Your existing insulation" card (O2): may stay $0 · removal $15/m² up to X. */
export function existingInsulationCard(i: { areaM2: number; ratePerM2: number; upTo: number }): string {
  const row = (icon: string, title: string, detail: string, amount: string, color: string, top: boolean) => {
    const bt = top ? `border-top:1px solid ${KIT.LINE};` : "";
    return `<tr><td valign="top" style="padding:12px 10px 12px 0;width:20px;${bt}">${icon}</td><td valign="top" style="padding:12px 0;${bt}"><div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};">${esc(title)}</div><div style="font-size:13px;color:${KIT.SUB};line-height:1.45;margin-top:2px;">${detail}</div></td><td valign="top" align="right" style="padding:12px 0 12px 10px;white-space:nowrap;${bt}"><div style="font-size:17px;font-weight:bold;color:${color};">${esc(amount)}</div></td></tr>`;
  };
  return `${TABLE} style="margin-top:18px;border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:16px 16px 6px;">
<div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};">Your existing insulation</div>
<div style="font-size:14px;color:${KIT.NAVY};line-height:1.5;margin-top:4px;">Good news: <strong>it may be able to stay.</strong></div>
${TABLE} style="margin-top:4px;">
${row(TICK, "If it can stay", "New batts go straight over the top", "$0", KIT.GREEN, false)}
${row(PLUS, "If some needs removing", `Only the areas that need it.<br>Up to ${esc(whole(i.upTo))} for your ${esc(m2(i.areaM2))} ceiling.`, `$${i.ratePerM2}/m²`, KIT.BLUE, true)}
</table>
<div style="font-size:13px;color:${KIT.SUB};line-height:1.5;padding:10px 0 10px;border-top:1px solid ${KIT.LINE};">Prices incl. GST. The installer checks this at your free Ready Check, and you'll know the exact cost before you agree to anything.</div>
</td></tr></table>`;
}

export type Step = { title: string; detail?: string | null };
/** Numbered steps (blue circles). `compact` = the 26px variant inside a mist box (O47). */
export function numberedSteps(steps: Step[], compact = false): string {
  const d = compact ? 26 : 28, f = compact ? 13 : 14, ts = compact ? 14 : 15, ds = compact ? 13 : 14, pad = compact ? "12px" : "14px", top = compact ? "2px" : "3px";
  return `${TABLE}>\n${steps.map((s, n) => `<tr><td valign="top" style="padding:0 12px ${pad} 0;width:${d}px;"><div style="width:${d}px;height:${d}px;line-height:${d}px;border-radius:${d / 2}px;background:${KIT.BLUE};color:#fff;font-size:${f}px;font-weight:bold;text-align:center;">${n + 1}</div></td><td valign="top" style="padding:${top} 0 ${pad};"><div style="font-size:${ts}px;font-weight:bold;color:${KIT.NAVY};">${esc(s.title)}</div>${s.detail ? `<div style="font-size:${ds}px;color:${KIT.SUB};line-height:1.5;margin-top:2px;">${esc(s.detail)}</div>` : ""}</td></tr>`).join("\n")}\n</table>`;
}
/** Small numbered list inside a mist box (O2-questions "3 quick questions"). */
export function questionList(items: Step[]): string {
  return `${TABLE} style="background:${KIT.MIST};border-radius:14px;"><tr><td style="padding:8px 14px;">${TABLE}>
${items.map((s, n) => `<tr><td valign="top" style="padding:8px 10px 8px 0;width:24px;"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:${KIT.BLUE};color:#fff;font-size:13px;font-weight:bold;text-align:center;">${n + 1}</div></td><td style="padding:8px 0;"><div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};">${esc(s.title)}</div>${s.detail ? `<div style="font-size:13px;color:${KIT.SUB};margin-top:1px;">${esc(s.detail)}</div>` : ""}</td></tr>`).join("\n")}
</table></td></tr></table>`;
}

/** Green date card: caps label, day, green time line, address/contact lines, optional struck-through old day and extra HTML. */
export function dateCard(i: { label: string; day: string; time: string; lines: string[]; was?: string | null; extraHtml?: string | null; padding?: string }): string {
  return `${TABLE} style="background:${KIT.MINT};border:2px solid ${KIT.GREEN};border-radius:16px;"><tr><td style="padding:${i.padding ?? "18px"};">
<div style="${CAPS}">${esc(i.label)}</div>
<div style="font-size:22px;font-weight:bold;color:${KIT.NAVY};margin-top:6px;">${esc(i.day)}</div>
<div style="font-size:22px;font-weight:bold;color:${KIT.GREEN};">${esc(i.time)}</div>
${i.was ? `<div style="font-size:13px;color:${KIT.SUB};margin-top:8px;text-decoration:line-through;">${esc(i.was)}</div>\n` : ""}${i.lines.length ? `<div style="font-size:14px;color:${KIT.NAVY};line-height:1.5;margin-top:${i.was ? 8 : 10}px;">${i.lines.map(esc).join("<br>")}</div>\n` : ""}${i.extraHtml ?? ""}</td></tr></table>`;
}
/** Green result card with a caps label, a big green line and label/value rows (O28, O44). */
export function resultCard(i: { label?: string | null; headline?: string | null; rows: { k: string; v: string; color?: string }[]; kv?: boolean }): string {
  const rows = i.kv
    ? i.rows.map((r) => `<tr><td style="padding:7px 0;font-size:13px;color:${KIT.SUB};width:42%;border-top:1px solid ${KIT.LINE};">${esc(r.k)}</td><td style="padding:7px 0;font-size:14px;font-weight:bold;color:${r.color ?? KIT.NAVY};border-top:1px solid ${KIT.LINE};">${esc(r.v)}</td></tr>`)
    : i.rows.map((r) => `<tr><td style="font-size:14px;color:${KIT.NAVY};padding:3px 0;">${esc(r.k)}</td><td align="right" style="font-size:14px;font-weight:bold;color:${r.color ?? KIT.NAVY};">${esc(r.v)}</td></tr>`);
  return `${TABLE} style="background:${KIT.MINT};border:2px solid ${KIT.GREEN};border-radius:16px;"><tr><td style="padding:16px 18px;">
${i.label ? `<div style="${CAPS}">${esc(i.label)}</div>\n` : ""}${i.headline ? `<div style="font-size:22px;font-weight:bold;color:${KIT.GREEN};margin-top:4px;">${esc(i.headline)}</div>\n` : ""}${TABLE}${i.kv ? ` style="margin-top:10px;"` : ""}>
${rows.join("\n")}
</table>
</td></tr></table>`;
}

export type QuoteRow = { title: string; detail?: string | null; amount: string; bold?: boolean; color?: string };
/** White bordered itemised table (O18 "Your quote", O29 "Your fixes quote"): title + grey detail rows, bold total row. */
export function quoteTable(i: { title: string; rows: QuoteRow[]; totalLabel: string; total: string; footnote?: string | null; marginTop?: number }): string {
  const rows = i.rows.map((r, n) => {
    const bt = n === 0 ? "" : `border-top:1px solid ${KIT.LINE};`;
    return `<tr><td valign="top" style="padding:10px 0;${bt}"><div style="font-size:14px;font-weight:bold;color:${KIT.NAVY};">${esc(r.title)}</div>${r.detail ? `<div style="font-size:12px;color:${KIT.SUB};line-height:1.45;margin-top:2px;">${esc(r.detail)}</div>` : ""}</td><td valign="top" align="right" style="padding:10px 0 10px 10px;${bt}font-size:14px;font-weight:${r.bold ? "bold" : "normal"};color:${r.color ?? KIT.NAVY};white-space:nowrap;">${esc(r.amount)}</td></tr>`;
  });
  return `${TABLE} style="margin-top:${i.marginTop ?? 16}px;border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:14px 16px 6px;">
<div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};margin:0 0 4px;">${esc(i.title)}</div>
${TABLE}>
${rows.join("\n")}
<tr><td style="padding:12px 0;border-top:2px solid ${KIT.NAVY};font-size:16px;font-weight:bold;color:${KIT.NAVY};">${esc(i.totalLabel)}</td><td align="right" style="padding:12px 0 12px 10px;border-top:2px solid ${KIT.NAVY};font-size:18px;font-weight:bold;color:${KIT.BLUE};">${esc(i.total)}</td></tr>
</table>
${i.footnote ? `<div style="font-size:13px;color:${KIT.SUB};line-height:1.5;padding:8px 0 8px;border-top:1px solid ${KIT.LINE};">${esc(i.footnote)}</div>\n` : ""}</td></tr></table>`;
}
/** Plain invoice table (O45): single-line rows, bold rows, blue bold total. */
export function invoiceTable(i: { header: string; meta: string[]; rows: { label: string; amount: string; bold?: boolean; color?: string }[]; totalLabel: string; total: string }): string {
  return `${TABLE} style="border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:14px 16px 6px;">
<div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${KIT.SUB};">${esc(i.header)}</div>
<div style="font-size:13px;color:${KIT.SUB};margin:4px 0 6px;line-height:1.5;">${i.meta.map(esc).join("<br>")}</div>
${TABLE}>
${i.rows.map((r, n) => { const bt = n === 0 ? "" : `border-top:1px solid ${KIT.LINE};`; const b = r.bold ? "font-weight:bold;" : ""; return `<tr><td style="padding:8px 0;${bt}font-size:14px;color:${KIT.NAVY};${b}">${esc(r.label)}</td><td align="right" style="padding:8px 0 8px 10px;${bt}font-size:14px;color:${r.color ?? KIT.NAVY};${b}white-space:nowrap;">${esc(r.amount)}</td></tr>`; }).join("\n")}
<tr><td style="padding:12px 0;border-top:2px solid ${KIT.NAVY};font-size:16px;font-weight:bold;color:${KIT.NAVY};">${esc(i.totalLabel)}</td><td align="right" style="padding:12px 0 12px 10px;border-top:2px solid ${KIT.NAVY};font-size:18px;font-weight:bold;color:${KIT.BLUE};">${esc(i.total)}</td></tr>
</table>
</td></tr></table>`;
}

/** Mist box with a bold title and body HTML (O6 "Why", O7 "What happens now", O35 power-off, I24 reason). */
export function mistBox(title: string, bodyHtml: string, opts: { marginTop?: number; padding?: string; radius?: number; titleHtml?: string } = {}): string {
  return `${TABLE} style="${opts.marginTop ? `margin-top:${opts.marginTop}px;` : ""}background:${KIT.MIST};border-radius:${opts.radius ?? 16}px;"><tr><td style="padding:${opts.padding ?? "16px 18px"};">
<div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};margin-bottom:6px;">${opts.titleHtml ?? esc(title)}</div>
${bodyHtml}
</td></tr></table>`;
}
/** Amber notice (O29 "What they found", O44 "sign your rebate form"). */
export function amberBox(title: string, bodyHtml: string, marginTop = 0): string {
  return `${TABLE} style="${marginTop ? `margin-top:${marginTop}px;` : ""}background:${KIT.AMBER_BG};border:1px solid ${KIT.AMBER_LINE};border-radius:14px;"><tr><td style="padding:14px 16px;">
<div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};margin-bottom:6px;">${esc(title)}</div>
${bodyHtml}
</td></tr></table>`;
}
/** Red notice box. */
export function redBox(title: string, bodyHtml: string, marginTop = 16): string {
  return `${TABLE} style="margin-top:${marginTop}px;background:${KIT.RED_BG};border:1px solid ${KIT.RED_LINE};border-radius:14px;"><tr><td style="padding:14px 16px;"><div style="font-size:15px;font-weight:bold;color:${KIT.RED};">${title}</div>
<div style="font-size:14px;color:${KIT.NAVY};line-height:1.55;margin-top:4px;">${bodyHtml}</div>
</td></tr></table>`;
}
/** Decision 137: the "⏰ The 30-day clock" warning. `expiresOn` (e.g. "5 December") gives the fixes-quote variant. */
export function thirtyDayClockBox(variant: { kind: "safety_check" } | { kind: "fixes"; expiresOn: string }): string {
  const body = variant.kind === "fixes"
    ? `<strong>Please approve this quickly.</strong> Your safety check expires 30 days after it was done (on <strong>${esc(variant.expiresOn)}</strong>), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged.`
    : `<strong>Your install must happen within 30 days of this safety check.</strong> After 30 days the check expires and has to be done again, and a new check may be charged. So once it's done, please book your install day as soon as the installer offers times, and approve any electrical fixes quickly.`;
  return redBox("&#9200; The 30-day clock", body);
}
export const THIRTY_DAY_CLOCK_TEXT = (expiresOn?: string | null) => expiresOn
  ? `The 30-day clock: please approve this quickly. Your safety check expires 30 days after it was done (on ${expiresOn}), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged.`
  : "The 30-day clock: your install must happen within 30 days of this safety check. After 30 days the check expires and has to be done again, and a new check may be charged. So once it's done, please book your install day as soon as the installer offers times, and approve any electrical fixes quickly.";

/** Tap-a-time buttons (day left, time right) plus "None suit? Suggest other days". */
export function tapTimeButtons(times: { day: string; time: string; href: string }[], suggest?: { href: string } | null): string {
  const rows = times.map((t) => `<tr><td style="padding:0 0 10px;"><a href="${esc(t.href)}" style="display:block;border:2px solid ${KIT.BLUE};border-radius:12px;padding:13px 16px;text-decoration:none;"><span style="font-size:16px;font-weight:bold;color:${KIT.NAVY};">${esc(t.day)}</span><span style="font-size:16px;color:${KIT.BLUE};font-weight:bold;float:right;">${esc(t.time)} &rsaquo;</span></a></td></tr>`);
  return `${TABLE}>\n${rows.join("\n")}\n</table>${suggest ? `\n<p style="font-size:14px;line-height:1.5;margin:4px 0 0;color:${KIT.SUB};text-align:center;">None suit? ${link(suggest.href, "Suggest other days")}</p>` : ""}`;
}

/** White card with a bold title, grey body and a blue arrow link (friend card, "New to how we work?"). */
export function linkCard(i: { title: string; body: string; href: string; label: string; marginTop?: number }): string {
  return `${TABLE} style="margin-top:${i.marginTop ?? 20}px;border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:16px;">
<div style="font-size:15px;font-weight:bold;color:${KIT.NAVY};">${esc(i.title)}</div>
<div style="font-size:14px;color:${KIT.SUB};line-height:1.5;margin:4px 0 10px;">${esc(i.body)}</div>
<a href="${esc(i.href)}" style="font-size:14px;font-weight:bold;color:${KIT.BLUE};">${esc(i.label)} &rarr;</a>
</td></tr></table>`;
}
export const friendCard = (href: string, variant: "spot" | "eligibility" | "cold" = "eligibility") => linkCard(
  variant === "spot" ? { title: "Have a friend who needs a spot saved?", body: "Send them our free eligibility checker. It takes a minute.", href, label: "Send to a friend" }
    : variant === "cold" ? { title: "Know someone with a cold house?", body: "Send them our free eligibility checker. It takes a minute, and they could get the rebate too.", href, label: "Send to a friend" }
      : { title: "Know someone thinking about insulation?", body: "They can check their own eligibility in about a minute.", href, label: "Send to a friend" },
);

/** Download rows (O47): 📄 title + grey detail, blue "Download" link. */
export function downloadList(items: { title: string; detail: string; href: string | null }[]): string {
  return `${TABLE} style="border:1px solid ${KIT.LINE};border-radius:14px;background:${KIT.WHITE};"><tr><td style="padding:6px 16px;">
${TABLE}>
${items.map((d, n) => { const bt = n === 0 ? "" : `border-top:1px solid ${KIT.LINE};`; return `<tr><td style="padding:11px 0;${bt}"><div style="font-size:14px;font-weight:bold;color:${KIT.NAVY};">&#128196; ${esc(d.title)}</div><div style="font-size:12px;color:${KIT.SUB};margin-top:2px;">${esc(d.detail)}</div></td><td align="right" style="padding:11px 0 11px 10px;${bt}">${d.href ? `<a href="${esc(d.href)}" style="font-size:13px;font-weight:bold;color:${KIT.BLUE};white-space:nowrap;">Download</a>` : `<span style="font-size:13px;color:${KIT.SUB};white-space:nowrap;">On your job page</span>`}</td></tr>`; }).join("\n")}
</table>
</td></tr></table>`;
}
/** Five tap-a-star links (O51). */
export function starRow(hrefFor: (stars: number) => string): string {
  return `<p style="font-size:15px;font-weight:bold;margin:0 0 10px;text-align:center;">Tap a star</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${[1, 2, 3, 4, 5].map((n) => `<td align="center" style="padding:0 4px;"><a href="${esc(hrefFor(n))}" style="display:block;width:48px;height:48px;line-height:48px;border-radius:12px;border:1px solid ${KIT.LINE};background:#fff;font-size:24px;color:${KIT.STAR};text-decoration:none;">&#9733;</a></td>`).join("")}</tr></table>`;
}

// ---------------------------------------------------------------------------
// Approved standing content (decision 66; Jo confirmed for every job)
// ---------------------------------------------------------------------------
/** "What's included in $X" rows shared by Save my spot, Spot saved, Ready Check times and booked. */
export function includedItems(rebate: number): TickItem[] {
  return [
    { title: "Free Ready Check", detail: "An installer visits to measure your ceiling and confirm the price." },
    { title: "Licensed electrician safety check", detail: "Required before any insulation goes in. They check wiring, downlights and cables so your ceiling is safe." },
    { title: "Premium R5.0 ceiling batts", detail: "Approved for the VEU program and made to Australian Standard AS/NZS 4859.1." },
    { title: "Fitted by an EEC-certified installer", detail: "Certified Insulation Installer (CII) through the Energy Efficiency Council, installing to Australian Standard AS 3999." },
    { title: "We handle the rebate", detail: `As a VEU Accredited Person (${AP_NUMBER}), we do all the government paperwork. The ${whole(rebate)} comes straight off your price.` },
  ];
}
/** "Not included, only if needed" rows; `someInsulation` swaps the removal line (O2). */
export function notIncludedItems(someInsulation = false): string[] {
  return [
    someInsulation ? "<strong>Removing old insulation</strong>, only if it can't stay ($15 per m², see above)" : "<strong>Removing old insulation</strong>, if any needs to come out",
    "<strong>Ceiling access fee</strong>, if your ceiling is hard to get into",
    "<strong>Electrical fixes</strong>, if the safety check finds any",
    "<strong>A bigger ceiling</strong> than you told us",
  ];
}
/** Both cards + the check-at-Ready-Check line. `seeEstimate` adds the "See your full estimate" link. */
export function includedAndNotIncluded(i: { price: number; rebate: number; someInsulation?: boolean; closing?: string; seeEstimate?: string | null }): string {
  const closing = i.closing ?? "We check these at your free Ready Check and tell you the exact price before you agree to anything.";
  return `${includedCard(`What's included in ${whole(i.price)}`, includedItems(i.rebate))}${notIncludedCard("Not included, only if needed", notIncludedItems(i.someInsulation))}<p style="font-size:13px;line-height:1.5;margin:10px 0 0;color:${KIT.SUB};">${esc(closing)}${i.seeEstimate ? ` ${link(i.seeEstimate, "See your full estimate")}` : ""}</p>`;
}
/** Plain-text twin of the two cards. */
export function includedAndNotIncludedText(i: { price: number; rebate: number; someInsulation?: boolean; closing?: string }): string[] {
  const inc = includedItems(i.rebate).map((t) => typeof t === "string" ? `✓ ${t}` : `✓ ${t.title}: ${t.detail ?? ""}`.trim());
  const not = notIncludedItems(i.someInsulation).map((h) => `+ ${stripTags(h)}`);
  return [`WHAT'S INCLUDED IN ${whole(i.price)}`, ...inc, "", "NOT INCLUDED, ONLY IF NEEDED", ...not, "", i.closing ?? "We check these at your free Ready Check and tell you the exact price before you agree to anything."];
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------
export const stripTags = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/** Joins lines (dropping null/false), then the AP/ABN footer and the unsubscribe/TEST lines. */
export function plainText(lines: Array<string | null | false | undefined>, opts: { unsubscribe?: string | null; testLabel?: boolean } = {}): string {
  const body = lines.filter((l): l is string => typeof l === "string");
  return [...body, "", FOOTER_TEXT, ...(opts.unsubscribe ? [`Unsubscribe: ${opts.unsubscribe}`] : []), ...(opts.testLabel ? ["", "TEST — only sent to Jo."] : [])].join("\n");
}
