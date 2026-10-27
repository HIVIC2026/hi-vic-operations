// One look for every partner email (welcome, send back, decline, application received, ESC notice): the MJML email
// refresh (Jo 26 Oct 2026; designs docs/templates/mjml/installer_I54.mjml, electrician_E13.mjml, installer_I60.mjml,
// installer_I62.mjml). Pure. The logo is the hosted PNG `mjEmail` puts in the header (same file as CUSTOMER_BRAND.logoUrl).
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { SET_PASSWORD_BASE } from "./set-password-link.core";
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { NO_FORM_NO_PAY } from "./trade-view.core";

/** Decision 107: the 2-minute installer guide page (src/routes/_authenticated/field.guide.tsx). */
export const INSTALLER_GUIDE_URL = `${SET_PASSWORD_BASE}/field/guide`;

/** Public website logo (kept for callers that still reference it; the emails use the same hosted file). */
export const PARTNER_EMAIL_LOGO_URL = CUSTOMER_BRAND.logoUrl;

/**
 * Blocks for `partnerEmailLayout`. `hi` (first block only) = the short greeting line above the heading; `box` = the yellow
 * panel; `small` = a small grey line; `card` = a white bordered panel with a title (lists inside it: an item starting
 * "– " is a sub-item with no tick); `preview` = the inbox preview line (not shown in the body).
 */
export type PartnerBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "button"; label: string; url: string }
  | { kind: "sign"; lines: string[] }
  | { kind: "hi"; text: string }
  | { kind: "box"; text: string }
  | { kind: "small"; text: string }
  | { kind: "card"; title: string; subtitle?: string | null; blocks: PartnerBlock[] }
  | { kind: "preview"; text: string };

const sec = (rows: string, cls?: string) => `<mj-section><mj-column${cls ? ` mj-class="${cls}"` : ""}>${rows}</mj-column></mj-section>`;
const txt = (html: string, attrs = "") => `<mj-text${attrs ? ` ${attrs}` : ""}>${html}</mj-text>`;
const tick = (html: string, pad: number) => `<tr><td width="32" valign="top" style="padding:2px 0 ${pad}px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 ${pad}px;">${html}</td></tr>`;
const LINK = "color:#3C51C4;font-weight:700;";
/** Email addresses inside escaped text become mailto links (the ESC notice's privacy address). */
const mailLinks = (html: string) => html.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, `<a href="mailto:$1" style="${LINK}">$1</a>`);

function cardRows(b: Extract<PartnerBlock, { kind: "card" }>): string {
  const rows = [txt(esc(b.title), `mj-class="h2" padding="18px 18px ${b.subtitle ? 2 : 10}px"`)];
  if (b.subtitle) rows.push(txt(esc(b.subtitle), 'mj-class="small" padding="0 18px 12px"'));
  b.blocks.forEach((x, n) => {
    const last = n === b.blocks.length - 1;
    if (x.kind === "p") rows.push(txt(mailLinks(esc(x.text)), `font-size="15px" line-height="23px" padding="0 18px ${last ? 18 : 12}px"`));
    else if (x.kind === "list") {
      rows.push(`<mj-table padding="0 18px 6px">${x.items.map((it, k, all) => {
        if (!it.startsWith("– ")) return tick(esc(it), 12);
        const pad = k === all.length - 1 ? 12 : 10;
        return `<tr><td width="32" valign="top" style="padding:0 0 ${pad}px;"></td><td style="padding:0 0 ${pad}px;">${esc(it)}</td></tr>`;
      }).join("")}</mj-table>`);
    }
  });
  return rows.join("");
}

function blockText(b: PartnerBlock): string[] {
  switch (b.kind) {
    case "p": case "hi": case "box": case "small": return [b.text, ""];
    case "list": return [...b.items.map((x) => `• ${x}`), ""];
    case "button": return [`${b.label}: ${b.url}`, ""];
    case "sign": return [...b.lines, ""];
    case "card": return [b.title, ...(b.subtitle ? [b.subtitle] : []), "", ...b.blocks.flatMap(blockText)];
    case "preview": return [];
  }
}

