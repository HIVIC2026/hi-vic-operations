import { esc, genericMail } from './mail-mjml.core';
import { partnerEmailLayout } from './partner-email.core';
import { renderOwnerQuoteEmail, type OwnerQuoteEmailInput } from './owner-quote-email.core';

export const ownQuoteIntro = (firstName: string, installer: string) => `Hi ${firstName}, ${installer} has prepared your ceiling insulation quote and asked us to send it. Home Insulation Victoria is the Accredited Person for the Victorian Energy Upgrades rebate on this job: we handle the rebate paperwork, the electrical safety check and the quality checks. ${installer} does the install.`;
export function renderOwnCustomerQuoteEmail(i: OwnerQuoteEmailInput & { readyCheckVisit: boolean }) {
  if (!i.ownCustomer?.installerName.trim()) throw new Error('Installer name is unavailable.');
  return renderOwnerQuoteEmail({ ...i, ownCustomerMessage: { intro: ownQuoteIntro(i.firstName?.trim() || 'there', i.ownCustomer.installerName), measuredBy: i.readyCheckVisit ? null : i.ownCustomer.installerName } });
}

export type UpdatedOwnerQuoteInput = { firstName: string; installer: string; address: string; link: string; previousSentDate: string; validUntil: string; officeNumber: string; unsubscribeUrl?: string | null; test?: boolean };
export function renderOwnCustomerUpdatedQuoteEmail(i: UpdatedOwnerQuoteInput) {
  if (!/^https:\/\//.test(i.link) || !i.officeNumber.trim() || !i.previousSentDate.trim() || !i.validUntil.trim()) throw new Error('Updated quote details are unavailable.');
  const subject = `Your updated insulation quote – ${i.address}`;
  const before = `Hi ${i.firstName}, ${i.installer} has updated their price, so here's your new quote: `;
  const after = `. It replaces the one we sent on ${i.previousSentDate}. It's valid until ${i.validUntil}. Any questions, reply to this email or call us on ${i.officeNumber}. Jo, Home Insulation Victoria`;
  const text = before + i.link + after;
  return { subject, text, html: genericMail({ subject, bodyHtml: `${esc(before)}<a href="${esc(i.link)}">${esc(i.link)}</a>${esc(after)}`, unsubscribe: i.unsubscribeUrl ?? null, testLabel: i.test }) };
}

export type InstallerOwnMessageInput = { name: string; jobNumber: string; address: string; validUntil: string; test?: boolean };
export function renderOwnInstallerQuoteSentEmail(i: InstallerOwnMessageInput, updated = false) {
  const subject = `${i.jobNumber} – quote sent to the owner`;
  const sentence = updated ? `Your new price is in. The updated quote for ${i.address} went to the owner today.` : `the quote for ${i.address} went to the owner today.`;
  const text = `Hi ${i.name}, ${sentence} It's valid until ${i.validUntil}. You can see it on the job page in the portal. If the owner asks you anything about it, call me on 0477 511 901. Jo`;
  return { subject, ...partnerEmailLayout({ subject, test: i.test === true, blocks: [{ kind: 'p', text }] }) };
}
export function renderOwnInstallerAcceptedEmail(i: Omit<InstallerOwnMessageInput, 'validUntil'>) {
  const subject = `${i.jobNumber} – owner accepted`;
  const text = `Hi ${i.name}, the owner at ${i.address} has accepted the quote and paid for the safety check. Next step: book the safety check on the job page. Jo`;
  return { subject, ...partnerEmailLayout({ subject, test: i.test === true, blocks: [{ kind: 'p', text }] }) };
}
export function replacedOwnQuoteLine(sentAt: string | null): string {
  if (!sentAt || !Number.isFinite(new Date(sentAt).getTime())) return 'This quote has been replaced.';
  const date = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short' }).format(new Date(sentAt));
  return `This quote has been replaced. The new one is in your email from ${date}.`;
}