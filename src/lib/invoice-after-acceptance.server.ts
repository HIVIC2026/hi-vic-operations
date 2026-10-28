// The invoice step after an owner accepts a quote. Shared by the acceptance itself and the office "Create invoice" retry.
// Safe to repeat: createInvoiceForQuote keeps ONE invoice per quote and never creates a second Xero invoice for one that
// is already linked or already exists under the job's reference.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { createInvoiceForQuote } from "./xero.server";

/** The acceptance (signature + stage move) is already committed before this runs. An invoice / Xero push failure must not
 *  turn the owner's completed acceptance into an error they cannot retry; it is recorded for the office (Needs me). */
export async function createInvoiceAfterAcceptance(quoteId: string, jobId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  try { await createInvoiceForQuote(quoteId, actorId as string); return { ok: true }; }
  catch (e) {
    const error = (e as Error)?.message ?? String(e);
    const { data: inv } = await admin.from("invoices").select("id").eq("quote_id", quoteId).maybeSingle();
    await logEvent(jobId, actorId, "invoice_create_failed", `Quote accepted but the invoice step failed – office action needed: ${error}`, { quote_id: quoteId, invoice_id: inv?.id ?? null, local_invoice_exists: !!inv }, { internal: true }).catch(() => null);
    return { ok: false, error };
  }
}
