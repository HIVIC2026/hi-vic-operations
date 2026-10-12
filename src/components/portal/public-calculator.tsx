// ============= Full file contents =============

import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, Check, ChevronDown, Info, PiggyBank, RotateCcw } from "lucide-react";
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE } from "@/lib/customer-quote-system";
import { CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings } from "@/lib/estimate.core";
import { lookupLocation } from "@/lib/activity48.core";
import { INTEREST_INCLUDED } from "@/lib/interest.core";
import { RegisterInterest } from "./register-interest";
import { extractPostcode, suburbFromLine, type AddressSuggestion } from "@/lib/address.core";
import { AddressCombobox } from "./address-combobox";
import { Button } from "@/components/ui/button";
import { REMOVAL_BUDGET_NOTE, calculatorTotals, installRateLabel, readyCheckFeeLabel, showRemovalBudgetNote } from "@/lib/pricing-cohort.core";

/** The public site lives in Base44 — this page only ever points there. */
const ENQUIRY_URL = "https://homeinsulationvictoria.com.au";

const INSULATION_OPTIONS: { value: InsulationDeclared; label: string }[] = [
  { value: "none", label: "None" },
  { value: "present", label: "Some there" },
  { value: "unknown", label: "Not sure" },
];

/** Plain-language help under each answer box. */
const INSULATION_HELP: Record<string, string> = {
  none: "Bare ceiling or just the plaster",
  present: "Some insulation already installed",
  unknown: "We'll confirm it at the free Ready Check",
};

/** Split out of the canonical "what could change" wording — same facts, easier to scan. */
const CHANGE_FACTORS = [
  "The measured ceiling size",
  "Existing insulation, and whether any has to be removed",
  "Ceiling access conditions",
  "Any electrical rectification found during the mandatory PIESA",
];

function Question({ id, n, label, children }: { id: string; n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="flex items-center gap-2.5 text-[0.7rem] font-extrabold uppercase tracking-[0.14em] text-estimate-navy/70">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-estimate-blue text-[0.7rem] font-extrabold text-estimate-white">
          {n}
        </span>
        {label}
      </label>
      {children}
    </div>
  );
}

const quietInput =
  "w-full rounded-xl bg-estimate-canvas px-4 py-3 text-[0.95rem] text-estimate-navy placeholder:text-estimate-navy/70 focus-visible:bg-estimate-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Supporting detail lives after the price, never between an answer and its result. */
