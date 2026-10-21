// TEST-only Group B (existing insulation) homeowner, created fresh for every test copy sent to Jo.
// Cloned from the TEST likely-eligible job's own TEST rows (never real customer data). source = qa_test, so it never
// enters post-intake automation, real sends or operational views.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { GATE1_RULESET_VERSION } from "./eligibility.core";
import { LINK_PURPOSE, newToken } from "./estimatelink.core";
import { groupBTestAudit, groupBTestRaw } from "./group-b-test-fixture.core";

export async function createGroupBTestLink(templateJobNumber: string): Promise<{ jobId: string; jobNumber: string; token: string }> {
  const { data: tj } = await admin.from("jobs").select("id, source, owner_id, property_id").eq("job_number", templateJobNumber).maybeSingle();
  if (!tj || tj.source !== "qa_test") throw new Error("TEST template job unavailable.");
  const [{ data: est }, { data: consent }] = await Promise.all([
    admin.from("indicative_estimates").select("*").eq("job_id", tj.id).eq("status", "current").maybeSingle(),
    admin.from("owner_contact_consents").select("*").eq("job_id", tj.id).eq("consent_status", "granted").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!est || !consent) throw new Error("TEST template estimate or consent unavailable.");
  const stamp = Date.now().toString(36);
  const { data: owner, error: oe } = await admin.from("owners").insert({ full_name: "TEST GroupB", email: `qa.groupb.${stamp}@hivic-test.example`, phone: "0400000998" }).select("id").single();
  if (oe || !owner) throw new Error(oe?.message ?? "TEST owner failed");
  const { data: prop, error: pe } = await admin.from("properties").insert({ owner_id: owner.id, address_line: "1 Test Street", suburb: "Testville", state: "VIC", postcode: "3000", occupancy: "owner_occupied", is_residential: true, enrichment: { base44: { raw: groupBTestRaw() } } } as never).select("id").single();
  if (pe || !prop) throw new Error(pe?.message ?? "TEST property failed");
  const { data: job, error: je } = await admin.from("jobs").insert({ property_id: prop.id, owner_id: owner.id, source: "qa_test", business_unit: "hivic", stage: "preliminary_estimate_ready", next_action: "TEST: Group B owner response", estimated_area_m2: est.area_m2, eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false, eligibility_decision_rules: groupBTestAudit(GATE1_RULESET_VERSION) } as never).select("id, job_number").single();
  if (je || !job) throw new Error(je?.message ?? "TEST job failed");
  const { id: _e, created_at: _c, superseded_at: _s, ...estRow } = est as Record<string, unknown>;
  const { error: ee } = await admin.from("indicative_estimates").insert({ ...estRow, job_id: job.id, insulation_declared: "present", input_signature: `${String(estRow["input_signature"])}:groupb-test:${stamp}` } as never);
  if (ee) throw new Error(ee.message);
  const { id: _ci, created_at: _cc, ...consentRow } = consent as Record<string, unknown>;
  const { error: ce } = await admin.from("owner_contact_consents").insert({ ...consentRow, job_id: job.id, owner_id: owner.id, consent_key: `groupb-test:${job.id}`, source_reference: "TEST Group B fixture" } as never);
  if (ce) throw new Error(ce.message);
  const token = newToken();
  const { error: le } = await admin.from("customer_estimate_links").insert({ job_id: job.id, owner_id: owner.id, purpose: LINK_PURPOSE, token, status: "active", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() } as never);
  if (le) throw new Error(le.message);
  return { jobId: job.id, jobNumber: job.job_number, token };
}
