import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { Button } from "@/components/ui/button";
import { renderLaunchCampaignEmail } from "@/lib/estimate-email";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import type { RetailSettings } from "@/lib/estimate.core";

const settings: RetailSettings = {
  id: "campaign-preview", version: 3, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-10-05", minimum_customer_copayment_inc_gst: 200,
  max_discount_metro_inc_gst: Infinity, max_discount_regional_inc_gst: Infinity,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};
const campaignUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}/campaign`;
const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/email/unsubscribe?t=${"U".repeat(43)}`;

export const Route = createFileRoute("/campaign-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Launch campaign previews — Home Insulation Victoria" },
    { name: "description", content: "Private previews of Home Insulation Victoria launch campaign pages and emails." },
    { property: "og:title", content: "Launch campaign previews — Home Insulation Victoria" },
    { property: "og:description", content: "Private previews of Home Insulation Victoria launch campaign pages and emails." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: CampaignPreview,
});

function CampaignPreview() {
  const [group, setGroup] = useState<"likely" | "onsite">("likely");
  const [kind, setKind] = useState<"page" | "email">("page");
  const email = renderLaunchCampaignEmail({ group, campaignUrl, unsubscribeUrl, firstName: group === "likely" ? "Sarah" : "Michael", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: group === "likely" ? "14 Example Street, Ballarat VIC 3350" : "28 Sample Road, Bendigo VIC 3550" });
  return <main className="estimate-brand min-h-screen bg-estimate-canvas py-4">
    <nav className="mx-auto mb-4 grid max-w-[390px] grid-cols-2 gap-2 px-4" aria-label="Preview controls">
      <Button variant={group === "likely" ? "default" : "outline"} onClick={() => setGroup("likely")}>Group A</Button>
      <Button variant={group === "onsite" ? "default" : "outline"} onClick={() => setGroup("onsite")}>Group B</Button>
      <Button variant={kind === "page" ? "default" : "outline"} onClick={() => setKind("page")}>Owner page</Button>
      <Button variant={kind === "email" ? "default" : "outline"} onClick={() => setKind("email")}>Email</Button>
    </nav>
    <section data-preview-content="true">
    {kind === "email" ? <iframe title={`${group} campaign email`} sandbox="" srcDoc={email.html} className="mx-auto block h-[1100px] w-[390px] max-w-full border-0 bg-estimate-canvas" /> : <section className="mx-auto max-w-[390px] px-4 pt-6 text-center"><OwnerHouse level={0} className="mx-auto" /><h1 className="mt-4 font-display text-3xl font-extrabold text-estimate-navy">You're on the list!</h1><p className="mt-3 text-estimate-navy/75">No payment and no obligation. We'll be in touch as soon as an installer is free in your area.</p>{group === "onsite" && <div className="mt-5 rounded-xl bg-estimate-mint p-4"><h2 className="font-display text-lg font-bold text-estimate-navy">Want to jump the queue?</h2><Button className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent">Send a quick video</Button></div>}</section>}
    </section>
  </main>;
}