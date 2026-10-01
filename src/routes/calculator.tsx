import { createFileRoute } from "@tanstack/react-router";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import type { RetailSettings } from "@/lib/estimate.core";

// Public standalone calculator for clients. Local-only what-if: no server calls, writes, payments or communications.
const settings: RetailSettings = {
  id: "public-calculator-v2", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};

const title = "Ceiling insulation rebate calculator Victoria (VEU) — Home Insulation Victoria";
const description =
  "Work out an indicative price for ceiling insulation in your Victorian home — including the VEU discount you're likely to qualify for. Free, no obligation, nothing saved.";

export const Route = createFileRoute("/calculator")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store" }),
  head: () => ({
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
  }),
  component: PublicCalculatorPage,
});

function PublicCalculatorPage() {
  return <PublicCalculator settings={settings} />;
}
