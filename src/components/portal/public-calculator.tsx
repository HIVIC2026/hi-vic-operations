import { useRef, useState } from "react";
import { Check, ChevronDown, Layers, MapPin, RotateCcw, Ruler } from "lucide-react";
import { QuoteBreakdown } from "./estimate";
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "@/lib/customer-quote-system";
import { CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings } from "@/lib/estimate.core";
import { lookupLocation } from "@/lib/activity48.core";

/** The public site lives in Base44 — this page only ever points there. */
const ENQUIRY_URL = "https://homeinsulationvictoria.com.au";

const INSULATION_OPTIONS: { value: InsulationDeclared; label: string }[] = [
  { value: "none", label: "None" },
  { value: "present", label: "Some there" },
  { value: "unknown", label: "Not sure" },
];

/** Split out of the canonical "what could change" wording — same facts, easier to scan. */
const CHANGE_FACTORS = [
  "The measured ceiling size",
  "Existing insulation, and whether any has to be removed",
  "Ceiling access conditions",
  "Any electrical rectification found during the mandatory PIESA",
];

function Field({ id, icon: Icon, label, hint, children }: { id: string; icon: typeof MapPin; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-estimate-line px-5 py-3 first:border-t-0">
      <label htmlFor={id} className="flex items-center gap-2 text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy/60">
        <Icon aria-hidden="true" className="size-3.5 text-estimate-green" />
        {label}
      </label>
      {hint && <p className="mt-1 text-xs leading-relaxed text-estimate-navy/65">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Kept in the question column so opening it never pushes the price out of view. */
function WhatCouldChange() {
  return (
    <details className="group mt-3 overflow-hidden rounded-lg border border-estimate-line bg-estimate-white">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-extrabold text-estimate-blue">
        What could change this price?
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-estimate-line px-3 py-3 text-xs leading-relaxed">
        <p>Based on what you&apos;ve told us. Your final scope and price are confirmed after we check:</p>
        <ul className="mt-2 space-y-1.5">
          {CHANGE_FACTORS.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-estimate-green" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-bold">{CUSTOMER_WHAT_COULD_CHANGE.closing}</p>
        <p className="mt-2 font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
      </div>
    </details>
  );
}

export function PublicCalculator({ settings }: { settings: RetailSettings }) {
  const [postcode, setPostcode] = useState("");
  const [raw, setRaw] = useState("");
  const [insulation, setInsulation] = useState<InsulationDeclared>(null);
  const postcodeRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);

  const trimmed = postcode.trim();
  const location = trimmed.length === 4 ? lookupLocation(trimmed) : null;
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, location, insulation, settings);
  const primary = est?.scenarios[0];
  const standard = primary?.by_access.standard;
  const removal = est?.scenarios.find((s) => s.key === "full_removal");
  const priced = standard != null && primary != null;
  const touched = postcode !== "" || raw !== "" || insulation != null;

  const startAgain = () => {
    setPostcode("");
    setRaw("");
    setInsulation(null);
    postcodeRef.current?.focus();
  };
  const changePostcode = () => {
    setPostcode("");
    postcodeRef.current?.focus();
  };
  const changeArea = () => {
    setRaw("");
    areaRef.current?.focus();
  };

  return (
    <div className="estimate-brand min-h-screen bg-gradient-to-b from-estimate-blush via-estimate-canvas to-estimate-canvas">
      <div className="mx-auto flex min-h-screen w-full max-w-[1080px] flex-col px-4 pb-24 sm:px-6 lg:pb-3">
        <header className="flex flex-wrap items-center justify-between gap-3 py-3">
          <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-9 w-auto sm:h-10" />
          <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green">Free instant estimate · no obligation</p>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight text-estimate-navy sm:text-[1.7rem]">What would ceiling insulation cost?</h1>
            <p className="mt-1 max-w-[580px] text-[0.82rem] leading-relaxed text-estimate-navy/75">
              Three quick questions — your estimated price updates as you go, including the discount your home is likely to qualify for.
            </p>
          </div>
          {touched && (
            <button type="button" onClick={startAgain} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-estimate-line bg-estimate-white px-2.5 text-[0.7rem] font-extrabold text-estimate-navy/70 hover:border-estimate-green/50 hover:text-estimate-blue">
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Start again
            </button>
          )}
        </div>

        <div className="estimate-offset mt-3 grid overflow-hidden rounded-2xl border border-estimate-line bg-estimate-white lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div>
            <Field id="calc-postcode" icon={MapPin} label="Where is the property?" hint="Enter your Victorian postcode. You can change it any time — the price updates instantly.">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={postcodeRef}
                  id="calc-postcode"
                  inputMode="numeric"
                  type="text"
                  maxLength={4}
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="e.g. 3000"
                  aria-label="Your Victorian postcode"
                  className="h-10 w-[132px] rounded-lg border-2 border-estimate-line bg-estimate-white px-3 text-base font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                {location && (
                  <span className="inline-flex items-center gap-2 rounded-lg bg-estimate-mint px-2.5 py-1.5 text-[0.7rem] font-extrabold text-estimate-green">
                    <Check aria-hidden="true" className="size-3.5" />
                    {location.metropolitan_or_regional} · {location.climate_region}
                  </span>
                )}
                {trimmed.length === 4 && !location && <p role="alert" className="text-xs leading-relaxed text-estimate-navy/75">We don&apos;t hold pricing for that Victorian postcode yet — send us your address and we&apos;ll confirm directly.</p>}
              </div>
            </Field>

            <Field id="calc-area" icon={Ruler} label="How big is your ceiling?" hint="Not sure? A typical Victorian home is around 150 m². We measure properly on the day.">
              <div className="flex flex-wrap gap-1.5">
                {CALC_QUICK.map((q) => {
                  const on = raw === String(q);
                  return (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRaw(String(q))}
                      className={`min-h-9 rounded-lg border px-3 text-xs font-extrabold transition ${on ? "border-estimate-green bg-estimate-mint text-estimate-navy" : "border-estimate-line bg-estimate-white text-estimate-navy/75 hover:border-estimate-green/50"}`}
                    >
                      {q} m²
                    </button>
                  );
                })}
                <div className="relative w-full sm:w-[104px]">
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
                    className="h-9 w-full rounded-lg border-2 border-estimate-line bg-estimate-white pl-3 pr-8 text-sm font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-bold text-estimate-navy/50">m²</span>
                </div>
              </div>
              {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-2 text-xs font-bold text-danger">Please enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
            </Field>

            <Field id="calc-insulation" icon={Layers} label="Any insulation already up there?" hint="This tells us whether old insulation may need to come out first.">
              <div id="calc-insulation" className="grid grid-cols-3 gap-1.5 rounded-xl border border-estimate-line bg-estimate-mist p-1.5">
                {INSULATION_OPTIONS.map((o) => {
                  const on = insulation === o.value;
                  return (
                    <button
                      key={String(o.value)}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setInsulation(o.value)}
                      className={`min-h-9 rounded-lg px-2 text-xs font-extrabold transition ${on ? "bg-estimate-white text-estimate-blue ring-1 ring-estimate-green/50" : "text-estimate-navy/70 hover:bg-estimate-white/70"}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="px-5 pb-3 lg:pt-0">
              <WhatCouldChange />
              <p className="mt-3 text-[0.7rem] leading-relaxed text-estimate-navy/70">
                Licensed electrician for the safety assessment · EEC certified installer · we manage the paperwork and the rebate claim for you.
              </p>
            </div>
          </div>

          <div className="border-t border-estimate-line bg-estimate-mist px-5 py-4 lg:border-l lg:border-t-0">
            {!priced ? (
              <div className="flex h-full min-h-[200px] flex-col justify-center">
                <p className="text-sm leading-relaxed text-estimate-navy/75">
                  <span className="font-extrabold text-estimate-navy">Your price will show here.</span> Answer the three questions and it appears instantly — change any answer and it updates on the spot.
                </p>
              </div>
            ) : (
              <div data-testid="public-calculator-result">
                <p className="text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-green">Your estimated cost</p>
                <dl className="mt-2.5 space-y-1 rounded-xl border border-estimate-line bg-estimate-white px-3.5 py-2.5 text-xs">
                  {[
                    { label: "Property", value: trimmed, onChange: changePostcode },
                    { label: "Ceiling", value: `${m2} m²`, onChange: changeArea },
                    { label: "Existing insulation", value: INSULATION_OPTIONS.find((o) => o.value === insulation)?.label ?? "—", onChange: () => setInsulation(null) },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <dt className="text-estimate-navy/65">{row.label}</dt>
                      <dd className="flex items-center gap-2 font-extrabold text-estimate-navy">
                        {row.value}
                        <button type="button" onClick={row.onChange} className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
                          Change
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3">
                  <QuoteBreakdown
                    rows={customerQuoteRows({ piesa: settings.piesa_assessment_inc_gst, installation: standard.installation, apManagement: settings.ap_management_inc_gst })}
                    gross={standard.pre_discount_total}
                    discount={standard.applied_discount}
                    final={standard.estimated_customer_total}
                    ids={{ final: "public-calculator-final" }}
                  />
                </div>
                {standard.copayment_capped && <p className="mt-2 text-xs leading-relaxed">The discount is limited so your contribution meets the program minimum.</p>}
                {removal && (
                  <p className="mt-3 rounded-lg border border-estimate-line bg-estimate-white px-3 py-2.5 text-xs leading-relaxed">
                    If your existing insulation has to come out, your total would be around{" "}
                    <strong className="text-estimate-blue">{dollars(removal.by_access.standard.estimated_customer_total)}</strong>. We confirm whether removal is needed before you agree to anything.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 text-[0.7rem] leading-relaxed text-estimate-navy/65">
          Estimates only — not a quote. Prices include GST. Nothing you type is saved, sent or shared.{" "}
          <a href={ENQUIRY_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
            homeinsulationvictoria.com.au
          </a>
          <br className="hidden sm:block" /> Home Insulation Victoria manages your project end-to-end as the Accredited Person under the Victorian Energy Upgrades program.
        </p>

        {priced && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-estimate-line bg-estimate-white/95 px-4 py-3 backdrop-blur lg:hidden">
            <div className="mx-auto flex max-w-[420px] items-baseline justify-between gap-3">
              <span className="text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy/65">Estimated cost after discount</span>
              <span className="text-2xl font-extrabold leading-none text-estimate-blue">{dollars(standard.estimated_customer_total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
