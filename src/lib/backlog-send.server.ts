// Decision 393 (Jo, owner, 25 Oct 2026: "Yes, send all 54"): one-off, DB-triggered send of the missed first email to a
// fixed list of website enquiries (route /api/public/hooks/backlog-send). Every item re-reads its job, is refused on any
// closed/opted-out/saved/already-emailed fact, then goes through an EXISTING guarded sender only — nothing new is said to
// customers, and each sender's once-per-home key, consent, switches and opt-out checks still run. Counts only, no PII.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  backlogOutcome, backlogRefusal, backlogSummary, existingInsulationAnswer, parseBacklogSendBody, safeDetail,
  type BacklogJobFacts, type BacklogResult, type BacklogSendItem,
} from "./backlog-send.core";

const MAX_BODY_BYTES = 32_768;

type Facts = { facts: BacklogJobFacts; ownerEmail: string | null };

async function readFacts(jobId: string): Promise<Facts | { missing: true } | { error: string }> {
  const OFFER_KEYS = "idempotency_key.like.%:save_my_spot:%,idempotency_key.like.%existing_insulation_save_spot%,idempotency_key.like.%likely_size%,idempotency_key.like.%office_outlook_save_spot%";
  const [job, response, optouts, media, offers, questions] = await Promise.all([
    admin.from("jobs").select("job_number, source, stage, deleted_at, qa_archived_at, eligibility_outcome, owners(email)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at").eq("job_id", jobId).maybeSingle(),
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).not("opted_out_at", "is", null).limit(1),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "intake_media"),
    admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("status", ["sent", "sending"]).or(OFFER_KEYS),
    admin.from("customer_email_sends").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("status", ["sent", "sending"]).like("idempotency_key", "%insulation_details%"),
  ]);
  // Fail closed: an unreadable record is never treated as "none".
  if (job.error || response.error || optouts.error || media.error || media.count == null || offers.error || offers.count == null || questions.error || questions.count == null) return { error: "Could not read the job's records. Nothing sent." };
  if (!job.data) return { missing: true };
  const j = job.data as { job_number: string | null; source: string | null; stage: string | null; deleted_at: string | null; qa_archived_at: string | null; eligibility_outcome: string | null; owners: { email: string | null } | null };
  const r = response.data as { spot_saved_at: string | null; opted_out_at: string | null; media_received_at: string | null } | null;
  return {
    ownerEmail: j.owners?.email?.trim().toLowerCase() || null,
    facts: {
      jobNumber: j.job_number, source: j.source, stage: j.stage, deletedAt: j.deleted_at, qaArchivedAt: j.qa_archived_at,
      eligibilityOutcome: j.eligibility_outcome, spotSavedAt: r?.spot_saved_at ?? null, campaignOptedOutAt: r?.opted_out_at ?? null,
      emailOptedOutAt: (optouts.data as { opted_out_at: string | null }[] | null)?.[0]?.opted_out_at ?? null,
      intakeMediaCount: media.count, mediaReceivedAt: r?.media_received_at ?? null, priorOfferCount: offers.count, priorQuestionsCount: questions.count,
    },
  };
}

async function sendItem(item: BacklogSendItem): Promise<{ outcome: string; detail: string }> {
  if (item.kind === "save_spot_none") {
    const { sendSaveMySpot } = await import("./hot-leads-send.server");
    const res = (await sendSaveMySpot([item.jobId], null, {}))[0];
    return res ?? { outcome: "failed", detail: "No send result" };
  }
  if (item.kind === "save_spot_existing") {
    const { data: est, error } = await admin.from("indicative_estimates").select("insulation_declared").eq("job_id", item.jobId).eq("status", "current").maybeSingle();
    if (error) return { outcome: "failed", detail: "Could not read the current estimate. Nothing sent." };
    const answer = existingInsulationAnswer((est as { insulation_declared: string | null } | null)?.insulation_declared);
    if (!answer) return { outcome: "skipped", detail: "Current estimate does not record existing insulation (yes or don't know)." };
    const { sendOwnerDeclaredExistingInsulationOffer } = await import("./lead-email-routing.server");
    const offer = await sendOwnerDeclaredExistingInsulationOffer(item.jobId, answer === "unknown");
    return offer.ok ? offer.result : { outcome: "failed", detail: offer.reason };
  }
  const { sendInsulationQuestionsInvitation } = await import("./hot-leads-send.server");
  return sendInsulationQuestionsInvitation(item.jobId);
}

/** One at a time; a failure on one item never stops the rest. */
export async function runBacklogSend(sends: BacklogSendItem[]): Promise<BacklogResult[]> {
  const results: BacklogResult[] = [];
  // Each owner gets one email: a second home on this list with the same owner email is skipped once one was emailed.
  const emailedOwners = new Set<string>();
  for (const item of sends) {
    let jobNumber: string | null = null;
    const done = (outcome: BacklogResult["outcome"], detail: string) => results.push({ jobNumber, kind: item.kind, outcome, detail: safeDetail(detail) });
    try {
      const read = await readFacts(item.jobId);
      if ("error" in read) { done("failed", read.error); continue; }
      if ("missing" in read) { done("failed", "Job not found."); continue; }
      jobNumber = read.facts.jobNumber;
      const { legacyExclusionReason } = await import("./hot-leads.core");
      const refusal = backlogRefusal(item.kind, read.facts, legacyExclusionReason(jobNumber));
      if (refusal) { done("skipped", refusal); continue; }
      if (read.ownerEmail && emailedOwners.has(read.ownerEmail)) { done("skipped", "Another home on this list with the same owner email was already emailed."); continue; }
      // Same preparation the automatic router does before these senders: refresh the estimate and secure link (never sends).
      const { syncStep3 } = await import("./estimatelink.server");
      await syncStep3(item.jobId, null);
      const res = await sendItem(item);
      const outcome = backlogOutcome(res.outcome);
      if (read.ownerEmail && (outcome === "sent" || outcome === "uncertain")) emailedOwners.add(read.ownerEmail);
      done(outcome, res.detail);
    } catch (e) {
      done("failed", `Error: ${(e as Error).message}`);
    }
  }
  return results;
}

/** Body → 400 (nothing sent) or the counts-only summary. Auth is done by the route before this is called. */
export async function handleBacklogSendRequest(request: Request): Promise<Response> {
  const text = await request.text().catch(() => null);
  if (text == null || text.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Body missing or too large." }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 }); }
  const parsed = parseBacklogSendBody(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  return Response.json(backlogSummary(await runBacklogSend(parsed.sends)));
}
