import { useRef, useState } from "react";
import { Check, ChevronDown, Info, Layers, MapPin, RotateCcw, Ruler } from "lucide-react";
import { QuoteBreakdown } from "./estimate";
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "@/lib/customer-quote-system";
import { CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings } from "@/lib/estimate.core";
import { lookupLocation } from "@/lib/activity48.core";
import { INTEREST_INCLUDED } from "@/lib/interest.core";
import { RegisterInterest } from "./register-interest";
import { extractPostcode, suburbFromLine, type AddressSuggestion } from "@/lib/address.core";
import { AddressCombobox } from "./address-combobox";

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

function Field({ id, icon: Icon, label, hint, children }: { id: string; icon: typeof MapPin; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-estimate-line px-5 py-2 first:border-t-0">
      <label htmlFor={id} className="flex items-center gap-2 text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy">
        <Icon aria-hidden="true" className="size-3.5 text-estimate-green" />
        {label}
      </label>
      {hint && <p className="mt-1 text-xs leading-relaxed text-estimate-navy/85">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Kept in the question column so opening it never pushes the price out of view. */
function WhatCouldChange() {
  return (
    <details className="group mt-2 overflow-hidden rounded-lg border border-estimate-line bg-estimate-white">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 bg-workspace-blush/40 px-3 py-2 text-xs font-extrabold text-estimate-blue">
        What could change this price?
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-x-5 gap-y-2 border-t border-estimate-line px-3 py-3 text-xs leading-relaxed sm:grid-cols-2">
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
function WhatIsIncluded() {
  return (
    <details className="group mt-2 rounded-xl border border-estimate-line bg-estimate-white/80">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-estimate-navy">
        <span className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-estimate-green" strokeWidth={3} />
          What this includes
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-estimate-navy/85 transition group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 px-3 pb-3">
        {INTEREST_INCLUDED.map((row) => (
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

export function PublicCalculator({ settings }: { settings: RetailSettings }) {
  const [addressText, setAddressText] = useState("");
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [raw, setRaw] = useState("");
  const [insulation, setInsulation] = useState<InsulationDeclared>(null);
  const areaRef = useRef<HTMLInputElement>(null);

  const postcode = (picked?.postcode ?? extractPostcode(addressText)).trim();
  const suburb = picked?.suburb ?? suburbFromLine(addressText);
  const location = postcode.length === 4 ? lookupLocation(postcode) : null;
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, location, insulation, settings);
  const primary = est?.scenarios[0];
  const standard = primary?.by_access.standard;
  const priced = standard != null && primary != null;
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

  return (
    <div className="estimate-brand min-h-screen bg-gradient-to-b from-estimate-blush via-estimate-canvas to-estimate-canvas">
      <div className="mx-auto flex min-h-screen w-full max-w-[1080px] flex-col px-4 pb-24 sm:px-6 lg:pb-4">
        <header className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-9 w-auto sm:h-10" />
          <p className="rounded-full bg-workspace-blush px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-task-eligibility-foreground">Free instant estimate · no obligation</p>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight text-estimate-blue sm:text-[1.7rem]">What would ceiling insulation cost?</h1>
            <p className="mt-1 max-w-[780px] text-[0.82rem] leading-relaxed text-estimate-navy/85">
              Three quick questions — your estimated price updates as you go, including the VEU discount your home is likely to qualify for.
            </p>
          </div>
          {touched && (
            <button type="button" onClick={startAgain} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-estimate-line bg-estimate-white px-2.5 text-[0.7rem] font-extrabold text-estimate-navy/85 hover:border-estimate-green/50 hover:text-estimate-blue">
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Start again
            </button>
          )}
        </div>

        <div className="estimate-offset mt-2 grid overflow-hidden rounded-2xl border border-estimate-line bg-estimate-white shadow-[0_18px_45px_-28px_rgba(34,55,107,0.45)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div>
            <Field id="calc-address" icon={MapPin} label="Where is the property?" hint="Start typing your street address and we'll autofill it. The price updates instantly.">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full sm:max-w-[380px]">
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
                {location && (
                  <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-estimate-mint px-3 text-[0.7rem] font-extrabold text-estimate-green">
                    <Check aria-hidden="true" className="size-3.5" />
                    {location.metropolitan_or_regional} · {location.climate_region}
                  </span>
                )}
                {postcode.length === 4 && !location && <p role="alert" className="text-xs leading-relaxed text-estimate-navy/85">We don&apos;t hold pricing for that Victorian postcode yet — send us your address and we&apos;ll confirm directly.</p>}
              </div>
            </Field>

            <Field id="calc-area" icon={Ruler} label="How big is your ceiling?">
              <div className="flex flex-wrap gap-1.5">
                {CALC_QUICK.map((q) => {
                  const on = raw === String(q);
                  return (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRaw(String(q))}
                      className={`min-h-9 rounded-lg border px-3 text-xs font-extrabold transition ${on ? "border-estimate-green bg-estimate-mint text-estimate-navy" : "border-estimate-line bg-estimate-white text-estimate-navy/90 hover:border-estimate-green/50"}`}
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
                    className="h-9 w-full rounded-lg border border-estimate-line bg-estimate-white pl-3 pr-9 text-sm font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-estimate-navy/85">m²</span>
                </div>
              </div>
              <p className="mt-2 flex items-start gap-2 rounded-lg border-l-2 border-workspace-blush-strong bg-workspace-blush/50 px-3 py-2 text-xs leading-relaxed text-estimate-navy/90">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-task-eligibility-foreground" />
                <span>A typical Victorian home is around 150 m². The closer your number is to the real thing, the closer this price is to your final quote.</span>
              </p>
              {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-2 text-xs font-bold text-danger">Please enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
            </Field>

            <Field id="calc-insulation" icon={Layers} label="Any insulation already up there?">
              <div id="calc-insulation" className="grid gap-2 sm:grid-cols-3">
                {INSULATION_OPTIONS.map((o) => {
                  const on = insulation === o.value;
                  return (
                    <button
                      key={String(o.value)}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setInsulation(o.value)}
                      className={`flex min-h-[3.75rem] flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                        on
                          ? "border-estimate-green bg-estimate-mint shadow-[0_12px_24px_-20px_rgba(7,191,97,0.9)]"
                          : "border-estimate-line bg-estimate-white hover:border-estimate-blue/45 hover:bg-estimate-mist"
                      }`}
                    >
                      <span className="flex w-full items-center justify-between gap-2 text-sm font-extrabold text-estimate-navy">
                        {o.label}
                        {on && <Check aria-hidden="true" className="size-4 shrink-0 text-estimate-green" strokeWidth={3} />}
                      </span>
                      <span className="text-[0.7rem] leading-snug text-estimate-navy/90">{INSULATION_HELP[String(o.value)]}</span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="px-5 pb-3">
              <WhatIsIncluded />
              <WhatCouldChange />
            </div>
          </div>

          <div className="border-t border-estimate-line bg-estimate-mist px-5 py-4 lg:border-l lg:border-t-0">
            {!priced ? (
              <div className="flex h-full min-h-[200px] flex-col justify-center">
                <p className="text-sm leading-relaxed text-estimate-navy/85">
                  <span className="font-extrabold text-estimate-navy">Your price will show here.</span> Answer the three questions and it appears instantly — change any answer and it updates on the spot.
                </p>
              </div>
            ) : (
              <div data-testid="public-calculator-result">
                <p className="text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-green">Your estimated cost</p>
                <dl className="mt-2.5 space-y-1 rounded-xl border border-estimate-line bg-estimate-white px-3.5 py-2.5 text-xs">
                  {[
                    { label: "Property", value: suburb ? `${suburb} ${postcode}` : postcode, onChange: changeAddress },
                    { label: "Ceiling", value: `${m2} m²`, onChange: changeArea },
                    { label: "Existing insulation", value: INSULATION_OPTIONS.find((o) => o.value === insulation)?.label ?? "—", onChange: () => setInsulation(null) },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <dt className="text-estimate-navy/85">{row.label}</dt>
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
                {insulation !== "none" && (
                  <p className="mt-3 rounded-lg border border-workspace-blush-strong/40 bg-workspace-blush/50 px-3 py-2.5 text-xs leading-relaxed text-estimate-navy/90">
                    <strong className="text-estimate-navy">Already have insulation?</strong> In many homes it can stay. If part of yours does need removing, budget an extra{" "}
                    <strong className="text-estimate-blue">$10–$15 per m² of the area requiring removal</strong>, depending on the insulation type. Your installer will assess it and advise you at your free Ready Check — before you agree to anything.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <RegisterInterest
          address={picked?.full ?? addressText.trim()}
          suburb={suburb}
          postcode={postcode}
          ceilingM2={m2 ?? 0}
          insulation={insulation ?? "unknown"}
        />

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.7rem] text-estimate-navy/90">
          <p>Estimates only — not a quote. Prices include GST. Nothing you type here is saved unless you register your interest.</p>
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-bold text-estimate-navy/85">Home Insulation Victoria · Accredited Person under the Victorian Energy Upgrades program</span>
            <a href={ENQUIRY_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-estimate-blue underline decoration-estimate-green/60 underline-offset-2 hover:text-estimate-green">
              homeinsulationvictoria.com.au
            </a>
          </p>
        </div>

        {priced && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-estimate-line bg-estimate-white/95 px-5 py-3 backdrop-blur lg:hidden">
            <div className="mx-auto flex max-w-[560px] items-baseline justify-between gap-3">
              <span className="text-[0.7rem] font-extrabold uppercase tracking-wider text-estimate-navy/85">Estimated cost</span>
              <span className="hidden text-[0.65rem] text-estimate-navy/80 sm:inline">Includes GST · not a quote</span>
              <span className="text-2xl font-extrabold leading-none text-estimate-blue">{dollars(standard.estimated_customer_total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
