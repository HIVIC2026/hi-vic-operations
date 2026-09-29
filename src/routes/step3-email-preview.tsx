import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "@/lib/estimate-email";
import { withUnsubscribe } from "@/lib/emailsafety.core";
import { ConfirmQuote } from "@/components/portal/estimate";
import { EstimateHeader } from "@/components/portal/EstimateHeader";


const estimateUrl = "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
// PREVIEW SAMPLE ONLY. Fees mirror the two approved $349 fields; totals are derived, never typed.
const SAMPLE_INSTALL = 3801, SAMPLE_DISCOUNT = 2140, PIESA_FEE = 349, AP_FEE = 349;
const SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE;
const SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT;
const quote = {
  estimateUrl,
  estimatedTotal: SAMPLE_CUSTOMER,
  veuDiscount: SAMPLE_DISCOUNT,
  areaM2: 150,
  installationPrice: SAMPLE_INSTALL,
  assessmentFee: PIESA_FEE,
  apFee: AP_FEE,
  grossProjectTotal: SAMPLE_GROSS,
  amountPayableNow: PIESA_FEE,
  estimatedRemainingBalance: SAMPLE_CUSTOMER - PIESA_FEE,
  savingsPercent: Math.round((SAMPLE_DISCOUNT / SAMPLE_GROSS) * 100),
  firstName: "Alex",
  address: "30 Dash St, Fraser Rise VIC 3336",
  referralUrl,
  reference: "SAMPLE-1001",
} as const;
const samples = {
  likely: withUnsubscribe(renderEstimateEmail({
    ...quote,
    estimateUrl,
    outcome: "likely",
  }), unsubscribeUrl),
  onsite: withUnsubscribe(renderEstimateEmail({
    ...quote,
    outcome: "onsite",
    reasons: ["The existing insulation and eligible ceiling area need to be confirmed onsite.", "Roof access and electrical safety need to be checked."],
  }), unsubscribeUrl),
  ineligible: withUnsubscribe(renderIneligibleOutcomeEmail({
    referralUrl,
    reasons: ["The information supplied indicates this property does not meet the preliminary requirements for this offer."],
    reference: "SAMPLE-1001",
  }), unsubscribeUrl),
};

export const Route = createFileRoute("/step3-email-preview")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Customer Outcome Email Previews — Home Insulation Victoria" },
    { name: "description", content: "Static previews of the Home Insulation Victoria customer outcome emails." },
    { property: "og:title", content: "Customer Outcome Email Previews — Home Insulation Victoria" },
    { property: "og:description", content: "Static customer outcome email previews for visual review." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: EmailPreview,
});

