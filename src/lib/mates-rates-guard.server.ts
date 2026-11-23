/** Read-only protection for a quote issued before an owner's clear garage-only change email.
 * Checks the owner's actual inbound message, not quoted installer mail or messages before the quote.
 * Existing owner acceptance calls this before any signature, invoice or payment side effect.
 */
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { isGarageOnlyRequoteRequest } from "./mates-rates.core";
export async function garageScopeChangeAfterQuote(jobId: string, quoteSentAt: string | null | undefined): Promise<boolean> {
  if (!quoteSentAt || !Number.isFinite(Date.parse(quoteSentAt))) return false;
  const [{ data: job, error: jobError }, { data: emails, error: mailError }] = await Promise.all([
    admin.from("jobs").select("owners(email)").eq("id", jobId).maybeSingle(),
    admin.from("job_communications").select("direction,channel,sender_text,body,received_at,created_at")
      .eq("job_id", jobId).eq("direction", "inbound").eq("channel", "email")
      .order("created_at", { ascending: false }).limit(200),
  ]);
  if (jobError || mailError) throw new WorkflowError("The owner's quote change messages could not be checked. Try again.");
  const ownerEmail = ((job as { owners?: { email?: string | null } | null } | null)?.owners?.email ?? "").toLowerCase().trim();
  if (!ownerEmail) throw new WorkflowError("The owner's email could not be checked before accepting a quote.");
  return (emails ?? []).some((m) => {
    const sender = String(m.sender_text ?? "").toLowerCase();
    const received = Date.parse(String(m.received_at ?? m.created_at ?? ""));
    return sender.includes(ownerEmail) && Number.isFinite(received) && received > Date.parse(quoteSentAt)
      && isGarageOnlyRequoteRequest(m.body);
  });
}
