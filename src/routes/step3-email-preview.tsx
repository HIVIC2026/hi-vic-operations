import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { renderEstimateEmail } from "@/lib/estimate-email";
import { withUnsubscribe } from "@/lib/emailsafety.core";
import { Button } from "@/components/ui/button";

const estimateUrl = "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const sample = withUnsubscribe(
  renderEstimateEmail({
    estimateUrl,
    outcome: "likely",
    estimatedTotal: 2710,
    veuDiscount: 2140,
    areaM2: 150,
    installationPrice: 3801,
    assessmentFee: 349,
    apFee: 700,
    grossProjectTotal: 4850,
    amountPayableNow: 349,
    estimatedRemainingBalance: 2361,
    savingsPercent: 44,
    firstName: "Alex",
    address: "30 Dash St, Fraser Rise VIC 3336",
    referralUrl,
    reference: "SAMPLE-1001",
  }),
  unsubscribeUrl,
);

export const Route = createFileRoute("/step3-email-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Likely-Eligible Email Preview — Home Insulation Victoria" },
    { name: "description", content: "Static preview of the Home Insulation Victoria likely-eligible customer email." },
    { property: "og:title", content: "Likely-Eligible Email Preview — Home Insulation Victoria" },
    { property: "og:description", content: "Static likely-eligible customer email preview for visual review." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: EmailPreview,
});

function EmailPreview() {
  const [view, setView] = useState<"fit" | "desktop" | "mobile">("fit");
  const srcDoc = sample.html
    .replaceAll("https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png", "/email-preview/hi-vic-logo.png")
    .replace(/\s+href="[^"]*"/g, "");
  const width = view === "desktop" ? 640 : view === "mobile" ? 390 : undefined;
  return <main className="min-h-screen bg-background px-3 py-6 text-foreground sm:px-6">
    <div className="mx-auto max-w-[760px]">
      <p className="mb-4 border-l-4 border-primary bg-card px-4 py-3 text-sm font-bold">SAMPLE EMAIL PREVIEW ONLY — likely-eligible version. Buttons are disabled here; nothing is sent, saved or paid.</p>
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 border-b-2 border-primary pb-4 text-sm font-bold" aria-label="Preview sample values">
        <span>Alex</span><span>30 Dash St, Fraser Rise VIC 3336</span><span>150 m²</span><span>Package $4,850</span><span className="text-primary">VEU discount −$2,140</span><span>Estimated price $2,710</span><span>44% estimated saving</span>
      </div>
      <p className="mb-2 text-sm"><strong>Subject:</strong> {sample.subject}</p>
      <p className="mb-6 text-sm"><strong>Preheader:</strong> {sample.previewText}</p>
      <div className="mb-4 flex gap-2" aria-label="Preview width">
        <Button type="button" variant={view === "fit" ? "default" : "outline"} onClick={() => setView("fit")}>Fit</Button>
        <Button type="button" variant={view === "desktop" ? "default" : "outline"} onClick={() => setView("desktop")}>640 desktop</Button>
        <Button type="button" variant={view === "mobile" ? "default" : "outline"} onClick={() => setView("mobile")}>390 mobile</Button>
      </div>
      <section aria-label="Likely-eligible email preview" className="min-w-0">
        <h2 className="mb-3 text-sm font-bold">{view === "fit" ? "Responsive fit" : view === "desktop" ? "Desktop · 640px" : "Mobile · 390px"}</h2>
        <div className="mx-auto max-w-full overflow-x-auto border border-border bg-muted p-1 sm:p-3" style={width ? { width: width + 26 } : undefined}>
          <iframe title="Likely-eligible email" srcDoc={srcDoc} sandbox="" className="block h-[4600px] max-w-full border-0 bg-background" style={{ width: width ?? "100%" }} />
        </div>
      </section>
    </div>
  </main>;
}
