// P1-R2-S02: Pure renderers for the five later-stage customer lifecycle emails that the
// template catalog (template-catalog.ts) already registers but had no sample renderer for:
//   measured_quote · booking_consent · pre_install_pack · assignment_signing · completion_pack
//
// These FOLLOW THE EXISTING renderer pattern (coverage-email.ts / estimate-email.ts): a pure
// function returning { subject, previewText, html, plainText } built from V2_THEME, with NO data
// access and NO delivery. They are mounted only as office PREVIEW samples (template-hub) so the
// office can review wording. NOTHING here sends: there is no new delivery engine, no new template
// database and no auto-route wiring. Live sending for these stages remains held until the
// unresolved legal/business dependencies below are approved. Unresolved official/legal wording is
// marked [PLACEHOLDER] and never invented.
import { escape, V2_THEME, type EstimateEmail } from "./estimate-email";

const { F, FH, colors: C, site: SITE } = V2_THEME;
const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
const p = (t: string) => `<p class="lx-body" style="margin:0 0 12px;${F}color:${C.INK};font-size:15px;line-height:1.6;">${t}</p>`;
const kicker = (t: string) => `<p style="margin:0 0 8px;${F}color:${C.TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">${escape(t)}</p>`;
const h1 = (t: string) => `<h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${C.INK};font-size:32px;line-height:37px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${escape(t)}</h1>`;
const boxTitle = (t: string) => `<p style="margin:0 0 10px;${FH}color:${C.INK};font-size:17px;line-height:1.3;font-weight:800;">${escape(t)}</p>`;
const mistBox = (title: string, inner: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.MIST}" style="width:100%;border-collapse:separate;background-color:${C.MIST};border-radius:18px;"><tr><td class="lx-result-pad" style="padding:20px;${F}">${boxTitle(title)}${inner}</td></tr></table>`;
// A visible, neutral placeholder block for official/legal wording that must come from a verified source.
const placeholder = (what: string) =>
  `<p style="margin:0 0 6px;${F}color:#8A3B00;font-size:12.5px;line-height:1.5;font-weight:700;">[PLACEHOLDER: ${escape(what)} — insert approved wording before this email can be sent.]</p>`;

/** Reference line reused by every lifecycle email's footer (reason = why they receive it). */
const REASON = "You’re receiving this because you have an active Home Insulation Victoria job.";

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE 3 — Measured quote (stage 2 · Quote). Populated from a VALIDATED quote record;
// the renderer NEVER recalculates price — it formats the figures it is given.
// ───────────────────────────────────────────────────────────────────────────
export type MeasuredQuoteInput = {
  firstName?: string | null;
  address?: string | null;
  measuredAreaM2: number;
  /** Pre-formatted currency strings from the validated quote record (no math here). */
  piesaFee: string;
  supplyInstall: string;
  apFee: string;
  veecCount: number;
  veuDiscount: string;
  totalIncGst: string;
  acceptUrl: string;
  /** True only when the validated record flags >15% area change vs the earlier estimate. */
  areaChangedOver15pct?: boolean;
  reference?: string | null;
};

const amtRow = (label: string, amount: string, strong = false) =>
  `<tr><td style="padding:8px 0;${F}color:${C.INK};font-size:14px;line-height:1.4;${strong ? "font-weight:800;border-top:1px solid " + C.LINE + ";" : ""}">${escape(label)}</td><td align="right" class="lx-row-amt" style="padding:8px 0;${F}color:${C.INK};font-size:14px;line-height:1.4;white-space:nowrap;${strong ? "font-weight:800;border-top:1px solid " + C.LINE + ";" : ""}">${escape(amount)}</td></tr>`;

