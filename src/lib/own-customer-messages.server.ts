import { ownMessageApproved, type OwnCustomerMessageKey } from './own-customer-message-approval.core';
export async function approvedOwnMessage(key: OwnCustomerMessageKey): Promise<boolean> {
  const { supabaseAdmin: admin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await admin.from('workflow_settings').select('sms_message_switches').eq('id', 1).maybeSingle();
  if (error) throw new Error('Email approval could not be checked; nothing sent.');
  return ownMessageApproved(data?.sms_message_switches, key);
}
export async function ownQuoteReplacement(jobId: string, quoteId: string) {
  const { supabaseAdmin: admin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await admin.from('workflow_events').select('details').eq('job_id', jobId).eq('event_type', 'installer_price_quote_replaced').contains('details', { quote_id: quoteId }).limit(1).maybeSingle();
  if (error) throw new Error('Replacement quote could not be checked.');
  const id = (data?.details as { replaced_quote_id?: string } | null)?.replaced_quote_id;
  if (!id) return null;
  const { data: old, error: oe } = await admin.from('quotes').select('sent_at').eq('job_id', jobId).eq('id', id).maybeSingle();
  if (oe || !old?.sent_at) throw new Error('Previous quote send date could not be checked.');
  return { previousSentAt: old.sent_at };
}