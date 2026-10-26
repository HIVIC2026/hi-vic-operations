// After-install owner emails (Jo 24 Oct 2026, decisions 101–105, 119–120, 132–133).
//   O44 "All done!"            docs/templates/mjml/owner_O44.mjml     (summary card, sign your rebate form, what you'll get)
//   O45 Final invoice          docs/templates/mjml/invoices_O45.mjml  (tax invoice lines, balance due today; decision 334: pay by bank transfer)
//   O47 Completion pack        docs/templates/mjml/owner_O47.mjml     (downloads, who to contact, care tips)
//   O51 Review request         docs/templates/mjml/owner_O51.mjml     (tap a star, Google review, refer a friend)
// O44 is approved (decision 169, Jo 24 Oct): it is the day-0 VEEC signing request, sent by veec-reminders.server.ts
// through approved-owner-emails.server.ts when the install is recorded complete. O45/O47/O51 are approved too
// (COMPLETION_EMAILS_APPROVED, decisions 133/103/105) and go through the same guarded sender. Pure.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { AP_DETAILS } from "./veec-assignment-form.core";
import { insulationLineWithCodes } from "./invoice-itemisation.core";
import { bankDetailLines, type BankDetails } from "./payments.core";

/** Decision 209: the installed product line as it appears on the Xero invoice, with the exact ESC model code(s) when known. */
export type InstalledLine = { description: string; escModelCodes: string[] };
/** Contracting business line for the tax invoice: name, address (AP company address on file) and ABN. */
export const BUSINESS_LINE = [`${K.ENTITY_LINE} trading as Home Insulation Victoria`, AP_DETAILS.companyAddress?.trim() || null, K.ABN_LINE, `VEU Accredited Person ${K.AP_NUMBER}`].filter(Boolean).join(" · ");

/** Jo 24 Oct 2026: O45 final invoice (decision 133), O47 completion pack (decision 103), O51 review request (decision 105) approved. Delivery still behind customer_comms_enabled. */
export const COMPLETION_EMAILS_APPROVED = true as boolean;
/** Decision 169: the All done email carries the rebate-form signing request, so it goes to real owners (behind customer_comms_enabled). */
export const INSTALL_COMPLETE_EMAIL_APPROVED = true as boolean;

type Installer = { name: string | null; phone?: string | null };
const installerLine = (ins: Installer | null | undefined, action: string) => {
  const name = ins?.name?.trim() || "your installer";
  return `Something not right? Contact ${name} first${ins?.phone?.trim() ? ` on ${ins.phone.trim()}` : ""}${action}`;
};

export type InstallCompleteInput = {
  firstName: string | null; installer: Installer | null; product: string | null; areaM2: number | null; rebate: number | null;
  balancePaid: boolean; signRebateFormUrl: string | null; test?: boolean;
  /** Decision 321: product names whose manufacturer warranty PDF is attached to this email; [] / omitted = none attached. */
  attachedWarranties?: string[];
};

/** Decision 321: the one line O44 / O47 print when a manufacturer warranty PDF is attached (null = none attached). */
export function attachedWarrantyLine(names: readonly string[] | null | undefined): string | null {
  const n = (names ?? []).map((s) => s.trim()).filter(Boolean);
  return n.length ? `Attached: your ${n.join(" and ")} manufacturer's warranty (PDF). Keep it with your home's paperwork.` : null;
}

