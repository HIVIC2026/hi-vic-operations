import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PublicCalculator } from "@/components/portal/public-calculator";
import { Button } from "@/components/ui/button";
import { renderLaunchCampaignEmail } from "@/lib/estimate-email";
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
const campaignUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}/campaign`;

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
  const email = renderLaunchCampaignEmail({ group, campaignUrl, firstName: group === "likely" ? "Sarah" : "Michael", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: group === "likely" ? "14 Example Street, Ballarat VIC 3350" : "28 Sample Road, Bendigo VIC 3550" });
  return <main className="estimate-brand min-h-screen bg-estimate-canvas py-4">
    <nav className="mx-auto mb-4 grid max-w-[390px] grid-cols-2 gap-2 px-4" aria-label="Preview controls">
      <Button variant={group === "likely" ? "default" : "outline"} onClick={() => setGroup("likely")}>Group A</Button>
      <Button variant={group === "onsite" ? "default" : "outline"} onClick={() => setGroup("onsite")}>Group B</Button>
      <Button variant={kind === "page" ? "default" : "outline"} onClick={() => setKind("page")}>Owner page</Button>
      <Button variant={kind === "email" ? "default" : "outline"} onClick={() => setKind("email")}>Email</Button>
    </nav>
    <section data-preview-content="true">
    {kind === "email" ? <iframe title={`${group} campaign email`} sandbox="" srcDoc={email.html} className="mx-auto block h-[1100px] w-[390px] max-w-full border-0 bg-estimate-canvas" /> : <>
      {group === "onsite" && <section className="mx-4 mb-4 rounded-[22px] border border-estimate-line bg-estimate-mint p-5"><h2 className="font-display text-xl font-bold text-estimate-navy">Help us check from the desk</h2><p className="mt-2 text-sm text-estimate-navy/75">Send a short video from the manhole. You can also add photos. This desk check does not replace the onsite Ready Check.</p><Button variant="outline" className="mt-4 border-estimate-blue text-estimate-blue">Upload a video or photos</Button></section>}
      <PublicCalculator key={group} settings={settings} initialValues={{ address: group === "likely" ? "14 Example Street, Ballarat VIC 3350" : "28 Sample Road, Bendigo VIC 3550", areaM2: 150, insulation: group === "likely" ? "none" : "present" }} heading={`${group === "likely" ? "Sarah" : "Michael"}, here's how much you could save`} hideRegistration resultAction={() => <div className="mt-4"><Button className="min-h-12 w-full bg-estimate-green text-estimate-white hover:bg-estimate-accent">Save my spot</Button><p className="mt-2 text-center text-xs text-estimate-navy/75">Saving your spot does not book a visit.</p></div>} footer={<footer className="mt-6 border-t border-estimate-line pb-6 pt-4 text-center text-xs text-estimate-navy/75"><button type="button" className="underline">I&apos;m no longer interested — remove my enquiry</button></footer>} />
    </>}
    </section>
  </main>;
}