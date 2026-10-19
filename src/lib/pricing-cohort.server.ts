// Reads the pricing cutover + per-job cohort snapshot and resolves through the pure rule. Read-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { PricingCohortUnknownError, resolveCustomerPricing, type CohortSnapshot, type Cutover, type PricingRates, type ResolvedPricing } from "./pricing-cohort.core";

// Tables are added by the staged migration docs/pending-migrations/0200_pricing_cohort_cutover.sql; untyped until applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => admin as any;
const NOT_INSTALLED = new Set(["PGRST205", "42P01"]);

type SettingsRow = { id: string; version: number; r5_install_inc_gst_per_m2: number; removal_inc_gst_per_m2: number; piesa_assessment_inc_gst: number; ap_management_inc_gst: number; ready_check_fee_inc_gst?: number | null };
const toRates = (r: SettingsRow): PricingRates => ({
  settingsId: r.id, settingsVersion: Number(r.version), r5InstallIncGstPerM2: Number(r.r5_install_inc_gst_per_m2), removalIncGstPerM2: Number(r.removal_inc_gst_per_m2),
  piesaIncGst: Number(r.piesa_assessment_inc_gst), apIncGst: Number(r.ap_management_inc_gst), readyCheckFeeIncGst: 0,
});

export async function loadCutover(): Promise<Cutover> {
  const { data, error } = await db().from("pricing_cutover").select("cutover_at, new_settings_id, rolled_back_at").is("rolled_back_at", null).maybeSingle();
  if (error) { if (NOT_INSTALLED.has(error.code)) return null; throw new PricingCohortUnknownError(); }
  if (!data) return null;
  const { data: s, error: e2 } = await admin.from("retail_estimator_settings").select("*").eq("id", data.new_settings_id).maybeSingle();
  if (e2 || !s) throw new PricingCohortUnknownError();
  return { cutoverAt: String(data.cutover_at), newSettings: toRates(s as unknown as SettingsRow) };
}

export async function pricingForJob(jobId: string): Promise<ResolvedPricing> {
  const [{ data: cur }, cutover] = await Promise.all([admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(), loadCutover()]);
  const legacy = cur ? toRates(cur as unknown as SettingsRow) : null;
  if (!cutover) return resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, legacy, null);
  const [{ data: saved, error: e1 }, { data: snap, error: e2 }] = await Promise.all([
    admin.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", jobId).not("spot_saved_at", "is", null).order("spot_saved_at").limit(1).maybeSingle(),
    db().from("job_pricing_cohorts").select("*").eq("job_id", jobId).maybeSingle(),
  ]);
  if (e1 || e2) throw new PricingCohortUnknownError();
  const snapshot: CohortSnapshot | null = snap ? {
    cohort: snap.cohort, spotSavedAt: snap.spot_saved_at, settingsId: snap.settings_id, settingsVersion: Number(snap.settings_version),
    r5InstallIncGstPerM2: Number(snap.r5_install_inc_gst_per_m2), removalIncGstPerM2: Number(snap.removal_inc_gst_per_m2), piesaIncGst: Number(snap.piesa_assessment_inc_gst),
    apIncGst: Number(snap.ap_management_inc_gst), readyCheckFeeIncGst: 0,
    savedTotal: snap.saved_total == null ? null : Number(snap.saved_total), savedGrossTotal: snap.saved_gross_total == null ? null : Number(snap.saved_gross_total),
    savedVeuDiscount: snap.saved_veu_discount == null ? null : Number(snap.saved_veu_discount), savedAreaM2: snap.saved_area_m2 == null ? null : Number(snap.saved_area_m2),
  } : null;
  return resolveCustomerPricing({ spotSavedAt: saved?.spot_saved_at ?? null, snapshot }, legacy, cutover);
}

/** A brand-new enquiry with no job/saved spot yet (public calculator, calculator-only leads). */
export async function pricingForNewEnquiry(): Promise<ResolvedPricing> {
  const [{ data: cur }, cutover] = await Promise.all([admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(), loadCutover()]);
  return resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, cur ? toRates(cur as unknown as SettingsRow) : null, cutover);
}

/** Apply resolved rates onto a retail-settings object (other fields — multipliers, VEEC value, minimum — unchanged). */
export function withCohortRates<T extends { r5_install_inc_gst_per_m2: number; removal_inc_gst_per_m2: number; piesa_assessment_inc_gst: number; ap_management_inc_gst: number }>(s: T, p: ResolvedPricing): T {
  return { ...s, r5_install_inc_gst_per_m2: p.r5InstallIncGstPerM2, removal_inc_gst_per_m2: p.removalIncGstPerM2, piesa_assessment_inc_gst: p.piesaIncGst, ap_management_inc_gst: p.apIncGst };
}
