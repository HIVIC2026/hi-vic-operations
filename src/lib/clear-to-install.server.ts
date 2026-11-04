// Part 4 Task 3 (#40): the inputs the "You're clear to install" email needs. Read-only apart from preparing the owner's
// ESC consent record (the same prepare step the confirm-and-pay page uses). Any missing piece returns { held } so the
// email waits; it is never sent without the owner's PIESA copy.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { EmailAttachment } from './email-kit.core';

export type ClearToInstallInputs = { checkedOn: string; electrician: string; piesaRecordId: string; signedCopyId: string; attachments: EmailAttachment[] };
const HELD = { held: 'Clear to install documents not ready' } as const;

export async function clearToInstallInputs(jobId: string): Promise<ClearToInstallInputs | { held: string }> {
  try {
    const { currentCopy } = await import('./official-forms.server');
    const pe = await currentCopy(jobId, 'piesa');
    const { data: job } = await admin.from('jobs').select('job_number').eq('id', jobId).maybeSingle();
    const { data: rec } = await admin.from('piesa_records').select('id').eq('job_id', jobId).eq('is_current', true).maybeSingle();
    if (pe.unavailable || !pe.copy || !job || !rec) return HELD;
    // Follows the current owner PIESA copy: the filled DEECA PDF only when PDF_LOOK_APPROVED.officialFormPdf is on, else the existing copy.
    const { officialPiesaPdf, pdfAttachment } = await import('./official-piesa-pdf.server');
    const piesa = await officialPiesaPdf(jobId, job.job_number ?? '');
    if (!piesa || piesa.copyId !== pe.copy.id) return HELD;
    const consent = await (await import('./consent.server')).prefilledEscConsentPdf(jobId);
    if (!consent) return HELD;
    const { businessContactForJob } = await import('./owner-contact.server');
    const el = await businessContactForJob(jobId, 'electrician');
    const electrician = (el?.tradingName || el?.name || '').replace(/^\[TEST PARTNER\]\s*/, '').trim();
    const { piesaStatus } = await import('./workflow.server');
    const checkedOn = ((await piesaStatus(jobId)) as { piesa_date?: string | null } | null)?.piesa_date ?? pe.copy.signatureDate;
    if (!electrician || !checkedOn) return HELD;
    return { checkedOn, electrician, piesaRecordId: rec.id, signedCopyId: pe.copy.id, attachments: [pdfAttachment(piesa), consent] };
  } catch (e) {
    console.error('clear to install inputs unavailable', jobId, e instanceof Error ? e.message : e);
    return HELD;
  }
}