export function renderMeasuredQuoteEmail(input: MeasuredQuoteInput): EstimateEmail {
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const where = input.address?.trim() || "your property";
  const subject = "Your confirmed Home Insulation Victoria quote";
  const previewText = `Your measured ceiling insulation quote for ${where}.`;
  const intro = `${name ? `Hi ${name}, thank` : "Thank"} you for having your free Ready Check done. We’ve now measured your ceiling at ${escape(where)} and prepared your confirmed quote.`;
  const changed = input.areaChangedOver15pct
    ? `<p style="margin:0 0 12px;${F}color:${C.INK};font-size:13px;line-height:1.55;font-style:italic;">Please note: the measured area is different from the earlier estimate, so your quote has been updated to reflect the actual area measured onsite.</p>`
    : "";
  const quoteTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${amtRow("Electrical safety check (PIESA)", input.piesaFee)}${amtRow("R5.0 ceiling insulation — supply & install", input.supplyInstall)}${amtRow("Home Insulation Victoria management", input.apFee)}${amtRow(`VEU discount (${input.veecCount} × $70)`, `−${input.veuDiscount}`)}${amtRow("Total (inc GST)", input.totalIncGst, true)}</table>`;
  const measured = `<p style="margin:0 0 10px;${F}color:${C.INK};font-size:15px;line-height:1.4;"><strong>Measured ceiling area:</strong> ${escape(String(input.measuredAreaM2))} m²</p>`;
  const includes = V2_THEME.neutralItem("Supply and installation of R5.0 ceiling insulation for the measured area") + V2_THEME.neutralItem("Your electrical safety check (PIESA)") + V2_THEME.neutralItem("Your VEU discount, already applied above");
  const excludes = V2_THEME.neutralItem("Electrical rectification — not yet assessed (only known after the safety check)") + V2_THEME.neutralItem("Removal of existing insulation (quoted separately if needed)") + V2_THEME.neutralItem("Unusual access or other extras");
  const hero = `${kicker("Your confirmed quote")}${h1("Your measured quote is ready")}${p(escape(intro))}${changed}${measured}`;
  const next = `${p("When you accept, you’ll choose 3 times for your electrical safety check and we’ll send the safety-check payment request.")}${placeholder("refund / cancellation terms for the safety-check fee")}`;
  const html = V2_THEME.shell(
    `${row(V2_THEME.header("Measured quote"), "22px 36px 18px")}${row(hero, "8px 36px 20px")}${row(mistBox("Your quote", quoteTable), "0 28px 16px")}${row(mistBox("What this includes", includes), "0 28px 12px")}${row(mistBox("What’s not included", excludes), "0 28px 16px")}${row(V2_THEME.button(input.acceptUrl, "Accept quote →"), "0 36px 14px")}${row(next, "0 36px 20px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, REASON))}`,
    previewText, null,
  );
  const plainText = [subject, "", "YOUR MEASURED QUOTE IS READY", "", intro, ...(input.areaChangedOver15pct ? ["", "Note: the measured area is different from the earlier estimate, so your quote has been updated to reflect the actual area measured onsite."] : []), "", `Measured ceiling area: ${input.measuredAreaM2} m²`, "", "YOUR QUOTE", `• Electrical safety check (PIESA): ${input.piesaFee}`, `• R5.0 ceiling insulation — supply & install: ${input.supplyInstall}`, `• Home Insulation Victoria management: ${input.apFee}`, `• VEU discount (${input.veecCount} × $70): −${input.veuDiscount}`, `• Total (inc GST): ${input.totalIncGst}`, "", "WHAT THIS INCLUDES", "• Supply and installation of R5.0 ceiling insulation for the measured area", "• Your electrical safety check (PIESA)", "• Your VEU discount, already applied above", "", "WHAT’S NOT INCLUDED", "• Electrical rectification — not yet assessed (only known after the safety check)", "• Removal of existing insulation (quoted separately if needed)", "• Unusual access or other extras", "", `Accept quote: ${input.acceptUrl}`, "When you accept, you’ll choose 3 times for your electrical safety check and we’ll send the safety-check payment request.", "[PLACEHOLDER: refund / cancellation terms for the safety-check fee]", "", ...V2_THEME.footerPlain(input.reference, null, REASON)].join("\n");
  return { subject, previewText, html, plainText };
}

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE 4 — Booking confirmation + consent (stage 3 · Booked).
// ───────────────────────────────────────────────────────────────────────────
export type BookingConsentInput = {
  firstName?: string | null;
  address?: string | null;
  installDate: string;
  installTime?: string | null;
  installerBusiness?: string | null;
  lifeSupport?: boolean;
  /** Pre-formatted amounts from the real payment arrangement; renderer does no math. */
  firstHalfAmount?: string | null;
  paidInFull?: boolean;
  bookingUrl: string;
  reference?: string | null;
};

export function renderBookingConsentEmail(input: BookingConsentInput): EstimateEmail {
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const where = input.address?.trim() || "your property";
  const installer = input.installerBusiness?.trim() || "your installer";
  const subject = `Your insulation install is booked — ${input.installDate}`;
  const previewText = `Your ceiling insulation install at ${where} is booked.`;
  const intro = `${name ? `Hi ${name}, great` : "Great"} news — your ceiling insulation install at ${escape(where)} is booked.`;
  const when = `<p style="margin:0 0 4px;${FH}color:${C.INK};font-size:22px;line-height:1.3;font-weight:800;">${escape(input.installDate)}${input.installTime ? ` at ${escape(input.installTime)}` : ""}</p>`;
  const prepare = V2_THEME.neutralItem("Please make sure the ceiling manhole / access point is clear.") + V2_THEME.neutralItem(`Your installer is ${installer}; you’ll see each other’s contact details for this visit.`) + (input.lifeSupport ? V2_THEME.neutralItem("We’ve noted life-support equipment at the property and will plan around it — please keep your plan in place.") : "");
  const power = p("There may be a short power interruption during the work. We’ll keep it to a minimum and let you know on the day.");
  const payment = input.paidInFull
    ? p("You’ve chosen to pay in full, so there’s nothing more to pay now.")
    : p(`To confirm the booking, we’re requesting the first 50%${input.firstHalfAmount ? ` (${escape(input.firstHalfAmount)})` : ""} of your balance now; the remaining 50% is due on install day.`);
  const consent = `${boxTitle("Consents")}${placeholder("owner consent wording required at install booking, and its deadline")}<p style="margin:6px 0 0;${F}color:${C.INK};font-size:13px;line-height:1.55;">We’ll also arrange the required electrical-safety notice before your install.</p>`;
  const hero = `${kicker("You’re booked")}${h1("Your install is booked")}${p(escape(intro))}${mistBox("Installation date", when)}`;
  const html = V2_THEME.shell(
    `${row(V2_THEME.header("Booking confirmed"), "22px 36px 18px")}${row(hero, "8px 36px 18px")}${row(mistBox("How to prepare", prepare), "0 28px 14px")}${row(power + payment, "0 36px 10px")}${row(V2_THEME.button(input.bookingUrl, "View booking & pay balance →"), "0 36px 14px")}${row(mistBox("Consents", consent), "0 28px 20px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, REASON))}`,
    previewText, null,
  );
  const plainText = [subject, "", "YOUR INSTALL IS BOOKED", "", intro, "", `${input.installDate}${input.installTime ? ` at ${input.installTime}` : ""}`, "", "HOW TO PREPARE", "• Please make sure the ceiling manhole / access point is clear.", `• Your installer is ${installer}; you’ll see each other’s contact details for this visit.`, ...(input.lifeSupport ? ["• We’ve noted life-support equipment at the property and will plan around it."] : []), "", "There may be a short power interruption during the work. We’ll keep it to a minimum and let you know on the day.", "", input.paidInFull ? "You’ve chosen to pay in full, so there’s nothing more to pay now." : `To confirm the booking, we’re requesting the first 50%${input.firstHalfAmount ? ` (${input.firstHalfAmount})` : ""} now; the remaining 50% is due on install day.`, "", `View booking & pay balance: ${input.bookingUrl}`, "", "CONSENTS", "[PLACEHOLDER: owner consent wording required at install booking, and its deadline]", "We’ll also arrange the required electrical-safety notice before your install.", "", ...V2_THEME.footerPlain(input.reference, null, REASON)].join("\n");
  return { subject, previewText, html, plainText };
}

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE 5 — Pre-installation pack (stage 4 · Before install; PIESA copy ≥24h before).
// ───────────────────────────────────────────────────────────────────────────
export type PreInstallPackInput = {
  firstName?: string | null;
  address?: string | null;
  installDate: string;
  lifeSupport?: boolean;
  documentsUrl: string;
  reference?: string | null;
};

export function renderPreInstallPackEmail(input: PreInstallPackInput): EstimateEmail {
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const where = input.address?.trim() || "your property";
  const subject = "Your electrical safety check & install details";
  const previewText = `Your electrical safety check and install details for ${where}.`;
  const intro = `${name ? `Hi ${name}, your` : "Your"} install at ${escape(where)} is coming up on ${escape(input.installDate)}. Here’s everything you need beforehand.`;
  const items = V2_THEME.neutralItem("Your electrical safety check (PIESA) — attached / available to download. This confirms the electrical safety assessment for your property.") + V2_THEME.neutralItem("What to expect on the day — your installer will arrive within the agreed window, complete an onsite safety check before any work, and keep any power interruption to a minimum.") + (input.lifeSupport ? V2_THEME.neutralItem("Life support — we’ve planned around the equipment you told us about.") : "");
  const hero = `${kicker("Before your install")}${h1("Your documents are ready")}${p(escape(intro))}`;
  const html = V2_THEME.shell(
    `${row(V2_THEME.header("Pre-install pack"), "22px 36px 18px")}${row(hero, "8px 36px 18px")}${row(mistBox("Your pre-install pack", items), "0 28px 16px")}${row(V2_THEME.button(input.documentsUrl, "View my documents →"), "0 36px 16px")}${row(p("If anything changes before your install, message us and we’ll sort it out."), "0 36px 20px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, REASON))}`,
    previewText, null,
  );
  const plainText = [subject, "", "YOUR DOCUMENTS ARE READY", "", intro, "", "• Your electrical safety check (PIESA) — attached / available to download.", "• What to expect on the day — your installer will arrive within the agreed window and complete an onsite safety check before any work.", ...(input.lifeSupport ? ["• Life support — we’ve planned around the equipment you told us about."] : []), "", `View my documents: ${input.documentsUrl}`, "", "If anything changes before your install, message us and we’ll sort it out.", "", ...V2_THEME.footerPlain(input.reference, null, REASON)].join("\n");
  return { subject, previewText, html, plainText };
}

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE 6 — VEEC assignment signing (stage 5 · After install). POST-INSTALL ONLY.
// Never requests a declaration of installation facts before installation. Official declaration
// wording and signing order are a [PLACEHOLDER] launch blocker — not invented here.
// ───────────────────────────────────────────────────────────────────────────
export type AssignmentSigningInput = {
  firstName?: string | null;
  address?: string | null;
  signingUrl: string;
  reference?: string | null;
};

export function renderAssignmentSigningEmail(input: AssignmentSigningInput): EstimateEmail {
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const where = input.address?.trim() || "your property";
  const subject = "One last step — sign your insulation documents";
  const previewText = `One last step to finalise your insulation at ${where}.`;
  const intro = `${name ? `Hi ${name}, your` : "Your"} ceiling insulation at ${escape(where)} has been installed and reviewed — thank you! There’s one last step to finalise everything.`;
  const items = V2_THEME.neutralItem("VEEC assignment form — this assigns the Victorian Energy Efficiency Certificates created by your upgrade.");
  const decl = placeholder("required owner declaration(s) and the verified signing order (post-install only)");
  const hero = `${kicker("One last step")}${h1("Sign your documents")}${p(escape(intro))}`;
  const html = V2_THEME.shell(
    `${row(V2_THEME.header("Signatures"), "22px 36px 18px")}${row(hero, "8px 36px 18px")}${row(mistBox("Please review and sign", items + decl), "0 28px 16px")}${row(V2_THEME.button(input.signingUrl, "Review & sign →"), "0 36px 16px")}${row(p("These are based on the actual completed installation. Once signed, we’ll finalise your certificates and send your completion pack."), "0 36px 20px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, REASON))}`,
    previewText, null,
  );
  const plainText = [subject, "", "SIGN YOUR DOCUMENTS", "", intro, "", "• VEEC assignment form — this assigns the Victorian Energy Efficiency Certificates created by your upgrade.", "[PLACEHOLDER: required owner declaration(s) and the verified signing order (post-install only)]", "", `Review & sign: ${input.signingUrl}`, "", "These are based on the actual completed installation. Once signed, we’ll finalise your certificates and send your completion pack.", "", ...V2_THEME.footerPlain(input.reference, null, REASON)].join("\n");
  return { subject, previewText, html, plainText };
}

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE 7 — Completion pack (stage 6 · Complete). Only after registry outcome recorded.
// ───────────────────────────────────────────────────────────────────────────
export type CompletionPackInput = {
  firstName?: string | null;
  address?: string | null;
  coesIncluded?: boolean;
  completionUrl: string;
  reference?: string | null;
};

export function renderCompletionPackEmail(input: CompletionPackInput): EstimateEmail {
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const where = input.address?.trim() || "your property";
  const subject = "All done! Your insulation completion pack";
  const previewText = `Your ceiling insulation upgrade at ${where} is complete.`;
  const intro = `${name ? `Hi ${name}, your` : "Your"} ceiling insulation upgrade at ${escape(where)} is complete — thank you for choosing Home Insulation Victoria.`;
  const items = V2_THEME.neutralItem("Completion documents for your records") + V2_THEME.neutralItem("Invoice & payment summary") + V2_THEME.neutralItem("VEEC assignment form (signed copy)") + (input.coesIncluded ? V2_THEME.neutralItem("Certificate of Electrical Safety (CoES) — included") : "") + V2_THEME.neutralItem("Warranty and manufacturer instructions") + V2_THEME.neutralItem("Dispute-resolution information — how to raise any concern");
  const contact = `${placeholder("AP contact details as required by the VEU Code of Conduct")}`;
  const hero = `${kicker("All done")}${h1("Your upgrade is complete")}${p(escape(intro))}`;
  const html = V2_THEME.shell(
    `${row(V2_THEME.header("Completion pack"), "22px 36px 18px")}${row(hero, "8px 36px 18px")}${row(mistBox("Here’s your completion pack", items), "0 28px 16px")}${row(V2_THEME.button(input.completionUrl, "View my completion pack →"), "0 36px 14px")}${row(p("If you ever have a question about your upgrade, just message us — our team is here to help."), "0 36px 6px")}${row(contact, "0 36px 20px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, REASON))}`,
    previewText, null,
  );
  const plainText = [subject, "", "YOUR UPGRADE IS COMPLETE", "", intro, "", "HERE’S YOUR COMPLETION PACK", "• Completion documents for your records", "• Invoice & payment summary", "• VEEC assignment form (signed copy)", ...(input.coesIncluded ? ["• Certificate of Electrical Safety (CoES) — included"] : []), "• Warranty and manufacturer instructions", "• Dispute-resolution information — how to raise any concern", "", `View my completion pack: ${input.completionUrl}`, "", "If you ever have a question about your upgrade, just message us — our team is here to help.", "[PLACEHOLDER: AP contact details as required by the VEU Code of Conduct]", "", ...V2_THEME.footerPlain(input.reference, null, REASON)].join("\n");
  return { subject, previewText, html, plainText };
}

/** Shared sample inputs for the office template-hub previews (presentation only; nothing sends). */
export const LIFECYCLE_SAMPLE = {
  firstName: "Alex",
  address: "30 Dash St, Fraser Rise VIC 3336",
  reference: "SAMPLE-1001",
} as const;
