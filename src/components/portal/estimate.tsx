import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { EngagementPanel } from "./engagement";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Check, ChevronDown, ClipboardCheck, Flame, Leaf, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminEstimate, getAdminEstimateLink, getAdminEstimateLinkUrl, getOwnerEstimate } from "@/lib/estimate.functions";
import { LINK_ADMIN_WARNING, LINK_COMMS_OFF } from "@/lib/estimatelink.core";
import { BENCHMARK_LABEL, CALC_ASSUMPTION_LABEL, CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, FEE_DESCRIPTION, FEE_LABEL, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings, type Scenario } from "@/lib/estimate.core";
import type { LocationVariables } from "@/lib/activity48.core";
import { CUSTOMER_BRAND, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "@/lib/customer-quote-system";
import type { AssessmentAcceptanceState } from "@/lib/assessment-payment.core";
import { Pill } from "./badges";

export const HEADLINE = { likely: "Your home has passed our initial eligibility checks.", onsite: "Your home looks likely to qualify." } as const;
const ELIGIBILITY_COPY = {
  likely: { badge: "LIKELY ELIGIBLE", description: "Based on your answers and our initial property checks, your home is on track to qualify for a VEU insulation discount. The onsite assessment confirms the remaining technical requirements and your final price." },
  onsite: { badge: "LIKELY ELIGIBLE — ONSITE CONFIRMATION NEEDED", description: "Based on your answers and our initial checks, your property is a strong candidate for the VEU insulation discount. We just need to confirm the remaining onsite items before the final quote." },
} as const;
function plainOnsiteDriver(driver: string) {
  if (/insulation/i.test(driver)) return "the type and condition of existing insulation";
  if (/roof|access|cavity/i.test(driver)) return "roof space and access";
  return driver;
}

export type CustomerData = {
  visible: boolean; mode?: "likely" | "onsite"; measureRequired?: boolean; onsiteDrivers?: string[]; rolloutHold?: boolean; accessConcern?: boolean;
  fees?: { piesa: number; ap: number; minCopay: number } | null;
  calc?: { location: LocationVariables; insulation: string | null; settings: RetailSettings } | null; postcodeUnlisted?: boolean;
  estimate?: { area: { m2: number; label: string }; scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } } | null;
};

type Est = { scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } };

