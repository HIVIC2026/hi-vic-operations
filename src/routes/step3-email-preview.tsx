import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendSaveSpotPreviewTest } from "@/lib/hot-leads.functions";
import { renderFollowupEmail } from "@/lib/followup-email";
import { renderCoverageUnavailableEmail } from "@/lib/coverage-email";
import { renderEstimateEmail, renderIneligibleOutcomeEmail, PUBLIC_CALCULATOR_URL } from "@/lib/estimate-email";
import { renderStep3SaveSpot, STEP3_SAVESPOT_SAMPLE } from "@/lib/step3-emails";
import { withUnsubscribe } from "@/lib/emailsafety.core";
import { ConfirmQuote } from "@/components/portal/estimate";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import type { RetailSettings } from "@/lib/estimate.core";
import { CUSTOMER_BRAND, CUSTOMER_QUOTE_LABELS } from "@/lib/customer-quote-system";
import type { ReadyCheckAcceptanceState } from "@/lib/readycheck.core";
import { MeasuredQuoteSample, type PiesaPreviewCase } from "@/components/portal/readycheck";


const estimateUrl = "https://estimate.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
// PREVIEW SAMPLE ONLY. The Ready Check is free; PIESA and AP fees remain dynamic quote inputs.
// Illustrative example only — real Step 3 calculation for postcode 3336, 150 m², standard access, no removal, current settings v2.
const SAMPLE_INSTALL = 4500, SAMPLE_DISCOUNT = 1481.76, PIESA_FEE = 349, AP_FEE = 349;
const SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE;
const SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT;
const previewSettings: RetailSettings = {
  id: "preview-v2", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0,
  piesa_assessment_inc_gst: PIESA_FEE, ap_management_inc_gst: AP_FEE,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  max_discount_metro_inc_gst: 1500, max_discount_regional_inc_gst: 2100,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};
const quote = {
  estimateUrl,
  estimatedTotal: SAMPLE_CUSTOMER,
  veuDiscount: SAMPLE_DISCOUNT,
  areaM2: 150,
  installationPrice: SAMPLE_INSTALL,
  assessmentFee: PIESA_FEE,
  apFee: AP_FEE,
  grossProjectTotal: SAMPLE_GROSS,
  amountPayableNow: 0,
  estimatedRemainingBalance: SAMPLE_CUSTOMER,
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
    apCount: 2, // business-owner supplied current figure (1 Oct 2026), not registry-verified
  }), unsubscribeUrl),
  // APPROVED by Jo Lowe, 7 Oct 2026 — FINAL Save your spot email.
  savespot: renderStep3SaveSpot(STEP3_SAVESPOT_SAMPLE),
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
  reminder3: withUnsubscribe(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl, referralUrl }), unsubscribeUrl),
  coverage: withUnsubscribe(renderCoverageUnavailableEmail({ firstName: "Alex", suburb: "Fraser Rise", postcode: "3336", missing: ["installer"], reference: "SAMPLE-1001" }), unsubscribeUrl),
};
const OUTCOME_LABELS = { likely: "Likely eligible", savespot: "Save your spot (likely eligible) – APPROVED", onsite: "Needs onsite confirmation", ineligible: "Does not appear eligible", reminder3: "Reminder: 3 days, unopened", coverage: "Service availability update" } as const;

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

function SaveSpotTestSend() {
  const send = useServerFn(sendSaveSpotPreviewTest);
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "#EAF8F0" }}>
      <p className="font-bold">APPROVED by Jo Lowe, 7 Oct 2026. Hot-leads sending stays off.</p>
      <button type="button" className="mt-2 rounded-full px-4 py-2 font-bold" style={{ background: CUSTOMER_BRAND.colors.green, color: "#fff" }}
        onClick={async () => { setState("Sending…"); try { const r = await send({ data: {} }); setState(`${r.outcome}: ${r.detail}${r.sendId ? ` (${r.sendId})` : ""}`); } catch (e) { setState((e as Error).message); } }}>
        Send test to jolowexo@hotmail.com
      </button>
      {state && <p className="mt-2">{state}</p>}
    </div>
  );
}

