import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CustomerEstimate } from "@/components/portal/estimate";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { Button } from "@/components/ui/button";
import { step3DesignFixtures } from "@/lib/step3-design-fixtures";

export const Route = createFileRoute("/step3-design-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Step 3 Design Preview — Home Insulation Victoria" },
    { name: "description", content: "Sample-only visual preview of Home Insulation Victoria indicative estimates." },
    { property: "og:title", content: "Step 3 Design Preview — Home Insulation Victoria" },
    { property: "og:description", content: "Sample-only visual preview of indicative estimates." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: Step3DesignPreview,
});

function Step3DesignPreview() {
  const [active, setActive] = useState<"known" | "unknown">("known");
  const fixtures = step3DesignFixtures();
  if (!fixtures) return <p>Sample location unavailable.</p>;

  return <div className="estimate-brand min-h-screen bg-estimate-canvas">
    <EstimateHeader />
     <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
      <p className="mb-5 border-l-2 border-estimate-accent bg-estimate-accent-soft px-4 py-3 text-xs font-semibold uppercase tracking-wider text-estimate-navy" role="note">Design preview only — sample data, nothing is saved.</p>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Sample estimate">
        <Button type="button" role="tab" id="known-tab" aria-controls="known-panel" aria-selected={active === "known"} onClick={() => setActive("known")} variant="outline" className={`h-auto min-h-11 whitespace-normal rounded-lg border px-4 py-2 text-left text-sm font-semibold ${active === "known" ? "border-estimate-blue bg-estimate-blue text-estimate-white" : "border-estimate-blue-soft bg-estimate-white text-estimate-navy"}`}>134.1 m² · insulation present</Button>
        <Button type="button" role="tab" id="unknown-tab" aria-controls="unknown-panel" aria-selected={active === "unknown"} onClick={() => setActive("unknown")} variant="outline" className={`h-auto min-h-11 whitespace-normal rounded-lg border px-4 py-2 text-left text-sm font-semibold ${active === "unknown" ? "border-estimate-blue bg-estimate-blue text-estimate-white" : "border-estimate-blue-soft bg-estimate-white text-estimate-navy"}`}>Area unknown · no insulation</Button>
      </div>
      <div className="estimate-offset overflow-hidden rounded-2xl border border-estimate-blue-soft bg-estimate-white px-5 py-7 sm:px-10 sm:py-11" role="tabpanel" id="known-panel" aria-labelledby="known-tab" hidden={active !== "known"}>
        {active === "known" && <CustomerEstimate data={fixtures.knownData} publicPage />}
      </div>
      <div className="estimate-offset overflow-hidden rounded-2xl border border-estimate-blue-soft bg-estimate-white px-5 py-7 sm:px-10 sm:py-11" role="tabpanel" id="unknown-panel" aria-labelledby="unknown-tab" hidden={active !== "unknown"}>
        {active === "unknown" && <CustomerEstimate data={fixtures.unknownData} publicPage />}
      </div>
    </main>
  </div>;
}