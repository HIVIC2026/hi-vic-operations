import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { refreshStaleSystemGate1 } from "@/lib/eligibility.server";
import { GATE1_RULESET_VERSION } from "@/lib/eligibility.core";
const all: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from("jobs").select("id, job_number, eligibility_decision_source, eligibility_decision_rules").eq("source", "base44").eq("channel", "hivic_sourced").eq("eligibility_decision_source", "system").range(from, from + 999);
  all.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
}
const stale = all.filter((j) => (j.eligibility_decision_rules as any)?.ruleset_version !== GATE1_RULESET_VERSION);
const tally: Record<string, string[]> = {};
for (const j of stale) { const r = await refreshStaleSystemGate1(j.id); (tally[r] ??= []).push(j.job_number); }
for (const [k, v] of Object.entries(tally)) console.log(k, v.length, k === "needs_office" ? v.join(", ") : "");
