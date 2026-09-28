// Gate 1 Property Intelligence persistence. INFORMATION ONLY: never changes jobs.stage or Gate 1 fields.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { RULESET, STALE_AFTER_DAYS, addressHash, canReplace, completeness, gate1InputFromFacts, recommendGate1, selectCurrentEstimate, type AreaTier, type Fact } from "./intelligence.core";
import { defaultFetchJson, gatherEvidence, type EvidenceProvider, type FetchJson } from "./intelligence.gather";

/** No floor-plan / listing / imagery provider is configured yet (never scrape unknown portals). */
export function configuredProvider(): EvidenceProvider | null { return null; }

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());

async function referenceDate(jobId: string): Promise<{ date: string; basis: string }> {
  const { data } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (data?.scheduled_start) return { date: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(data.scheduled_start)), basis: "installation_booking" };
  return { date: today(), basis: "today" };
}

const hash = async (v: unknown) => { const b = new TextEncoder().encode(JSON.stringify(v ?? null)); const d = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };

export async function runPropertyIntelligence(jobId: string, actorId: string | null, trigger: string, fetchJson: FetchJson = defaultFetchJson) {
  const { data: job } = await admin.from("jobs").select("id, property_id, estimated_area_m2, estimated_area_unknown, properties(address_line, suburb, postcode, state)").eq("id", jobId).single();
  if (!job) return null;
  const p = job.properties as { address_line: string; suburb: string | null; postcode: string | null; state: string } | null;
  if (!p) return null;
  const ref = await referenceDate(jobId);
  const { data: run } = await admin.from("property_intelligence_runs").insert({ job_id: jobId, property_id: job.property_id, status: "running", ruleset_version: RULESET.version, trigger, reference_date: ref.date, reference_date_basis: ref.basis, address_hash: addressHash(p.address_line, p.suburb, p.postcode), created_by: actorId }).select("id").single();
  if (!run) return null;
  try {
    const { data: m } = await admin.from("ceiling_measurements").select("measured_area_m2, status, external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    const partner = m && m.status === "complete" && m.external_source && Number(m.measured_area_m2) > 0 ? { net_m2: Number(m.measured_area_m2), source: m.external_source, external_id: m.external_id } : null;
    const g = await gatherEvidence({ addressLine: p.address_line, suburb: p.suburb, postcode: p.postcode, state: p.state, ownerEstimateM2: job.estimated_area_unknown ? null : Number(job.estimated_area_m2) || null, partnerMeasurement: partner, provider: configuredProvider() }, fetchJson);

    // Area hierarchy: keep every estimate; only equal-or-stronger evidence becomes current.
    const { data: prevAreas } = await admin.from("property_area_estimates").select("id, tier, net_m2, created_at, is_current").eq("job_id", jobId);
    let current = selectCurrentEstimate((prevAreas ?? []).map((a) => ({ id: a.id, tier: a.tier as AreaTier, net_m2: Number(a.net_m2), created_at: a.created_at })));
    for (const a of g.areas) {
      const dup = (prevAreas ?? []).some((x) => x.tier === a.tier && Number(x.net_m2) === a.net_m2);
      if (dup) continue;
      const { data: ins } = await admin.from("property_area_estimates").insert({ ...a, job_id: jobId, property_id: job.property_id, run_id: run.id, created_by: actorId }).select("id, created_at").single();
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

    const rec = recommendGate1(gate1InputFromFacts(facts, ref.date));
    const failedSources = g.checks.filter((c) => c.status === "error" || c.status === "timeout");
    const status = failedSources.length ? "partial" : "complete";
    await admin.from("property_intelligence_runs").update({ status, result: rec.outcome, result_reason: rec.reasons.join(" • "), next_action: rec.nextAction, completeness_pct: completeness(facts), completed_at: new Date().toISOString(), error_summary: failedSources.map((c) => `${c.source_key}: ${c.error}`).join("; ") || null }).eq("id", run.id);
    await logEvent(jobId, actorId, "property_intelligence_run", `Property intelligence (${status}): preliminary ${rec.outcome.replace(/_/g, " ")} – information only, admin confirms Gate 1`, { run_id: run.id, trigger, ruleset: RULESET.version, reference_date: ref.date, reasons: rec.reasons, sources: g.checks }, { internal: true });
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
  const rec = recommendGate1(gate1InputFromFacts(facts, ref.date));
  await admin.from("property_intelligence_runs").update({ result: rec.outcome, result_reason: rec.reasons.join(" • "), next_action: rec.nextAction, reference_date: ref.date, reference_date_basis: ref.basis }).eq("id", last.id);
  if (rec.outcome !== last.result || ref.date !== last.reference_date)
    await logEvent(jobId, actorId, "property_intelligence_reevaluated", `Gate 1 recommendation re-evaluated (${why}): ${rec.outcome.replace(/_/g, " ")} for reference date ${ref.date}`, { run_id: last.id, previous: last.result, reasons: rec.reasons }, { internal: true });
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
