import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConfirmQuote, CustomerEstimate, type CustomerData } from "@/components/portal/estimate";
import { EstimateHeader } from "@/components/portal/EstimateHeader";
import { lookupLocation } from "@/lib/activity48.core";
import { computeEstimate, type RetailSettings } from "@/lib/estimate.core";
import { READY_CHECK_FEE, type ReadyCheckAcceptanceState } from "@/lib/readycheck.core";

// TEST / DUMMY customer journey for manual email QA only. Renders the real customer components
// with a locked fixture. No server calls, no writes, no payments, no Xero, no communications.
const ADDRESS = "30 Dash St, Fraser Rise VIC 3336";
const REFERENCE = "TEST-DUMMY-1001";
const settings: RetailSettings = {
  id: "test-dummy-v2", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15,
  piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};

function buildFixture(): CustomerData | null {
  const location = lookupLocation("3336");
  if (!location) return null;
  const est = computeEstimate({ m2: 150, source: "owner_estimate", basis: "Owner estimate", id: null, label: "Your estimated ceiling size" }, location, "none", settings);
  return {
    visible: true, mode: "likely",
    fees: { piesa: 349, ap: 349, minCopay: 200 },
    calc: { location, insulation: "none", settings },
    estimate: { area: { m2: 150, label: "Your estimated ceiling size" }, scenarios: est.scenarios, access_adjustment: est.access_adjustment },
  };
}

export const Route = createFileRoute("/test-customer-estimate")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "Test customer estimate — Home Insulation Victoria" },
    { name: "description", content: "Test / dummy customer estimate journey for internal email QA. No live job or payment." },
    { property: "og:title", content: "Test customer estimate — Home Insulation Victoria" },
    { property: "og:description", content: "Test / dummy customer estimate journey. No live job or payment." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: TestCustomerEstimate,
});

function TestCustomerEstimate() {
  const [data] = useState(buildFixture);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ReadyCheckAcceptanceState | null>(null);
  useEffect(() => {
    const sync = () => setConfirming(window.location.hash === "#confirm");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!confirming && window.location.hash === "#calculator") {
      const t = setTimeout(() => document.getElementById("calculator")?.scrollIntoView({ block: "start" }), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [confirming]);
  const standard = data?.estimate?.scenarios[0]?.by_access.standard;
  const total = standard?.estimated_customer_total ?? 0;
  const localState = (paymentStatus: "unpaid" | "paid" | "failed"): ReadyCheckAcceptanceState => ({ acceptanceId: "test-dummy", estimateId: "test-dummy", acceptedAt: new Date().toISOString(), paymentId: "test-dummy", paymentStatus, amountIncGst: READY_CHECK_FEE, estimatedRemainingBalanceIncGst: Math.round((total - READY_CHECK_FEE) * 100) / 100, paidAt: paymentStatus === "paid" ? new Date().toISOString() : null, stale: false });
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <p data-testid="test-dummy-banner" className="bg-estimate-blue-soft px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-estimate-navy">TEST / DUMMY CUSTOMER JOURNEY — NO LIVE JOB OR PAYMENT</p>
      <EstimateHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-14 sm:px-8">
        {!data || !standard ? <p className="text-sm">Estimate unavailable.</p> : <>
          <p className="mb-4 px-1 text-xs font-medium text-estimate-navy/70">{ADDRESS} · {REFERENCE}</p>
          {confirming
            ? <ConfirmQuote estimatedPrice={total} assessmentFee={349} testMode state={state} onAccept={() => setState(localState("unpaid"))} onTestPayment={(r) => setState(localState(r === "success" ? "paid" : "failed"))} onBack={() => { window.history.replaceState(null, "", window.location.pathname); setConfirming(false); }} />
            : <div className="estimate-offset overflow-hidden rounded-2xl border border-estimate-blue-soft bg-estimate-white px-5 py-7 sm:px-10 sm:py-11"><CustomerEstimate data={data} publicPage propertyAddress={ADDRESS} /></div>}
        </>}
      </main>
    </div>
  );
}
