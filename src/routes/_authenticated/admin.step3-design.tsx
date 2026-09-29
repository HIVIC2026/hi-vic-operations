import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/portal/AppShell";
import { CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { supabase } from "@/integrations/supabase/client";
import { A48_SPEC, lookupLocation } from "@/lib/activity48.core";
import { computeEstimate, type RetailSettings } from "@/lib/estimate.core";

export const Route = createFileRoute("/_authenticated/admin/step3-design")({
  beforeLoad: async () => {
    const { data, error } = await supabase.rpc("is_admin");
    if (error || data !== true) throw redirect({ to: "/home" });
  },
  head: () => ({ meta: [
    { title: "Step 3 Design — HI VIC Portal" },
    { name: "description", content: "Private visual review of two sample HI VIC customer estimates." },
    { property: "og:title", content: "Step 3 Design — HI VIC Portal" },
    { property: "og:description", content: "Private visual review of two sample HI VIC customer estimates." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: Step3Design,
});

// Static visual fixtures only; never loads or saves jobs or estimator settings.
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

function Step3Design() {
  const location = lookupLocation("3058");
  if (!location) return <AppShell><p>Sample location unavailable.</p></AppShell>;

  const area = { m2: 134.1, source: "owner_estimate" as const, basis: "declared", id: null, label: "Your estimate" };
  const known = computeEstimate(area, location, "present", sampleSettings);
  const fees = { piesa: 349, ap: 349, minCopay: 200 };
  const knownData: CustomerData = {
    visible: true, mode: "onsite", fees,
    calc: { location, insulation: "present", settings: sampleSettings },
    estimate: { area: { m2: known.area.m2, label: known.area.label }, scenarios: known.scenarios, access_adjustment: known.access_adjustment },
  };
  const unknownData: CustomerData = {
    visible: true, mode: "likely", measureRequired: true, fees,
    calc: { location, insulation: "none", settings: sampleSettings },
  };

  return <AppShell wide>
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-foreground">Step 3 Design</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sample estimates for visual review only. These are not customer jobs.</p>
    </div>
    <div className="space-y-12">
      <section aria-labelledby="known-example" className="bg-estimate-canvas py-7 sm:py-10">
        <div className="mx-auto max-w-[840px] px-5 sm:px-8">
          <h2 id="known-example" className="mb-6 text-lg font-semibold text-foreground">134.1 m² · Existing insulation present</h2>
          <CustomerEstimate data={knownData} />
        </div>
      </section>
      <section aria-labelledby="unknown-example" className="bg-estimate-canvas py-7 sm:py-10">
        <div className="mx-auto max-w-[840px] px-5 sm:px-8">
          <h2 id="unknown-example" className="mb-6 text-lg font-semibold text-foreground">Area unknown · No existing insulation</h2>
          <CustomerEstimate data={unknownData} />
        </div>
      </section>
    </div>
  </AppShell>;
}