function EmailPreview() {
  const [view, setView] = useState<"fit" | "desktop" | "mobile">("fit");
  const [outcome, setOutcome] = useState<keyof typeof samples>("likely");
  const [hasExistingInsulation, setHasExistingInsulation] = useState(false);
  const [previewKind, setPreviewKind] = useState<"email" | "confirm" | "measured">("email");
  const [piesaCase, setPiesaCase] = useState<PiesaPreviewCase>("higher");
  const [testState, setTestState] = useState<"unaccepted" | "accepted">("unaccepted");
  const [emailHeight, setEmailHeight] = useState(2050);
  const previewAcceptance: ReadyCheckAcceptanceState | null = testState === "unaccepted" ? null : { acceptanceId: "preview-acceptance", estimateId: "preview-estimate", acceptedAt: "2026-09-29T00:00:00Z", paymentId: null, paymentStatus: "accepted", amountIncGst: 0, estimatedRemainingBalanceIncGst: SAMPLE_CUSTOMER, paidAt: null, stale: false };
  const isQuote = outcome === "likely" || outcome === "onsite";
  const sample = !isQuote ? samples[outcome] : withUnsubscribe(renderEstimateEmail({
    ...quote,
    outcome,
    existingInsulationPresent: hasExistingInsulation,
    apCount: 2, // business-owner supplied current figure (1 Oct 2026), not registry-verified
    ...(outcome === "onsite" ? { reasons: ["The existing insulation and eligible ceiling area need to be confirmed onsite.", "Roof access and electrical safety need to be checked."] } : {}),
  }), unsubscribeUrl);
  const srcDoc = sample.html.replace(/(<a\b[^>]*?)\s+href="[^"]*"/g, "$1");
  const outcomeTestUrl = outcome === "ineligible" ? "https://homeinsulationvictoria.com.au/homeowner" : `${estimateUrl}#confirm`;
  const width = view === "desktop" ? 640 : view === "mobile" ? 390 : undefined;
  const brand = { fontFamily: "Figtree, Arial, Helvetica, sans-serif", background: CUSTOMER_BRAND.colors.offWhite, color: CUSTOMER_BRAND.colors.navy };
  const pill = (active: boolean) => ({ fontFamily: brand.fontFamily, background: active ? CUSTOMER_BRAND.colors.blue : CUSTOMER_BRAND.colors.white, color: active ? CUSTOMER_BRAND.colors.white : CUSTOMER_BRAND.colors.blue, border: `2px solid ${CUSTOMER_BRAND.colors.blue}`, boxShadow: active ? `3px 3px 0 ${CUSTOMER_BRAND.colors.green}` : "none" });
  const btn = "ep-btn min-h-11 px-3 py-2 text-xs font-extrabold uppercase tracking-wider";
  return <main className="min-h-screen px-3 py-6 sm:px-6" style={brand}>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&family=Outfit:wght@700;800&display=swap" />
    <style>{`.ep-btn:focus-visible{outline:3px solid #07BF61;outline-offset:2px}`}</style>
    <div className="mx-auto max-w-[760px]">
       <p className="estimate-action-card mb-4 text-sm font-bold">SAMPLE EMAIL PREVIEW ONLY. Buttons are disabled here; nothing is sent, saved or paid.</p>
       <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 pb-4 text-sm font-bold" style={{ borderBottom: "2px solid #3C51C4" }} aria-label="Preview sample values">
        <span style={{ color: CUSTOMER_BRAND.colors.blue }}>Sample values only:</span><span>Alex</span><span>150 m²</span><span>{CUSTOMER_QUOTE_LABELS.projectTotal} ${SAMPLE_GROSS.toLocaleString("en-AU")}</span><span style={{ color: CUSTOMER_BRAND.colors.green }}>{CUSTOMER_QUOTE_LABELS.discount} −${SAMPLE_DISCOUNT.toLocaleString("en-AU")}</span><span>{CUSTOMER_QUOTE_LABELS.finalCost} ${SAMPLE_CUSTOMER.toLocaleString("en-AU")}</span>
      </div>
       {outcome === "savespot" && <SaveSpotTestSend />}
       <div className="mb-4 flex flex-wrap gap-2" aria-label="Email outcome">
          {(Object.keys(OUTCOME_LABELS) as Array<keyof typeof OUTCOME_LABELS>).map((item) => <button key={item} type="button" aria-pressed={outcome === item} className={btn} style={pill(outcome === item)} onClick={() => { setOutcome(item); if (item !== "likely" && item !== "onsite") setPreviewKind("email"); }}>{OUTCOME_LABELS[item]}</button>)}
       </div>
       <div className="mb-4 flex flex-wrap gap-2" aria-label="Preview screen">
         <button type="button" aria-pressed={previewKind === "email"} className={btn} style={pill(previewKind === "email")} onClick={() => setPreviewKind("email")}>Email</button>
           {isQuote && <button type="button" aria-pressed={previewKind === "confirm"} className={btn} style={pill(previewKind === "confirm")} onClick={() => setPreviewKind("confirm")}>Free Insulation Measure-Up & Eligibility Check (test)</button>}
          {isQuote && <button type="button" aria-pressed={previewKind === "measured"} className={btn} style={pill(previewKind === "measured")} onClick={() => setPreviewKind("measured")}>Measured quote + PIESA (test)</button>}
       </div>
      {previewKind === "measured" && <div className="mb-4 flex flex-wrap gap-2" aria-label="PIESA state">
        {([["before", "PIESA: before"], ["none", "PIESA: no rectification"], ["same", "PIESA: same"], ["lower", "PIESA: lower"], ["higher", "PIESA: higher"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={piesaCase === k} className={btn} style={pill(piesaCase === k)} onClick={() => setPiesaCase(k)}>{l}</button>)}
      </div>}
      {previewKind === "email" && <><p className="mb-2 text-sm"><strong>Subject:</strong> {sample.subject}</p><p className="mb-6 text-sm"><strong>Preheader:</strong> {sample.previewText}</p></>}
       {previewKind === "email" && <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-bold">
           {isQuote && <a href={PUBLIC_CALCULATOR_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: "#3C51C4" }}>Test Open the calculator → (opens the public calculator)</a>}
         {outcome === "ineligible"
           ? <a href={outcomeTestUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: "#3C51C4" }}>Test Review my result →</a>
           : <button type="button" onClick={() => setPreviewKind("confirm")} className="underline" style={{ color: "#067A45" }}>Test Arrange my free measure-up & eligibility check →</button>}
       </div>}
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Preview width">
        <button type="button" aria-pressed={view === "fit"} className={btn} style={pill(view === "fit")} onClick={() => setView("fit")}>Fit</button>
        <button type="button" aria-pressed={view === "desktop"} className={btn} style={pill(view === "desktop")} onClick={() => setView("desktop")}>640 desktop</button>
        <button type="button" aria-pressed={view === "mobile"} className={btn} style={pill(view === "mobile")} onClick={() => setView("mobile")}>390 mobile</button>
      </div>
       <section aria-label={`${outcome} ${previewKind} preview`} className="min-w-0">
        <h2 className="mb-3 text-sm font-extrabold uppercase" style={{ color: "#3C51C4" }}>{view === "fit" ? "Responsive fit" : view === "desktop" ? "Desktop · 640px" : "Mobile · 390px"}</h2>
          {previewKind === "measured" ? <div className="mx-auto max-w-full" style={{ width: width ?? "100%" }}><MeasuredQuoteSample insulation={SAMPLE_INSTALL} piesa={PIESA_FEE} ap={AP_FEE} discount={SAMPLE_DISCOUNT} existingInsulation={hasExistingInsulation} piesaCase={piesaCase} /></div> : previewKind === "email" ? <div className="mx-auto max-w-full overflow-x-auto" style={width ? { width } : undefined}>
             <iframe key={`${outcome}-${view}-${hasExistingInsulation}`} title={`${outcome} email`} srcDoc={srcDoc} sandbox="allow-same-origin" onLoad={(event) => { const frame = event.currentTarget; const doc = frame.contentDocument; const measure = () => { const measured = doc?.querySelector(".hiv-main")?.getBoundingClientRect().bottom; if (measured) setEmailHeight(Math.ceil(measured) + 38); }; measure(); for (const ms of [250, 900, 2000]) window.setTimeout(measure, ms); doc?.fonts?.ready.then(measure).catch(() => {}); doc?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure, { once: true })); }} className="block max-w-full border-0" style={{ width: width ?? "100%", height: emailHeight, background: "#FBFCFA" }} />
            </div> : <div className="estimate-brand mx-auto max-w-full overflow-hidden bg-estimate-canvas" style={{ width: width ?? "100%" }}><EstimateHeader /><div className="px-4 pb-10"><ConfirmQuote key={testState} estimatedPrice={SAMPLE_CUSTOMER} assessmentFee={PIESA_FEE} preview testMode state={previewAcceptance} onAccept={() => setTestState("accepted")} onBack={() => setPreviewKind("email")} /></div></div>}
         {previewKind === "confirm" && isQuote && <div className="mb-4 flex flex-wrap gap-2" aria-label="Test request state">{(["unaccepted", "accepted"] as const).map((item) => <button key={item} type="button" className={btn} aria-pressed={testState === item} style={pill(testState === item)} onClick={() => setTestState(item)}>{item}</button>)}</div>}
       {isQuote && <div className="mb-4 flex flex-wrap gap-2" aria-label="Existing insulation sample">
         <button type="button" aria-pressed={!hasExistingInsulation} className={btn} style={pill(!hasExistingInsulation)} onClick={() => setHasExistingInsulation(false)}>No existing insulation</button>
         <button type="button" aria-pressed={hasExistingInsulation} className={btn} style={pill(hasExistingInsulation)} onClick={() => setHasExistingInsulation(true)}>Existing insulation: yes</button>
       </div>}
      </section>
    </div>
  </main>;
}
