// After-install owner emails (Jo 24 Oct 2026, decisions 101–105, 119–120, 132–133).
//   O44 "All done!"            docs/templates/approved/O44-install-complete.html  (summary card, sign your rebate form, what you'll get)
//   O45 Final invoice          docs/templates/approved/O45-final-invoice.html     (tax invoice lines, balance due today, Pay button)
//   O47 Completion pack        docs/templates/approved/O47-completion-pack.html   (downloads, who to contact, care tips)
//   O51 Review request         docs/templates/approved/O51-review.html           (tap a star, Google review, refer a friend)
// O44 is approved (decision 169, Jo 24 Oct): it is the day-0 VEEC signing request, sent by veec-reminders.server.ts
// through approved-owner-emails.server.ts when the install is recorded complete. O45/O47/O51 are approved too
// (COMPLETION_EMAILS_APPROVED, decisions 133/103/105) and go through the same guarded sender. Pure.
import * as K from "./email-kit.core";
import { AP_DETAILS } from "./veec-assignment-form.core";
import { insulationLineWithCodes } from "./invoice-itemisation.core";

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
};

/** Decision 101/119: "All done, {First}. Enjoy a warmer home!" with the rebate-form signing request. */
export function renderInstallCompleteEmail(i: InstallCompleteInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installer?.name?.trim() || "Your installer";
  const subject = `All done, ${first}. Enjoy a warmer home!`;
  const intro = `${installer} finished installing your ceiling insulation today. You should notice the difference straight away: warmer winters, cooler summers and lower heating and cooling bills.`;
  const rows = [
    ...(i.product || i.areaM2 ? [{ k: "Installed", v: [i.areaM2 ? K.m2(i.areaM2) : null, i.product?.trim() || null].filter(Boolean).join(" ") }] : []),
    ...(i.rebate && i.rebate > 0 ? [{ k: "Your VEU rebate", v: `${K.whole(i.rebate)} off`, color: K.KIT.GREEN }] : []),
    { k: "Balance", v: i.balancePaid ? "Paid in full ✓" : "Due today", color: i.balancePaid ? K.KIT.GREEN : K.KIT.NAVY },
  ];
  const signBody = "It confirms what was installed and assigns the rebate you've already had off your price to us, so we can claim it. It takes a minute, and you'll get a copy straight away.";
  const steps: K.Step[] = [
    { title: "Your completion pack", detail: "Tax invoice, Certificate of Completion, your installer's 1-year workmanship warranty and the 5-year product warranty, care tips and every signed form, in one place." },
    { title: "A copy of your signed rebate form", detail: "Emailed to you as soon as you sign." },
  ];
  const closing = installerLine(i.installer, ". Not sorted? Reply to this email and we'll help.");
  const body = [
    K.h1(subject, 8), K.p(intro), K.resultCard({ rows }),
    i.signRebateFormUrl ? K.amberBox("One last thing: sign your rebate form", `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.5;margin:4px 0 12px;">${K.esc(signBody)}</div>\n${K.button(i.signRebateFormUrl, "Sign your rebate form", "0")}`, 16) : "",
    K.sectionTitle("What you'll get from us", "24px 0 12px"), K.numberedSteps(steps), K.small(closing, "6px 0 0"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([subject, "", intro, "", ...rows.map((r) => `${r.k}: ${r.v}`), "", ...(i.signRebateFormUrl ? ["ONE LAST THING: SIGN YOUR REBATE FORM", signBody, `Sign your rebate form: ${i.signRebateFormUrl}`, ""] : []), "WHAT YOU'LL GET FROM US", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}

export type FinalInvoiceInput = {
  firstName: string | null; ownerName: string | null; address: string | null; installer: Installer | null;
  invoiceNumber: string; invoiceDate: string;
  lines: { description: string; amount: number }[];
  totalIncGst: number; gst: number | null; rebate: number;
  payments: { label: string; amount: number }[];
  balanceDue: number; payUrl: string; test?: boolean;
  /** Decision 209: installed product itemisation (brand, model, R-value, m², ESC model codes); omitted when unknown. */
  installed?: InstalledLine | null;
};

/** Decision 133: full tax invoice in HIV's name, VEEC incentive as a price reduction, payments so far, balance due today, Pay button.
 *  Decision 209: header carries the energy consumer, installation address, business name/address/ABN and the installed product line. */
export function renderFinalInvoiceEmail(i: FinalInvoiceInput) {
  if (!/^https:\/\//.test(i.payUrl)) throw new Error("Payment link is unavailable.");
  const first = K.cleanName(i.firstName) ?? "there";
  const installer = i.installer?.name?.trim() || "Your installer";
  const subject = `${first}, your install is done. Here's your final invoice`;
  const intro = `${installer} finished today. Your balance is due today, as agreed when you booked. Tap the button to pay by card, and you'll get your receipt straight away.`;
  const balance = K.cents(i.balanceDue);
  const rows = [
    ...i.lines.map((l) => ({ label: l.description, amount: K.cents(l.amount) })),
    { label: `Total incl. GST${i.gst != null ? ` (GST ${K.cents(i.gst)})` : ""}`, amount: K.cents(i.totalIncGst), bold: true },
    { label: "VEEC incentive (your VEU rebate, price reduction)", amount: `−${K.cents(i.rebate)}`, bold: true, color: K.KIT.GREEN },
    { label: "Amount after VEEC incentive", amount: K.cents(i.totalIncGst - i.rebate), bold: true },
    ...i.payments.map((p) => ({ label: `Paid: ${p.label}`, amount: `−${K.cents(p.amount)}` })),
  ];
  const meta = [
    BUSINESS_LINE,
    ...(i.ownerName?.trim() ? [`To: ${i.ownerName.trim()}`] : []),
    ...(i.address?.trim() ? [`Installation address: ${i.address.trim()}`] : []),
    ...(i.installed ? [`Installed: ${insulationLineWithCodes(i.installed)}`] : []),
  ];
  const after = "Once it's paid, we'll send your completion pack: certificate, warranties and all your signed forms. You'll also get a short text asking you to sign your rebate form, if you haven't already.";
  const closing = installerLine(i.installer, ", or reply to this email.");
  const body = [
    K.h1(subject, 8), K.p(intro),
    K.invoiceTable({ header: `Tax invoice ${i.invoiceNumber} · ${i.invoiceDate}`, meta, rows, totalLabel: "Balance due today", total: balance }),
    K.button(i.payUrl, `Pay ${balance} now`), K.small("Secure card payment by Stripe · Invoice PDF attached", "10px 0 0", { center: true }),
    K.note(after, "18px 0 0"), K.small(closing),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([subject, "", intro, "", `TAX INVOICE ${i.invoiceNumber} · ${i.invoiceDate}`, ...meta, ...rows.map((r) => `${r.label}: ${r.amount}`), `Balance due today: ${balance}`, "", `Pay ${balance} now: ${i.payUrl}`, "Secure card payment by Stripe · Invoice PDF attached", "", after, "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}

export type CompletionPackInput = {
  firstName: string | null; installer: Installer | null;
  downloads: { certificateUrl: string | null; invoiceUrl: string | null; warrantiesUrl: string | null; signedFormsUrl: string | null };
  test?: boolean;
  /** Decision 209: the same installed product line as the tax invoice (with ESC model codes when known); omitted when unknown. */
  installed?: InstalledLine | null;
};

/** Decision 103: downloads, "Something not right?" (installer → us → ESC), care tips. */
export function renderCompletionPackEmail(i: CompletionPackInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Your completion pack, ${first}`;
  const intro = "Everything about your new ceiling insulation in one place. Keep this email, as it's handy if you sell your home or need your warranty.";
  const downloads = [
    { title: "Certificate of Completion", detail: "Product, R-value, area, installer, date and rebate", href: i.downloads.certificateUrl },
    { title: "Tax invoice", detail: "Paid in full", href: i.downloads.invoiceUrl },
    { title: "Your warranties", detail: "1-year installer workmanship · 5-year product warranty", href: i.downloads.warrantiesUrl },
    { title: "Signed forms", detail: "Acceptance, install consent, rebate form, safety check", href: i.downloads.signedFormsUrl },
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
    "Adding new downlights later? Make sure they're IC-rated, which means they're safe to cover with insulation.",
  ];
  const closing = "Thanks for choosing Home Insulation Victoria. Your pack is always on your job page too.";
  const installed = i.installed ? `Installed: ${insulationLineWithCodes(i.installed)}` : null;
  const body = [
    K.h1(subject, 8), K.p(intro), installed ? K.note(installed, "0 0 14px") : "", K.downloadList(downloads),
    K.mistBox("Something not right?", K.numberedSteps(steps, true), { marginTop: 16, padding: "14px 16px 6px", radius: 14 }).replace("margin-bottom:6px;", "margin-bottom:10px;"),
    K.sectionTitle("Looking after your insulation", "22px 0 10px"), K.checkList(care.map(K.esc), 14, "8px"), K.small(closing),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
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
  const google = "Happy with everything? A quick Google review helps other Victorians find the rebate too.";
  const closing = installerLine(i.installer, ", or reply to this email and we'll help.");
  const body = [K.h1(subject, 8), K.p(intro, "0 0 18px"), K.starRow(i.starUrl), K.note(google, "18px 0 0"), K.button(i.googleReviewUrl, "Leave a Google review", "14px 0 4px"), K.friendCard(i.referralUrl, "cold"), K.small(closing)].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([subject, "", intro, "", "TAP A STAR", ...[1, 2, 3, 4, 5].map((n) => `${n} star${n > 1 ? "s" : ""}: ${i.starUrl(n)}`), "", google, `Leave a Google review: ${i.googleReviewUrl}`, "", "KNOW SOMEONE WITH A COLD HOUSE?", "Send them our free eligibility checker. It takes a minute, and they could get the rebate too.", `Send to a friend: ${i.referralUrl}`, "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}
