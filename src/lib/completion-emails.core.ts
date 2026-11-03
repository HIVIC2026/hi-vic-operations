// After-install owner emails (Jo 24 Oct 2026, decisions 101–105, 119–120, 132–133).
//   O44 "All done!"            docs/templates/mjml/owner_O44.mjml     (summary card, sign your rebate form, what you'll get)
//   (O45 Final invoice — retired 2 Nov 2026, Part 4 Task 14 / touchpoint 52: the All done email carries the tax invoice and balance)
//   O47 Completion pack        docs/templates/mjml/owner_O47.mjml     (downloads, who to contact, care tips)
//   O51 Review request         docs/templates/mjml/owner_O51.mjml     (tap a star, Google review, refer a friend)
// O44 is approved (decision 169, Jo 24 Oct): it is the day-0 VEEC signing request, sent by veec-reminders.server.ts
// through approved-owner-emails.server.ts when the install is recorded complete. O47/O51 are approved too
// (COMPLETION_EMAILS_APPROVED, decisions 103/105) and go through the same guarded sender. Pure.
import { currentFeeWording } from "./hiv-quote.core";
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { AP_DETAILS } from "./veec-assignment-form.core";
import { insulationLineWithCodes } from "./invoice-itemisation.core";
import { COMPLAINT_LINE, contactLine, type BusinessContact } from "./owner-wording.core";

/** Decision 209: the installed product line as it appears on the Xero invoice, with the exact ESC model code(s) when known. */
export type InstalledLine = { description: string; escModelCodes: string[] };
/** Contracting business line for the tax invoice: name, address (AP company address on file) and ABN. */
export const BUSINESS_LINE = [`${K.ENTITY_LINE} trading as Home Insulation Victoria`, AP_DETAILS.companyAddress?.trim() || null, K.ABN_LINE, `VEU Accredited Person ${K.AP_NUMBER}`].filter(Boolean).join(" · ");

/** Jo 24 Oct 2026: O45 final invoice (decision 133), O47 completion pack (decision 103), O51 review request (decision 105) approved. Delivery still behind customer_comms_enabled. */
export const COMPLETION_EMAILS_APPROVED = true as boolean;
/** Decision 169: the All done email carries the rebate-form signing request, so it goes to real owners (behind customer_comms_enabled). */
export const INSTALL_COMPLETE_EMAIL_APPROVED = true as boolean;

/** Part 4 Task 9 (touchpoint 52, done2.png): ONE "All done" email at completion, paid or not. OFF = the current wording
 *  (same purpose `install_complete`, same key). The contacts block and the "Attached:" line are drafts for Jo. */
export const ALL_DONE_V2_APPROVED = false as boolean;
/** Who owners can contact (cl 26): Home Insulation Victoria (the Accredited Person), the installer and, when there was electrical work, the electrician. Trades by OFFICE phone only. */
export type AllDoneContacts = { ap: BusinessContact; installer: BusinessContact; electrician: BusinessContact | null };
/** Home Insulation Victoria's own contact line: no phone is printed (the approved picture lists the email only). */
export const HIV_AP_CONTACT: BusinessContact = { name: "Home Insulation Victoria", tradingName: null, officePhone: null, email: "info@homeinsulationvictoria.com.au" };
/** Which documents this send really carries (the "Attached:" line only names those). */
export type AllDoneAttached = { taxInvoice: boolean; rebateForm: boolean; warranty: boolean; instructions: boolean };

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
  /** Task 9 (flag ALL_DONE_V2_APPROVED): the balance in cents, the Sign and pay link (`?screen=finish`), the contacts block and which documents are attached. */
  balanceCents?: number; signAndPayUrl?: string; contacts?: AllDoneContacts; attached?: AllDoneAttached;
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

/** Why the All done email must wait (null = ready): the installer, and the electrician when there was electrical work, need an OFFICE phone and a business email (cl 26; never a worker's mobile). */
export function allDoneContactHold(installer: BusinessContact | null, electrician: BusinessContact | null): string | null {
  if (!installer) return "No installer office on file";
  const miss = (b: BusinessContact) => { const n = b.tradingName?.trim() || b.name.trim(); return !b.officePhone?.trim() ? `No office phone for ${n}` : !b.email?.trim() ? `No business email for ${n}` : null; };
  return miss(installer) ?? (electrician ? miss(electrician) : null);
}

