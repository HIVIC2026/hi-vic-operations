import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { stableUuid } from "./mitti-create-claim.core";
import { currentFixesQuote } from "./fixes-quote-current.server";

/** Stable primary keys make interrupted/concurrent identical generation recoverable without extra quotes or lines. */
export async function saveFixesQuote(jobId: string, values: Record<string, unknown>, lines: Record<string, unknown>[], internals: Record<string, unknown>) {
  const basis = JSON.stringify({ values: { ...values, created_by: null }, lines, internals });
  const current = await currentFixesQuote(jobId);
  const { data: previous, error: pe } = current ? await admin.from("quote_internals").select("calc_snapshot").eq("quote_id", current.id).maybeSingle() : { data: null, error: null };
  if (pe) throw new Error(pe.message);
  if (current && (previous?.calc_snapshot as Record<string, unknown> | null)?.["fixes_basis"] === basis) {
    const { error } = await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").in("status", ["draft", "issued", "accepted"]).neq("id", current.id);
    if (error) throw new Error(error.message);
    return { id: current.id, already: true };
  }
  const id = await stableUuid(`fixes-quote:v1:${jobId}:${basis}`);
  const { error: qe } = await admin.from("quotes").upsert({ ...values, id, job_id: jobId, kind: "rectification", status: "draft" } as never, { onConflict: "id", ignoreDuplicates: true });
  if (qe) throw new Error(qe.message);
  const rows = await Promise.all(lines.map(async (line, i) => ({ ...line, quote_id: id, id: await stableUuid(`fixes-line:${id}:${i}`) })));
  const { error: le } = await admin.from("quote_items").upsert(rows as never, { onConflict: "id", ignoreDuplicates: true });
  if (le) throw new Error(le.message);
  const snapshot = { ...(internals["calc_snapshot"] as Record<string, unknown>), fixes_basis: basis };
  const { error: ie } = await admin.from("quote_internals").upsert({ ...internals, quote_id: id, calc_snapshot: snapshot } as never, { onConflict: "quote_id" });
  if (ie) throw new Error(ie.message);
  const { error: se } = await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").in("status", ["draft", "issued", "accepted"]).neq("id", id);
  if (se) throw new Error(se.message);
  return { id, already: false };
}