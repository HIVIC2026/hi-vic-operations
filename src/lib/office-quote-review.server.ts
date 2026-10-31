// Callers authenticate Office first. Readiness is shared by the list, draft and explicit Send action.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { quoteReviewReasons, quoteNeedsOfficeReview } from "./office-quote-review.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { intakeSendBlockers } from "./installer-intake.server";
import { quoteBillingBlocker } from "./installer-quote.server";

export async function officeQuoteBlockers(
  jobId: string,
  quote: {
    id: string;
    created_at: string;
    release_hold_reason?: string | null;
    option_code?: string | null;
  },
) {
  // One read of the current measurement serves both the Mitti check and the measurement check below (was two).
  const { jobProductProblems } = await import("./install-evidence.server");
  const [
    { data: job, error: je },
    { data: events, error: ee },
    intake,
    billing,
    { data: mitti, error: me },
    product,
  ] = await Promise.all([
    admin
      .from("jobs")
      .select("stage, deleted_at, qa_archived_at, channel")
      .eq("id", jobId)
      .maybeSingle(),
    admin
      .from("workflow_events")
      .select("created_at, details")
      .eq("job_id", jobId)
      .in("event_type", ["installer_quote_held", "ready_check_needs_office"])
      .order("created_at", { ascending: false })
      .limit(1),
    intakeSendBlockers(jobId),
    quoteBillingBlocker(quote.id),
    admin
      .from("ceiling_measurements")
      .select(
        "id, status, measured_area_m2, removal_required, removal_m2, access_difficulty, external_source, external_id",
      )
      .eq("job_id", jobId)
      .eq("is_current", true)
      .maybeSingle(),
    // Decision 205 (checklist D6): the declared product must be on the ESC register, in date and reach R5.0 — shown here
    // so the office sees it on Quotes to check, long before AP review blocks on the same rule.
    jobProductProblems(jobId),
  ]);
  if (je || ee || !job) throw new WorkflowError("Quote readiness could not be checked.");
  const e = events?.[0];
  const d = e?.details as { reasons?: string[]; blockers?: string[] } | null;
  const reasons = quoteReviewReasons(
    quote.release_hold_reason,
    e ? { at: e.created_at, reasons: d?.reasons ?? d?.blockers ?? [] } : null,
    quote.created_at,
  );
  if (me) throw new WorkflowError("Ready Check could not be checked.");
  if (mitti?.external_source === "mitti" && mitti.external_id) {
    // Old drafts retain their history, but these two superseded Add job disclosures are not Mitti holds.
    for (let i = reasons.length - 1; i >= 0; i--)
      if (/^Owner fee awareness|^Electrician not decided yet/.test(reasons[i] ?? ""))
        reasons.splice(i, 1);
  }
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job))
    reasons.push("Job is closed or archived");
  if (job.channel !== "installer_sourced") {
    const m = mitti;
    try {
      (await import("./scope.core")).quoteInputsFromMeasurement(m);
    } catch (e) {
      reasons.push(e instanceof Error ? e.message : "Ready Check needs review");
    }
  }
  // Jo 24 Oct: no installer approval on any Ready Check quote — Complete in Mitti + these checks are the gate.
  return [...new Set([...reasons, ...intake, ...(billing ? [billing] : []), ...product])];
}

/** Office "Send quote" (an authenticated button). */
export async function sendOfficeReviewedQuote(jobId: string, quoteId: string, actorId: string) {
  return releaseQuoteToOwner(jobId, quoteId, actorId, "office");
}

/** One guarded release for both triggers: the Office button and (Jo 24 Oct) the installer marking the Mitti
 *  Ready Check Complete with every check passing (auto-quote-send.server.ts). */
