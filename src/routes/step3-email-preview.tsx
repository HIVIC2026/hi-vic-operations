import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { renderEstimateEmail } from "@/lib/estimate-email";

const knownSample = renderEstimateEmail({
  estimateUrl: "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link",
  estimatedTotal: 3396,
  veuDiscount: 1325,
  areaM2: 134.1,
});
const noAreaSample = renderEstimateEmail({ estimateUrl: "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link" });

export const Route = createFileRoute("/step3-email-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Step 3 Email Preview — Home Insulation Victoria" },
    { name: "description", content: "Static sample of the Home Insulation Victoria customer estimate email." },
    { property: "og:title", content: "Step 3 Email Preview — Home Insulation Victoria" },
    { property: "og:description", content: "Static sample customer estimate email for visual review." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: EmailPreview,
});

function EmailPreview() {
  const [variant, setVariant] = useState<"known" | "no-area">("known");
  const sample = variant === "known" ? knownSample : noAreaSample;
  return <main className="min-h-screen bg-background px-3 py-6 text-foreground sm:px-6">
    <div className="mx-auto max-w-[700px]">
      <p className="mb-4 border-l-4 border-primary bg-card px-4 py-3 text-sm font-bold">SAMPLE EMAIL PREVIEW ONLY — nothing is sent or saved.</p>
      <div role="tablist" aria-label="Sample email state" className="mb-5 flex gap-2">
        {([ ["known", "Known area"], ["no-area", "No area yet"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={variant === value} onClick={() => setVariant(value)} className={`rounded-lg border px-4 py-2 text-sm font-bold ${variant === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}>{label}</button>)}
      </div>
      <p className="mb-2 text-sm"><strong>Subject:</strong> {sample.subject}</p>
      <p className="mb-5 text-sm"><strong>Preheader:</strong> {sample.previewText}</p>
      <iframe title={`${variant === "known" ? "Known area" : "No area yet"} sample HI VIC estimate email`} srcDoc={sample.html.replace("https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png", "/email-preview/hi-vic-logo.png")} sandbox="" className="block h-[3400px] w-full border-0 bg-background sm:h-[2700px]" />
    </div>
  </main>;
}