// One look for every partner email (welcome, send back, decline): real logo, portal fonts, dark-grey 16px body.
// Pure. Logo is the same public file the website uses (absolute URL so Outlook/Hotmail/Gmail load it).
import { CUSTOMER_BRAND } from "./customer-quote-system";

export const PARTNER_EMAIL_LOGO_URL = CUSTOMER_BRAND.logoUrl;
const FONT_BODY = "'Figtree', 'Inter', Helvetica, Arial, sans-serif";
const FONT_HEAD = "'Outfit', 'Inter', Helvetica, Arial, sans-serif";
const TEXT = "#333A40", BRAND = "#07864B", NAVY = "#22376B", LINE = "#E4E9F5";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
const p = (html: string, extra = "") => `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${TEXT};${extra}">${html}</p>`;

export type PartnerBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] } | { kind: "button"; label: string; url: string } | { kind: "sign"; lines: string[] };

export function partnerEmailLayout(i: { subject: string; heading?: string | null; blocks: PartnerBlock[]; preview?: string; test?: boolean }) {
  const body = i.blocks.map((b) => {
    if (b.kind === "p") return p(esc(b.text));
    if (b.kind === "list") return `<ul style="margin:0 0 16px;padding-left:22px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${TEXT};">${b.items.map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`).join("")}</ul>`;
    if (b.kind === "button") return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${BRAND};border-radius:12px;"><a href="${esc(b.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT_BODY};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(b.label)}</a></td></tr></table>`;
    return p(b.lines.map(esc).join("<br>"), "margin-top:8px;");
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(i.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;">
${i.preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(i.preview)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:0 4px 20px;border-bottom:1px solid ${LINE};">
<img src="${PARTNER_EMAIL_LOGO_URL}" alt="Home Insulation Victoria" width="160" style="display:block;width:160px;max-width:60%;height:auto;border:0;">
${i.test === false ? "" : `<div style="display:inline-block;margin-top:12px;background:#FDF2F6;color:${NAVY};font-family:${FONT_BODY};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;">TEST — only sent to Jo</div>`}
</td></tr><tr><td style="padding:28px 4px 8px;">
${i.heading ? `<h1 style="margin:0 0 20px;font-family:${FONT_HEAD};font-size:26px;line-height:1.25;font-weight:700;color:${NAVY};">${esc(i.heading)}</h1>` : ""}
${body}
</td></tr><tr><td style="padding:20px 4px 0;border-top:1px solid ${LINE};font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:#6B7280;">
Home Insulation Victoria · operated by DC Construction Solutions<br>
<a href="mailto:info@homeinsulationvictoria.com.au" style="color:#6B7280;">info@homeinsulationvictoria.com.au</a>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    ...i.blocks.flatMap((b) => b.kind === "p" ? [b.text, ""] : b.kind === "list" ? [...b.items.map((x) => `• ${x}`), ""] : b.kind === "button" ? [`${b.label}: ${b.url}`, ""] : [...b.lines, ""]),
    "Home Insulation Victoria · info@homeinsulationvictoria.com.au",
    ...(i.test === false ? [] : ["", "TEST — only sent to Jo."]),
  ];
  if (i.heading) text.unshift(i.heading, "");
  return { html, text: text.join("\n") };
}

/** Jo's exact approved welcome wording (8 Oct 2026). */
export function partnerWelcomeEmail(i: { firstName: string | null; businessName: string; trade: "installer" | "electrician"; email: string; link: string; test?: boolean }) {
  const subject = "You're approved — welcome to Home Insulation Victoria";
  const blocks: PartnerBlock[] = [
    { kind: "p", text: `Hi ${i.firstName?.trim() || "there"},` },
    { kind: "p", text: `Great news — ${i.businessName} is now an approved Home Insulation Victoria partner.` },
    { kind: "p", text: "Your partner portal is where you'll:" },
    { kind: "list", items: [
      i.trade === "installer" ? "see and accept insulation jobs near you" : "see and accept PIESAs near you",
      "add your own customers",
      "track every job, payment and form in one place",
    ] },
    { kind: "p", text: "Tap below to set your password. The link works once and lasts 24 hours." },
    { kind: "button", label: "Set up my account", url: i.link },
    { kind: "p", text: `You'll sign in with: ${i.email}` },
    { kind: "p", text: "Questions? Just reply to this email." },
    { kind: "sign", lines: ["Welcome aboard,", "Jo", "Home Insulation Victoria"] },
  ];
  return { subject, ...partnerEmailLayout({ subject, blocks, preview: `${i.businessName} is now an approved Home Insulation Victoria partner.`, test: i.test ?? true }) };
}
