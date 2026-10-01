/** Pure service-availability update email, in the approved outcome-email theme. No data access or delivery. */
import { escape, V2_THEME, type EstimateEmail } from "./estimate-email";

export function renderCoverageUnavailableEmail(input: { firstName?: string | null; suburb?: string | null; postcode?: string | null; missing: Array<"REC / electrician" | "installer">; reference?: string | null }): EstimateEmail {
  const { F, FH, colors: C } = V2_THEME;
  const area = [input.suburb, input.postcode].filter(Boolean).join(" ") || "your area";
  const missing = input.missing.join(" and ");
  const subject = `An update about Home Insulation Victoria service availability in ${area}`;
  const previewText = `Home Insulation Victoria service availability update for ${area}.`;
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const intro = `${name ? `Hi ${name}, thank` : "Thank"} you for your Home Insulation Victoria enquiry. We have completed our initial check, but we do not currently have an approved ${missing} with verified coverage for ${area}.`;
  const next = ["We will keep your enquiry on file while we review coverage.", "We will contact you if suitable local availability changes.", "You do not need to pay anything or take any further action."];
  const reason = "You’re receiving this because you requested an eligibility check.";
  const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
  const hero = `<p style="margin:0 0 8px;${F}color:${C.TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Service availability</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${C.INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">An update about service in your area</h1><p class="lx-body" style="margin:0;${F}color:${C.INK};font-size:15px;line-height:1.6;">${escape(intro)}</p>`;
  const box = `<table data-coverage-next="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.MIST}" style="width:100%;border-collapse:separate;background-color:${C.MIST};border-radius:18px;"><tr><td class="lx-result-pad" style="padding:20px 20px;${F}"><p style="margin:0 0 10px;${FH}color:${C.INK};font-size:17px;line-height:1.3;font-weight:800;">What happens next</p>${next.map(V2_THEME.neutralItem).join("")}</td></tr></table>`;
  const contact = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.BLUSH}" style="width:100%;border-collapse:separate;background-color:${C.BLUSH};border-radius:20px;"><tr><td style="padding:20px 22px;${F}"><h2 style="margin:0 0 8px;${FH}color:${C.INK};font-size:20px;line-height:1.25;font-weight:800;">Questions in the meantime?</h2><p class="lx-body" style="margin:0;${F}color:${C.INK};font-size:14px;line-height:1.55;">You can <a href="${V2_THEME.site}/contact" style="color:${C.BLUE};font-weight:800;text-decoration:underline;">contact us</a> any time.</p></td></tr></table>`;
  const html = V2_THEME.shell(`${row(V2_THEME.header("Service update"), "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(box, "0 28px 18px")}${row(contact, "0 28px 24px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, reason))}`, previewText, null);
  const plainText = [subject, "", "An update about service in your area", "", intro, "", "WHAT HAPPENS NEXT", ...next.map((n) => `• ${n}`), "", "QUESTIONS IN THE MEANTIME?", `Contact us: ${V2_THEME.site}/contact`, "", ...V2_THEME.footerPlain(input.reference, null, reason)].join("\n");
  return { subject, previewText, html, plainText };
}
