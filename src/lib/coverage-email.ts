import { CUSTOMER_BRAND } from "./customer-quote-system";
import { escape, type EstimateEmail } from "./estimate-email";

export function renderCoverageUnavailableEmail(input: { firstName?: string | null; suburb?: string | null; postcode?: string | null; missing: Array<"REC / electrician" | "installer">; reference?: string | null }): EstimateEmail {
  const area = [input.suburb, input.postcode].filter(Boolean).join(" ") || "your area";
  const missing = input.missing.join(" and ");
  const subject = `An update about HI VIC service availability in ${area}`;
  const intro = input.firstName ? `Hi ${input.firstName},` : "Hi there,";
  const body = `Thank you for your Home Insulation Victoria enquiry. We have completed our initial check, but we do not currently have an approved ${missing} with verified coverage for ${area}.`;
  const next = "We will keep your enquiry on file while we review coverage. We will contact you if suitable local availability changes. You do not need to pay anything or take any further action.";
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#FBFCFA;color:#22376B;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" style="max-width:600px;background:#ffffff;border:1px solid #DDE2EE"><tr><td style="padding:24px"><img src="${escape(CUSTOMER_BRAND.logoUrl)}" width="180" alt="Home Insulation Victoria" style="display:block;max-width:180px;height:auto"></td></tr><tr><td style="padding:4px 24px 28px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 20px">Service availability update</h1><p style="font-size:16px;line-height:1.6">${escape(intro)}</p><p style="font-size:16px;line-height:1.6">${escape(body)}</p><p style="font-size:16px;line-height:1.6">${escape(next)}</p><p style="font-size:13px;color:#5A6785;margin-top:28px">Home Insulation Victoria<br>DC Construction Solutions Pty Ltd${input.reference ? `<br>Reference: ${escape(input.reference)}` : ""}</p></td></tr></table></td></tr></table></body></html>`;
  const plainText = `${subject}\n\n${intro}\n\n${body}\n\n${next}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd${input.reference ? `\nReference: ${input.reference}` : ""}`;
  return { subject, previewText: `HI VIC service availability update for ${area}.`, html, plainText };
}