export function ConfirmQuote({ estimatedPrice, assessmentFee, onBack, preview = false, testMode = preview, state = null, busy = false, error = null, onAccept, onTestPayment }: { estimatedPrice: number; assessmentFee: number; onBack: () => void; preview?: boolean; testMode?: boolean; state?: AssessmentAcceptanceState | null; busy?: boolean; error?: string | null; onAccept?: () => void; onTestPayment?: (outcome: "success" | "failure") => void }) {
  const remaining = Math.max(0, estimatedPrice - assessmentFee);
  const paid = state?.paymentStatus === "paid";
  const [acknowledged, setAcknowledged] = useState(false);
  return <section className="estimate-brand overflow-hidden border-2 border-estimate-blue bg-estimate-white text-estimate-navy shadow-[6px_6px_0_var(--estimate-green)]" aria-labelledby="confirm-quote-title">
    {testMode && <div className="bg-warning-soft px-5 py-3 text-center text-xs font-extrabold uppercase text-warning-foreground">Test mode · no real payment will be taken</div>}
    <div className="bg-estimate-blue px-5 py-7 text-estimate-white sm:px-9 sm:py-9">
      <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green-light">Your next step</p>
      <h1 id="confirm-quote-title" className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">LET’S CONFIRM YOUR QUOTE</h1>
      <p className="mt-3 max-w-xl text-sm font-semibold leading-relaxed">The next step is your Mandatory Pre-Installation Electrical Safety Assessment (PIESA) + onsite ceiling measure-up.</p>
    </div>
    <div className="px-5 py-7 sm:px-9 sm:py-9">
      <dl className="space-y-3 border-b border-estimate-blue-soft pb-6 text-sm">
        <div className="flex items-baseline justify-between gap-4"><dt className="font-bold">{CUSTOMER_QUOTE_LABELS.finalCost}</dt><dd className="text-xl font-extrabold text-estimate-blue">{dollars(estimatedPrice)}</dd></div>
        <div className="flex items-baseline justify-between gap-4"><dt className="font-bold">{CUSTOMER_QUOTE_LABELS.payableNow}</dt><dd className="text-xl font-extrabold text-estimate-blue">{dollars(assessmentFee)}</dd></div>
        <div className="flex items-baseline justify-between gap-4"><dt className="font-bold">{CUSTOMER_QUOTE_LABELS.remainingBalance}</dt><dd className="text-xl font-extrabold text-estimate-blue">{dollars(remaining)}</dd></div>
      </dl>
      <div className="mt-6 border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-4 text-sm leading-relaxed"><p className="font-extrabold">{CUSTOMER_PAYMENT_COPY.included}</p><p className="mt-1">{CUSTOMER_PAYMENT_COPY.notAgain}</p></div>
      <label className="mt-6 flex items-start gap-3 border border-estimate-blue-soft p-4 text-sm leading-relaxed">
        <input type="checkbox" checked={!!state || acknowledged} disabled={!!state || busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-4 accent-estimate-blue" />
        <span>I accept proceeding with the Measure + PIESA assessment. I understand the $349 is included in this estimate, is not paid again if the project proceeds, and final figures may change only for the onsite factors already disclosed.</span>
      </label>
      <div className="mt-7">
        <h2 className="text-lg font-extrabold text-estimate-blue">What this visit confirms</h2>
        <ul className="mt-4 space-y-3 text-sm font-semibold">
          {["Actual eligible ceiling area", "Existing insulation and whether removal is required", "Electrical safety", "The information needed to confirm your final quote"].map((item) => <li key={item} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-estimate-green" /><span>{item}</span></li>)}
        </ul>
      </div>
      <div className="mt-7 border-t border-estimate-blue-soft pt-6">
        <h2 className="text-lg font-extrabold text-estimate-blue">NO SURPRISE ADD-ONS.</h2>
        <p className="mt-2 text-sm font-bold leading-relaxed">{CUSTOMER_PAYMENT_COPY.noSilentAdditions}</p><p className="mt-2 text-sm leading-relaxed">If the onsite assessment identifies insulation removal or electrical rectification that isn’t included in your estimate, we’ll show you exactly what’s required and what it costs before you decide whether to proceed.</p>
      </div>
      <div className="mt-7 space-y-3">
        {!state && testMode && <Button type="button" size="field" className="h-auto min-h-14 w-full rounded-none bg-estimate-blue px-5 py-4 font-extrabold text-estimate-white shadow-[4px_4px_0_var(--estimate-green)]" disabled={!acknowledged || busy || !onAccept} onClick={onAccept}>{busy ? "RECORDING…" : "ACCEPT & OPEN TEST PAYMENT →"}</Button>}
        {state && !paid && testMode && <div className="border-2 border-dashed border-estimate-blue p-4" data-testid="test-payment-controls"><p className="text-xs font-extrabold uppercase text-estimate-blue">Test payment controls</p><p className="mt-2 text-sm">Current state: <strong>{state.paymentStatus === "failed" ? "Payment failed — retry available" : "Unpaid"}</strong></p><div className="mt-4 grid gap-3 sm:grid-cols-2"><Button type="button" variant="outline" size="field" disabled={busy || !onTestPayment} onClick={() => onTestPayment?.("failure")}>SIMULATE FAILURE</Button><Button type="button" size="field" className="bg-estimate-blue text-estimate-white" disabled={busy || !onTestPayment} onClick={() => onTestPayment?.("success")}>SIMULATE SUCCESS</Button></div></div>}
        {!testMode && !paid && <Button type="button" size="field" className="h-auto min-h-14 w-full rounded-none bg-estimate-blue px-5 py-4 font-extrabold text-estimate-white disabled:opacity-100" disabled>PAYMENT CURRENTLY UNAVAILABLE</Button>}
        {paid && <div className="border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-5" role="status"><p className="text-lg font-extrabold text-estimate-blue">$349 Measure + PIESA payment received</p><p className="mt-2 text-sm">{CUSTOMER_QUOTE_LABELS.remainingBalance}: <strong>{dollars(state.estimatedRemainingBalanceIncGst)}</strong></p><p className="mt-2 text-sm">Next: Home Insulation Victoria will arrange electrician assignment or Measure + PIESA scheduling.</p></div>}
        {state?.stale && <p className="border-l-4 border-danger bg-danger-soft px-4 py-3 text-sm font-bold" role="alert">Your estimate changed. Please review and accept the updated estimate before paying.</p>}
        {error && <p className="text-sm font-bold text-danger" role="alert">{error}</p>}
        <Button type="button" variant="ghost" size="field" className="w-full font-bold text-estimate-blue hover:bg-estimate-green-soft hover:text-estimate-blue" onClick={onBack}>← BACK TO MY ESTIMATE</Button>
      </div>
    </div>
  </section>;
}

function PriceResult({ est, area, fees, assumption = false }: { est: Est; area: number; fees: NonNullable<CustomerData["fees"]>; assumption?: boolean }) {
  const primary = est.scenarios.find((s) => s.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  return <section className="rounded-xl bg-estimate-blue-pale px-5 py-7 sm:px-8 sm:py-9" aria-label="Your estimated home upgrade">
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Your estimated home upgrade</p>
    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1"><strong className="text-5xl font-bold leading-none text-estimate-navy sm:text-6xl" data-testid={assumption ? "calculator-total-can_remain" : "total-can_remain"}>{dollars(standard.estimated_customer_total)}</strong><span className="pb-1 text-sm font-medium text-estimate-navy/70">inc GST</span></div>
    <p className="mt-3 text-sm leading-relaxed text-estimate-navy/80">{assumption ? `${CALC_ASSUMPTION_LABEL}: ${area} m². Final area measured onsite.` : `Based on an estimated ${area} m² ceiling area${est.scenarios.some((s) => s.key === "full_removal") ? ", assuming your existing insulation can remain" : ""}.`}</p>
    <div className="mt-7 border-t border-estimate-blue-soft pt-6">
      <h3 className="text-base font-semibold text-estimate-navy">Your itemised estimate</h3>
      <dl className="mt-4 space-y-4 text-sm">
        {customerQuoteRows({ piesa: fees.piesa, installation: standard.installation, apManagement: fees.ap }).map(({ label, amount }) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4"><dt className="min-w-0 leading-relaxed">{label}</dt><dd className="font-bold">{dollars(amount)}</dd></div>)}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-estimate-blue-soft pt-4 font-semibold text-estimate-navy"><dt className="min-w-0">{CUSTOMER_QUOTE_LABELS.projectTotal}</dt><dd>{dollars(standard.pre_discount_total)}</dd></div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-estimate-green-light pb-4 font-semibold text-estimate-navy"><dt className="min-w-0">{CUSTOMER_QUOTE_LABELS.discount}</dt><dd className="text-estimate-green">−{dollars(standard.applied_discount)}</dd></div>
      </dl>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 font-bold text-estimate-navy"><span className="text-sm">{CUSTOMER_QUOTE_LABELS.finalCost}</span><span className="text-xl">{dollars(standard.estimated_customer_total)}</span></div>
      <div className="mt-5 bg-estimate-green-soft px-4 py-4 text-sm leading-relaxed text-estimate-navy"><p><strong>{CUSTOMER_QUOTE_LABELS.payableNow}</strong></p><p className="mt-1">{CUSTOMER_PAYMENT_COPY.included}</p><p className="mt-1">{CUSTOMER_PAYMENT_COPY.notAgain}</p><p className="mt-2">{CUSTOMER_QUOTE_LABELS.remainingBalance}: <strong>{dollars(Math.max(0, standard.estimated_customer_total - fees.piesa))}</strong></p></div>
    </div>
    {standard.copayment_capped && <p className="mt-3 text-sm">The discount is limited so your contribution meets the program minimum.</p>}
  </section>;
}

function CalculatorQuoteResult({ est, area, fees, existingInsulation }: { est: Est; area: number; fees: NonNullable<CustomerData["fees"]>; existingInsulation: boolean }) {
  const primary = est.scenarios.find((scenario) => scenario.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  const remaining = Math.max(0, standard.estimated_customer_total - fees.piesa);
  const rows = customerQuoteRows({ piesa: fees.piesa, installation: standard.installation, apManagement: fees.ap });
  return <div className="space-y-5" data-testid="calculator-result">
    <section className="overflow-hidden border-2 border-estimate-blue bg-estimate-white shadow-[5px_5px_0_var(--estimate-accent)]" aria-label="Revised preliminary estimate">
      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-xs font-extrabold uppercase text-estimate-green">Your revised preliminary quote</p>
        <div className="mt-3 flex items-baseline justify-between gap-4 border-b border-estimate-blue-soft pb-4">
          <span className="text-sm font-bold">Estimated ceiling size</span>
          <strong className="text-xl text-estimate-blue" data-testid="calculator-area">{area} m²</strong>
        </div>
        <dl className="text-sm">
          {rows.map(({ key, label, amount }) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-estimate-blue-soft py-4"><dt className="min-w-0 font-semibold leading-relaxed">{label}</dt><dd className="font-extrabold text-estimate-blue">{dollars(amount)}</dd></div>)}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 pt-5"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.projectTotal}</dt><dd className="font-extrabold text-estimate-blue" data-testid="calculator-gross">{dollars(standard.pre_discount_total)}</dd></div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 text-estimate-green"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.discount}</dt><dd className="font-extrabold" data-testid="calculator-discount">−{dollars(standard.applied_discount)}</dd></div>
        </dl>
        <div className="mt-2 bg-estimate-blue px-4 py-5 text-estimate-white sm:px-5">
          <p className="text-xs font-extrabold uppercase text-estimate-green-light">{CUSTOMER_QUOTE_LABELS.finalCost}</p>
          <p className="mt-2 text-4xl font-extrabold leading-none" data-testid="calculator-total-can_remain">{dollars(standard.estimated_customer_total)}</p>
        </div>
        <div className="mt-5 border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-4 text-sm leading-relaxed">
          <p><strong>{CUSTOMER_QUOTE_LABELS.payableNow}</strong></p>
          <p className="mt-1 font-bold">{CUSTOMER_PAYMENT_COPY.included}</p>
          <p className="mt-1">{CUSTOMER_PAYMENT_COPY.notAgain}</p>
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-estimate-green/25 pt-3"><span>{CUSTOMER_QUOTE_LABELS.remainingBalance}</span><strong data-testid="calculator-remaining">{dollars(remaining)}</strong></p>
        </div>
        <p className="mt-4 text-xs font-bold">All prices incl GST.</p>
        {standard.copayment_capped && <p className="mt-2 text-xs">The discount is limited so your contribution meets the program minimum.</p>}
      </div>
    </section>
    {existingInsulation && <p className="border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-4 text-sm font-semibold leading-relaxed">{CUSTOMER_EXISTING_INSULATION_NOTE}</p>}
    <section className="border-y border-estimate-blue-soft py-6">
      <h4 className="text-lg font-extrabold text-estimate-blue">{CUSTOMER_WHAT_COULD_CHANGE.heading}</h4>
      <ul className="mt-4 space-y-3 text-sm leading-relaxed">
        {CUSTOMER_WHAT_COULD_CHANGE.items.map((item) => <li key={item} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" /><span>{item}</span></li>)}
      </ul>
      <p className="mt-5 text-sm font-extrabold leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.closing}</p>
    </section>
    <section className="border border-estimate-green/25 bg-estimate-green-soft p-4 sm:p-5">
      <Button type="button" size="field" className="h-auto min-h-12 w-full rounded-none bg-estimate-blue px-4 py-3 font-extrabold text-estimate-white shadow-[4px_4px_0_var(--estimate-green)] disabled:opacity-100" disabled>PAY {dollars(fees.piesa)} &amp; CONTINUE →</Button>
      <p className="mt-3 text-center text-sm font-extrabold">{CUSTOMER_PAYMENT_COPY.included}</p><p className="mt-1 text-center text-xs">{CUSTOMER_PAYMENT_COPY.notAgain}</p>
      <p className="mt-1 text-center text-xs leading-relaxed">Home Insulation Victoria manages the VEU pathway from assessment through compliance and VEEC processing.</p>
      <p className="mt-2 text-center text-xs font-bold text-estimate-blue">Secure payment is not yet available.</p>
    </section>
  </div>;
}

const insulationSource = "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts";
const energyTipsSource = "https://www.energy.vic.gov.au/households/save-energy-and-money/top-10-energy-saving-tips";
function HouseholdBenefits() {
  const id = useId();
  return <section aria-labelledby={id}>
    <h3 id={id} className="text-xl font-bold text-estimate-navy sm:text-2xl">What this upgrade could mean for your home</h3>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {[
        { icon: Leaf, value: "$400+ / year*", label: "average potential energy-bill savings from upgrading ceiling insulation" },
        { icon: Flame, value: "Up to 20%*", label: "potential savings on heating and cooling costs" },
        { icon: Sun, value: "Warmer in winter. Cooler in summer.", label: "Better year-round comfort with less energy wasted through the ceiling." },
      ].map(({ icon: Icon, value, label }) => <div key={value} className="border-t-2 border-estimate-green px-1 py-5"><Icon aria-hidden="true" className="mb-4 size-6 text-estimate-green" /><p className="text-lg font-bold leading-snug text-estimate-navy">{value}</p><p className="mt-2 text-sm leading-relaxed">{label}</p></div>)}
    </div>
    <p className="mt-4 text-sm leading-relaxed">That means insulation isn&apos;t just an upfront upgrade — it can keep reducing energy use and household running costs year after year.</p>
    <p className="mt-3 text-xs leading-relaxed">*Victorian Government estimates/averages. Actual savings vary with your home, climate, energy use, energy prices and heating/cooling habits. <a href={insulationSource} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">Insulation discounts</a> · <a href={energyTipsSource} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">Energy-saving tips</a></p>
  </section>;
}

function PriceProtection({ settings, fees }: { settings: RetailSettings | undefined; fees: NonNullable<CustomerData["fees"]> }) {
  const id = useId();
  const pct = (m: number) => `${Math.round((m - 1) * 100)}%`;
  const rows = [
    ...(settings ? [`R5.0 insulation: ${dollars(settings.r5_install_inc_gst_per_m2)}/m² inc GST`, `Removal, if required: ${dollars(settings.removal_inc_gst_per_m2)}/m² inc GST`] : []),
    `${CUSTOMER_QUOTE_LABELS.piesa}: ${dollars(fees.piesa)} inc GST`,
    `${CUSTOMER_QUOTE_LABELS.apManagement}: ${dollars(fees.ap)} inc GST`,
    ...(settings ? [`Access adjustments: fixed +${pct(settings.access_moderate_multiplier)} moderate / +${pct(settings.access_difficult_multiplier)} difficult on the installation component`] : []),
    "Electrical rectification: separately itemised and approved before work",
  ];
  return <section aria-labelledby={id} className="border-y border-estimate-blue-soft py-7">
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Price protection</p>
    <h3 id={id} className="mt-2 text-xl font-bold leading-snug text-estimate-navy sm:text-2xl">Transparent Home Insulation Victoria pricing — no installer mark-up surprises.</h3>
    <p className="mt-3 text-sm leading-relaxed">Home Insulation Victoria sets the customer pricing. Once the onsite facts are confirmed, your final quote is calculated from our set customer rate card. Our partner electricians and insulation installers do not decide what you pay.</p>
    <ul className="mt-5 grid gap-x-7 gap-y-3 text-sm sm:grid-cols-2">{rows.map((r) => <li key={r} className="flex items-start gap-2 leading-snug"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" />{r}</li>)}</ul>
    <p className="mt-4 text-xs leading-relaxed">Your final total still depends on the measured area, whether removal is needed, access and any electrical rectification.</p>
  </section>;
}

function NextStep({ fee, hasPrice }: { fee: number; hasPrice: boolean }) {
  const id = useId();
  return <section className="rounded-xl bg-estimate-blue px-5 py-8 text-estimate-white sm:px-8 sm:py-10" aria-labelledby={`${id}-next-step`}>
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-accent">Your next step</p>
    <h3 id={`${id}-next-step`} className="mt-2 text-2xl font-bold leading-tight">{CUSTOMER_QUOTE_LABELS.piesa}</h3>
    <p className="mt-4 text-4xl font-bold">{dollars(fee)} <span className="text-base font-medium">inc GST</span></p>
    <p className="mt-4 border-l-2 border-estimate-accent bg-estimate-white/10 px-4 py-3 text-sm font-semibold leading-relaxed">{hasPrice ? CUSTOMER_PAYMENT_COPY.included : "Included in your estimated total — not an extra fee."}</p>
    <p className="mt-5 text-sm leading-relaxed">One visit gives us the verified information needed to finalise your job. Your assessment is completed by a licensed electrician employed by a Registered Electrical Contractor (REC).</p>
    <p className="mt-6 font-bold">What it covers</p>
    <ul className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">{["Exact ceiling-area measurement", "Existing insulation/R-value check", "Whether removal is required", "Roof/ceiling access assessment", "PIESA by a licensed electrician employed by a REC", "Wiring, downlights, exhaust fans and electrical-clearance checks", "Identification of any rectification required before install", "Information required to prepare the final insulation quote"].map((item) => <li key={item} className="flex items-start gap-2 leading-relaxed"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green-light" />{item}</li>)}</ul>
    <div className="mt-7 border-t border-estimate-white/30 pt-5"><p className="font-bold">What happens next?</p><ol className="mt-4 grid gap-4 text-sm sm:grid-cols-3">{["We complete the onsite measure and PIESA", "You receive your final Home Insulation Victoria quote", "Once you approve it, we coordinate the qualified installer and manage the job through installation, evidence and VEEC processing"].map((item, index) => <li key={item} className="flex items-start gap-2 leading-relaxed"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-estimate-green-soft font-bold text-estimate-blue">{index + 1}</span>{item}</li>)}</ol></div>
    <div className="mt-8 border-t border-estimate-white/25 pt-5 text-sm font-semibold text-estimate-green-light">Online booking &amp; payment — coming in the next step</div>
  </section>;
}

function ManagedProcess() {
  const id = useId();
  const cards = [
    { icon: ShieldCheck, title: "Licensed electrical safety assessment", copy: "Your PIESA is completed by a licensed electrician employed by a Registered Electrical Contractor (REC). They check the ceiling space for unsafe wiring, prohibited lighting such as halogen downlights, solar/battery cabling and other electrical hazards before insulation work proceeds.", note: "" },
    { icon: BadgeCheck, title: "EEC Certified Insulation Installer", copy: "Your insulation upgrade is carried out by an EEC Certified Insulation Installer (CII) — the certification required for installers working under the VEU ceiling-insulation activity.", note: "CII certification covers the competency pathway for safe retrofit insulation work, including WHS, measurements and calculations, working safely at heights and bulk insulation installation." },
    { icon: ClipboardCheck, title: "We manage it end-to-end", copy: "Eligibility, onsite assessment, vetted trades, quoting, compliance, evidence, installation coordination and VEEC processing — managed through one Home Insulation Victoria process.", note: "" },
  ];
  return <section aria-labelledby={id}>
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Why Home Insulation Victoria</p>
    <h3 id={id} className="mt-2 text-xl font-bold leading-snug text-estimate-navy sm:text-2xl">One managed pathway. The right qualified people. No chasing trades.</h3>
    <p className="mt-3 text-sm leading-relaxed sm:text-base">From eligibility through to installation and VEEC processing, Home Insulation Victoria coordinates the people, paperwork and compliance for you.</p>
    <div className="mt-5 grid gap-3">
      {cards.map(({ icon: Icon, title, copy, note }) => <div key={title} className="flex items-start gap-4 border-b border-estimate-blue-soft px-1 py-5 last:border-b-0">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-estimate-green-soft"><Icon aria-hidden="true" className="size-5 text-estimate-green" /></span>
        <div><p className="font-bold leading-snug text-estimate-navy">{title}</p><p className="mt-1.5 text-sm leading-relaxed">{copy}</p>{note && <p className="mt-2 text-xs leading-relaxed">{note}</p>}</div>
      </div>)}
    </div>
    <p className="mt-4 text-sm font-semibold leading-relaxed">You don&apos;t need to work out which trades meet the program requirements — we coordinate appropriately qualified participants for the job.</p>
  </section>;
}

function RemovalNote({ est, assumption = false }: { est: Est; assumption?: boolean }) {
  const removal = est.scenarios.find((s) => s.key === "full_removal");
  if (!removal) return null;
  return <p className="border-l-2 border-estimate-accent bg-estimate-accent-soft px-4 py-4 text-sm leading-relaxed">If full removal is required, your estimated total would be around <strong data-testid={assumption ? "calculator-total-full_removal" : "total-full_removal"}>{dollars(removal.by_access.standard.estimated_customer_total)}</strong>. Your onsite assessment confirms whether removal is actually needed.</p>;
}

function EstimateDetails({ data }: { data: CustomerData }) {
  return <div className="border-y border-estimate-blue/20 py-5 text-sm"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What could change the final price? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><ul className="space-y-3 pt-5 leading-relaxed"><li>Final measured ceiling area may differ from this estimate.</li><li>Access is confirmed onsite. Standard access is assumed.{data.estimate ? ` Moderate access may add ${dollars(data.estimate.access_adjustment.moderate)}; difficult access may add ${dollars(data.estimate.access_adjustment.difficult)}.` : ""}{data.accessConcern ? " Access needs checking onsite." : ""}</li><li>Existing insulation may need removal after onsite inspection.</li><li>Electrical rectification, if required, is quoted separately before approval.</li></ul></details></div>;
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, publicPage = false, propertyAddress, onCalculatorUse }: { data: CustomerData; publicPage?: boolean; propertyAddress?: string | null; onCalculatorUse?: (m2: number) => void }) {
  if (!data.visible || !data.mode) return null;
  const fees = data.fees;
  const Heading = publicPage ? "h1" : "h2";
  return (
    <div className="estimate-brand space-y-8 text-estimate-navy sm:space-y-11" aria-label="Indicative estimate">
       <div className="border-b border-estimate-blue-soft pb-7 sm:pb-9">
         <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-estimate-green">GOOD NEWS</p>
         <Heading className="max-w-[620px] text-3xl font-bold leading-tight text-estimate-navy sm:text-4xl">{HEADLINE[data.mode]}</Heading>
          <span className="mt-5 inline-flex max-w-full rounded-md bg-estimate-green-soft px-3 py-2 text-xs font-bold uppercase leading-snug text-estimate-green">{ELIGIBILITY_COPY[data.mode].badge}</span>
          <p className="mt-4 max-w-[620px] text-sm leading-relaxed text-estimate-navy/85 sm:text-base">{ELIGIBILITY_COPY[data.mode].description}</p>
         {data.mode === "onsite" && !!data.onsiteDrivers?.length && <p className="mt-3 text-sm leading-relaxed text-estimate-navy"><span className="font-bold">We just need to confirm:</span> {[...new Set(data.onsiteDrivers.map(plainOnsiteDriver))].join(" · ")}</p>}
       </div>
      {data.rolloutHold && <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Assessments for private homes open from 1 October 2026. This is a scheduling hold only, not an eligibility result.</p>}
      {!fees ? <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Your estimate is being prepared.</p> : <>
        {data.estimate ? <PriceResult est={data.estimate} area={data.estimate.area.m2} fees={fees} /> : data.calc ? <AreaCalculator calc={data.calc} initial={null} fees={fees} {...(propertyAddress !== undefined ? { propertyAddress } : {})} {...(onCalculatorUse ? { onUse: onCalculatorUse } : {})} /> : <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>}
         {data.estimate && <><RemovalNote est={data.estimate} /><NextStep fee={fees.piesa} hasPrice /><HouseholdBenefits /><PriceProtection settings={data.calc?.settings} fees={fees} /><ManagedProcess /></>}
        {data.estimate && data.calc && <AreaCalculator calc={data.calc} initial={data.estimate.area.m2} fees={fees} {...(propertyAddress !== undefined ? { propertyAddress } : {})} secondary {...(onCalculatorUse ? { onUse: onCalculatorUse } : {})} />}
        <EstimateDetails data={data} />
        {data.calc && <details className="group border-b border-estimate-blue/20 pb-5 text-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">How is the VEU discount estimated? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><p className="mt-4 leading-relaxed">We use the official Activity 48 postcode/climate calculation and a {dollars(data.calc.settings.indicative_veec_value)} consumer benchmark calibrated to the Victorian Government&apos;s published example. Final certificate values can change. This is not the live VEEC market price.</p>{data.calc.settings.veec_value_source_url?.startsWith("https://") && <a className="mt-2 inline-block font-bold text-estimate-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={data.calc.settings.veec_value_source_url} target="_blank" rel="noopener noreferrer">View the published example <span aria-hidden="true">↗</span></a>}</details>}
        <p className="pb-6 text-xs leading-relaxed text-estimate-navy">Indicative estimate only. Final price depends on onsite measurement, existing insulation, access, electrical safety, eligibility and certificate values.</p>
      </>}
    </div>
  );
}

/** Pure client-side what-if. Local state only: no server call, never saved to the job, measurements or estimates. */
export function AreaCalculator({ calc, initial, fees, propertyAddress, secondary = false, preview = false, onUse }: { calc: NonNullable<CustomerData["calc"]>; initial: number | null; fees: NonNullable<CustomerData["fees"]>; propertyAddress?: string | null; secondary?: boolean; preview?: boolean; onUse?: (m2: number) => void }) {
  const id = useId();
  const [open, setOpen] = useState(!secondary);
  const [raw, setRawState] = useState(initial == null ? "" : String(initial));
  const [touched, setTouched] = useState(false);
  const setRaw = (v: string) => { setTouched(true); setRawState(v); };
  const m2 = parseAssumption(raw);
  const reported = useRef(false);
  // Engagement signal only (never the area itself to the job): debounced, at most once per page session.
  useEffect(() => {
    if (!onUse || !touched || m2 == null || reported.current) return;
    const t = setTimeout(() => { reported.current = true; onUse(m2); }, 1500);
    return () => clearTimeout(t);
  }, [m2, touched, onUse]);
  const est = whatIfEstimate(m2, calc.location, calc.insulation as InsulationDeclared, calc.settings);
  useEffect(() => {
    if (secondary && window.location.hash === "#calculator") setOpen(true);
  }, [secondary]);
  return (
    <section id={secondary ? "calculator" : undefined} className="scroll-mt-6" data-testid="area-calculator" aria-label="Ceiling area calculator">
      {secondary && !open ? <Button variant="ghost" size="field" className="h-auto min-h-12 max-w-full justify-start whitespace-normal px-0 text-left font-bold text-estimate-blue underline underline-offset-4 hover:bg-transparent hover:text-estimate-blue" onClick={() => setOpen(true)}>Want to test a different ceiling area? <ChevronDown aria-hidden="true" /></Button> : <>
        <div className="overflow-hidden border-2 border-estimate-blue bg-estimate-white shadow-[5px_5px_0_var(--estimate-green)]">
        <div className="bg-estimate-blue px-5 py-6 text-estimate-white sm:px-8 sm:py-8">
          <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-auto w-40 max-w-full rounded-sm bg-estimate-white p-2" />
          <p className="mt-6 text-xs font-extrabold uppercase text-estimate-green-light">Interactive preliminary estimate</p>
          <h3 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">CHECK ANOTHER CEILING SIZE</h3>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-relaxed">Change the estimated m² and see how your preliminary project total, VEU discount and estimated balance could change.</p>
          {propertyAddress && <div className="mt-5 border-l-4 border-estimate-green bg-estimate-white/10 px-4 py-3"><p className="text-xs font-extrabold uppercase text-estimate-green-light">Property</p><p className="mt-1 text-sm font-extrabold">{propertyAddress}</p></div>}
        </div>
        <div className="px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-sm font-extrabold text-estimate-blue">Choose an estimated ceiling size</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={id}>Approximate ceiling area (m²)</label>
          <input id={id} aria-label="Approximate ceiling area (m²)" inputMode="decimal" type="number" min={CALC_MIN_M2} max={CALC_MAX_M2} className="h-14 w-28 rounded-xl border border-estimate-blue bg-estimate-white px-3 text-lg text-estimate-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Area" />
          <span className="mr-2 text-sm text-estimate-navy">m²</span>
          {CALC_QUICK.map((q) => <Button key={q} type="button" size="field" variant="outline" className={`rounded-lg border border-estimate-blue-soft px-3 font-semibold text-estimate-navy hover:bg-estimate-green-soft hover:text-estimate-navy ${m2 === q ? "bg-estimate-green-soft" : "bg-estimate-white"}`} aria-pressed={m2 === q} onClick={() => setRaw(String(q))}>{q} m²</Button>)}
          <Button type="button" size="field" variant="outline" className={`rounded-lg border border-estimate-blue-soft px-3 font-semibold text-estimate-navy hover:bg-estimate-green-soft hover:text-estimate-navy ${m2 != null && !CALC_QUICK.includes(m2 as never) ? "bg-estimate-green-soft" : "bg-estimate-white"}`} aria-pressed={m2 != null && !CALC_QUICK.includes(m2 as never)} onClick={() => setRaw("")}>Other / custom</Button>
        </div>
        {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-3 text-sm font-bold text-danger">Enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
        <p className="mt-5 border-l-4 border-estimate-green bg-estimate-green-soft px-4 py-3 text-sm font-semibold leading-relaxed">This is a what-if calculator only. It does not change the property details you submitted. Your onsite measure confirms the final eligible area.</p>
        </div>
        </div>
         {est && <div className="mt-6"><CalculatorQuoteResult est={est} area={m2 ?? 0} fees={fees} existingInsulation={calc.insulation === "present"} /></div>}
         {preview && <p className="mt-4 text-center text-xs font-bold text-estimate-blue">Preview only — nothing is saved, sent or paid.</p>}
      </>}
    </section>
  );
}

export function OwnerEstimateCard({ jobId }: { jobId: string }) {
  const fn = useServerFn(getOwnerEstimate);
  const { data } = useQuery({ queryKey: ["owner_estimate", jobId], queryFn: () => fn({ data: { jobId } }) as Promise<CustomerData> });
  return data ? <CustomerEstimate data={data} /> : null;
}

const r = (n: number, d = 4) => Number(n).toFixed(d);
export function AdminEstimateCard({ jobId }: { jobId: string }) {
  const fn = useServerFn(getAdminEstimate);
  const { data: v, isLoading } = useQuery({ queryKey: ["admin_estimate", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (isLoading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Loading estimate…</div>;
  if (!v) return null;
  const e = v.estimate, s = v.settings;
  const cust: CustomerData = { visible: v.mode === "likely" || v.mode === "onsite", mode: v.mode, measureRequired: v.measureRequired, onsiteDrivers: v.onsiteDrivers, rolloutHold: v.rolloutHold, accessConcern: v.accessConcern,
    fees: s ? { piesa: Number(s.piesa_assessment_inc_gst), ap: Number(s.ap_management_inc_gst), minCopay: Number(s.minimum_customer_copayment_inc_gst) } : null,
    calc: s && v.location ? { location: v.location, insulation: v.insulationDeclared, settings: s } : null, postcodeUnlisted: v.postcodeUnlisted,
    estimate: e ? { area: { m2: e.area.m2, label: e.area.label }, scenarios: e.scenarios, access_adjustment: e.access_adjustment } : null };
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Step 3 · Indicative estimate</h3>
        {e ? <Pill t="good">Current v{e.settings_version} · {new Date(e.created_at).toLocaleString("en-AU")}</Pill> : <Pill t="warn">Not shown to customer</Pill>}
      </div>
      {v.reason && <p className="mb-3 rounded bg-warning-soft px-3 py-2 text-sm font-medium">{v.reason}</p>}
      {e && (
        <div className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
          <div>Area: <b>{e.area.m2} m²</b> — {e.area.label} ({e.area.basis})</div>
          <div>Postcode {e.location.postcode}: <b>{e.location.metropolitan_or_regional} / {e.location.climate_region}</b> (zone {e.location.climate_zone}, Spec v{e.location.source_version})</div>
          <div>GHG reduction: {e.ghg.formula} = <b>{r(e.ghg.ghgReduction)} t CO2-e</b> (≈ VEEC equivalent)</div>
          <div>× ${Number(s?.indicative_veec_value).toFixed(2)} {BENCHMARK_LABEL.toLowerCase()} (settings v{s?.version}, not market price) = raw {dollars(e.raw_estimated_discount)} · applied {dollars(e.applied_discount)} (<a className="underline" href={s?.veec_value_source_url} target="_blank" rel="noreferrer">source</a>, checked {s?.veec_value_checked_at})</div>
          <div>{FEE_LABEL}: {dollars(Number(s?.ap_management_inc_gst))}</div>
          <div>Insulation declared: {v.insulationDeclared ?? "not answered"} · scenarios: {e.scenarios.length}</div>
          <div>Access totals (primary): {(["standard", "moderate", "difficult"] as const).map((a) => `${a} ${dollars(e.primary.by_access[a].estimated_customer_total)}`).join(" · ")}</div>
        </div>
      )}
      <EstimateLinkPanel jobId={jobId} />
      <EngagementPanel jobId={jobId} />
       <div className="rounded-lg border border-dashed p-3 sm:p-5"><div className="mb-4 text-xs font-bold uppercase text-muted-foreground">Customer-facing preview</div>{cust.visible ? <CustomerEstimate data={cust} /> : <p className="text-sm text-muted-foreground">Nothing is shown to the customer.</p>}</div>
      {e && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Exact calculation audit</summary><pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2">{JSON.stringify({ area: e.area, location: e.location, ghg: e.ghg, raw_estimated_discount: e.raw_estimated_discount, scenarios: e.scenarios, settings: s, history: v.history }, null, 2)}</pre></details>}
    </section>
  );
}

type LinkStatus = { link: { status: string; created_at: string; expires_at: string; revocation_reason: string | null; last_viewed_at: string | null; view_count: number } | null; delivery: { ready: boolean; state: string; consent: boolean; commsEnabled: boolean } };
/** Admin-only link management. The token is fetched only on an explicit click; never auto-copied or sent. */
function EstimateLinkPanel({ jobId }: { jobId: string }) {
  const statusFn = useServerFn(getAdminEstimateLink);
  const urlFn = useServerFn(getAdminEstimateLinkUrl);
  const { data } = useQuery({ queryKey: ["admin_estimate_link", jobId], queryFn: () => statusFn({ data: { jobId } }) as Promise<LinkStatus> });
  const [url, setUrl] = useState<string | null>(null);
  if (!data) return null;
  const l = data.link;
  const active = l?.status === "active" && Date.parse(l.expires_at) > Date.now();
  const reveal = async () => { const r = await urlFn({ data: { jobId } }); setUrl(r.path ? `${window.location.origin}${r.path}` : null); };
  return (
    <div className="mb-3 rounded-lg border p-3 text-sm" data-testid="estimate-link-panel">
      <div className="mb-1 flex flex-wrap items-center gap-2"><b>Secure customer estimate link</b>{active ? <Pill t="good">Active</Pill> : <Pill t="warn">{l ? l.status : "Not prepared"}</Pill>}</div>
      {l && <div className="text-muted-foreground">Created {new Date(l.created_at).toLocaleString("en-AU")} · expires {new Date(l.expires_at).toLocaleDateString("en-AU")} · views {l.view_count}{l.last_viewed_at ? ` (last ${new Date(l.last_viewed_at).toLocaleString("en-AU")})` : ""}{l.revocation_reason ? ` · ${l.revocation_reason}` : ""}</div>}
      <div className="mt-1 font-medium">{data.delivery.commsEnabled ? (data.delivery.ready ? "Delivery allowed (not sent automatically)" : "Owner contact consent missing — delivery not allowed") : LINK_COMMS_OFF}</div>
      {active && <p className="mt-1 text-xs text-warning-foreground">{LINK_ADMIN_WARNING}</p>}
      {active && (url
        ? <div className="mt-2 flex flex-wrap gap-2"><input readOnly className="h-10 flex-1 rounded border bg-background px-2 text-xs" value={url} /><button type="button" className="h-10 rounded border px-3" onClick={() => navigator.clipboard.writeText(url)}>Copy</button><a className="h-10 rounded border px-3 leading-10" href={url} target="_blank" rel="noreferrer noopener">Open</a></div>
        : <button type="button" className="mt-2 h-10 rounded border px-3" onClick={reveal}>Show link (admin only)</button>)}
    </div>
  );
}
