import { useState } from "react";
import { ArrowRight, BadgeCheck, Check, Info, Layers, MapPin, Ruler, ShieldCheck } from "lucide-react";
import { QuoteBreakdown } from "./estimate";
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "@/lib/customer-quote-system";
import { CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings } from "@/lib/estimate.core";
import { lookupLocation } from "@/lib/activity48.core";

/** The public site lives in Base44 — this page only sends people there. */
const ENQUIRY_URL = "https://homeinsulationvictoria.com.au";

const INSULATION_OPTIONS: { value: InsulationDeclared; label: string; hint: string }[] = [
  { value: "none", label: "No insulation", hint: "Bare ceiling or plaster only" },
  { value: "present", label: "There's some up there", hint: "Batts or loose-fill already in" },
  { value: "unknown", label: "Not sure", hint: "Most people aren't — that's fine" },
];

const PROMISES = [
  { icon: Ruler, label: "Free Ready Check" },
  { icon: ShieldCheck, label: "Licensed electrician" },
  { icon: BadgeCheck, label: "Certified installer" },
];

function Step({ n, icon: Icon, title, hint, children }: { n: number; icon: typeof MapPin; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-estimate-blue-soft px-5 py-6 first:border-t-0 sm:px-8 sm:py-7">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-estimate-blue text-sm font-extrabold text-estimate-white">{n}</span>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-extrabold leading-snug text-estimate-navy sm:text-xl">
            <Icon aria-hidden="true" className="size-5 shrink-0 text-estimate-green" />
            {title}
          </h2>
          {hint && <p className="mt-1 text-sm leading-relaxed text-estimate-navy/75">{hint}</p>}
        </div>
      </div>
      <div className="mt-4 sm:pl-12">{children}</div>
    </div>
  );
}

