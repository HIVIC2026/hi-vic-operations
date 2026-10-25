import { PublicCalculator } from "@/components/portal/public-calculator";
import type { RetailSettings } from "@/lib/estimate.core";

// The one public customer calculator, shared by "/" and "/calculator".
// Local-only what-if: no server calls, writes, payments or communications.
const settings: RetailSettings = {
  id: "public-calculator-v3", version: 3, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  // No maximum discount exists (Jo, 5 Oct 2026); these fields are deprecated and never applied.
  max_discount_metro_inc_gst: Infinity, max_discount_regional_inc_gst: Infinity,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};

// The head tags live in ./public-calculator-head (route heads are not code-split; decision 280).
export { publicCalculatorHead } from "./public-calculator-head";

export function PublicCalculatorPage() {
  return <PublicCalculator settings={settings} />;
}