/** Generic partner email (send back / decline / notice / one-off): greeting, heading, paragraphs, boxes, one button, sign-off. */
export function partnerEmailLayout(i: { subject: string; heading?: string | null; blocks: PartnerBlock[]; preview?: string; test?: boolean }) {
  const preview = i.preview ?? i.blocks.find((b): b is Extract<PartnerBlock, { kind: "preview" }> => b.kind === "preview")?.text ?? null;
  const blocks = i.blocks.filter((b) => b.kind !== "preview");
  const hi = blocks[0]?.kind === "hi" ? blocks[0] : null;
  const rest = hi ? blocks.slice(1) : blocks;
  const out: string[] = [];
  let rows: string[] = [];
  let afterPanel = false;
  const flush = () => { if (rows.length) out.push(sec(rows.join(""))); rows = []; };
  const panel = (cls: string, inner: string) => { flush(); out.push(sec(inner, cls)); afterPanel = true; };
  if (hi) rows.push(txt(esc(hi.text), 'mj-class="hi"'));
  if (i.heading) rows.push(txt(esc(i.heading), `mj-class="h1" css-class="email-heading"${hi ? ' padding="4px 12px 10px"' : ""}`));
  for (const b of rest) {
    const first = afterPanel && rows.length === 0; // first line after a panel gets the design's extra top space
    if (b.kind === "p" || b.kind === "hi") rows.push(txt(esc(b.text), first ? 'padding="14px 12px 14px"' : ""));
    else if (b.kind === "small") rows.push(txt(esc(b.text), `mj-class="small"${first ? ' padding="14px 12px 0"' : ""}`));
    else if (b.kind === "button") { if (first) rows.push('<mj-text padding="8px 0 0"></mj-text>'); rows.push(`<mj-button href="${esc(b.url)}">${esc(b.label)}</mj-button>`); }
    else if (b.kind === "sign") rows.push(txt(b.lines.map(esc).join("<br />")));
    else if (b.kind === "box") panel("panel-amber", txt(esc(b.text), 'padding="18px 18px 18px"'));
    else if (b.kind === "list") panel("panel-card", `<mj-table padding="18px 18px 6px">${b.items.map((x, n, all) => tick(esc(x), n === all.length - 1 ? 12 : 14)).join("")}</mj-table>`);
    else if (b.kind === "card") panel("panel-card", cardRows(b));
  }
  flush();
  const html = mjEmail({ subject: i.subject, preview, body: out.join(""), unsubscribe: null, testLabel: i.test !== false });
  const text = K.plainText([
    ...(hi ? [hi.text, ""] : []),
    ...(i.heading ? [i.heading, ""] : []),
    ...rest.flatMap(blockText),
    "Home Insulation Victoria · info@homeinsulationvictoria.com.au",
  ], { testLabel: i.test !== false });
  return { html, text };
}

/** Official Mitti (by SafetyCulture) app store pages (checked 27 Oct 2026). */
export const MITTI_APP_STORE_URL = "https://apps.apple.com/au/app/mitti-by-safetyculture/id499999532";
export const MITTI_GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.safetyculture.iauditor";

/** Jo 27 Oct 2026: numbered "What happens next" steps, checked against the portal (decisions 315, 333, 344, 355, 366). */
export const WELCOME_STEPS = {
  installer: [
    "We send you jobs, or you add your own customers with Add a job in the portal.",
    "Do the free Ready Check measure using the Ready Check form in Mitti.",
    "We send the owner one quote, using your price.",
    "Once the owner accepts and pays, we book the electrician for the safety check.",
    "When the job is cleared, we text you. Offer the owner 3 install days.",
    "Install, then finish the install form in Mitti on site and press Complete.",
    "Get paid 7 days after we approve the job. For your own customers, the owner must also have paid in full.",
  ],
  electrician: [
    "You get a text when a PIESA job near you is available. The first electrician to accept gets it.",
    "Accept it, then offer the owner 3 times. You'll see their contact details once it's yours.",
    "Do the PIESA using the A3 form in Mitti, on site, and press Complete.",
    "If fixes are needed, put your price on the A3 form and send us 3 to 5 times when we text you. We quote the owner. Once they've paid, they pick one of your times. Use the A4 form on the day.",
    "Get paid your agreed rate 7 days after the form is complete and the owner has paid.",
  ],
} as const;
export const WELCOME_MITTI = {
  title: "Getting into Mitti",
  lead: "Mitti is the app for all Home Insulation Victoria job forms.",
  steps: ["Look for a separate email from Mitti and set your password.", "Download the Mitti app:"],
  forms: {
    installer: "Use the Ready Check form when you measure, and the install form on install day.",
    electrician: "Use the A3 PIESA form at the safety check, and the A4 fixes form if fixes are needed.",
  },
} as const;
const num = (html: string, n: number, last: boolean) => `<tr><td width="32" valign="top" style="padding:2px 0 ${last ? 12 : 14}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${last ? 12 : 14}px;">${html}</td></tr>`;

