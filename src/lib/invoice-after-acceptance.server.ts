// The invoice step after an owner accepts a quote (installation, or electrical fixes — their own invoice since batch 3b).
// Shared by the acceptance itself and the office "Create invoice" retry.
// Safe to repeat: createInvoiceForQuote keeps ONE invoice per quote and never creates a second Xero invoice for one that
// is already linked or already exists under the job's reference.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { createInvoiceForQuote } from "./xero.server";

/** The acceptance (signature + stage move) is already committed before this runs. An invoice / Xero push failure must not
 *  turn the owner's completed acceptance into an error they cannot retry; it is recorded for the office (Needs me).
 *  pushInvoiceToXero swallows Xero errors itself, so success means the invoice is now linked to Xero, not "no throw". */
export async function createInvoiceAfterAcceptance(quoteId: string, jobId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  let error: string | null = null;
  try {
    await createInvoiceForQuote(quoteId, actorId);
    const { data: inv } = await admin.from("invoices").select("xero_invoice_id, last_sync_error").eq("quote_id", quoteId).maybeSingle();
    if (!inv?.xero_invoice_id) error = inv?.last_sync_error ?? "The invoice was not linked to Xero.";
  } catch (e) { error = (e as Error)?.message ?? String(e); }
  if (!error) return { ok: true };
  const [{ data: inv }, { data: q }] = await Promise.all([
    admin.from("invoices").select("id").eq("quote_id", quoteId).maybeSingle(),
    admin.from("quotes").select("kind").eq("id", quoteId).maybeSingle(),
  ]);
  // `kind` lets Needs me name the invoice (batch 3b: installation or electrical fixes).
  await logEvent(jobId, actorId, "invoice_create_failed", `Quote accepted but the invoice step failed – office action needed: ${error}`, { quote_id: quoteId, invoice_id: inv?.id ?? null, local_invoice_exists: !!inv, kind: q?.kind ?? null }, { internal: true }).catch(() => null);
  return { ok: false, error };
}
