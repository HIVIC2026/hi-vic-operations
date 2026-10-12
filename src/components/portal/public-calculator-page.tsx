import { PublicCalculator } from "@/components/portal/public-calculator";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import type { RetailSettings } from "@/lib/estimate.core";
import { publicCalculatorPricing } from "@/lib/pricing-cohort.core";

const PUBLIC_PRICING = publicCalculatorPricing();

// The one public customer calculator, shared by "/" and "/calculator".
// Local-only what-if: no server calls, writes, payments or communications.
const settings: RetailSettings = {
  id: "public-calculator-v3", version: 3, r5_install_inc_gst_per_m2: PUBLIC_PRICING.r5InstallIncGstPerM2, removal_inc_gst_per_m2: 0,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  // No maximum discount exists (Jo, 5 Oct 2026); these fields are deprecated and never applied.
  max_discount_metro_inc_gst: Infinity, max_discount_regional_inc_gst: Infinity,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};

const title = "Ceiling insulation rebate calculator Victoria (VEU) — Home Insulation Victoria";
const description =
  "Work out an indicative price for ceiling insulation in your Victorian home — including the VEU discount you're likely to qualify for. Free, no obligation, nothing saved.";

export const publicCalculatorHead = () => ({
  meta: [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://estimate.homeinsulationvictoria.com.au/" },
    { property: "og:image", content: CUSTOMER_BRAND.logoUrl },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: CUSTOMER_BRAND.logoUrl },
    { name: "robots", content: "index, follow" },
  ],
  links: [{ rel: "canonical", href: "https://estimate.homeinsulationvictoria.com.au/" }],
});

export function PublicCalculatorPage() {
  return <PublicCalculator settings={settings} readyCheckFeeIncGst={PUBLIC_PRICING.readyCheckFeeIncGst} pricingCohort={PUBLIC_PRICING.cohort} />;
}
