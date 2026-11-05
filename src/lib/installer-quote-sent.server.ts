// Own-customer office notice only; no delivery (including TEST) until Jo approves its wording.
import { approvedOwnMessage, ownQuoteReplacement } from './own-customer-messages.server';
import { renderOwnInstallerQuoteSentEmail } from './own-customer-quote-messages.core';

export async function notifyInstallerQuoteSent(jobId: string, quoteId: string): Promise<string> {
  // Both variants fail closed before job reads or TEST delivery while unapproved.
  const [firstApproved, updatedApproved] = await Promise.all([approvedOwnMessage('own_installer_quote_sent'), approvedOwnMessage('own_installer_updated_quote_sent')]);
  if (!firstApproved && !updatedApproved) return 'awaiting wording approval';
  const replacement = await ownQuoteReplacement(jobId, quoteId);
  const approved = replacement ? updatedApproved : firstApproved;
  if (!approved) return 'awaiting wording approval';
  const { supabaseAdmin: admin } = await import('@/integrations/supabase/client.server');
  if (await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId)) return 'TEST delivery held';
  const [{ data: job, error: je }, { data: quote, error: qe }, { data: assignment, error: ae }] = await Promise.all([
    admin.from('jobs').select('channel, job_number, originating_installer_business_id, properties(address_line, suburb)').eq('id', jobId).maybeSingle(),
    admin.from('quotes').select('sent_at, status, kind').eq('job_id', jobId).eq('id', quoteId).maybeSingle(),
    admin.from('job_assignments').select('business_id').eq('job_id', jobId).eq('role', 'installer').eq('active', true).order('assigned_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (je || qe || ae) throw new Error('Quote notification facts could not be checked.');
  if (!job || job.channel !== 'installer_sourced' || !quote?.sent_at || quote.kind !== 'installation' || !['issued', 'accepted'].includes(quote.status)) return 'not due';
  const businessId = assignment?.business_id;
  if (!businessId || businessId !== job.originating_installer_business_id) return 'own installer not assigned';
  const { data: business, error: be } = await admin.from('businesses').select('name, trading_name').eq('id', businessId).maybeSingle();
  if (be || !business) throw new Error('Installer could not be checked.');
  const { quoteExpiresAt } = await import('./quote-expiry.core');
  const validUntil = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short' }).format(new Date(quoteExpiresAt(quote.sent_at).getTime() - 1));
  const property = job.properties as { address_line?: string | null; suburb?: string | null } | null;
  const mail = renderOwnInstallerQuoteSentEmail({ jobNumber: job.job_number, name: business.trading_name || business.name, address: [property?.address_line, property?.suburb].filter(Boolean).join(', ') || job.job_number, validUntil }, !!replacement);
  const { emailInstallerOffice } = await import('./own-job-piesa-notices.server');
  return (await emailInstallerOffice({ jobId, businessId, key: `installer-quote-sent:v1:${quoteId}:${quote.sent_at}`, ...mail, approved, rendered: mail })).status;
}