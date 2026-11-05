// The ONE release of an electrical fixes (rectification) quote: draft → issued, the decision-315 hours copy and the
// `rectification_quote_issued` event. Part 4 Task 14 (Jo 2 Nov 2026): the HIV fixes quote to OWNERS is retired — the O29
// owner email is gone, the office Send button is refused (`FIXES_QUOTE_RETIRED`), and only the Test Centre journeys still
// release a quote (`how: "auto"`, no message) so the old money/payout checks keep a record. Idempotent: the status
// flips only from draft.
import { UPGRADES_QUOTE_SEND_BLOCKER, electricianBillsUpgrades } from "./upgrades-billing.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { holdForTotals, quoteTotalsHoldReason } from "./quote-totals.server";

export type FixesReleaseHow = "office" | "auto";

/** Jo 2 Nov 2026 (touchpoint decisions, Stage 8): no more HIV fixes quotes to owners. Join (4 Nov 2026, ruling 1): the ONE rule is
 *  `electricianBillsUpgrades()` (upgrades-billing.core) and the office sees its wording, UPGRADES_QUOTE_SEND_BLOCKER. */
export const FIXES_QUOTE_RETIRED = UPGRADES_QUOTE_SEND_BLOCKER;

/** The office Send checks for this quote (null = may be sent). `auto` stands in for the office review (decision 354). */
export async function fixesQuoteSendBlocker(q: { id: string; job_id: string; kind: string; status: string; office_reviewed_at: string | null }, how: FixesReleaseHow, opts: { ignoreTimesHold?: boolean } = {}): Promise<string | null> {
  if (electricianBillsUpgrades(q)) return UPGRADES_QUOTE_SEND_BLOCKER;
  const { rectificationSendBlocker } = await import("./allocation.core");
  const { count, error } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("needs_office_pricing", true);
  if (error) throw new Error(`Could not check the electrical fixes items: ${error.message}`);
  // Decision 315: the fixes quote never reaches the owner before the electrician's fixes times exist (the owner picks one).
  const fixesTimesHold = opts.ignoreTimesHold ? null : await (await import("./rectification.server")).fixesTimesHoldFor(q.job_id);
  return rectificationSendBlocker({ kind: q.kind, status: q.status, office_reviewed_at: how === "auto" ? "automatic checks (decision 354)" : q.office_reviewed_at, has_unpriced_items: !!count, fixes_times_hold: fixesTimesHold }, true);
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
  const totalsWhy = await quoteTotalsHoldReason(q.id);
  if (totalsWhy) {
    const held = await holdForTotals(q.id, q.job_id, totalsWhy, actorId); // throws if the hold can't be saved: nothing is sent either way
    throw new WorkflowError(held ? "Quote totals don't add up, so the quote was held and nothing was sent." : "Quote totals don't add up and nothing was sent. The quote could not be held – reload and check it.");
  }
  const now = new Date().toISOString();
  const patch = how === "auto" ? { status: "issued" as const, sent_at: now, release_state: "released", release_hold_reason: null } : { status: "issued" as const, sent_at: now };
  const { data: u } = await admin.from("quotes").update(patch).eq("id", q.id).eq("status", "draft").select("id").maybeSingle();
  if (!u) throw new WorkflowError("This quote is no longer a draft.");
  await logEvent(q.job_id, actorId, "rectification_quote_issued",
    how === "auto" ? "Electrical fixes quote sent to the owner automatically — A3 complete and every check passed (decision 354)" : "Office sent the reviewed electrical fixes quote to the owner for approval",
    { quote_id: q.id, ...(how === "auto" ? { auto: true, rule: "decision 354" } : {}) });
  // Part 4 Task 14: no O29 owner email any more.
  return { jobId: q.job_id };
}
