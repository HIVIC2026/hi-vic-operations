import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras, declaredInsulationDetail } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { savedInsulationTap } from "./insulation-details.core";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { EXCLUSION_LABEL, INSULATION_QUESTIONS_BATCH, INSULATION_QUESTIONS_SEND_APPROVED, batchSlice, questionsExclusion, type QuestionsExclusion, type QuestionsFacts } from "./insulation-questions-campaign.core";

async function pages<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error("Could not read the campaign audience. Nothing sent.");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Candidate = { id: string; jobNumber: string | null; createdAt: string; facts: QuestionsFacts };

async function readCandidates(onlyIds?: string[]): Promise<Candidate[]> {
  const idx = await pages((f, t) => {
    let q = admin.from("office_enquiry_index").select("id, job_number, stage, source, channel, created_at, eligibility_outcome, removed, owner_email, spot_offered, spot_saved, media_count, contact_rank").in("source", ["base44", "qa_test"]);
    if (onlyIds) q = q.in("id", onlyIds);
    return q.order("created_at").order("id").range(f, t);
  });
  const ids = idx.map((r) => r.id!).filter(Boolean);
  const enrich = new Map<string, Record<string, unknown> | null>(), opted = new Set<string>(), questions = new Set<string>(), details = new Map<string, string>();
  for (const c of chunks(ids)) {
    const [jobs, optA, optB, sends] = await Promise.all([
      admin.from("jobs").select("id, properties(enrichment)").in("id", c),
      admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", c),
      admin.from("lead_campaign_responses").select("job_id, opted_out_at").in("job_id", c),
      admin.from("customer_email_sends").select("job_id, status, idempotency_key, sent_at, created_at").in("job_id", c).eq("purpose", LAUNCH_CAMPAIGN),
    ]);
    if (jobs.error || optA.error || optB.error || sends.error) throw new Error("Could not read the campaign audience. Nothing sent.");
    for (const j of jobs.data ?? []) enrich.set(j.id, (j.properties as { enrichment: Record<string, unknown> | null } | null)?.enrichment ?? null);
    for (const o of [...(optA.data ?? []), ...(optB.data ?? [])]) if (o.opted_out_at && o.job_id) opted.add(o.job_id);
    for (const s of sends.data ?? []) {
      if (!s.job_id || s.status === "failed") continue;
      const k = s.idempotency_key ?? "";
      if (k.includes(":insulation_questions:")) questions.add(s.job_id);
      if (k.includes(":insulation_details:")) { const at = s.sent_at ?? s.created_at; if (at && (details.get(s.job_id) ?? "") < at) details.set(s.job_id, at); }
    }
  }
  return idx.map((r) => {
    const e = enrich.get(r.id!) ?? null;
    const answers = ((e?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } }).raw?.answers ?? null;
    return {
      id: r.id!, jobNumber: r.job_number, createdAt: r.created_at!,
      facts: {
        source: r.source, channel: r.channel, stage: r.stage, outcome: r.eligibility_outcome, removed: !!r.removed, optedOut: opted.has(r.id!),
        email: r.owner_email, duplicateContact: (r.contact_rank ?? 1) > 1, spotOffered: !!r.spot_offered, spotSaved: !!r.spot_saved,
        questionsSent: questions.has(r.id!), insulationDetailsSentAt: details.get(r.id!) ?? null,
        declared: normaliseInsulation(declaredExtras(answers).existing_insulation), detail: declaredInsulationDetail(answers),
        tapAnswered: !!savedInsulationTap(e), mediaCount: r.media_count ?? 0,
      },
    };
  });
}

/** Read-only: audience, exclusion counts and batches. Oldest enquiry first. */
export async function questionsCampaignOverview(batch = 1) {
  const all = await readCandidates();
  const now = Date.now();
  const excluded: Partial<Record<QuestionsExclusion, number>> = {};
  const audience: Candidate[] = [];
  for (const c of all) { const x = questionsExclusion(c.facts, now); if (x) excluded[x] = (excluded[x] ?? 0) + 1; else audience.push(c); }
  const batches = Math.max(1, Math.ceil(audience.length / INSULATION_QUESTIONS_BATCH));
  const rows = batchSlice(audience, batch).map((c) => ({ id: c.id, jobNumber: c.jobNumber, createdAt: c.createdAt, declared: c.facts.declared }));
  return {
    sendApproved: INSULATION_QUESTIONS_SEND_APPROVED, batchSize: INSULATION_QUESTIONS_BATCH, total: audience.length, batches, batch,
    batchCounts: Array.from({ length: batches }, (_, i) => Math.min(INSULATION_QUESTIONS_BATCH, audience.length - i * INSULATION_QUESTIONS_BATCH)),
    exclusions: (Object.keys(EXCLUSION_LABEL) as QuestionsExclusion[]).map((k) => ({ key: k, label: EXCLUSION_LABEL[k], count: excluded[k] ?? 0 })),
    rows,
  };
}

/** Re-checked inside the guarded sender for every single email. */
export async function questionsCampaignJobBlocker(jobId: string): Promise<string | null> {
  const [c] = await readCandidates([jobId]);
  if (!c) return "Not a website enquiry.";
  const x = questionsExclusion(c.facts);
  return x ? `${EXCLUSION_LABEL[x]} — not sent.` : null;
}

/** Preview the email for one job (no send, no tokens). */
export async function questionsCampaignPreview(jobId: string, actorId: string | null) {
  const { sendSaveMySpot } = await import("./hot-leads-send.server");
  const [r] = await sendSaveMySpot([jobId], actorId, { mode: "preview", insulationQuestions: true });
  return r;
}

/** Office batch send. Refused in code until Jo approves the final wording and says go. */
export async function questionsCampaignSendBatch(jobIds: string[], actorId: string | null) {
  if (!INSULATION_QUESTIONS_SEND_APPROVED) return { refused: true as const, detail: "Sending is off until Jo approves the final wording and says go. Nothing sent.", results: [] };
  if (jobIds.length > INSULATION_QUESTIONS_BATCH) throw new Error(`Send at most ${INSULATION_QUESTIONS_BATCH} at a time.`);
  const { sendSaveMySpot } = await import("./hot-leads-send.server");
  const results = [];
  for (const id of jobIds) results.push(...(await sendSaveMySpot([id], actorId, { mode: "send", insulationQuestions: true })));
  return { refused: false as const, detail: "", results };
}

/** Jo 23 Oct 08:14 UTC: after an owner answers the questions or uploads photos/video, send Save my spot
 *  (thin/patchy wording for thin/loose fill, otherwise the standard existing-insulation wording) through the
 *  same guarded automatic route. Refused while the campaign switch is off. */
export async function sendAnsweredOwnerSaveSpot(jobId: string) {
  if (!INSULATION_QUESTIONS_SEND_APPROVED) return { sent: false, reason: "Sending is off until Jo says go." };
  const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server");
  return maybeAutoRouteLeadEmail(jobId);
}
