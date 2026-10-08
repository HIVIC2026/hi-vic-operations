import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { evaluateJobGate1 } from "@/lib/eligibility.server";
import { GATE1_RULESET_VERSION } from "@/lib/eligibility.core";
const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle();
console.log("comms_enabled", ws?.customer_comms_enabled);
const all: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from("jobs").select("id, job_number, stage, source, channel, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules, estimated_area_m2, properties(enrichment)").eq("source", "base44").eq("channel", "hivic_sourced").range(from, from + 999);
  all.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
}
const staleX = all.filter((j) => j.eligibility_decision_source === "system" && (j.eligibility_decision_rules as any)?.ruleset_version !== GATE1_RULESET_VERSION && ["new_enquiry", "eligibility_review"].includes(j.stage));
const stale = all.filter((j) => j.eligibility_decision_source === "system" && (j.eligibility_decision_rules as any)?.ruleset_version !== GATE1_RULESET_VERSION && !["new_enquiry", "eligibility_review"].includes(j.stage));
console.log("stale", stale.length);
const tally: Record<string, number> = {}; const out: any[] = [];
for (const j of stale) {
  const d = await evaluateJobGate1(j.id);
  const ins = (d as any)?.facts?.existingInsulation ?? null;
  const k = `${j.stage} | ${j.eligibility_outcome} -> ${d?.outcome}${d?.reviewRequired ? " (review)" : ""}`;
  tally[k] = (tally[k] ?? 0) + 1;
  out.push({ job: j.job_number, from: j.eligibility_outcome, to: d?.outcome, review: d?.reviewRequired, failed: d?.failed, onsite: d?.onsite, area: j.estimated_area_m2 });
}
console.log(tally);
await Bun.write("/tmp/recheck/dry.json", JSON.stringify(out, null, 1));
