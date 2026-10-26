// Jo 24 Oct 2026 (decisions 4, 91, 92, 136): installer emails when the owner accepts or declines the quote.
// Designs approved (MJML refresh, Jo 26 Oct 2026): docs/templates/mjml/installer_I23.mjml ("Good news, {InstallerFirst}." /
// "{OwnerFirst} accepted!") and installer_I24.mjml ("{InstallerFirst}," / "{OwnerFirst} has declined the quote"). Pure. No prices:
// trades never see the owner's price. Both flags are on (decisions 91/136); real partners get them through sendOfficeEmail.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

export const INSTALLER_ACCEPTED_EMAIL_APPROVED = true as boolean;
/** Jo 24 Oct 2026, decision 136 (I24 "Owner declined"): approved. Real partners still go through sendOfficeEmail. */
export const INSTALLER_DECLINED_EMAIL_APPROVED = true as boolean;

export type InstallerAcceptedInput = { installerFirstName: string | null; ownerName: string | null; address: string | null; jobNumber: string; jobUrl: string; test?: boolean };

const num = (n: number, title: string, detail: string, last: boolean) => { const pad = last ? 12 : 14; return `<tr><td width="32" valign="top" style="padding:2px 0 ${pad}px;"><span class="num">${n}</span></td><td style="padding:0 0 ${pad}px;"><strong>${esc(title)}</strong><br /><span class="muted">${esc(detail)}</span></td></tr>`; };
const intro = (hi: string, headline: string, lead: string) => `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`;

export function renderInstallerAcceptedEmail(i: InstallerAcceptedInput) {
  const owner = i.ownerName?.trim() || "The owner";
  const first = owner.split(/\s+/)[0] ?? owner;
  const where = i.address?.trim() || "the property";
  const you = K.cleanName(i.installerFirstName);
  const subject = `Owner accepted – ${i.jobNumber}${i.address?.trim() ? `, ${i.address.trim()}` : ""}`;
  const hi = `Good news${you ? `, ${you}` : ""}.`;
  const headline = `${first} accepted!`;
  const lead = `${owner} has accepted the quote for ${where} (${i.jobNumber}) and has paid for the electrical safety check.`;
  const preview = `${first} has paid for the electrical safety check. Nothing for you to do until it clears.`;
  const steps: K.Step[] = [
    { title: "Electrical safety check", detail: `The licensed electrician offers ${first} times. Nothing for you to do.` },
    { title: `Offer ${first} 3 install days`, detail: `Once the safety check clears, your portal asks you to offer ${first} 3 install days. ${first} picks one and it's booked, or suggests other days, until you agree.` },
    { title: "Install within 30 days of the safety check", detail: "Your portal shows how many days are left." },
  ];
  const body = [
    intro(hi, headline, lead),
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What happens next</mj-text><mj-table padding="0 18px 6px">${steps.map((s, n) => num(n + 1, s.title, s.detail ?? "", n === steps.length - 1)).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="8px 0 0"></mj-text><mj-button href="${esc(i.jobUrl)}">Open the job</mj-button></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    `Hi ${you ?? "there"},`, "", `${hi} ${headline}`, lead, "",
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "",
    `Open the job: ${i.jobUrl}`,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}

export type InstallerDeclinedInput = InstallerAcceptedInput & { reasonLabel?: string | null; reasonNote?: string | null };

/** Decision 92/136: "{OwnerFirst} declined the quote for {address} ({HV}). Reason: … Nothing more to do. The job is closed." */
export function renderInstallerDeclinedEmail(i: InstallerDeclinedInput) {
  const owner = i.ownerName?.trim() || "The owner";
  const first = owner.split(/\s+/)[0] ?? owner;
  const where = i.address?.trim() || "the property";
  const you = K.cleanName(i.installerFirstName);
  const subject = `Owner declined – ${i.jobNumber}${i.address?.trim() ? `, ${i.address.trim()}` : ""}`;
  const headline = `${first} has declined the quote`;
  const lead = `${owner} declined the quote for ${where} (${i.jobNumber}).`;
  const label = i.reasonLabel?.trim() || "No reason given";
  const note = i.reasonNote?.trim() || null;
  const closing = `Nothing more to do. The job is closed. If ${first} changes their mind, we can reopen it from our side. Just let us know.`;
  const top = you
    ? intro(`${you},`, headline, lead)
    : `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`;
  const body = [
    top,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow" padding="18px 18px 6px">Reason given</mj-text><mj-text padding="0 18px ${note ? 6 : 18}px"><strong>${esc(label)}</strong></mj-text>${note ? `<mj-text padding="0 18px 18px" font-style="italic">"${esc(note)}"</mj-text>` : ""}</mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="14px 12px 14px">${esc(closing)}</mj-text><mj-button href="${esc(i.jobUrl)}">See the job</mj-button></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview: "The job is closed. Nothing more for you to do.", body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([`Hi ${you ?? "there"},`, "", headline, lead, `Reason given: ${label}${note ? ` — "${note}"` : ""}`, "", closing, "", `See the job: ${i.jobUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
