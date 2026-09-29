/** Pure preliminary-ineligible outcome email renderer. No price, no booking CTA, no unrelated offers. No data access or delivery. */
import { escape, validReferralUrl, type EstimateEmail } from "./estimate-email";

export type IneligibleEmailInput = { referralUrl: string; reason?: string | null };

export const INELIGIBLE_SUBJECT = "Your HI VIC eligibility check";
const LEAD = "Unfortunately, based on the answers you provided, this property doesn’t appear eligible for this VEU ceiling-insulation offer.";
const REFER_HEAD = "Know someone who could benefit?";
const REFER_BODY = "This property may not qualify, but someone you know might. Share HI VIC and they can check in just a few minutes.";
const CTA = "REFER A FRIEND";

/** Keeps only a short, plain customer-safe reason (no markup, no internal codes). */
export function safeReason(r: string | null | undefined): string | null {
  if (!r) return null;
  const t = r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!t || /[_]{1}[a-z]+_/.test(t) || /review required/i.test(t)) return null;
  return t.slice(0, 400);
}

const p = (html: string, style = "") => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#22376B;${style}">${html}</p>`;

export function renderIneligibleEmail(input: IneligibleEmailInput): EstimateEmail {
  const referral = validReferralUrl(input.referralUrl);
  if (!referral) throw new Error("A HI VIC referral link is required.");
  const reason = safeReason(input.reason);
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(INELIGIBLE_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#FBFCFA;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#22376B;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(REFER_HEAD)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#FBFCFA;"><tr><td align="center" style="padding:22px 12px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;">
<tr><td style="padding:24px 24px 18px;"><img src="https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="205" height="88" style="display:block;width:205px;height:auto;max-width:100%;border:0;"></td></tr>
<tr><td style="padding:0 24px 8px;"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#3C51C4;font-weight:800;">${escape(INELIGIBLE_SUBJECT)}</h1>${p(escape(LEAD))}${reason ? p(`<strong>Reason:</strong> ${escape(reason)}`) : ""}</td></tr>
<tr><td style="padding:8px 24px 8px;"><h2 style="margin:0 0 10px;font-size:19px;color:#3C51C4;font-weight:800;">${escape(REFER_HEAD)}</h2>${p(escape(REFER_BODY))}</td></tr>
<tr><td style="padding:4px 24px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="background-color:#07BF61;border-radius:8px;"><a href="${escape(referral)}" style="display:block;padding:16px 18px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;">${CTA}</a></td></tr></table></td></tr>
<tr><td style="padding:18px 24px 28px;border-top:1px solid #EEF0FC;">${p("Home Insulation Victoria", "font-weight:800;margin:0;")}${p("DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", "font-size:12px;margin:0;")}${p('<a href="https://homeinsulationvictoria.com.au" style="color:#3C51C4;text-decoration:underline;">homeinsulationvictoria.com.au</a>', "font-size:12px;margin:0;")}</td></tr>
</table></td></tr></table></body></html>`;
  const plainText = `${INELIGIBLE_SUBJECT}\n\n${LEAD}${reason ? `\n\nReason: ${reason}` : ""}\n\n${REFER_HEAD}\n${REFER_BODY}\n\n${CTA}: ${referral}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd t/a Home Insulation Victoria\nhomeinsulationvictoria.com.au`;
  return { subject: INELIGIBLE_SUBJECT, previewText: REFER_HEAD, html, plainText };
}
