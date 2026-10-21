// AP approval queue: read-only grouping of jobs at AP review into "no flags" and "flagged". Rules: ap-flags.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { apFlags } from "./ap-flags.core";

export async function jobApFlags(jobIds: string[]) {
  const ids = jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"];
  const [jobs, meas, ve, po, quotes] = await Promise.all([
    admin.from("jobs").select("id, estimated_area_m2").in("id", ids),
    admin.from("ceiling_measurements").select("job_id, measured_area_m2, verified_area_m2, variance_pct, accepted_reason").eq("is_current", true).in("job_id", ids),
    admin.from("visit_events").select("job_id, event, counts_against").in("job_id", ids),
    admin.from("payment_overrides").select("job_id").in("job_id", ids),
    admin.from("quotes").select("id, job_id").in("job_id", ids),
  ]);
  for (const r of [jobs, meas, ve, po, quotes]) if (r.error) throw new Error(`Could not load AP flags: ${r.error.message}`);
  const qIds = (quotes.data ?? []).map((q) => q.id);
  const adj = await admin.from("quote_adjustments").select("quote_id").in("quote_id", qIds.length ? qIds : ["00000000-0000-0000-0000-000000000000"]);
  if (adj.error) throw new Error(`Could not load AP flags: ${adj.error.message}`);
  const qJob = new Map((quotes.data ?? []).map((q) => [q.id, q.job_id]));
  const out = new Map<string, string[]>();
  for (const j of jobs.data ?? []) {
    const m = (meas.data ?? []).find((x) => x.job_id === j.id);
    const ev = (ve.data ?? []).filter((x) => x.job_id === j.id);
    out.set(j.id, apFlags({
      estimatedAreaM2: j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2),
      measuredAreaM2: m ? Number(m.verified_area_m2 ?? m.measured_area_m2 ?? NaN) || null : null,
      recordedVariancePct: m?.variance_pct == null ? null : Number(m.variance_pct),
      measurementAcceptedReason: m?.accepted_reason ?? null,
      evidenceRejections: ev.filter((x) => x.event === "evidence_rejected").length,
      paymentOverrides: (po.data ?? []).filter((x) => x.job_id === j.id).length,
      quoteManualEdits: (adj.data ?? []).filter((a) => qJob.get(a.quote_id) === j.id).length,
      visitIssues: ev.filter((x) => x.counts_against !== "none" && x.event !== "evidence_rejected").map((x) => x.event),
    }));
  }
  return out;
}

export async function loadApQueue() {
  const { data, error } = await admin.from("job_overview").select("id, job_number, property_address, source, stage, last_activity_at").eq("stage", "ap_review");
  if (error) throw new Error(`Could not load Final check jobs: ${error.message}`);
  const rows = (data ?? []).filter((j) => j.source !== "qa_test" && j.id);
  const flags = await jobApFlags(rows.map((r) => r.id!));
  const items = rows.map((r) => ({ id: r.id!, jobNumber: r.job_number, property: r.property_address, since: r.last_activity_at, flags: flags.get(r.id!) ?? [] }));
  return { clean: items.filter((i) => !i.flags.length), flagged: items.filter((i) => i.flags.length) };
}
