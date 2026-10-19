// Step 3 persistence: one current indicative estimate per job, superseded only when material inputs change.
// Reads Gate 1 (never writes it), no communications, no payment/Xero/Mitti/ESC/VEEC calls.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { evaluateJobGate1 } from "./eligibility.server";
import { selectCurrentEstimate, type AreaTier } from "./intelligence.core";
import { A48_SPEC, type LocationVariables } from "./activity48.core";
import { TRUSTED_ESTIMATE_TIERS, computeEstimate, customerCanSee, displayModeFor, estimateSignature, pickArea, type DisplayMode, type EstimateResult, type RetailSettings } from "./estimate.core";

export type EstimateView = {
  mode: DisplayMode; reason: string | null; measureRequired: boolean;
  onsiteDrivers: string[]; rolloutHold: boolean; accessConcern: boolean; insulationDeclared: string | null; location: LocationVariables | null; postcodeUnlisted: boolean;
  settings: RetailSettings | null; estimate: (EstimateResult & { id: string; created_at: string; settings_version: number }) | null;
  history: { id: string; status: string; created_at: string; superseded_at: string | null; area_m2: number; settings_version: number }[];
};

export async function currentRetailSettings(): Promise<RetailSettings | null> {
  const { data } = await admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle();
  return (data as unknown as RetailSettings) ?? null;
}

export async function refreshIndicativeEstimate(jobId: string): Promise<EstimateView> {
  const { data: j } = await admin.from("jobs").select("eligibility_outcome, eligibility_decision_source, eligibility_review_required, estimated_area_m2, estimated_area_unknown, properties(postcode, enrichment)").eq("id", jobId).single();
  if (!j) throw new Error("Job not found");
  const p = j.properties as { postcode: string | null; enrichment: Record<string, unknown> | null } | null;
  const b44 = (p?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const declaredInsulation = normaliseInsulation(declaredExtras(b44.raw?.answers ?? null).existing_insulation);
  // Office "Photos show no insulation" decision (separate event; raw owner answer untouched). Latest photo decision wins.
  const { NO_INSULATION_EVENT, MEDIA_REVIEW_EVENT, officeInsulationOverride } = await import("./office-no-insulation.core");
  const { data: officeEvents, error: officeEventsError } = await admin.from("customer_engagement_events").select("event_type, occurred_at").eq("job_id", jobId).in("event_type", [NO_INSULATION_EVENT, MEDIA_REVIEW_EVENT]);
  if (officeEventsError) throw new Error("Could not read office photo decisions.");
  const insulation = officeInsulationOverride(officeEvents ?? []) ?? declaredInsulation;
  const recorded = j.eligibility_decision_source === "system" || j.eligibility_decision_source === "admin";
  const mode = displayModeFor({ outcome: j.eligibility_outcome, reviewRequired: !!j.eligibility_review_required, recorded });
  const d = await evaluateJobGate1(jobId); // read-only: drivers + flags
  const flags = d?.flags ?? [];
  const base = {
    mode, onsiteDrivers: mode === "onsite" ? d?.onsite ?? [] : [], rolloutHold: flags.some((f) => f.key === "rollout_hold"),
    accessConcern: flags.some((f) => f.key === "roof_access_review"), insulationDeclared: insulation, location: null as LocationVariables | null, postcodeUnlisted: false,
  };
  const { data: hist } = await admin.from("indicative_estimates").select("id, status, created_at, superseded_at, area_m2, settings_version").eq("job_id", jobId).order("created_at", { ascending: false }).limit(20);
  const history = (hist ?? []).map((h) => ({ ...h, area_m2: Number(h.area_m2) }));
  const settings = await currentRetailSettings();
  const out = (x: Partial<EstimateView>): EstimateView => ({ reason: null, measureRequired: false, settings, estimate: null, history, ...base, ...x });
  if (!customerCanSee(mode)) return out({ reason: mode === "withheld_review" ? "Estimate withheld — Gate 1 review required." : mode === "none_ineligible" ? "No estimate — Gate 1 outcome: does not appear eligible." : "Estimate withheld — no official Gate 1 decision recorded yet." });
  if (!settings) return out({ reason: "Retail estimator settings are not configured." });

  const { data: locRow } = await admin.from("veu_location_variables").select("*").eq("postcode", String(p?.postcode ?? "").trim()).maybeSingle();
  if (!locRow) return out({ postcodeUnlisted: true, reason: `Postcode ${p?.postcode ?? "(missing)"} is not in the VEU Version 25 Location Variable List – estimate not calculated.` });
  const loc = locRow as unknown as LocationVariables;
  base.location = loc;

  const { data: m } = await admin.from("ceiling_measurements").select("id, verified_area_m2, measured_area_m2, status").eq("job_id", jobId).eq("is_current", true).eq("status", "complete").maybeSingle();
  const { data: ests } = await admin.from("property_area_estimates").select("id, tier, net_m2, created_at").eq("job_id", jobId).in("tier", TRUSTED_ESTIMATE_TIERS);
  const best = selectCurrentEstimate((ests ?? []).map((e) => ({ id: e.id, tier: e.tier as AreaTier, net_m2: e.net_m2 == null ? null : Number(e.net_m2), created_at: e.created_at })));
  const area = pickArea({
    measurement: m ? { id: m.id, m2: Number(m.verified_area_m2 ?? m.measured_area_m2) || null } : null,
    estimate: best ? { id: best.id!, m2: best.net_m2, tier: best.tier } : null,
    owner: j.estimated_area_unknown ? null : j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2),
  });
  if (!area) return out({ measureRequired: true, reason: "We need a ceiling-area estimate before we can calculate indicative savings" });
  const sig = estimateSignature({ mode, area, postcode: loc.postcode, insulation, settingsId: settings.id, settingsVersion: settings.version, veecValue: settings.indicative_veec_value, veecSource: `${settings.veec_value_source_url}|${settings.veec_value_checked_at}`, specVersion: A48_SPEC.version });
  const r = computeEstimate(area, loc, insulation, settings);
  const { data: cur } = await admin.from("indicative_estimates").select("id, input_signature, created_at, settings_version").eq("job_id", jobId).eq("status", "current").maybeSingle();
  let row = cur && cur.input_signature === sig ? cur : null;
  if (!row) {
    const now = new Date().toISOString();
    if (cur) await admin.from("indicative_estimates").update({ status: "superseded", superseded_at: now }).eq("id", cur.id);
    const snapshot = { formula: "GHG Eq. Reduction = GHG Savings × Area × Lifetime × Regional Factor (Spec v25 Eq 48.1)", inputs: { area, location: loc, insulation, mode }, settings, ghg: r.ghg, raw_estimated_discount: r.raw_estimated_discount, scenarios: r.scenarios, spec: A48_SPEC, calculated_at: now };
    const { data: ins, error } = await admin.from("indicative_estimates").insert({
      job_id: jobId, status: "current", input_signature: sig, eligibility_outcome: j.eligibility_outcome, display_mode: mode,
      area_m2: area.m2, area_source: area.source, area_basis: area.basis, area_source_id: area.id, postcode: loc.postcode, location: loc as unknown as Json,
      spec_version: A48_SPEC.version, spec_source_url: A48_SPEC.sourceUrl, settings_id: settings.id, settings_version: settings.version,
      veec_value: settings.indicative_veec_value, veec_source_url: settings.veec_value_source_url, veec_checked_at: settings.veec_value_checked_at,
      ghg_savings_factor: r.ghg.ghgSavings, regional_factor: r.ghg.regionalFactor, lifetime_years: r.ghg.lifetimeYears,
      raw_ghg_reduction: r.ghg.ghgReduction, raw_estimated_discount: r.raw_estimated_discount, applied_discount: r.applied_discount,
      insulation_declared: insulation, scenarios: r.scenarios as unknown as Json, snapshot: snapshot as unknown as Json,
    }).select("id, input_signature, created_at, settings_version").single();
    if (error) throw new Error(error.message);
    row = ins;
  }
  return out({ estimate: { ...r, id: row.id, created_at: row.created_at, settings_version: row.settings_version } });
}