/** Decision 107: "Welcome aboard, {First}. You're approved!" — 3 benefits, Set your password, the 2-minute guide box. */
export function partnerWelcomeEmail(i: { firstName: string | null; businessName: string; trade: "installer" | "electrician"; email: string; link: string; guideUrl?: string | null; test?: boolean }) {
  const subject = "You're approved — welcome to Home Insulation Victoria";
  const first = K.cleanName(i.firstName);
  const hi = `Welcome aboard${first ? `, ${first}` : ""}.`;
  const headline = "You're approved!";
  const intro = i.trade === "installer"
    ? `${i.businessName} can now take VEU ceiling insulation jobs through Home Insulation Victoria. Here's what you get:`
    : `${i.businessName} can now take VEU electrical safety checks (PIESAs) through Home Insulation Victoria. Here's what you get:`;
  const preview = i.trade === "installer"
    ? `${i.businessName} can now take VEU ceiling insulation jobs. Set your password to get started.`
    : `${i.businessName} can now take VEU electrical safety checks. Set your password to get started.`;
  const benefits = i.trade === "installer"
    ? ["Jobs sent to you, plus add your own customers", "Your price, never marked up. We only add our $349 AP fee", "Quotes, electrician, compliance and rebate paperwork handled by us"]
    : ["PIESAs sent to you near where you work", "Your agreed rate, paid 7 days after approval", "Bookings, compliance and rebate paperwork handled by us"];
  // Link check (Jo 27 Oct 2026): the guide page is the installer guide and only installers can open it, so electricians get no guide box.
  const guide = i.trade === "installer" || i.guideUrl ? { title: "New to how we work?", body: "Read the 2-minute guide: Ready Checks, Mitti, your jobs, our leads and getting paid.", href: i.guideUrl || INSTALLER_GUIDE_URL } : null;
  const steps = WELCOME_STEPS[i.trade];
  const signIn = `You'll sign in with ${i.email}. The link works once and lasts 24 hours.`;
  // Decision 318 (Jo 25 Oct 2026): the pay rule, Jo's approved words, shown as two paragraphs in the yellow box.
  const pay = NO_FORM_NO_PAY.body.indexOf(". ");
  const payParas = pay > 0 ? [NO_FORM_NO_PAY.body.slice(0, pay + 1), NO_FORM_NO_PAY.body.slice(pay + 2)] : [NO_FORM_NO_PAY.body];
  const body = [
    sec([txt(esc(hi), 'mj-class="hi"'), txt(esc(headline), 'mj-class="h1" css-class="email-heading" padding="4px 12px 10px"'), txt(esc(intro))].join("")),
    sec(`<mj-table padding="18px 18px 6px">${benefits.map((b, n) => tick(esc(b), n === benefits.length - 1 ? 12 : 14)).join("")}</mj-table>`, "panel-card"),
    sec(['<mj-text padding="8px 0 0"></mj-text>', `<mj-button href="${esc(i.link)}">Set your password</mj-button>`, txt(esc(signIn), 'mj-class="small center" padding="0 12px 18px"')].join("")),
    sec([txt("What happens next", 'mj-class="h2" padding="18px 18px 10px"'), `<mj-table padding="0 18px 6px">${steps.map((t, n) => num(esc(t), n, n === steps.length - 1)).join("")}</mj-table>`].join(""), "panel-card"),
    sec([txt(esc(WELCOME_MITTI.title), 'mj-class="h2" padding="18px 18px 6px"'), txt(esc(WELCOME_MITTI.lead), 'padding="0 18px 10px"'),
      `<mj-table padding="0 18px 6px">${num(esc(WELCOME_MITTI.steps[0]), 0, false)}${num(`${esc(WELCOME_MITTI.steps[1])} <a href="${MITTI_APP_STORE_URL}" style="${LINK}">App Store</a> &middot; <a href="${MITTI_GOOGLE_PLAY_URL}" style="${LINK}">Google Play</a>`, 1, true)}</mj-table>`,
      txt(esc(WELCOME_MITTI.forms[i.trade]), 'padding="0 18px 18px"')].join(""), "panel"),
    guide ? sec([txt(esc(guide.title), 'mj-class="h2" padding="18px 18px 6px"'), txt(`${esc(guide.body)}<br /><a href="${esc(guide.href)}" style="${LINK}">Read the guide &rarr;</a>`, 'padding="0 18px 18px"')].join(""), "panel") : "",
    sec([txt(esc(NO_FORM_NO_PAY.headline), 'mj-class="h2" padding="18px 18px 6px"'), ...payParas.map((p, n) => txt(esc(p), `padding="0 18px ${n === payParas.length - 1 ? 18 : 10}px"`))].join(""), "panel-amber"),
    sec(txt("Questions? Just reply to this email.", 'mj-class="small" padding="14px 12px 0"')),
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    hi, "", headline, "", intro, ...benefits.map((b) => `✓ ${b}`), "",
    `Set your password: ${i.link}`, signIn, "",
    "What happens next", ...steps.map((t, n) => `${n + 1}. ${t}`), "",
    WELCOME_MITTI.title, WELCOME_MITTI.lead, `1. ${WELCOME_MITTI.steps[0]}`, `2. ${WELCOME_MITTI.steps[1]} App Store ${MITTI_APP_STORE_URL} · Google Play ${MITTI_GOOGLE_PLAY_URL}`, WELCOME_MITTI.forms[i.trade], "",
    ...(guide ? [`${guide.title} ${guide.body}`, `Read the guide: ${guide.href}`, ""] : []), `${NO_FORM_NO_PAY.headline}. ${NO_FORM_NO_PAY.body}`, "", "Questions? Just reply to this email.",
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
