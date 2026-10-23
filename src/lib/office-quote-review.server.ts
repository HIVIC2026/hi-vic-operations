// Callers authenticate Office first. Readiness is shared by the list, draft and explicit Send action.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { quoteReviewReasons, quoteNeedsOfficeReview } from "./office-quote-review.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { intakeSendBlockers } from "./installer-intake.server";
import { quoteBillingBlocker } from "./installer-quote.server";

export async function officeQuoteBlockers(jobId: string, quote: { id: string; created_at: string; release_hold_reason?: string | null; option_code?: string | null }) {
  const [{ data: job, error: je }, { data: events, error: ee }, intake, billing] = await Promise.all([
    admin.from("jobs").select("stage, deleted_at, qa_archived_at, channel").eq("id", jobId).maybeSingle(),
    admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).in("event_type", ["installer_quote_held", "ready_check_needs_office"]).order("created_at", { ascending: false }).limit(1),
    intakeSendBlockers(jobId), quoteBillingBlocker(quote.id),
  ]);
  if (je || ee || !job) throw new WorkflowError("Quote readiness could not be checked.");
  const e = events?.[0];
  const d = e?.details as { reasons?: string[]; blockers?: string[] } | null;
  const reasons = quoteReviewReasons(quote.release_hold_reason, e ? { at: e.created_at, reasons: d?.reasons ?? d?.blockers ?? [] } : null, quote.created_at);
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) reasons.push("Job is closed or archived");
  if (job.channel !== "installer_sourced") {
    const { data: m, error } = await admin.from("ceiling_measurements").select("id, status, measured_area_m2, removal_required, removal_m2, access_difficulty").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    if (error) throw new WorkflowError("Ready Check could not be checked.");
    try { (await import("./scope.core")).quoteInputsFromMeasurement(m); } catch (e) { reasons.push(e instanceof Error ? e.message : "Ready Check needs review"); }
  }
  const approval = await (await import("./installer-quote-approval.server")).installerApprovalBlocker(jobId, quote);
  return [...new Set([...reasons, ...intake, ...(billing ? [billing] : []), ...(approval ? [approval] : [])])];
}

/** The only new delivery trigger is an authenticated Office button, never the scheduled tick. */
export async function sendOfficeReviewedQuote(jobId: string, quoteId: string, actorId: string) {
  const { data: quote, error } = await admin.from("quotes").select("id, job_id, kind, status, sent_at, release_state, release_hold_reason, created_at, option_code").eq("id", quoteId).eq("job_id", jobId).maybeSingle();
  if (error || !quote || !quoteNeedsOfficeReview(quote)) throw new WorkflowError("This quote is no longer available to send.");
  const blockers = await officeQuoteBlockers(jobId, quote);
  if (blockers.length) throw new WorkflowError(blockers.join(" • "));
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  await assertCustomerDeliveryAllowed(jobId, "Office Send quote");
  if (quote.option_code === "INSTALLER_A1") await (await import("./pilot.server")).applyCobrand(jobId);
  const now = new Date().toISOString();
  const { data: claimed, error: ce } = await admin.from("quotes").update({ status: "issued", release_state: "released", release_hold_reason: null, sent_at: now, office_reviewed_at: now, office_reviewed_by: actorId })
    .eq("id", quoteId).eq("job_id", jobId).eq("status", quote.status).eq("release_state", quote.release_state ?? "held").is("sent_at", null).select("id").maybeSingle();
  if (ce) throw new WorkflowError(ce.message);
  if (!claimed) throw new WorkflowError("The quote changed or was already sent. Reload it.");
  await logEvent(jobId, actorId, "quote_sent_by_office", "Office checked the draft and pressed Send quote", { quote_id: quoteId }, { internal: true });
  const notification = await (await import("./quote-ready-notify.server")).notifyOwnerQuoteReady(jobId, quoteId, quote.kind);
  return { delivery: "ready_to_send" as const, notification };
}