function EmailPreview() {
  const [view, setView] = useState<"fit" | "desktop" | "mobile">("fit");
  const [outcome, setOutcome] = useState<keyof typeof samples>("likely");
  const [hasExistingInsulation, setHasExistingInsulation] = useState(false);
  const [previewKind, setPreviewKind] = useState<"email" | "confirm">("email");
  const sample = outcome === "ineligible" ? samples.ineligible : withUnsubscribe(renderEstimateEmail({
    ...quote,
    outcome,
    existingInsulationPresent: hasExistingInsulation,
    ...(outcome === "onsite" ? { reasons: ["The existing insulation and eligible ceiling area need to be confirmed onsite.", "Roof access and electrical safety need to be checked."] } : {}),
  }), unsubscribeUrl);
  const srcDoc = sample.html
    .replaceAll("https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png", "/email-preview/hi-vic-logo.png")
    .replace(/(<a\b[^>]*?)\s+href="[^"]*"/g, "$1");
  const width = view === "desktop" ? 640 : view === "mobile" ? 390 : undefined;
  const brand = { fontFamily: "'Open Sans', Arial, Helvetica, sans-serif", background: "#FBFCFA", color: "#22376B" };
  const pill = (active: boolean) => ({ fontFamily: brand.fontFamily, background: active ? "#3C51C4" : "#FFFFFF", color: active ? "#FFFFFF" : "#3C51C4", border: "2px solid #3C51C4", boxShadow: active ? "3px 3px 0 #07BF61" : "none" });
  const btn = "ep-btn min-h-11 px-3 py-2 text-xs font-extrabold uppercase tracking-wider";
  return <main className="min-h-screen px-3 py-6 sm:px-6" style={brand}>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" />
    <style>{`.ep-btn:focus-visible{outline:3px solid #07BF61;outline-offset:2px}`}</style>
    <div className="mx-auto max-w-[760px]">
       <p className="mb-4 px-4 py-3 text-sm font-bold" style={{ background: "#ECF9F1", borderLeft: "4px solid #07BF61" }}>SAMPLE EMAIL PREVIEW ONLY. Buttons are disabled here; nothing is sent, saved or paid.</p>
       <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 pb-4 text-sm font-bold" style={{ borderBottom: "2px solid #3C51C4" }} aria-label="Preview sample values">
        <span>Alex</span><span>150 m²</span><span>Project ${SAMPLE_GROSS.toLocaleString("en-AU")}</span><span style={{ color: "#07BF61" }}>VEU discount −${SAMPLE_DISCOUNT.toLocaleString("en-AU")}</span><span>Estimated price ${SAMPLE_CUSTOMER.toLocaleString("en-AU")}</span><span>$349 now · ${(SAMPLE_CUSTOMER - PIESA_FEE).toLocaleString("en-AU")} remaining</span>
      </div>
       <div className="mb-4 flex flex-wrap gap-2" aria-label="Email outcome">
          {(["likely", "onsite", "ineligible"] as const).map((item) => <button key={item} type="button" aria-pressed={outcome === item} className={btn} style={pill(outcome === item)} onClick={() => { setOutcome(item); if (item === "ineligible") setPreviewKind("email"); }}>{item === "likely" ? "Likely eligible" : item === "onsite" ? "Needs onsite confirmation" : "Does not appear eligible"}</button>)}
       </div>
       <div className="mb-4 flex flex-wrap gap-2" aria-label="Preview screen">
         <button type="button" aria-pressed={previewKind === "email"} className={btn} style={pill(previewKind === "email")} onClick={() => setPreviewKind("email")}>Email</button>
         {outcome !== "ineligible" && <button type="button" aria-pressed={previewKind === "confirm"} className={btn} style={pill(previewKind === "confirm")} onClick={() => setPreviewKind("confirm")}>Secure next step</button>}
       </div>
      {previewKind === "email" && <><p className="mb-2 text-sm"><strong>Subject:</strong> {sample.subject}</p><p className="mb-6 text-sm"><strong>Preheader:</strong> {sample.previewText}</p></>}
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Preview width">
        <button type="button" aria-pressed={view === "fit"} className={btn} style={pill(view === "fit")} onClick={() => setView("fit")}>Fit</button>
        <button type="button" aria-pressed={view === "desktop"} className={btn} style={pill(view === "desktop")} onClick={() => setView("desktop")}>640 desktop</button>
        <button type="button" aria-pressed={view === "mobile"} className={btn} style={pill(view === "mobile")} onClick={() => setView("mobile")}>390 mobile</button>
      </div>
       <section aria-label={`${outcome} ${previewKind} preview`} className="min-w-0">
        <h2 className="mb-3 text-sm font-extrabold uppercase" style={{ color: "#3C51C4" }}>{view === "fit" ? "Responsive fit" : view === "desktop" ? "Desktop · 640px" : "Mobile · 390px"}</h2>
         {previewKind === "email" ? <div className="mx-auto max-w-full overflow-x-auto p-1 sm:p-3" style={{ background: "#FFFFFF", border: "2px solid #3C51C4", ...(width ? { width: width + 30 } : {}) }}>
            <iframe title={`${outcome} email`} srcDoc={srcDoc} sandbox="" className="block h-[2800px] max-w-full border-0" style={{ width: width ?? "100%", background: "#FBFCFA" }} />
         </div> : <div className="estimate-brand mx-auto max-w-full overflow-hidden bg-estimate-canvas" style={{ width: width ?? "100%" }}><EstimateHeader /><div className="px-4 pb-10"><ConfirmQuote estimatedPrice={SAMPLE_CUSTOMER} assessmentFee={PIESA_FEE} preview onBack={() => setPreviewKind("email")} /></div></div>}
       {outcome !== "ineligible" && <div className="mb-4 flex flex-wrap gap-2" aria-label="Existing insulation sample">
         <button type="button" aria-pressed={!hasExistingInsulation} className={btn} style={pill(!hasExistingInsulation)} onClick={() => setHasExistingInsulation(false)}>No existing insulation</button>
         <button type="button" aria-pressed={hasExistingInsulation} className={btn} style={pill(hasExistingInsulation)} onClick={() => setHasExistingInsulation(true)}>Existing insulation: yes</button>
       </div>}
      </section>
    </div>
  </main>;
}
