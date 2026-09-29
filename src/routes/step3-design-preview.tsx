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
     <main className="mx-auto max-w-[720px] px-5 pb-12 pt-6 sm:px-8 sm:pt-9">
      <p className="mb-7 border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-3 text-sm font-extrabold text-estimate-navy" role="note">DESIGN PREVIEW ONLY — sample data, nothing is saved.</p>
      <div className="mb-7 flex flex-wrap gap-2 border-b-2 border-estimate-blue/20 pb-4" role="tablist" aria-label="Sample estimate">
        <Button type="button" role="tab" id="known-tab" aria-controls="known-panel" aria-selected={active === "known"} onClick={() => setActive("known")} variant="outline" className={`h-auto min-h-12 whitespace-normal border-2 border-estimate-blue px-4 py-2 text-left font-bold ${active === "known" ? "bg-estimate-green-soft text-estimate-blue estimate-offset" : "bg-estimate-white text-estimate-navy"}`}>134.1 m² · insulation present</Button>
        <Button type="button" role="tab" id="unknown-tab" aria-controls="unknown-panel" aria-selected={active === "unknown"} onClick={() => setActive("unknown")} variant="outline" className={`h-auto min-h-12 whitespace-normal border-2 border-estimate-blue px-4 py-2 text-left font-bold ${active === "unknown" ? "bg-estimate-green-soft text-estimate-blue estimate-offset" : "bg-estimate-white text-estimate-navy"}`}>Area unknown · no insulation</Button>
      </div>
      <div role="tabpanel" id="known-panel" aria-labelledby="known-tab" hidden={active !== "known"}>
        {active === "known" && <CustomerEstimate data={fixtures.knownData} publicPage />}
      </div>
      <div role="tabpanel" id="unknown-panel" aria-labelledby="unknown-tab" hidden={active !== "unknown"}>
        {active === "unknown" && <CustomerEstimate data={fixtures.unknownData} publicPage />}
      </div>
    </main>
  </div>;
}