const BT = "border-top:1px solid #E4E9F5;";
/** Numbered rows inside a panel-card table (the designs' "What you'll get" / "Something not right?" cards). */
const numRows = (steps: K.Step[]) => steps.map((s, n) => {
  const pad = n === steps.length - 1 ? 12 : 14;
  return `<tr><td width="34" valign="top" style="padding:1px 0 ${pad}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${pad}px;"><strong>${esc(s.title)}</strong>${s.detail ? `<br /><span class="muted">${esc(s.detail)}</span>` : ""}</td></tr>`;
}).join("");
const tickRows = (items: string[]) => items.map((t) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 12px;">${esc(t)}</td></tr>`).join("");

/** Decision 101/119: "All done, {First}. Enjoy a warmer home!" with the rebate-form signing request. */
export function renderInstallCompleteEmail(i: InstallCompleteInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installer?.name?.trim() || "Your installer";
  const subject = `All done, ${first}. Enjoy a warmer home!`;
  const intro = `${installer} finished installing your ceiling insulation today. You should notice the difference straight away: warmer winters, cooler summers and lower heating and cooling bills.`;
  const rows: { k: string; v: string; green?: boolean; nowrap?: boolean }[] = [
    ...(i.product || i.areaM2 ? [{ k: "Installed", v: [i.areaM2 ? K.m2(i.areaM2) : null, i.product?.trim() || null].filter(Boolean).join(" ") }] : []),
    ...(i.rebate && i.rebate > 0 ? [{ k: "Your VEU rebate", v: `${K.whole(i.rebate)} off`, green: true, nowrap: true }] : []),
    { k: "Balance", v: i.balancePaid ? "Paid in full ✓" : "Due today", nowrap: true },
  ];
  const signTitle = "One last thing: sign your rebate form";
  const signBody = "It confirms what was installed. It also assigns the rebate you've already had off your price to us, so we can claim it. It takes a minute, and you'll get a copy straight away.";
  const steps: K.Step[] = [
    { title: "Your completion pack", detail: "Tax invoice, Certificate of Completion, your installer's 1-year workmanship warranty, the 5-year product warranty, care tips and every signed form, in one place." },
    { title: "A copy of your signed rebate form", detail: "Emailed to you as soon as you sign." },
  ];
  const closing = installerLine(i.installer, ". Not sorted? Reply to this email and we'll help.");
  const warrantyLine = attachedWarrantyLine(i.attachedWarranties);
  const preview = i.signRebateFormUrl ? "One last thing: sign your rebate form. It takes a minute." : intro;
  const rowHtml = rows.map((r, n) => {
    const top = n === 0 ? "" : BT;
    return `<tr><td style="padding:10px 0;${top}color:#5A6785;">${esc(r.k)}</td><td align="right" style="padding:10px 0 10px 12px;${top}${r.nowrap ? "white-space:nowrap;" : ""}${r.green ? "color:#057D40;" : ""}"><strong>${esc(r.v)}</strong></td></tr>`;
  }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-table padding="8px 18px 8px">${rowHtml}</mj-table></mj-column></mj-section>`,
    warrantyLine ? `<mj-section><mj-column><mj-text mj-class="small" padding="10px 12px 0">${esc(warrantyLine)}</mj-text></mj-column></mj-section>` : "",
    i.signRebateFormUrl ? `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">${esc(signTitle)}</mj-text><mj-text>${esc(signBody)}</mj-text><mj-button href="${esc(i.signRebateFormUrl)}">Sign your rebate form</mj-button></mj-column></mj-section>` : "",
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What you'll get from us</mj-text><mj-table padding="0 18px 6px">${numRows(steps)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", intro, "", ...rows.map((r) => `${r.k}: ${r.v}`), ...(warrantyLine ? [warrantyLine] : []), "", ...(i.signRebateFormUrl ? [signTitle.toUpperCase(), signBody, `Sign your rebate form: ${i.signRebateFormUrl}`, ""] : []), "WHAT YOU'LL GET FROM US", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}

export type FinalInvoiceInput = {
  firstName: string | null; ownerName: string | null; address: string | null; installer: Installer | null;
  invoiceNumber: string; invoiceDate: string;
  lines: { description: string; amount: number }[];
  totalIncGst: number; gst: number | null; rebate: number;
  payments: { label: string; amount: number }[];
  /** Decision 334 (Jo 25 Oct 2026): the balance is paid by bank transfer only (card stays for the safety check and fixes,
   *  decisions 140/144). Bank details from HIV_BANK_* (payments.server bankDetails); the invoice number is the reference. */
  balanceDue: number; bank: BankDetails; test?: boolean;
  /** Decision 334: "Invoice PDF attached" prints only when the Xero invoice PDF really is attached. */
  invoicePdfAttached?: boolean;
  /** Decision 209: installed product itemisation (brand, model, R-value, m², ESC model codes); omitted when unknown. */
  installed?: InstalledLine | null;
};

/** Jo's rule: "Accredited Person", never "Accredited Provider" (the O45 design fixes the AP fee line's wording; the amount is unchanged). */
const apWording = (s: string) => s.replace(/Accredited Provider/g, "Accredited Person");

/** payments.core bankDetailLines → label/value rows for the design's bank table; null when a line isn't one of those
 *  shapes (e.g. "Bank details: … to be confirmed"), so the lines are shown as they are. */
function bankRows(lines: string[]): { k: string; v: string }[] | null {
  const rows: { k: string; v: string }[] = [];
  for (const l of lines) {
    const bsb = /^BSB (\S+) · Account (\S+)$/.exec(l);
    const kv = /^(Account name|PayID|Reference|Amount): (.+)$/.exec(l);
    if (bsb) rows.push({ k: "BSB", v: bsb[1]! }, { k: "Account", v: bsb[2]! });
    else if (kv) rows.push({ k: kv[1]!, v: kv[2]! });
    else return null;
  }
  return rows.length ? rows : null;
}

/** Decision 133: full tax invoice in HIV's name, VEEC incentive as a price reduction, payments so far, balance due today.
 *  Decision 209: header carries the energy consumer, installation address, business name/address/ABN and the installed product line.
 *  Decision 334: no card wording or Pay button — "Pay by bank transfer" with the bank details and the invoice number as the reference. */
export function renderFinalInvoiceEmail(i: FinalInvoiceInput) {
  if (!i.invoiceNumber?.trim()) throw new Error("Invoice number is unavailable.");
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installer?.name?.trim() || "Your installer";
  const subject = `${first}, your install is done. Here's your final invoice`;
  const intro = `${installer} finished today. Your balance is due today, as agreed when you booked. Please pay by bank transfer using the details below, with your invoice number as the reference.`;
  const balance = K.cents(i.balanceDue);
  const ref = i.invoiceNumber.trim();
  const preview = `Balance due today: ${balance} by bank transfer, reference ${ref}.`;
  const gstNote = i.gst != null ? `(GST ${K.cents(i.gst)})` : null;
  const rows: { label: string; amount: string; bold?: boolean; green?: boolean; note?: string | null }[] = [
    ...i.lines.map((l) => ({ label: apWording(l.description), amount: K.cents(l.amount) })),
    { label: "Total incl. GST", note: gstNote, amount: K.cents(i.totalIncGst), bold: true },
    { label: "VEEC incentive (your VEU rebate, price reduction)", amount: `−${K.cents(i.rebate)}`, green: true },
    { label: "Amount after VEEC incentive", amount: K.cents(i.totalIncGst - i.rebate), bold: true },
    ...i.payments.map((p) => ({ label: `Paid: ${p.label}`, amount: `−${K.cents(p.amount)}` })),
  ];
  const who = [
    ...(i.ownerName?.trim() ? [["To", i.ownerName.trim()]] : []),
    ...(i.address?.trim() ? [["Installation address", i.address.trim()]] : []),
    ...(i.installed ? [["Installed", insulationLineWithCodes(i.installed)]] : []),
  ] as [string, string][];
  const meta = [BUSINESS_LINE, ...who.map(([k, v]) => `${k}: ${v}`)];
  const bankLines = [...bankDetailLines(i.bank, ref), `Amount: ${balance}`];
  const pdfLine = i.invoicePdfAttached === true ? "Invoice PDF attached" : null;
  const after = "Once it's paid, we'll send your completion pack: certificate, warranties and all your signed forms. You'll also get a short text asking you to sign your rebate form, if you haven't already.";
  const closing = installerLine(i.installer, ", or reply to this email.");
  const money = (a: string) => esc(a).replace(/^−/, "&#8722;");
  const rowHtml = [...rows.map((r, n) => {
    const top = n === 0 ? "" : BT;
    const green = r.green ? "color:#057D40;" : "";
    const label = `${r.bold ? `<strong>${esc(r.label)}</strong>` : esc(r.label)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ""}`;
    return `<tr><td valign="top" style="padding:9px 0;${top}${green}">${label}</td><td align="right" valign="top" style="padding:9px 0 9px 12px;white-space:nowrap;${top}${green}">${r.bold ? `<strong>${money(r.amount)}</strong>` : money(r.amount)}</td></tr>`;
  }), `<tr><td valign="top" style="padding:9px 0;border-top:2px solid #22376B;"><strong>Balance due today</strong></td><td align="right" valign="top" style="padding:9px 0 9px 12px;white-space:nowrap;border-top:2px solid #22376B;"><strong>${esc(balance)}</strong></td></tr>`].join("");
  const bRows = bankRows(bankLines);
  const bankHtml = bRows
    ? `<mj-table padding="0 18px 14px">${bRows.map((r, n) => { const top = n === 0 ? "" : BT; return `<tr><td style="padding:8px 0;${top}color:#5A6785;">${esc(r.k)}</td><td align="right" style="padding:8px 0 8px 12px;${top}${r.k === "Account name" || r.k === "PayID" ? "" : "white-space:nowrap;"}"><strong>${esc(r.v)}</strong></td></tr>`; }).join("")}</mj-table>`
    : `<mj-text padding="0 18px 16px">${bankLines.map(esc).join("<br />")}</mj-text>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Balance due today</mj-text><mj-text mj-class="big-blue" padding="0 12px 18px">${esc(balance)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 2px">Tax invoice ${esc(ref)}</mj-text><mj-text mj-class="small" padding="0 18px 12px">${esc(i.invoiceDate)}</mj-text><mj-text mj-class="small" padding="0 18px 10px">${esc(BUSINESS_LINE)}</mj-text>${who.length ? `<mj-text font-size="14px" line-height="21px" padding="0 18px 12px">${who.map(([k, v]) => `<strong>${esc(k)}:</strong> ${esc(v)}`).join("<br />")}</mj-text>` : ""}<mj-table padding="0 18px 12px" font-size="14px" line-height="20px">${rowHtml}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="h2" padding="18px 18px 8px">Pay by bank transfer</mj-text>${bankHtml}</mj-column></mj-section>`,
    `<mj-section><mj-column>${pdfLine ? `<mj-text mj-class="small center" padding="10px 12px 0">${esc(pdfLine)}</mj-text>` : ""}<mj-text padding="16px 12px 14px">${esc(after)}</mj-text><mj-text mj-class="small" padding="0 12px">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", intro, "", `Balance due today: ${balance}`, "", `TAX INVOICE ${ref} · ${i.invoiceDate}`, ...meta, ...rows.map((r) => `${r.label}${r.note ? ` ${r.note}` : ""}: ${r.amount}`), `Balance due today: ${balance}`, "", "PAY BY BANK TRANSFER", ...bankLines, ...(pdfLine ? [pdfLine] : []), "", after, "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}

export type CompletionPackInput = {
  firstName: string | null; installer: Installer | null;
  downloads: { certificateUrl: string | null; invoiceUrl: string | null; warrantiesUrl: string | null; signedFormsUrl: string | null };
  test?: boolean;
  /** Decision 209: the same installed product line as the tax invoice (with ESC model codes when known); omitted when unknown. */
  installed?: InstalledLine | null;
  /** VEU checklist G1: product names whose manufacturer warranty PDF is attached to this email (completion-pack.server.ts); [] = none attached. */
  attachedWarranties?: string[];
  /** Decision 322: the electrician's Certificate of Electrical Safety (A4 fixes form) is attached to this email. */
  attachedCoes?: boolean;
};

/** Decision 103: downloads, "Something not right?" (installer → us → ESC), care tips. */
export function renderCompletionPackEmail(i: CompletionPackInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Your completion pack, ${first}`;
  const intro = "Everything about your new ceiling insulation in one place. Keep this email. It's handy if you sell your home or need your warranty.";
  const preview = "Your certificate, invoice, warranties and signed forms. Keep this email, it's handy if you sell your home.";
  const attachedNames = (i.attachedWarranties ?? []).map((s) => s.trim()).filter(Boolean);
  const warrantyDetail = `1-year installer workmanship · 5-year product warranty${attachedNames.length ? ` · ${attachedNames.join(" and ")} manufacturer's warranty attached (PDF)` : ""}`;
  const downloads = [
    { title: "Certificate of Completion", detail: "Product, R-value, area, installer, date and rebate", href: i.downloads.certificateUrl },
    { title: "Tax invoice", detail: "Paid in full", href: i.downloads.invoiceUrl },
    { title: "Your warranties", detail: warrantyDetail, href: i.downloads.warrantiesUrl },
    { title: "Signed forms", detail: "Acceptance, install consent, rebate form, safety check", href: i.downloads.signedFormsUrl },
    ...(i.attachedCoes ? [{ title: "Certificate of Electrical Safety", detail: "From your electrician's fixes visit, attached to this email", href: null as string | null }] : []),
  ];
  const ins = i.installer?.name?.trim() || "your installer";
  const steps: K.Step[] = [
    { title: "Contact your installer first", detail: `${ins}${i.installer?.phone?.trim() ? ` · ${i.installer.phone.trim()}` : ""}. Workmanship is covered for 1 year.` },
    { title: "Not sorted? Contact us", detail: "Reply to this email and we'll help sort it out." },
    { title: "Still not resolved?", detail: "You can contact the Essential Services Commission, which runs the VEU program." },
  ];
  const care = [
    "Don't move, squash or walk on the batts. They work best fluffed up.",
    "If a tradie works in your ceiling, ask them to put the insulation back as they found it.",
    "Adding new downlights later? Make sure they're IC-rated. That means they're safe to cover with insulation.",
  ];
  const closing = "Thanks for choosing Home Insulation Victoria. Your pack is always on your job page too.";
  const installed = i.installed ? `Installed: ${insulationLineWithCodes(i.installed)}` : null;
  const codes = i.installed?.escModelCodes.length ? `ESC model ${i.installed.escModelCodes.join(", ")}` : null;
  const dlHtml = downloads.map((d, n) => {
    const top = n === 0 ? "" : BT;
    return `<tr><td valign="top" style="padding:12px 0;${top}"><strong>&#128196; ${esc(d.title)}</strong><br /><span class="muted">${esc(d.detail)}</span></td><td align="right" valign="top" style="padding:12px 0 12px 12px;white-space:nowrap;${top}">${d.href ? `<a href="${esc(d.href)}" style="color:#3C51C4;font-weight:700;">Download</a>` : `<span class="muted">On your job page</span>`}</td></tr>`;
  }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    i.installed ? `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow" padding="18px 18px 4px">Installed</mj-text><mj-text padding="0 18px 16px"><strong>${esc(i.installed.description)}</strong>${codes ? `<br /><span class="muted">${esc(codes)}</span>` : ""}</mj-text></mj-column></mj-section>` : "",
    `<mj-section><mj-column mj-class="panel-card"><mj-table padding="6px 18px 6px">${dlHtml}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Something not right?</mj-text><mj-table padding="0 18px 6px">${numRows(steps)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Looking after your insulation</mj-text><mj-table padding="0 18px 6px">${tickRows(care)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", intro, ...(installed ? [installed] : []), "", "YOUR DOCUMENTS", ...downloads.map((d) => `${d.title} (${d.detail})${d.href ? `: ${d.href}` : " — on your job page"}`), "", "SOMETHING NOT RIGHT?", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", "LOOKING AFTER YOUR INSULATION", ...care.map((c) => `✓ ${c}`), "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}

export type ReviewRequestInput = {
  firstName: string | null; installer: Installer | null; starUrl: (stars: number) => string; googleReviewUrl: string; referralUrl: string; test?: boolean;
};

/** Decision 105: a week after install — tap a star, Google review, refer a friend, installer-first contact line. */
export function renderReviewRequestEmail(i: ReviewRequestInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installer?.name?.trim() || "your installer";
  const subject = `${first}, how's your home feeling?`;
  const intro = `It's been a week since ${installer} installed your ceiling insulation. We'd love to know how we went.`;
  const preview = "It's been a week since your install. Tap a star to tell us how we went.";
  const google = "Happy with everything? A quick Google review helps other Victorians find the rebate too.";
  const friendTitle = "Know someone with a cold house?";
  const friendBody = "Send them our free eligibility checker. It takes a minute, and they could get the rebate too.";
  const closing = installerLine(i.installer, ", or reply to this email and we'll help.");
  const stars = [1, 2, 3, 4, 5].map((n) => `<td align="center" style="padding:0 3px;"><a href="${esc(i.starUrl(n))}" title="${n} star${n > 1 ? "s" : ""}" style="display:block;font-size:34px;line-height:44px;color:#F5A623;text-decoration:none;">&#9733;</a></td>`).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Tap a star</mj-text><mj-table align="center" width="250px" padding="0 12px 16px"><tr>${stars}</tr></mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="18px 12px 14px">${esc(google)}</mj-text><mj-button href="${esc(i.googleReviewUrl)}">Leave a Google review</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">${esc(friendTitle)}</mj-text><mj-text padding="0 18px 8px">${esc(friendBody)}</mj-text><mj-text padding="0 18px 16px"><a href="${esc(i.referralUrl)}" style="color:#3C51C4;font-weight:700;">Send to a friend &#8594;</a></mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", intro, "", "TAP A STAR", ...[1, 2, 3, 4, 5].map((n) => `${n} star${n > 1 ? "s" : ""}: ${i.starUrl(n)}`), "", google, `Leave a Google review: ${i.googleReviewUrl}`, "", friendTitle.toUpperCase(), friendBody, `Send to a friend: ${i.referralUrl}`, "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}