function Choice({ selected, onClick, label, hint }: { selected: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border-2 px-4 py-3 text-left transition ${selected ? "border-estimate-green bg-estimate-green-soft" : "border-estimate-blue-soft bg-estimate-white hover:border-estimate-green/60"}`}
    >
      <span className="flex items-center gap-2 text-sm font-extrabold text-estimate-navy">
        {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-estimate-green" />}
        {label}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-estimate-navy/70">{hint}</span>
    </button>
  );
}

export function PublicCalculator({ settings }: { settings: RetailSettings }) {
  const [postcode, setPostcode] = useState("");
  const [raw, setRaw] = useState("");
  const [insulation, setInsulation] = useState<InsulationDeclared>(null);

  const trimmed = postcode.trim();
  const shapeOk = trimmed === "" || /^\d{4}$/.test(trimmed);
  const location = lookupLocation(trimmed);
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, location, insulation, settings);

  const primary = est?.scenarios[0];
  const standard = primary?.by_access.standard;
  const removal = est?.scenarios.find((s) => s.key === "full_removal");

  // Only price when the postcode is one we hold rates for — an unlisted postcode is explained above, not an error.
  const readyToAnswer = trimmed.length === 4 && location != null && m2 != null && insulation != null;

  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas">
      <header className="border-b border-estimate-blue-soft bg-estimate-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[820px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-9 w-auto" />
          <p className="hidden text-xs font-extrabold uppercase tracking-wider text-estimate-green sm:block">Instant price estimate</p>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-4 pb-16 sm:px-8">
        <section className="rounded-[24px] bg-estimate-blue px-5 py-8 text-estimate-white sm:px-9 sm:py-11">
          <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green-light">Free · no obligation · nothing saved</p>
          <h1 className="mt-3 max-w-[620px] text-3xl font-extrabold leading-tight sm:text-[2.6rem] sm:leading-[1.1]">
            What could ceiling insulation cost for your home?
          </h1>
          <p className="mt-4 max-w-[560px] text-sm leading-relaxed font-semibold sm:text-base">
            Answer three quick questions and we&apos;ll show you an indicative price — including the VEU discount your home is likely to qualify for.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {PROMISES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 rounded-full bg-estimate-white/10 px-3 py-1.5 text-xs font-bold">
                <Icon aria-hidden="true" className="size-4 text-estimate-green-light" />
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="estimate-quote-card estimate-offset mt-6 overflow-hidden" aria-label="Insulation price calculator">
          <Step n={1} icon={MapPin} title="Where is your place?" hint="Your postcode sets your climate zone, which is part of the official discount calculation.">
            <div className="relative max-w-[220px]">
              <input
                inputMode="numeric"
                type="text"
                maxLength={4}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="e.g. 3000"
                aria-label="Your Victorian postcode"
                className="h-12 w-full rounded-xl border-2 border-estimate-blue bg-estimate-white px-4 text-lg font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            {!shapeOk && <p role="alert" className="mt-2 text-sm font-bold text-danger">Please enter a 4-digit Victorian postcode.</p>}
            {trimmed.length === 4 && shapeOk && !location && (
              <p role="alert" className="mt-2 text-sm leading-relaxed text-estimate-navy">
                We don&apos;t have that Victorian postcode in our pricing list yet. Send us your address and we&apos;ll confirm your pricing directly.
              </p>
            )}
            {location && (
              <p className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-estimate-green-soft px-3 py-2 text-xs font-extrabold text-estimate-green">
                <Check aria-hidden="true" className="size-3.5" />
                {location.postcode} · {location.metropolitan_or_regional} · {location.climate_region}
              </p>
            )}
          </Step>

          <Step n={2} icon={Ruler} title="How big is your ceiling?" hint="Not sure? A typical Victorian home is around 150 m² — your Ready Check measures it properly.">
            <div className="flex flex-wrap gap-2">
              {CALC_QUICK.map((q) => {
                const on = raw === String(q);
                return (
                  <button
                    key={q}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRaw(String(q))}
                    className={`h-12 min-w-[84px] rounded-xl border-2 px-4 text-sm font-extrabold transition ${on ? "border-estimate-green bg-estimate-green-soft text-estimate-navy" : "border-estimate-blue-soft bg-estimate-white text-estimate-navy hover:border-estimate-green/60"}`}
                  >
                    {q} m²
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="relative w-[180px]">
                <label htmlFor="calc-area" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-estimate-navy/70">
                  Or type your own
                </label>
                <div className="relative">
                  <input
                    id="calc-area"
                    inputMode="decimal"
                    type="number"
                    min={CALC_MIN_M2}
                    max={CALC_MAX_M2}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder="175"
                    className="h-12 w-full rounded-xl border-2 border-estimate-blue bg-estimate-white px-4 pr-12 text-lg font-bold text-estimate-navy placeholder:font-normal placeholder:text-estimate-navy/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-estimate-navy/60">m²</span>
                </div>
              </div>
            </div>
            {raw.trim() !== "" && m2 == null && (
              <p role="alert" className="mt-2 text-sm font-bold text-danger">Please enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>
            )}
          </Step>

          <Step n={3} icon={Layers} title="Any insulation already up there?" hint="This tells us whether old insulation may need to come out first.">
            <div className="grid gap-2 sm:grid-cols-3">
              {INSULATION_OPTIONS.map((o) => (
                <Choice key={String(o.value)} selected={insulation === o.value} onClick={() => setInsulation(o.value)} label={o.label} hint={o.hint} />
              ))}
            </div>
          </Step>

          <div className="border-t border-estimate-blue-soft bg-estimate-canvas px-5 py-7 sm:px-8">
            {!readyToAnswer ? (
              <div className="flex items-start gap-3 text-sm leading-relaxed text-estimate-navy/80">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-estimate-blue" />
                <p>Fill in the three questions above and your estimated price will appear here — it updates as you go.</p>
              </div>
            ) : !standard || !primary ? (
              <p className="text-sm font-bold text-danger">We couldn&apos;t calculate an estimate for those answers.</p>
            ) : (
              <div data-testid="public-calculator-result">
                <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green">Your indicative estimate</p>
                <p className="mt-2 text-sm leading-relaxed text-estimate-navy/80">
                  Based on a {m2} m² ceiling at postcode {location?.postcode}
                  {insulation === "present" ? ", assuming your existing insulation can stay" : ""}.
                </p>
                <div className="mt-4">
                  <QuoteBreakdown
                    rows={customerQuoteRows({ piesa: settings.piesa_assessment_inc_gst, installation: standard.installation, apManagement: settings.ap_management_inc_gst })}
                    gross={standard.pre_discount_total}
                    discount={standard.applied_discount}
                    final={standard.estimated_customer_total}
                    ids={{ final: "public-calculator-final" }}
                  />
                </div>
                {standard.copayment_capped && <p className="mt-3 text-xs leading-relaxed">The discount is limited so your contribution meets the program minimum.</p>}
                {removal && (
                  <p className="estimate-secondary-card mt-5 text-sm leading-relaxed">
                    If your existing insulation has to be removed, your estimated total would be around{" "}
                    <strong className="text-estimate-blue">{dollars(removal.by_access.standard.estimated_customer_total)}</strong>. Your Ready Check confirms whether
                    removal is needed before you agree to anything.
                  </p>
                )}
                <details className="mt-5 border-t border-estimate-blue-soft pt-4 text-sm">
                  <summary className="cursor-pointer font-extrabold text-estimate-blue">{CUSTOMER_WHAT_COULD_CHANGE.heading}</summary>
                  <p className="mt-3 leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.intro}</p>
                  <p className="mt-3 font-bold leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.closing}</p>
                  <p className="mt-2 text-xs font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
                </details>
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Why Home Insulation Victoria">
          {[
            { icon: ShieldCheck, title: "Electrical safety first", copy: "A licensed electrician checks your ceiling space for unsafe wiring and hazards before any insulation goes in." },
            { icon: BadgeCheck, title: "Certified installation", copy: "Your upgrade is carried out by an EEC Certified Insulation Installer, as the program requires." },
            { icon: Check, title: "We handle the paperwork", copy: "Eligibility, quoting, compliance, evidence and the rebate claim are all managed for you in one place." },
          ].map(({ icon: Icon, title, copy }) => (
            <div key={title} className="rounded-2xl border border-estimate-blue-soft bg-estimate-white p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-estimate-green-soft">
                <Icon aria-hidden="true" className="size-5 text-estimate-green" />
              </span>
              <p className="mt-3 text-sm font-extrabold leading-snug text-estimate-navy">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-estimate-navy/80">{copy}</p>
            </div>
          ))}
        </section>

        <section className="estimate-action-card mt-6 text-center">
          <h2 className="text-xl font-extrabold leading-tight text-estimate-blue sm:text-2xl">Ready for an exact price?</h2>
          <p className="mx-auto mt-2 max-w-[520px] text-sm leading-relaxed">
            Book a free Home Insulation Ready Check. We measure up, confirm what your home qualifies for, and give you a firm quote — no obligation.
          </p>
          <a
            href={ENQUIRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="estimate-action-button mt-5 inline-flex min-h-13 items-center justify-center gap-2 px-6 py-4 text-sm font-extrabold text-estimate-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Book my free Ready Check <ArrowRight aria-hidden="true" className="size-4" />
          </a>
          <p className="mt-3 text-xs font-bold text-estimate-navy/70">Takes about a minute · you&apos;ll be on the official Home Insulation Victoria enquiry form</p>
        </section>

        <p className="mt-6 text-center text-xs leading-relaxed text-estimate-navy/70">
          Indicative only — this is not a quote. Prices include GST. Nothing you type here is saved, sent or shared.
          <br />
          Home Insulation Victoria manages your project end-to-end as the Accredited Person under the Victorian Energy Upgrades program.
        </p>
      </main>
    </div>
  );
}
