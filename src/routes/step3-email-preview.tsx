import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { renderEstimateEmail } from "@/lib/estimate-email";
import { renderIneligibleEmail } from "@/lib/ineligible-email";
import { withUnsubscribe } from "@/lib/emailsafety.core";
import { Button } from "@/components/ui/button";

const estimateUrl = "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const sampleQuote = { estimatedTotal: 2710, veuDiscount: 2140, areaM2: 150, savingsPercent: 44, firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336", referralUrl };
const samples = {
  likely: withUnsubscribe(renderEstimateEmail({ estimateUrl, outcome: "likely", ...sampleQuote, reference: "SAMPLE-1001" }), unsubscribeUrl),
  onsite: withUnsubscribe(renderEstimateEmail({ estimateUrl, outcome: "onsite", ...sampleQuote, reasons: ["Existing insulation type and condition need to be confirmed.", "Ceiling access and electrical safety need to be checked onsite."], reference: "SAMPLE-1002" }), unsubscribeUrl),
  ineligible: withUnsubscribe(renderIneligibleEmail({ referralUrl, reasons: ["The property is recorded as less than five years old.", "This VEU activity is for eligible residential ceiling-insulation upgrades."], reference: "SAMPLE-1003" }), unsubscribeUrl),
};

export const Route = createFileRoute("/step3-email-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Customer Outcome Email Preview — Home Insulation Victoria" },
    { name: "description", content: "Static previews of the Home Insulation Victoria customer outcome emails." },
    { property: "og:title", content: "Customer Outcome Email Preview — Home Insulation Victoria" },
    { property: "og:description", content: "Static customer outcome email previews for visual review." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: EmailPreview,
});

function EmailPreview() {
  const [variant, setVariant] = useState<keyof typeof samples>("likely");
  const sample = samples[variant];
  const labels: Array<[keyof typeof samples, string]> = [["likely", "Likely eligible"], ["onsite", "Needs confirmation"], ["ineligible", "Does not appear eligible"]];
  const srcDoc = sample.html.replaceAll("https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png", "/email-preview/hi-vic-logo.png");
  return <main className="min-h-screen bg-background px-3 py-6 text-foreground sm:px-6">
    <div className="mx-auto max-w-[1120px]">
      <p className="mb-4 border-l-4 border-primary bg-card px-4 py-3 text-sm font-bold">SAMPLE EMAIL PREVIEW ONLY — nothing is sent or saved. Values shown are illustrative.</p>
      <div role="tablist" aria-label="Customer outcome email" className="mb-5 flex flex-wrap gap-2">
        {labels.map(([value, text]) => <Button key={value} type="button" role="tab" aria-selected={variant === value} variant={variant === value ? "default" : "outline"} onClick={() => setVariant(value)}>{text}</Button>)}
      </div>
      <p className="mb-2 text-sm"><strong>Subject:</strong> {sample.subject}</p>
      <p className="mb-6 text-sm"><strong>Preheader:</strong> {sample.previewText}</p>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,640px)_minmax(0,390px)]">
        <section aria-label="Desktop email preview" className="min-w-0"><h2 className="mb-3 text-sm font-bold">Desktop · 640px</h2><iframe title={`${labels.find(([value]) => value === variant)?.[1]} desktop email`} srcDoc={srcDoc} sandbox="" className="block h-[3800px] lg:h-[3800px] w-full border border-border bg-background" /></section>
        <section aria-label="Mobile email preview" className="min-w-0"><h2 className="mb-3 text-sm font-bold">Mobile · 390px</h2><div className="mx-auto w-full max-w-[390px] border-[6px] border-foreground bg-background"><iframe title={`${labels.find(([value]) => value === variant)?.[1]} mobile email`} srcDoc={srcDoc} sandbox="" className="block h-[5100px] w-full border-0 bg-background" /></div></section>
      </div>
    </div>
  </main>;
}
