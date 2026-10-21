// Gate 1 Property Intelligence persistence. INFORMATION ONLY: never changes jobs.stage or Gate 1 fields.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { RULESET, STALE_AFTER_DAYS, addressHash, canReplace, completeness, selectCurrentEstimate, type AreaTier, type Fact } from "./intelligence.core";
import { autoDecideEligibility, evaluateJobGate1, referenceDate } from "./eligibility.server";
import type { Gate1Decision } from "./eligibility.core";

/** Store the AUTHORITATIVE categorisation as the run's diagnostic summary (never an independent decision). */
const runSummary = (d: Gate1Decision | null) => d ? { result: d.outcome ?? "review_required", result_reason: (d.failed.length ? d.failed : d.review.length ? d.review : d.onsite).join(" • ") || null, next_action: d.nextAction } : { result: null, result_reason: null, next_action: null };
import { defaultProviderHttp, providerConfigFromEnv, type ProviderHttp } from "./providers.gather";
import { mayCopyFile } from "./providers.core";
import { defaultFetchJson, gatherEvidence, type EvidenceProvider, type FetchJson } from "./intelligence.gather";

/** No floor-plan / listing / imagery provider is configured yet (never scrape unknown portals). */
export function configuredProvider(): EvidenceProvider | null { return null; }

const hash = async (v: unknown) => { const b = new TextEncoder().encode(JSON.stringify(v ?? null)); const d = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };

