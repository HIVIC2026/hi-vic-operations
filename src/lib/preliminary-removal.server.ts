// Jo 23 Oct 2026: removal fact for the no-estimate Spot saved email. Current estimate scenario first;
// otherwise the owner's declared existing insulation (present/unknown → unknown, none → excluded).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { removalFromScenario } from "./estimate-removal.core";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";

export async function declaredRemovalKind(jobId: string): Promise<"excluded" | "included" | "unknown" | null> {
  const [{ data: est }, { data: job }] = await Promise.all([
    admin.from("indicative_estimates").select("scenarios").eq("job_id", jobId).eq("status", "current").maybeSingle(),
    admin.from("jobs").select("properties(enrichment)").eq("id", jobId).maybeSingle(),
  ]);
  if (est && Array.isArray(est.scenarios) && est.scenarios[0]) return removalFromScenario(est.scenarios[0]).kind;
  const enrichment = (job?.properties as { enrichment: Record<string, unknown> | null } | null)?.enrichment ?? null;
  const base44 = (enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const ins = normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
  return ins === "none" ? "excluded" : ins === "present" || ins === "unknown" ? "unknown" : null;
}
