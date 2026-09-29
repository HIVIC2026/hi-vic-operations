import type { CustomerData } from "@/components/portal/estimate";
import { A48_SPEC, lookupLocation } from "@/lib/activity48.core";
import { computeEstimate, type RetailSettings } from "@/lib/estimate.core";

// Fixed illustrative values only. No customer, job, or remote settings are read.
const sampleSettings: RetailSettings = {
  id: "design-sample", version: 2,
  r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70,
  veec_value_source_label: "Victorian Government consumer example",
  veec_value_source_url: "https://www.energy.vic.gov.au/households/victorian-energy-upgrades-for-households",
  veec_value_checked_at: "2026-09-29",
  minimum_customer_copayment_inc_gst: 200,
  spec_version: A48_SPEC.version, spec_source_url: A48_SPEC.sourceUrl,
};

export function step3DesignFixtures(): { knownData: CustomerData; unknownData: CustomerData } | null {
  const location = lookupLocation("3058");
  if (!location) return null;
  const area = { m2: 134.1, source: "owner_estimate" as const, basis: "declared", id: null, label: "Your estimate" };
  const known = computeEstimate(area, location, "present", sampleSettings);
  const fees = { piesa: 349, ap: 349, minCopay: 200 };
  return {
    knownData: {
       visible: true, mode: "onsite", onsiteDrivers: ["Owner says insulation is present – type and R-value must be confirmed onsite"], fees,
      calc: { location, insulation: "present", settings: sampleSettings },
      estimate: { area: { m2: known.area.m2, label: known.area.label }, scenarios: known.scenarios, access_adjustment: known.access_adjustment },
    },
    unknownData: {
      visible: true, mode: "likely", measureRequired: true, fees,
      calc: { location, insulation: "none", settings: sampleSettings },
    },
  };
}