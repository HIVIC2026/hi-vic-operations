import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import type { RetailSettings } from "@/lib/estimate.core";

// Friendly alias of /calculator for links we send to customers.
const settings: RetailSettings = {
  id: "public-calculator-v2", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};

const title = "Your free ceiling insulation estimate — Home Insulation Victoria";
const description =
  "Find out how much you could save on ceiling insulation for your Victorian home — including the VEU rebate you're likely to qualify for. Free, no obligation, nothing saved.";

export const Route = createFileRoute("/free-estimate")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:image", content: CUSTOMER_BRAND.logoUrl },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: CUSTOMER_BRAND.logoUrl },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PublicCalculatorPage,
});

function PublicCalculatorPage() {
  return <PublicCalculator settings={settings} />;
}