function WhatCouldChange() {
  return (
    <details className="group overflow-hidden rounded-2xl bg-estimate-white shadow-[0_10px_30px_-20px_rgba(34,55,107,0.35)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm font-extrabold text-estimate-navy">
        What could change this price?
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-estimate-navy/70 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-x-5 gap-y-2 border-t border-estimate-line px-5 py-3.5 text-xs leading-relaxed sm:grid-cols-2">
        <div>
          <p>Your final price is confirmed once we check:</p>
          <ul className="mt-2 space-y-1.5">
            {CHANGE_FACTORS.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-estimate-green" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="sm:pt-4">
          <p className="font-bold">{CUSTOMER_WHAT_COULD_CHANGE.closing}</p>
          <p className="mt-2 font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
        </div>
      </div>
    </details>
  );
}

/** What the price on screen actually covers — the same lines the owner is later quoted. */
function WhatIsIncluded({ readyCheckFeeIncGst, pricingCohort, ratePerM2 }: { readyCheckFeeIncGst: number; pricingCohort: PricingCohortProp; ratePerM2: number }) {
  const paid = readyCheckFeeIncGst > 0;
  const rows = INTEREST_INCLUDED.map((row, i) => i === 0 && paid
    ? { label: `Home Insulation Ready Check — ${readyCheckFeeLabel({ readyCheckFeeIncGst })}`, detail: `${readyCheckFeeLabel({ readyCheckFeeIncGst })}, included once in the total above. We confirm your ceiling size, access and what is needed before anyone is booked — no surprises, no second visits.` }
    : row.label.startsWith("R5.0") && pricingCohort === "current" ? { label: row.label, detail: `${installRateLabel({ r5InstallIncGstPerM2: ratePerM2, cohort: "current" })}. ${row.detail}` } : row);
  return (
    <details className="group overflow-hidden rounded-2xl bg-estimate-white shadow-[0_10px_30px_-20px_rgba(34,55,107,0.35)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm font-extrabold text-estimate-navy">
        What this includes
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-estimate-navy/70 transition group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 border-t border-estimate-line px-5 py-3.5">
        {rows.map((row) => (
          <li key={row.label} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-estimate-green" strokeWidth={3} />
            <span>
              <span className="block text-[0.8rem] font-bold leading-snug text-estimate-navy">{row.label}</span>
              <span className="block text-[0.75rem] leading-snug text-estimate-navy/85">{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export type PublicCalculatorInitialValues = {
  address?: string | null;
  areaM2?: number | null;
  insulation?: InsulationDeclared;
};

type PricingCohortProp = "pre_cutover" | "legacy_saved_spot" | "current";
type PublicCalculatorProps = {
  settings: RetailSettings;
  /** Versioned price (pricing-cohort.core). 0 = free Ready Check (legacy / protected saved spots). */
  readyCheckFeeIncGst?: number;
  pricingCohort?: PricingCohortProp;
  initialValues?: PublicCalculatorInitialValues;
  heading?: ReactNode;
  resultAction?: (state: { address: string; suburb: string; postcode: string; ceilingM2: number; insulation: InsulationDeclared }) => ReactNode;
  hideRegistration?: boolean;
  compactHeader?: boolean;
  footer?: ReactNode;
};

export function PublicCalculator({ settings, initialValues, heading, resultAction, hideRegistration = false, compactHeader = false, footer, readyCheckFeeIncGst = 0, pricingCohort = "pre_cutover" }: PublicCalculatorProps) {
  const paidCheck = readyCheckFeeIncGst > 0;
  const [addressText, setAddressText] = useState(initialValues?.address ?? "");
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [raw, setRaw] = useState(initialValues?.areaM2 != null ? String(initialValues.areaM2) : "");
  const [insulation, setInsulation] = useState<InsulationDeclared>(initialValues?.insulation ?? null);
  const areaRef = useRef<HTMLInputElement>(null);

  const postcode = (picked?.postcode ?? extractPostcode(addressText)).trim();
  const suburb = picked?.suburb ?? suburbFromLine(addressText);
  const location = postcode.length === 4 ? lookupLocation(postcode) : null;
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, location, insulation, settings);
  const primary = est?.scenarios[0];
  const standard = primary?.by_access.standard;
  const priced = standard != null && primary != null;
  // Install-only scenario + Ready Check fee once; removal is never added for the whole ceiling.
  const totals = standard ? calculatorTotals(standard, readyCheckFeeIncGst) : null;
  const touched = addressText !== "" || raw !== "" || insulation != null;

  const focusAddress = () => {
    const el = document.getElementById("calc-address");
    if (el instanceof HTMLInputElement) el.focus();
  };
  const startAgain = () => {
    setAddressText("");
    setPicked(null);
    setRaw("");
    setInsulation(null);
    focusAddress();
  };
  const changeAddress = () => {
    setAddressText("");
    setPicked(null);
    focusAddress();
  };
  const changeArea = () => {
    setRaw("");
    areaRef.current?.focus();
  };
  const scrollToRegister = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("register-interest")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("ri-name")?.focus({ preventScroll: true }), reduce ? 50 : 600);
  };

  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-8 pt-3 sm:px-6">
        {!compactHeader && <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-4">
          <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-9 w-auto sm:h-10" />
          <p className="rounded-full bg-estimate-blush px-3 py-1.5 text-[0.62rem] font-extrabold uppercase tracking-wide text-estimate-navy sm:text-[0.7rem]">Free estimate · no obligation</p>
        </header>}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-xl">
            <h1 className="text-[1.6rem] font-extrabold leading-tight tracking-tight text-estimate-navy sm:text-[2rem]">{heading ?? "How much could you save on ceiling insulation?"}</h1>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-estimate-navy/85">Three quick answers — your estimate and VEU discount appear instantly.</p>
          </div>
          {touched && (
            <Button type="button" variant="outline" onClick={startAgain} className="min-h-8 gap-1.5 border-transparent bg-estimate-white px-3 text-[0.7rem] font-extrabold text-estimate-navy/85 shadow-none hover:text-estimate-blue">
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Start again
            </Button>
          )}
        </div>

        <div className="mt-5 grid overflow-hidden rounded-3xl bg-estimate-white shadow-[0_30px_70px_-45px_rgba(34,55,107,0.45)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
          <div className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">
            <Question id="calc-address" n={1} label="Where is the property?">
              <div className="space-y-2.5">
                <div className="max-w-[420px]">
                  <AddressCombobox
                    id="calc-address"
                    value={addressText}
                    onChange={(next) => {
                      setAddressText(next);
                      setPicked(null);
                    }}
                    onPick={(suggestion) => {
                      setPicked(suggestion);
                      setAddressText(suggestion.full);
                    }}
                    placeholder="e.g. 34 Watsons Road, Bundoora"
                    ariaLabel="Your street address"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs leading-relaxed">
                  {location && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-estimate-mint px-2.5 py-1 font-extrabold text-estimate-green">
                      <Check aria-hidden="true" className="size-3.5" />
                      {location.metropolitan_or_regional} · {location.climate_region}
                    </span>
                  )}
                  {postcode.length === 4 && !location && <p role="alert" className="font-bold text-estimate-navy">We don&apos;t hold pricing for that Victorian postcode yet — send us your address and we&apos;ll confirm directly.</p>}
                </div>
              </div>
            </Question>

            <Question id="calc-area" n={2} label="How big is your ceiling?">
              <div className="flex flex-wrap gap-2">
                {CALC_QUICK.map((q) => {
                  const on = raw === String(q);
                  return (
                    <Button
                      key={q}
                      type="button"
                      variant="outline"
                      aria-pressed={on}
                      onClick={() => setRaw(String(q))}
                      className={`h-9 min-h-9 rounded-full px-4 text-xs font-extrabold ${on ? "border-transparent bg-estimate-blue text-white hover:bg-estimate-navy" : "border-estimate-line bg-estimate-white text-estimate-navy hover:border-estimate-blue/60"}`}
                    >
                      {q} m²
                    </Button>
                  );
                })}
                <div className="relative w-full sm:w-[185px]">
                  <input
                    ref={areaRef}
                    id="calc-area"
                    inputMode="decimal"
                    type="number"
                    min={CALC_MIN_M2}
                    max={CALC_MAX_M2}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    aria-label="Your own ceiling size in square metres"
                    placeholder="Or type your own size"
                    className="h-9 w-full rounded-full bg-estimate-canvas pl-4 pr-9 text-sm font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-bold text-estimate-navy/85">m²</span>
                </div>
              </div>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-estimate-navy/85">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-estimate-navy/70" />
                <span>Not sure? Try 150 m². A closer estimate of your ceiling size means a more accurate price.</span>
              </p>
              {raw.trim() !== "" && m2 == null && <p role="alert" className="text-xs font-bold text-danger">Please enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
            </Question>

            <Question id="calc-insulation" n={3} label="Any insulation already up there?">
              <div className="grid grid-cols-3 gap-2">
                {INSULATION_OPTIONS.map((o) => {
                  const on = insulation === o.value;
                  return (
                    <Button
                      key={String(o.value)}
                      type="button"
                      variant="outline"
                      aria-pressed={on}
                      onClick={() => setInsulation(o.value)}
                      className={`flex h-auto min-h-14 flex-col items-start justify-center gap-0.5 whitespace-normal rounded-2xl border px-2.5 py-2.5 text-left ${
                        on
                          ? "border-estimate-blue bg-estimate-mist text-estimate-blue"
                          : "border-transparent bg-estimate-canvas text-estimate-navy hover:border-estimate-line"
                      }`}
                    >
                      <span className="flex w-full items-center justify-between gap-1 text-[0.8rem] font-extrabold sm:text-sm">
                        {o.label}
                        {on && <Check aria-hidden="true" className="size-4 shrink-0 text-estimate-blue" strokeWidth={3} />}
                      </span>
                      <span className={`hidden text-[0.7rem] leading-snug sm:block ${on ? "text-estimate-navy/85" : "text-estimate-navy/80"}`}>{paidCheck && o.value === "unknown" ? "We'll confirm it at your Ready Check" : INSULATION_HELP[String(o.value)]}</span>
                    </Button>
                  );
                })}
              </div>
              {showRemovalBudgetNote(insulation) && (
                <p role="note" data-testid="removal-budget-note" className="rounded-xl border-2 border-estimate-blue bg-estimate-blush px-3.5 py-2.5 text-sm font-bold leading-relaxed text-estimate-navy">
                  {REMOVAL_BUDGET_NOTE}
                </p>
              )}
              {insulation === "unknown" && (
                <p className="rounded-xl bg-estimate-blush px-3.5 py-2.5 text-xs leading-relaxed text-estimate-navy/90">
                  <strong className="text-estimate-navy">Your existing insulation may be able to stay.</strong> Your installer will check it at your {paidCheck ? "" : "free "}Ready Check and confirm whether any removal is needed. Removal is not included in this estimate and will be priced only if required.
                </p>
              )}
            </Question>
          </div>

          <div className="bg-estimate-mist px-5 py-6 sm:px-8 sm:py-8 lg:border-l lg:border-estimate-line">
            {!priced ? (
              <div className="flex h-full min-h-16 items-center justify-center text-center lg:min-h-[240px]">
                <div>
                  <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-estimate-white shadow-[0_10px_30px_-20px_rgba(34,55,107,0.35)]">
                    <PiggyBank className="size-6 text-estimate-green" />
                  </span>
                  <p className="mt-3 text-sm leading-relaxed text-estimate-navy/85">
                    <span className="block font-extrabold text-estimate-navy">Your savings will show here.</span>
                    Answer the three questions — it takes seconds.
                  </p>
                </div>
              </div>
            ) : (
              <div data-testid="public-calculator-result">
                {/* Savings hero — the number the page promises. */}
                <div className="rounded-2xl border-2 border-estimate-green bg-estimate-mint px-5 py-4 text-center" data-testid="public-calculator-discount-highlight">
                  <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-estimate-navy/70">Your estimated VEU rebate</p>
                  <p className="mt-1 text-[2rem] font-extrabold leading-none text-estimate-green sm:text-[2.4rem]">You could save {dollars(standard.applied_discount)}</p>
                  <p className="mt-2 text-[0.7rem] leading-relaxed text-estimate-navy/75" data-testid="public-calculator-discount-estimate">Estimated discount: {dollars(standard.applied_discount)} — confirmed after your assessment.</p>
                </div>

                {/* The number they actually pay. */}
                <div className="mt-4 text-center">
                  <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-estimate-navy/70">Your estimated cost after rebate</p>
                  <p className="mt-1 text-[2.6rem] font-extrabold leading-none tracking-tight text-estimate-blue sm:text-[3rem]" data-testid="public-calculator-final">
                    {dollars(totals!.total)}
                  </p>
                  <p className="mt-1 text-xs font-bold text-estimate-navy/70">incl. GST · before rebate {dollars(totals!.gross)}</p>
                  {paidCheck && <p className="mt-1 text-[0.7rem] font-bold text-estimate-navy/80" data-testid="ready-check-fee-line">Includes the Ready Check: {readyCheckFeeLabel({ readyCheckFeeIncGst })}. Removal of existing insulation is not included.</p>}
                  <p className="mx-auto mt-2 max-w-[300px] text-[0.7rem] leading-relaxed text-estimate-navy/75">
                    Estimate only. Eligibility, measurements and final pricing confirmed after assessment.
                  </p>
                  {standard.copayment_capped && <p className="mt-2 text-xs leading-relaxed">Discount reduced so the minimum $200 customer contribution applies.</p>}
                </div>

                {resultAction ? resultAction({ address: picked?.full ?? addressText.trim(), suburb, postcode, ceilingM2: m2 ?? 0, insulation }) : <button
                  type="button"
                  onClick={scrollToRegister}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-estimate-green px-4 text-base font-extrabold text-estimate-white shadow-lg shadow-estimate-green/25 transition hover:bg-estimate-accent active:scale-[0.99]"
                >
                  Register my interest
                  <ArrowDown aria-hidden="true" className="size-4" />
                </button>}

                <dl className="mt-4 space-y-1.5 border-t border-estimate-line pt-3.5 text-xs">
                  {[
                    { label: "Property", value: suburb ? `${suburb} ${postcode}` : postcode, onChange: changeAddress },
                    { label: "Ceiling", value: `${m2} m²`, onChange: changeArea },
                    { label: "Existing insulation", value: INSULATION_OPTIONS.find((o) => o.value === insulation)?.label ?? "—", onChange: () => setInsulation(null) },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <dt className="text-estimate-navy/85">{row.label}</dt>
                      <dd className="flex items-center gap-2 font-extrabold text-estimate-navy">
                        {row.value}
                        <Button type="button" variant="link" onClick={row.onChange} className="h-auto p-0 text-xs font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
                          Change
                        </Button>
                      </dd>
                    </div>
                  ))}
                </dl>

              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <WhatIsIncluded readyCheckFeeIncGst={readyCheckFeeIncGst} pricingCohort={pricingCohort} ratePerM2={Number(settings.r5_install_inc_gst_per_m2)} />
          <WhatCouldChange />
        </div>

        {!hideRegistration && <RegisterInterest
          address={picked?.full ?? addressText.trim()}
          suburb={suburb}
          postcode={postcode}
          ceilingM2={m2 ?? 0}
          insulation={insulation ?? "unknown"}
        />}

        {footer ?? <footer className="mt-6 border-t border-estimate-line pb-6 pt-4 text-center text-xs leading-relaxed text-estimate-navy/85 sm:text-left lg:pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <p className="sm:max-w-[430px]">Estimate only, not a quote. Prices include GST.<br className="hidden sm:block" /> Your details are saved only if you register your interest.</p>
            <p className="flex flex-col items-center gap-1 sm:items-end sm:text-right">
              <span className="font-bold text-estimate-navy">Home Insulation Victoria · Accredited Person for Victorian Energy Upgrades</span>
              <a href={ENQUIRY_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
                homeinsulationvictoria.com.au
              </a>
              <a href="/privacy" className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
                Privacy policy
              </a>
            </p>
          </div>
        </footer>}

      </div>
    </div>
  );
}
