/** Pure Step 3 renderer: no data access, delivery, or side effects. */
export type EstimateEmailInput = { estimateUrl: string; estimatedTotal: number; veuDiscount: number; areaM2: number };
export type EstimateEmail = { subject: string; previewText: string; html: string; plainText: string };

const BASE = "https://quote.homeinsulationvictoria.com.au";
const SUBJECT = "Good news — your home looks likely to qualify for a VEU insulation discount";
const PREVIEW = "Your personalised HI VIC estimate is ready — see your VEU discount, project price and next step.";
const INTRO = "Based on your answers and our initial checks, your property is a strong candidate for the VEU insulation discount. We just need to confirm the remaining onsite items before the final quote.";
const FOOTNOTE = "*Victorian Government estimates/averages. Actual savings vary with home, climate, energy use, energy prices and heating/cooling habits.";
const REASSURANCE = "You don't need to work out which trades meet the program requirements — we coordinate appropriately qualified participants for the job.";
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const cell = (content: string, padding = "0 0 22px") => `<tr><td style="padding:${padding};">${content}</td></tr>`;
const text = (content: string, extra = "") => `<p style="margin:0;font-size:14px;line-height:1.65;color:#22376B;${extra}">${content}</p>`;

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const link = new URL(input.estimateUrl);
  if (link.origin !== BASE || !/^\/estimate\/[A-Za-z0-9_-]+\/?$/.test(link.pathname) || link.search || link.hash) throw new Error("An HTTPS HI VIC estimate link is required.");
  if (![input.estimatedTotal, input.veuDiscount, input.areaM2].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Estimate values must be positive finite numbers.");
  const url = escape(link.toString());
  const total = escape(money(input.estimatedTotal));
  const discount = escape(money(input.veuDiscount));
  const area = escape(new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(input.areaM2));
  const headline = "Your home looks likely to qualify.";
  const why = "One managed pathway. The right qualified people. No chasing trades.";
  const assessment = "A licensed electrician employed by a Registered Electrical Contractor confirms ceiling area, existing insulation, access and electrical safety.";
  const points = [
    "PIESA by a licensed electrician employed by a Registered Electrical Contractor (REC)",
    "Insulation by an EEC Certified Insulation Installer (CII)",
    "HI VIC manages eligibility, assessment, quoting, compliance, evidence, installation coordination and VEEC processing",
    "Transparent HI VIC pricing — partner trades do not decide what the customer pays",
  ];
  const steps: Array<[string, string]> = [
    ["View your personalised estimate", "See your likely eligibility, estimated VEU discount, project price, energy-saving benefits and what's included."],
    ["Book your onsite Measure + PIESA — $349 inc GST", `${assessment} The $349 is already included in your indicative project total if you proceed — it is not an extra charge.`],
    ["We take it from there", "HI VIC prepares your final HI VIC-priced quote, coordinates the EEC Certified Insulation Installer, manages compliance/evidence, and takes the job through installation and VEEC processing."],
  ];

  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background-color:#FBFCFA;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#22376B;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(PREVIEW)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#FBFCFA;"><tr><td align="center" style="padding:22px 12px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;">
${cell(`<img src="${BASE}/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="205" height="88" style="display:block;width:205px;height:auto;max-width:100%;border:0;"><p style="margin:16px 0 0;color:#3C51C4;font-size:11px;line-height:1.5;font-weight:800;letter-spacing:2px;">YOUR PERSONALISED ESTIMATE</p>`, "24px 24px 22px")}
${cell(`<p style="margin:0 0 6px;color:#078E4A;font-size:11px;font-weight:800;letter-spacing:2px;">GOOD NEWS</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#22376B;font-weight:800;">${headline}</h1><p style="display:inline-block;margin:0 0 14px;padding:8px 12px;background-color:#ECF9F1;color:#22376B;border-radius:20px;font-size:11px;line-height:1.5;font-weight:800;">LIKELY ELIGIBLE — ONSITE CONFIRMATION NEEDED</p>${text(INTRO)}`, "0 24px 24px")}
${cell(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:2px solid #3C51C4;border-radius:12px;background-color:#F4F7FF;"><tr><td style="padding:22px 18px;"><p style="margin:0 0 8px;color:#3C51C4;font-size:12px;font-weight:800;letter-spacing:1px;">YOUR ESTIMATED HOME UPGRADE</p><p style="margin:0;color:#22376B;font-size:40px;line-height:1.15;font-weight:800;">${total} <span style="font-size:14px;font-weight:600;">inc GST</span></p><p style="margin:16px 0 10px;padding:9px 12px;background-color:#ECF9F1;color:#14683C;font-size:16px;font-weight:800;">Estimated VEU discount: −${discount}</p>${text(`Based on an estimated ${area} m² ceiling area, assuming your existing insulation can remain.`, "font-size:12px;")}</td></tr></table>`, "0 24px 28px")}
${cell(`<h2 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#3C51C4;">What this upgrade could mean for your home</h2><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#ECF9F1;"><tr><td style="padding:16px 16px 6px;">${text('<strong style="font-size:20px;color:#22376B;">$400+ / year*</strong><br>average potential energy-bill savings')}</td></tr><tr><td style="padding:8px 16px;">${text('<strong style="font-size:20px;color:#22376B;">Up to 20%*</strong><br>potential savings on heating &amp; cooling costs')}</td></tr><tr><td style="padding:8px 16px 16px;">${text('<strong style="font-size:18px;color:#22376B;">Warmer in winter. Cooler in summer.</strong><br>better year-round comfort')}</td></tr></table>${text(FOOTNOTE, "margin-top:10px;font-size:11px;")}`, "0 24px 28px")}
${cell(`<h2 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#3C51C4;">${why}</h2>${points.map((point) => text(`<span style="color:#07BF61;font-weight:800;">✓</span> ${escape(point)}`, "margin-top:10px;")).join("")}${text(REASSURANCE, "margin-top:14px;font-weight:700;")}`, "0 24px 28px")}
${cell(`<h2 style="margin:0 0 16px;font-size:20px;color:#3C51C4;">Here's what happens next</h2>${steps.map(([title, copy], i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td width="32" valign="top" style="padding:0 8px 18px 0;color:#07BF61;font-size:20px;font-weight:800;">${i + 1}.</td><td valign="top" style="padding:0 0 18px;">${text(`<strong>${escape(title)}</strong><br>${escape(copy)}`)}</td></tr></table>`).join("")}`, "0 24px 6px")}
${cell(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="background-color:#07BF61;border-radius:8px;"><a href="${url}" style="display:block;padding:16px 18px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;">VIEW MY ESTIMATE</a></td></tr></table>${text("Your secure estimate link is personal to your property.", "margin-top:10px;font-size:12px;text-align:center;")}`, "0 24px 30px")}
${cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF0FC;"><tr><td style="padding:18px;"><h2 style="margin:0 0 8px;font-size:17px;color:#3C51C4;">Transparent HI VIC pricing</h2>${text("Once onsite facts are confirmed, your final quote is calculated from our set customer rate card. Partner electricians and installers do not decide what you pay.")}</td></tr></table>`, "0 24px 28px")}
${cell(`${text("Home Insulation Victoria", "font-weight:800;")}${text("DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", "font-size:12px;")}${text('<a href="https://homeinsulationvictoria.com.au" style="color:#3C51C4;text-decoration:underline;">homeinsulationvictoria.com.au</a>', "font-size:12px;")}`, "18px 24px 28px;border-top:1px solid #EEF0FC;")}
</table></td></tr></table></body></html>`;

  const plainText = `${SUBJECT}\n\nYOUR PERSONALISED ESTIMATE\n\nGOOD NEWS\n${headline}\nLIKELY ELIGIBLE — ONSITE CONFIRMATION NEEDED\n${INTRO}\n\nYOUR ESTIMATED HOME UPGRADE\n${total} inc GST\nEstimated VEU discount: −${discount}\nBased on an estimated ${area} m² ceiling area, assuming your existing insulation can remain.\n\nWHAT THIS UPGRADE COULD MEAN FOR YOUR HOME\n$400+ / year* — average potential energy-bill savings\nUp to 20%* — potential savings on heating & cooling costs\nWarmer in winter. Cooler in summer. — better year-round comfort\n${FOOTNOTE}\n\n${why}\n${points.map((point) => `✓ ${point}`).join("\n")}\n${REASSURANCE}\n\nHere's what happens next\n${steps.map(([title, copy], i) => `${i + 1}. ${title}\n${copy}`).join("\n\n")}\n\nVIEW MY ESTIMATE: ${link.toString()}\nYour secure estimate link is personal to your property.\n\nTransparent HI VIC pricing\nOnce onsite facts are confirmed, your final quote is calculated from our set customer rate card. Partner electricians and installers do not decide what you pay.\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd t/a Home Insulation Victoria\nhomeinsulationvictoria.com.au`;
  return { subject: SUBJECT, previewText: PREVIEW, html, plainText };
}