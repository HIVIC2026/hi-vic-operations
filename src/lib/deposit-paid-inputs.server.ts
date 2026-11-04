// Part 4 Task 6 (#44): what "Deposit received, thanks!" needs beyond the invoice facts: the installer's OFFICE phone (never a
// worker's mobile; missing = held with a note), the receipt (only with PDF_LOOK_APPROVED.receipts) and the owner-confirmed PIESA.
// The signed ESC consent is NOT attached here: it goes on its own at signing (Jo 2 Nov, answer 10).
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { EmailAttachment } from './email-kit.core';
import { pickDepositReceiptKey, type DepositReceiptEvent } from './deposit-paid-inputs.core';

export type DepositPaidInputs = { officePhone: string; balanceCents: number; depositCents: number; attachments: EmailAttachment[]; receiptAttached: boolean };
export type DepositPaidArgs = { jobId: string; invoiceId: string; jobNumber: string; depositCents: number; balanceCents: number };
export const OFFICE_PHONE_HELD = 'Installer office phone not on file: deposit received email held';

async function receiptAttachment(a: DepositPaidArgs): Promise<EmailAttachment[]> {
  const { PDF_LOOK_APPROVED } = await import('./pdf-approvals.core');
  if (!PDF_LOOK_APPROVED.receipts) return [];
  const load = async (type: string) => {
    const { data } = await admin.from('workflow_events').select('details').eq('job_id', a.jobId).eq('event_type', type).contains('details', { invoice_id: a.invoiceId }).order('created_at', { ascending: true });
    return (data ?? []).map((e) => (e.details ?? {}) as DepositReceiptEvent);
  };
  const key = pickDepositReceiptKey({ recorded: await load('owner_payment_recorded'), reversed: await load('owner_payment_reversed'), depositCents: a.depositCents });
  if (!key) return [];
  const filed = await (await import('./receipt-pdf.server')).fileReceiptPdf(a.jobId, 'install_deposit', key);
  if ('held' in filed) return [];
  const { data, error } = await admin.storage.from('job-files').download(filed.path);
  if (error || !data) return [];
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return [];
  const { bytesToBase64 } = await import('./veec-emails.core');
  return [{ filename: `Receipt${a.jobNumber ? `-${a.jobNumber}` : ''}.pdf`, content: bytesToBase64(bytes), contentType: 'application/pdf' }];
}

/** The current PIESA copy, only once the owner has confirmed it (the confirm-and-pay page records that). */
async function confirmedPiesaAttachment(a: DepositPaidArgs): Promise<EmailAttachment[]> {
  if (!(await (await import('./piesa-owner-confirm.server')).ownerConfirmationForExpand(a.jobId).catch(() => null))) return [];
  const { officialPiesaPdf, pdfAttachment } = await import('./official-piesa-pdf.server');
  const p = await officialPiesaPdf(a.jobId, a.jobNumber).catch(() => null);
  return p ? [pdfAttachment(p)] : [];
}

export async function depositPaidInputs(a: DepositPaidArgs): Promise<DepositPaidInputs | { held: string }> {
  const { businessContactForJob } = await import('./owner-contact.server');
  const officePhone = (await businessContactForJob(a.jobId, 'installer'))?.officePhone;
  if (!officePhone) return { held: OFFICE_PHONE_HELD };
  const receipt = await receiptAttachment(a).catch((e) => { console.error('deposit receipt not attached', a.jobId, e instanceof Error ? e.message : e); return [] as EmailAttachment[]; });
  const piesa = await confirmedPiesaAttachment(a).catch(() => [] as EmailAttachment[]);
  return { officePhone, balanceCents: a.balanceCents, depositCents: a.depositCents, attachments: [...receipt, ...piesa], receiptAttached: receipt.length > 0 };
}
