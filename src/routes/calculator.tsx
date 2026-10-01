import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AreaCalculator, type CustomerData } from "@/components/portal/estimate";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { lookupLocation } from "@/lib/activity48.core";
import { computeEstimate, type RetailSettings } from "@/lib/estimate.core";

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

function buildData(): CustomerData | null {
  const location = lookupLocation("3336");
  if (!location) return null;
  const est = computeEstimate({ m2: 150, source: "owner_estimate", basis: "Owner estimate", id: null, label: "Your estimated ceiling size" }, location, "none", settings);
  return {
    visible: true, mode: "likely",
    fees: { piesa: 349, ap: 349, minCopay: 200 },
    calc: { location, insulation: "none", settings },
    estimate: { area: { m2: 150, label: "Your estimated ceiling size" }, scenarios: est.scenarios, access_adjustment: est.access_adjustment },
  };
}

export const Route = createFileRoute("/calculator")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Insulation calculator — Home Insulation Victoria" },
    { name: "description", content: "Work out an indicative price for ceiling insulation with the Home Insulation Victoria calculator." },
    { property: "og:title", content: "Insulation calculator — Home Insulation Victoria" },
    { property: "og:description", content: "Work out an indicative price for ceiling insulation." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: PublicCalculator,
});

function PublicCalculator() {
  const [data] = useState(buildData);
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <EstimateHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
        {!data?.calc || !data.fees ? <p className="text-sm">Calculator unavailable.</p> : <AreaCalculator calc={data.calc} initial={data.estimate?.area.m2 ?? null} fees={data.fees} preview />}
      </main>
    </div>
  );
}