/** Draft for Jo: names only the documents that are really attached. null = nothing attached. */
export function allDoneAttachedLine(a: AllDoneAttached | null | undefined): string | null {
  if (!a) return null;
  const parts = [a.taxInvoice && "your tax invoice", a.rebateForm && "the rebate form to read before you sign", a.warranty && "your product warranty", a.instructions && "the manufacturer's instructions"].filter(Boolean) as string[];
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Attached: ${list} (PDFs). Once it's all done, we'll send your signed forms.`;
}

/** Draft for Jo: "name · phone · email", leaving out whatever is not held (a trade is held before this if its phone or email is missing). */
const contactRow = (b: BusinessContact) => contactLine(b) ?? [b.tradingName?.trim() || b.name.trim(), b.officePhone?.trim() || null, b.email?.trim() || null].filter(Boolean).join(" · ");

/** Touchpoint 52 (done2.png), verbatim where Jo gave it; see the Task 9 notes for the drafted lines. */
function renderAllDoneV2(i: InstallCompleteInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const c = i.contacts ?? null;
  const installer = (c ? c.installer.tradingName?.trim() || c.installer.name.trim() : null) || i.installer?.name?.trim() || "Your installer";
  const subject = `All done, ${first}. Enjoy a warmer home!`;
  const heading = "All done. Enjoy a warmer home!";
  const intro = `${installer} finished installing your ceiling insulation today.`;
  const due = !i.balancePaid && (i.balanceCents ?? 0) > 0;
  const balance = K.cents((i.balanceCents ?? 0) / 100);
  const rebateAmt = i.rebate && i.rebate > 0 ? K.whole(i.rebate) : null;
  const signUrl = i.signAndPayUrl ?? i.signRebateFormUrl ?? null;
  const title = due ? "Two last things, one page" : "One last thing";
  const item1 = `${due ? "1. " : ""}Sign your rebate form. It confirms what was installed and lets us claim the ${rebateAmt ? `${rebateAmt} ` : ""}rebate you've already had off your price.`;
  const item2 = due ? `2. Pay your balance: ${balance}, due today.` : null;
  const button = due ? "Sign and pay" : "Sign your rebate form";
  const small = due ? "Takes about a minute. Card or bank transfer." : "Takes about a minute.";
  const rows: { k: string; v: string; green?: boolean; nowrap?: boolean }[] = [
    ...(i.product || i.areaM2 ? [{ k: "Installed", v: [i.areaM2 ? K.m2(i.areaM2) : null, i.product?.trim() || null].filter(Boolean).join(" ") }] : []),
    ...(rebateAmt ? [{ k: "Your rebate", v: `${rebateAmt} off`, green: true, nowrap: true }] : []),
    ...(due ? [{ k: "Balance due today", v: balance, nowrap: true }] : []),
  ];
  const attachedLine = allDoneAttachedLine(i.attached);
  const people = c ? [`Home Insulation Victoria (Accredited Person) · ${c.ap.email?.trim() || HIV_AP_CONTACT.email}`, contactRow(c.installer), ...(c.electrician ? [contactRow(c.electrician)] : [])] : [];
  const rowHtml = rows.map((r, n) => {
    const top = n === 0 ? "" : BT;
    return `<tr><td style="padding:10px 0;${top}color:#5A6785;">${esc(r.k)}</td><td align="right" style="padding:10px 0 10px 12px;${top}${r.nowrap ? "white-space:nowrap;" : ""}${r.green ? "color:#057D40;" : ""}"><strong>${esc(r.v)}</strong></td></tr>`;
  }).join("");
  const peopleHtml = people.map((p, n) => `<tr><td style="padding:8px 0;${n === 0 ? "" : BT}">${esc(p)}</td></tr>`).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(heading)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">${esc(title)}</mj-text><mj-text>${esc(item1)}${item2 ? `<br /><br />${esc(item2)}` : ""}</mj-text>${signUrl ? `<mj-button href="${esc(signUrl)}">${esc(button)}</mj-button>` : ""}<mj-text mj-class="small" padding="0 12px">${esc(small)}</mj-text></mj-column></mj-section>`,
    rows.length ? `<mj-section><mj-column mj-class="panel-card"><mj-table padding="8px 18px 8px">${rowHtml}</mj-table></mj-column></mj-section>` : "",
    attachedLine ? `<mj-section><mj-column><mj-text mj-class="small" padding="10px 12px 0">${esc(attachedLine)}</mj-text></mj-column></mj-section>` : "",
    people.length ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">Your contacts</mj-text><mj-table padding="0 18px 8px">${peopleHtml}</mj-table></mj-column></mj-section>` : "",
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(COMPLAINT_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const preview = due ? `Two last things: sign your rebate form and pay your balance, ${balance}.` : "One last thing: sign your rebate form. It takes a minute.";
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", heading, intro, "", title, item1, ...(item2 ? [item2] : []), ...(signUrl ? [`${button}: ${signUrl}`] : []), small, "", ...rows.map((r) => `${r.k}: ${r.v}`), ...(attachedLine ? ["", attachedLine] : []), ...(people.length ? ["", "YOUR CONTACTS", ...people] : []), "", COMPLAINT_LINE], { testLabel: i.test === true });
  return { subject, html, text };
}

/** Decision 101/119: "All done, {First}. Enjoy a warmer home!" with the rebate-form signing request. `v2` = touchpoint 52 (default: ALL_DONE_V2_APPROVED). */
export function renderInstallCompleteEmail(i: InstallCompleteInput, v2: boolean = ALL_DONE_V2_APPROVED) {
  if (v2) return renderAllDoneV2(i);
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
    { title: "Signed forms", detail: "Acceptance, install consent, rebate form, safety check. Each was emailed to you when it was signed", href: i.downloads.signedFormsUrl },
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
  const closing = "Thanks for choosing Home Insulation Victoria.";
  const installed = i.installed ? `Installed: ${insulationLineWithCodes(i.installed)}` : null;
  const codes = i.installed?.escModelCodes.length ? `ESC model ${i.installed.escModelCodes.join(", ")}` : null;
  const dlHtml = downloads.map((d, n) => {
    const top = n === 0 ? "" : BT;
    return `<tr><td valign="top" style="padding:12px 0;${top}"><strong>&#128196; ${esc(d.title)}</strong><br /><span class="muted">${esc(d.detail)}</span></td><td align="right" valign="top" style="padding:12px 0 12px 12px;white-space:nowrap;${top}">${d.href ? `<a href="${esc(d.href)}" style="color:#3C51C4;font-weight:700;">Download</a>` : ""}</td></tr>`;
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
  const text = K.plainText([subject, "", intro, ...(installed ? [installed] : []), "", "YOUR DOCUMENTS", ...downloads.map((d) => `${d.title} (${d.detail})${d.href ? `: ${d.href}` : ""}`), "", "SOMETHING NOT RIGHT?", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", "LOOKING AFTER YOUR INSULATION", ...care.map((c) => `✓ ${c}`), "", closing], { testLabel: i.test === true });
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
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">${esc(friendTitle)}</mj-text><mj-text padding="0 18px 8px">${esc(friendBody)}</mj-text><mj-text padding="0 18px 16px"><a href="${esc(K.friendShareHref(i.referralUrl))}" style="color:#3C51C4;font-weight:700;">Send to a friend &#8594;</a></mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([subject, "", intro, "", "TAP A STAR", ...[1, 2, 3, 4, 5].map((n) => `${n} star${n > 1 ? "s" : ""}: ${i.starUrl(n)}`), "", google, `Leave a Google review: ${i.googleReviewUrl}`, "", friendTitle.toUpperCase(), friendBody, `Send to a friend: ${i.referralUrl}`, "", closing], { testLabel: i.test === true });
  return { subject, html, text };
}
