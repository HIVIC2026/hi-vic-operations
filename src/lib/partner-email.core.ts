// One look for every partner email (welcome, send back, decline, application received): the approved email kit
// (Jo 24 Oct 2026, decisions 107 and 136; designs docs/templates/installer/I54-welcome.html and I53-application-received.html).
// Pure. The logo is the bundled PNG data URI the kit embeds (same as every owner email).
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { SET_PASSWORD_BASE } from "./set-password-link.core";
import * as K from "./email-kit.core";
import { NO_FORM_NO_PAY } from "./trade-view.core";

/** Decision 107: the 2-minute installer guide page (src/routes/_authenticated/field.guide.tsx). */
export const INSTALLER_GUIDE_URL = `${SET_PASSWORD_BASE}/field/guide`;

/** Public website logo (kept for callers that still reference it; the emails embed the bundled PNG). */
export const PARTNER_EMAIL_LOGO_URL = CUSTOMER_BRAND.logoUrl;

export type PartnerBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] } | { kind: "button"; label: string; url: string } | { kind: "sign"; lines: string[] };

/** Generic partner email (send back / decline / one-off): heading, paragraphs, lists, one button, sign-off, in the kit shell. */
export function partnerEmailLayout(i: { subject: string; heading?: string | null; blocks: PartnerBlock[]; preview?: string; test?: boolean }) {
  const body = [
    ...(i.heading ? [K.h1(i.heading, 8)] : []),
    ...i.blocks.map((b) => {
      if (b.kind === "p") return K.p(b.text);
      if (b.kind === "list") return K.checkList(b.items.map(K.esc));
      if (b.kind === "button") return K.button(b.url, b.label);
      return K.p(b.lines.map(K.esc).join("<br>"), "16px 0 0", true);
    }),
  ].join("\n");
  const html = K.emailShell({ body, previewText: i.preview ?? null, testLabel: i.test !== false, unsubscribe: null });
  const text = K.plainText([
    ...(i.heading ? [i.heading, ""] : []),
    ...i.blocks.flatMap((b) => b.kind === "p" ? [b.text, ""] : b.kind === "list" ? [...b.items.map((x) => `• ${x}`), ""] : b.kind === "button" ? [`${b.label}: ${b.url}`, ""] : [...b.lines, ""]),
    "Home Insulation Victoria · info@homeinsulationvictoria.com.au",
  ], { testLabel: i.test !== false });
  return { html, text };
}

/** Decision 107: "Welcome aboard, {First}. You're approved!" — 3 benefits, Set your password, the 2-minute guide card. */
export function partnerWelcomeEmail(i: { firstName: string | null; businessName: string; trade: "installer" | "electrician"; email: string; link: string; guideUrl?: string | null; test?: boolean }) {
  const subject = "You're approved — welcome to Home Insulation Victoria";
  const first = K.cleanName(i.firstName);
  if (i.trade === "electrician") {
    // E13 picture (docs/templates/electrician/E13-welcome-email.html): "Welcome aboard, {First}", approved line, set-password
    // line, sign-in email, "Set my password". Decision 318's pay rule (Jo 25 Oct 2026) stays underneath.
    const h = `Welcome aboard${first ? `, ${first}` : ""}`;
    const l1 = `${i.businessName} is approved as a Home Insulation Victoria partner.`;
    const l2 = "Tap the button to set your password and sign in to your online portal. The link works once and expires in 24 hours.";
    const l3 = `Your sign-in email is ${i.email}.`;
    const eBody = [K.h1(h, 12), K.p(l1, "0 0 12px"), K.p(l2, "0 0 12px"), K.p(l3, "0 0 12px"), K.button(i.link, "Set my password", "6px 0 4px"),
      K.mistBox(NO_FORM_NO_PAY.headline, K.p(NO_FORM_NO_PAY.body, "0"), { marginTop: 14 })].join("\n");
    const eHtml = K.emailShell({ body: eBody, previewText: l1, testLabel: i.test === true, unsubscribe: null });
    const eText = K.plainText([h, "", l1, "", l2, "", l3, "", `Set my password: ${i.link}`, "", `${NO_FORM_NO_PAY.headline}. ${NO_FORM_NO_PAY.body}`], { testLabel: i.test === true });
    return { subject, html: eHtml, text: eText };
  }
  const headline = `Welcome aboard${first ? `, ${first}` : ""}. You're approved!`;
  const intro = i.trade === "installer"
    ? `${i.businessName} can now take VEU ceiling insulation jobs through Home Insulation Victoria. Here's what that gets you:`
    : `${i.businessName} can now take VEU electrical safety checks (PIESAs) through Home Insulation Victoria. Here's what that gets you:`;
  const benefits = i.trade === "installer"
    ? ["<strong>Jobs sent to you</strong>, plus add your own customers", "<strong>Your price, never marked up.</strong> We only add our $349 AP fee", "<strong>Quotes, electrician, compliance and rebate paperwork</strong> handled by us"]
    : ["<strong>PIESAs sent to you</strong> near where you work", "<strong>Your agreed rate, paid 7 days after approval</strong>", "<strong>Bookings, compliance and rebate paperwork</strong> handled by us"];
  // Electricians get no guide box (their E13 design has none; the guide page is installer-only).
  const guide = i.trade === "installer" || i.guideUrl ? { title: "New to how we work?", body: "Read the 2-minute guide: Ready Checks, Mitti, your jobs, our leads and getting paid.", href: i.guideUrl || INSTALLER_GUIDE_URL, label: "Read the guide", marginTop: 18 } : null;
  const signIn = `You'll sign in with ${i.email}. The link works once and lasts 24 hours.`;
  const body = [K.h1(headline, 8), K.p(intro, "0 0 14px"), K.checkList(benefits, 15, "9px"), K.button(i.link, "Set your password", "14px 0 4px"), K.small(signIn, "10px 0 0", { center: true }), ...(guide ? [K.linkCard(guide)] : []),
    // Decision 318 (Jo 25 Oct 2026): the pay rule, Jo's approved words, appended after the approved I54 content.
    K.mistBox(NO_FORM_NO_PAY.headline, K.p(NO_FORM_NO_PAY.body, "0"), { marginTop: 14 }), K.small("Questions? Just reply to this email.")].join("\n");
  const html = K.emailShell({ body, previewText: `${i.businessName} is now an approved Home Insulation Victoria partner.`, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    `Hi ${first ?? "there"},`, "", headline, "", intro, ...benefits.map((b) => `✓ ${K.stripTags(b)}`), "",
    `Set your password: ${i.link}`, signIn, "", ...(guide ? [`${guide.title} ${guide.body}`, `Read the guide: ${guide.href}`, ""] : []), `${NO_FORM_NO_PAY.headline}. ${NO_FORM_NO_PAY.body}`, "", "Questions? Just reply to this email.", "", "Welcome aboard,", "Jo", "Home Insulation Victoria",
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