export async function runPropertyIntelligence(jobId: string, actorId: string | null, trigger: string, fetchJson: FetchJson = defaultFetchJson, providerHttp: ProviderHttp = defaultProviderHttp) {
  const { data: job } = await admin.from("jobs").select("id, property_id, estimated_area_m2, estimated_area_unknown, properties(address_line, suburb, postcode, state)").eq("id", jobId).single();
  if (!job) return null;
  const p = job.properties as { address_line: string; suburb: string | null; postcode: string | null; state: string } | null;
  if (!p) return null;
  const ref = await referenceDate(jobId);
  const { data: run } = await admin.from("property_intelligence_runs").insert({ job_id: jobId, property_id: job.property_id, status: "running", ruleset_version: RULESET.version, trigger, reference_date: ref.date, reference_date_basis: ref.basis, address_hash: addressHash(p.address_line, p.suburb, p.postcode), created_by: actorId }).select("id").single();
  if (!run) return null;
  try {
    const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2, status, external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    // Accepted onsite/partner measurement is always tier A; no remote provider can outrank it.
    const partner = m && m.status === "complete" && Number(m.measured_area_m2) > 0 ? { net_m2: Number(m.measured_area_m2), source: m.external_source ?? "Onsite Ready Check (accepted)", external_id: m.external_id } : null;
    const g = await gatherEvidence({ addressLine: p.address_line, suburb: p.suburb, postcode: p.postcode, state: p.state, ownerEstimateM2: job.estimated_area_unknown ? null : Number(job.estimated_area_m2) || null, partnerMeasurement: partner, provider: configuredProvider(), providers: { cfg: providerConfigFromEnv(process.env as Record<string, string | undefined>), http: providerHttp, referenceDate: ref.date } }, fetchJson);

    // Area hierarchy: keep every estimate; only equal-or-stronger evidence becomes current.
    const { data: prevAreas } = await admin.from("property_area_estimates").select("id, tier, net_m2, created_at, is_current").eq("job_id", jobId);
    let current = selectCurrentEstimate((prevAreas ?? []).map((a) => ({ id: a.id, tier: a.tier as AreaTier, net_m2: Number(a.net_m2), created_at: a.created_at })));
    for (const a of g.areas) {
      const dup = (prevAreas ?? []).some((x) => x.tier === a.tier && Number(x.net_m2) === a.net_m2);
      if (dup) continue;
      const { data: ins } = await admin.from("property_area_estimates").insert({ ...a, calculation: (a.calculation ?? { source: a.method, raw_m2: a.gross_m2, exclusions: a.excluded_m2 ?? [], preliminary_net_m2: a.net_m2, confidence: a.confidence, reason: a.notes }) as Json, job_id: jobId, property_id: job.property_id, run_id: run.id, created_by: actorId }).select("id, created_at").single();
      if (ins && canReplace(current, { tier: a.tier, net_m2: a.net_m2 })) current = { id: ins.id, tier: a.tier, net_m2: a.net_m2, created_at: ins.created_at };
    }
    if (current?.id) {
      await admin.from("property_area_estimates").update({ is_current: false }).eq("job_id", jobId).neq("id", current.id);
      await admin.from("property_area_estimates").update({ is_current: true }).eq("id", current.id);
    }
    const areaFact: Fact = current
      ? { key: "preliminary_ceiling_area", value: { net_m2: current.net_m2, tier: current.tier }, status: "info", sourceType: "derived", sourceName: `Area hierarchy tier ${current.tier}`, confidence: current.tier === "A" ? "very_high" : current.tier === "B" ? "high" : "low", evidence: current.tier === "A" ? "direct" : "inferred", note: "Preliminary only – onsite measurement governs quote/VEEC" }
      : { key: "preliminary_ceiling_area", value: null, status: "unknown", sourceType: "derived", sourceName: "No area evidence", confidence: "unknown", evidence: "none" };
    const facts = [...g.facts, areaFact];

    await admin.from("property_facts").update({ is_current: false, superseded_at: new Date().toISOString() }).eq("job_id", jobId).eq("is_current", true);
    const rows = await Promise.all(facts.map(async (f) => ({
      job_id: jobId, property_id: job.property_id, run_id: run.id, fact_key: f.key, value: (f.value ?? null) as Json, check_status: f.status,
      source_type: f.sourceType, source_name: f.sourceName, source_url: f.sourceUrl ?? null, source_record_id: f.sourceRecordId ?? null, source_date: f.sourceDate ?? null,
      confidence: f.confidence, evidence_kind: f.evidence, note: f.note ?? null, raw_snapshot: (f.raw ?? null) as Json, raw_hash: f.raw ? await hash(f.raw) : null,
    })));
    await admin.from("property_facts").insert(rows);
    await admin.from("property_source_checks").insert(g.checks.map((c) => ({ ...c, run_id: run.id, job_id: jobId })));

    for (const fp of g.floorplans) {
      let storage_path: string | null = null;
      if (mayCopyFile(g.storagePolicy) && fp.provider_url) {
        try {
          const r = await fetch(fp.provider_url); if (r.ok) {
            const path = `${jobId}/property/floorplans/${fp.provider}-${fp.provider_image_id}`;
            const { error } = await admin.storage.from("job-files").upload(path, await r.arrayBuffer(), { upsert: false, contentType: r.headers.get("content-type") ?? "application/octet-stream" });
            if (!error) storage_path = path;
          }
        } catch { /* keep reference only */ }
      }
      await admin.from("property_floorplans").upsert({ ...fp, metadata: fp.metadata as Json, job_id: jobId, property_id: job.property_id, run_id: run.id, storage_policy: g.storagePolicy, storage_path, retrieved_at: new Date().toISOString() }, { onConflict: "job_id,provider,provider_image_id" });
    }

    const rec = await evaluateJobGate1(jobId, ref.date);
    const sum = runSummary(rec);
    const failedSources = g.checks.filter((c) => c.status === "error" || c.status === "timeout");
    const status = failedSources.length ? "partial" : "complete";
    const { error: finishErr } = await admin.from("property_intelligence_runs").update({ status, ...sum, completeness_pct: completeness(facts), completed_at: new Date().toISOString(), error_summary: failedSources.map((c) => `${c.source_key}: ${c.error}`).join("; ") || null }).eq("id", run.id);
    // A silently failed finish left runs "running" forever, which the stale-run recovery re-queued endlessly.
    if (finishErr) throw new Error(`Could not record run result: ${finishErr.message}`);
    await logEvent(jobId, actorId, "property_intelligence_run", `Property intelligence (${status}): evidence gathered – Gate 1 now ${String(sum.result ?? "unknown").replace(/_/g, " ")} (single Gate 1 engine)`, { run_id: run.id, trigger, ruleset: RULESET.version, reference_date: ref.date, reasons: sum.result_reason, sources: g.checks }, { internal: true });
    // Feed the single deterministic Gate 1 decider (it only uses trusted direct evidence; anything else stays review).
    try { await autoDecideEligibility(jobId); } catch { /* never fail the run */ }
    return { runId: run.id, status, recommendation: rec };
  } catch (e) {
    await admin.from("property_intelligence_runs").update({ status: "error", error_summary: (e as Error).message.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", run.id);
    await logEvent(jobId, actorId, "property_intelligence_error", "Property intelligence run failed – enquiry unaffected", { run_id: run.id, error: (e as Error).message.slice(0, 300) }, { internal: true });
    return { runId: run.id, status: "error" as const, recommendation: null };
  }
}

/** Re-evaluate the recommendation from stored facts (e.g. install date changed -> 5-year test). No network. */
export async function reevaluateIntelligence(jobId: string, actorId: string | null, why: string) {
  const { data: last } = await admin.from("property_intelligence_runs").select("id, result, reference_date").eq("job_id", jobId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) return null;
  const { data: rows } = await admin.from("property_facts").select("*").eq("job_id", jobId).eq("is_current", true);
  const facts: Fact[] = (rows ?? []).map((r) => ({ key: r.fact_key, value: r.value, status: r.check_status as Fact["status"], sourceType: r.source_type as Fact["sourceType"], sourceName: r.source_name, confidence: r.confidence as Fact["confidence"], evidence: r.evidence_kind as Fact["evidence"] }));
  const ref = await referenceDate(jobId);
  void facts;
  const rec = await evaluateJobGate1(jobId, ref.date);
  const sum = runSummary(rec);
  await admin.from("property_intelligence_runs").update({ ...sum, reference_date: ref.date, reference_date_basis: ref.basis }).eq("id", last.id);
  if (sum.result !== last.result || ref.date !== last.reference_date)
    await logEvent(jobId, actorId, "property_intelligence_reevaluated", `Gate 1 re-evaluated (${why}): ${String(sum.result).replace(/_/g, " ")} for reference date ${ref.date}`, { run_id: last.id, previous: last.result, reasons: sum.result_reason }, { internal: true });
  return rec;
}

export async function markIntelligenceStale(jobId: string, reason: string) {
  await admin.from("property_intelligence_runs").update({ is_stale: true, stale_reason: reason }).eq("job_id", jobId).eq("is_stale", false);
  await admin.from("property_facts").update({ is_stale: true }).eq("job_id", jobId).eq("is_current", true);
}

/** Should a repeat enquiry sync re-run intelligence? Only when the address changed or the last run is stale/old/missing. */
export async function needsRerun(jobId: string, currentHash: string): Promise<string | null> {
  const { data: last } = await admin.from("property_intelligence_runs").select("address_hash, is_stale, started_at, status").eq("job_id", jobId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) return "no previous run";
  if (last.address_hash !== currentHash) return "address changed";
  if (last.is_stale) return "marked stale";
  if (Date.now() - new Date(last.started_at).getTime() > STALE_AFTER_DAYS * 86400_000) return "data older than freshness window";
  return null;
}