/** Customer-safe projection: no settings metadata beyond published prices, no audit internals. */
export function customerView(v: EstimateView) {
  if (!customerCanSee(v.mode)) return { visible: false as const };
  const s = v.settings;
  return {
    visible: true as const, mode: v.mode, measureRequired: v.measureRequired, onsiteDrivers: v.onsiteDrivers, rolloutHold: v.rolloutHold, accessConcern: v.accessConcern,
    fees: s ? { piesa: Number(s.piesa_assessment_inc_gst), ap: Number(s.ap_management_inc_gst), minCopay: Number(s.minimum_customer_copayment_inc_gst) } : null,
    // Pure client-side what-if calculator inputs: resolved official v25 row + public retail prices + Step 1 insulation. Never persisted.
    calc: s && v.location ? { location: v.location, insulation: v.insulationDeclared, settings: publicSettings(s) } : null,
    postcodeUnlisted: v.postcodeUnlisted,
    estimate: v.estimate ? { area: { m2: v.estimate.area.m2, label: v.estimate.area.label }, scenarios: v.estimate.scenarios, access_adjustment: v.estimate.access_adjustment } : null,
  };
}

/** Published customer retail prices only (all already customer-facing). */
export function publicSettings(s: RetailSettings): RetailSettings {
  const n = (k: keyof RetailSettings) => Number(s[k]);
  return { id: s.id, version: s.version, r5_install_inc_gst_per_m2: n("r5_install_inc_gst_per_m2"), removal_inc_gst_per_m2: n("removal_inc_gst_per_m2"), piesa_assessment_inc_gst: n("piesa_assessment_inc_gst"), ap_management_inc_gst: n("ap_management_inc_gst"),
    access_standard_multiplier: n("access_standard_multiplier"), access_moderate_multiplier: n("access_moderate_multiplier"), access_difficult_multiplier: n("access_difficult_multiplier"), indicative_veec_value: n("indicative_veec_value"),
    veec_value_source_label: s.veec_value_source_label, veec_value_source_url: s.veec_value_source_url, veec_value_checked_at: s.veec_value_checked_at, minimum_customer_copayment_inc_gst: n("minimum_customer_copayment_inc_gst"), spec_version: s.spec_version, spec_source_url: s.spec_source_url,
    max_discount_metro_inc_gst: n("max_discount_metro_inc_gst"), max_discount_regional_inc_gst: n("max_discount_regional_inc_gst") };
}