export async function releaseQuoteToOwner(
  jobId: string,
  quoteId: string,
  actorId: string | null,
  how: "office" | "auto",
) {
  const { data: quote, error } = await admin
    .from("quotes")
    .select(
      "id, job_id, kind, status, sent_at, release_state, release_hold_reason, created_at, option_code",
    )
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error || !quote || !quoteNeedsOfficeReview(quote))
    throw new WorkflowError("This quote is no longer available to send.");
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  const wf = await import("./workflow.server");
  // Read together, but surface refusals in the original order. Commercial setup
  // reads channel/model/installer_led only; the quote-stage transition changes none of them.
  const [blockers, permission, { data: st }, commercial] = await Promise.all([
    officeQuoteBlockers(jobId, quote),
    assertCustomerDeliveryAllowed(jobId, "Office Send quote").then(
      () => ({ allowed: true as const }),
      (error) => ({ allowed: false as const, error }),
    ),
    admin.from("jobs").select("stage, source").eq("id", jobId).single(),
    wf.commercialBlocker(jobId).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    ),
  ]);
  if (blockers.length) throw new WorkflowError(blockers.join(" • "));
  if (!permission.allowed) throw permission.error;
  // Jo 24 Oct: release only when the owner can actually accept it — right stage, invoicing settled, and a secure link.
  if (st?.stage === "ready_check_complete") {
    // Sending the quote IS the move to the quote stage; its entry checks (Ready Check complete, eligibility) still apply.
    const sb = await wf.stageEntryBlockers(jobId, "measured_estimate_ready");
    if (sb.length) throw new WorkflowError(sb.join(" • "));
    await wf.transition(
      jobId,
      "measured_estimate_ready",
      actorId,
      how === "office"
        ? "Quote stage: office sending the owner's quote"
        : "Quote stage: Ready Check complete",
      { quote_id: quoteId },
    );
  } else if (!["measured_estimate_ready", "awaiting_quote_acceptance"].includes(String(st?.stage)))
    throw new WorkflowError(
      `The job isn't at the quote stage yet (${st?.stage ?? "unknown"}), so the owner couldn't accept it.`,
    );
  if (!commercial.ok) throw commercial.error;
  if (commercial.value) throw new WorkflowError(commercial.value);
  if (!(await (await import("./estimatelink.server")).ensureOwnerLink(jobId)))
    throw new WorkflowError(
      "The owner has no secure My job link, so they couldn't open or accept the quote.",
    );
  if (st?.source === "qa_test") {
    const { data: link, error: le } = await admin
      .from("customer_estimate_links")
      .select("status,expires_at")
      .eq("job_id", jobId)
      .eq("purpose", "step3_estimate")
      .eq("status", "active")
      .maybeSingle();
    if (le || !(await import("./estimatelink.core")).linkUsable(link))
      throw new WorkflowError("TEST owner quote link must be prepared before Send.");
  }
  if (quote.option_code === "INSTALLER_A1")
    await (await import("./pilot.server")).applyCobrand(jobId);
  const now = new Date().toISOString();
  const { data: claimed, error: ce } = await admin
    .from("quotes")
    .update({
      status: "issued",
      release_state: "released",
      release_hold_reason: null,
      sent_at: now,
      ...(how === "office" ? { office_reviewed_at: now, office_reviewed_by: actorId } : {}),
    })
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .eq("status", quote.status)
    .eq("release_state", quote.release_state ?? "held")
    .is("sent_at", null)
    .select("id")
    .maybeSingle();
  if (ce) throw new WorkflowError(ce.message);
  if (!claimed) throw new WorkflowError("The quote changed or was already sent. Reload it.");
  if (how === "office")
    await logEvent(
      jobId,
      actorId,
      "quote_sent_by_office",
      "Office checked the draft and pressed Send quote",
      { quote_id: quoteId },
      { internal: true },
    );
  else
    await logEvent(
      jobId,
      null,
      "quote_sent_automatically",
      "Installer marked the Ready Check Complete and every check passed — quote sent to the owner automatically",
      { quote_id: quoteId },
      { internal: true },
    );
  const notification = await (
    await import("./quote-ready-notify.server")
  ).notifyOwnerQuoteReady(jobId, quoteId, quote.kind);
  return { delivery: "ready_to_send" as const, notification };
}
/** Jo 24 Oct: a declined quote back to a draft on Quotes to check (fresh 14 days once sent again). Never sends. */
export async function reopenDeclinedQuoteImpl(jobId: string, quoteId: string, actorId: string) {
  const { data, error } = await admin
    .from("quotes")
    .update({
      status: "draft",
      sent_at: null,
      release_state: "held",
      release_hold_reason: "Waiting for office review before sending",
    })
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .eq("status", "declined")
    .select("id")
    .maybeSingle();
  if (error) throw new WorkflowError(error.message);
  if (!data) throw new WorkflowError("This quote isn't declined any more. Reload it.");
  const { QUOTE_DECLINED_REOPENED } = await import("./quote-decline.core");
  await logEvent(
    jobId,
    actorId,
    "quote_reopened_by_office",
    QUOTE_DECLINED_REOPENED,
    { quote_id: quoteId },
    { internal: true },
  );
  return { reopened: true as const };
}
