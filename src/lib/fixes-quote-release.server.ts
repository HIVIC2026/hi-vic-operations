// The ONE release of an electrical fixes (rectification) quote to the owner: draft → issued, the decision-315 hours
// copy, the `rectification_quote_issued` event and the O29 owner email through the guarded owner path
// (owner-email-triggers `onFixesQuoteIssued`: TEST jobs → test-send; real owners behind the template flag,
// `customer_comms_enabled` and consent; once per quote by idempotency key). Shared by the office Send button
// (allocation.functions `sendRectificationQuote`) and the decision-354 automatic send (auto-fixes-quote-send.server).
// Idempotent: the status flips only from draft, so a quote is issued (and its email triggered) at most once.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";

export type FixesReleaseHow = "office" | "auto";

/** The office Send checks for this quote (null = may be sent). `auto` stands in for the office review (decision 354). */
export async function fixesQuoteSendBlocker(q: { id: string; job_id: string; kind: string; status: string; office_reviewed_at: string | null }, how: FixesReleaseHow, opts: { ignoreTimesHold?: boolean } = {}): Promise<string | null> {
  const { rectificationSendBlocker } = await import("./allocation.core");
  // Only items still on the job count: a removed item can't be priced (office-job-parts shows required items only).
  const { count, error } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("status", "required").eq("needs_office_pricing", true);
  if (error) throw new Error(`Could not check the electrical fixes items: ${error.message}`);
  // Spec rule 3 (Jo 28 Oct 2026): nothing reaches the owner until every item has a price. Defence in depth for a quote
  // built before its "Other" item was priced (that item's line is $0 until the quote is rebuilt).
  const { count: zeroLines, error: le } = await admin.from("quote_items").select("id", { count: "exact", head: true }).eq("quote_id", q.id).eq("is_other", true).eq("unit_price_inc_gst", 0);
  if (le) throw new Error(`Could not check the electrical fixes quote lines: ${le.message}`);
  // Decision 315: the fixes quote never reaches the owner before the electrician's fixes times exist (the owner picks one).
  const fixesTimesHold = opts.ignoreTimesHold ? null : await (await import("./rectification.server")).fixesTimesHoldFor(q.job_id);
  const base = rectificationSendBlocker({ kind: q.kind, status: q.status, office_reviewed_at: how === "auto" ? "automatic checks (decision 354)" : q.office_reviewed_at, has_unpriced_items: !!count, has_zero_other_line: !!zeroLines, fixes_times_hold: fixesTimesHold }, true);
  return base ?? (q.kind === "rectification" ? await stalePriceBlocker(q) : null);
}

/** Task 9 fix round 1: a draft is never sent with an electrician price other than the one now on the job (the portal price
 *  first, else the old form's). Covers a form-price draft followed by a portal price with no rebuild, a rebuild that failed,
 *  and the office Send as well as the automatic send. */
async function stalePriceBlocker(q: { id: string; job_id: string }): Promise<string | null> {
  const [{ data: row, error: re }, { data: internals, error: ie }] = await Promise.all([
    admin.from("quotes").select("release_hold_reason").eq("id", q.id).maybeSingle(),
    admin.from("quote_internals").select("calc_snapshot").eq("quote_id", q.id).maybeSingle(),
  ]);
  if (re || ie) throw new Error(`Could not check the electrical fixes quote's price: ${(re ?? ie)!.message}`);
  const { REPAIR_PRICE_REBUILD_FAILED, REPAIR_PRICE_STALE, REPAIR_EXTRAS_STALE } = await import("./electrician-repair-price.core");
  if (row?.release_hold_reason === REPAIR_PRICE_REBUILD_FAILED) return REPAIR_PRICE_REBUILD_FAILED;
  const snap = (internals?.calc_snapshot ?? null) as { pricing_source?: string; electrician_price_inc_gst?: number; extras_inc_gst?: number } | null;
  const { A4_FIXES_PRICING_SOURCE, pricedFixesExtras } = await import("./fixes-price.core");
  const a4 = snap?.pricing_source === A4_FIXES_PRICING_SOURCE;
  const built = a4 && Number.isFinite(Number(snap!.electrician_price_inc_gst)) ? Math.round(Number(snap!.electrician_price_inc_gst) * 100) : null;
  const src = await (await import("./electrician-repair-price.server")).fixesPriceSourceForJob(q.job_id);
  const now = src.path === "a4_price" ? Math.round(src.electricianPriceIncGst * 100) : null;
  if (built !== now) return REPAIR_PRICE_STALE;
  if (!a4) return null;
  // Jo 28 Oct 2026: priced extras are lines on this quote — one priced after the draft was built (and not rebuilt) is stale.
  const { data: items, error: xe } = await admin.from("rectification_items").select("rate_code, description, quantity, is_other, status, needs_office_pricing, other_unit_price_inc_gst, explanation, source, external_key").eq("job_id", q.job_id).eq("status", "required").eq("is_other", true);
  if (xe) throw new Error(`Could not check the electrical fixes extra items: ${xe.message}`);
  const extrasNow = Math.round(pricedFixesExtras(items ?? []).reduce((a, e) => a + e.unitPriceIncGst * e.quantity, 0) * 100);
  return extrasNow === Math.round(Number(snap!.extras_inc_gst ?? 0) * 100) ? null : REPAIR_EXTRAS_STALE;
}

/** Releases one draft fixes quote; throws a WorkflowError with the reason when a check fails or it is no longer a draft. */
export async function releaseFixesQuote(quoteId: string, actorId: string | null, how: FixesReleaseHow): Promise<{ jobId: string }> {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, status, office_reviewed_at").eq("id", quoteId).single();
  if (!q) throw new WorkflowError("Quote not found.");
  const b = await fixesQuoteSendBlocker(q, how);
  if (b) throw new WorkflowError(b);
  // Decision 315: times given on the job page before this draft existed carry their hours on the event; copy them over.
  const { data: hq } = await admin.from("quotes").select("rect_estimated_hours").eq("id", q.id).maybeSingle();
  if (hq && hq.rect_estimated_hours == null) {
    const { data: ge } = await admin.from("workflow_events").select("details").eq("job_id", q.job_id).eq("event_type", "rectification_windows_given").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const h = Number((ge?.details as { hours?: unknown } | null)?.hours);
    if (Number.isFinite(h) && h > 0) await admin.from("quotes").update({ rect_estimated_hours: h }).eq("id", q.id).eq("status", "draft");
  }
  const now = new Date().toISOString();
  const patch = how === "auto" ? { status: "issued" as const, sent_at: now, release_state: "released", release_hold_reason: null } : { status: "issued" as const, sent_at: now };
  const { data: u } = await admin.from("quotes").update(patch).eq("id", q.id).eq("status", "draft").select("id").maybeSingle();
  if (!u) throw new WorkflowError("This quote is no longer a draft.");
  await logEvent(q.job_id, actorId, "rectification_quote_issued",
    how === "auto" ? "Electrical fixes quote sent to the owner automatically — A3 complete and every check passed (decision 354)" : "Office sent the reviewed electrical fixes quote to the owner for approval",
    { quote_id: q.id, ...(how === "auto" ? { auto: true, rule: "decision 354" } : {}) });
  // Decision 325: O29 "Your safety check found something to fix first" to the owner (guarded; best-effort, never undoes the send).
  await (await import("./owner-email-triggers.server")).onFixesQuoteIssued(q.job_id, q.id).catch((e) => console.error("fixes quote email skipped", (e as Error).message));
  return { jobId: q.job_id };
}
