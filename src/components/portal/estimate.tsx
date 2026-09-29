import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Check, ChevronDown, ClipboardCheck, Flame, Leaf, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminEstimate, getAdminEstimateLink, getAdminEstimateLinkUrl, getOwnerEstimate } from "@/lib/estimate.functions";
import { LINK_ADMIN_WARNING, LINK_COMMS_OFF } from "@/lib/estimatelink.core";
import { BENCHMARK_LABEL, CALC_ASSUMPTION_LABEL, CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, FEE_DESCRIPTION, FEE_LABEL, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings, type Scenario } from "@/lib/estimate.core";
import type { LocationVariables } from "@/lib/activity48.core";
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

function PriceResult({ est, area, fees, assumption = false }: { est: Est; area: number; fees: NonNullable<CustomerData["fees"]>; assumption?: boolean }) {
  const primary = est.scenarios.find((s) => s.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  return <section className="estimate-offset rounded-[1.35rem] border-2 border-estimate-blue bg-estimate-white px-5 py-6 sm:px-8 sm:py-8" aria-label="Your estimated home upgrade">
    <p className="text-xs font-extrabold uppercase tracking-widest text-estimate-blue">Your estimated home upgrade</p>
    <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1"><strong className="text-5xl font-extrabold leading-none text-estimate-navy sm:text-6xl" data-testid={assumption ? "calculator-total-can_remain" : "total-can_remain"}>{dollars(standard.estimated_customer_total)}</strong><span className="pb-1 text-sm">inc GST</span></div>
    <p className="mt-3 text-sm leading-relaxed">{assumption ? `${CALC_ASSUMPTION_LABEL}: ${area} m². Final area measured onsite.` : `Based on an estimated ${area} m² ceiling area${est.scenarios.some((s) => s.key === "full_removal") ? ", assuming your existing insulation can remain" : ""}.`}</p>
    <div className="mt-6 border-t border-estimate-blue/20 pt-5">
      <h3 className="text-lg font-extrabold text-estimate-blue">Everything included in this estimate</h3>
      <dl className="mt-4 space-y-4 text-sm">
        {[["R5.0 ceiling insulation — supply & installation", dollars(standard.installation)], ["Onsite Measure + PIESA electrical safety assessment", dollars(fees.piesa)], ["HI VIC eligibility, Accredited Person compliance, job administration, evidence review & VEEC processing", dollars(fees.ap)]].map(([label, amount]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4"><dt className="min-w-0 leading-relaxed">{label}</dt><dd className="font-bold">{amount}</dd></div>)}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-xl bg-estimate-green-soft px-3 py-3 font-bold text-estimate-navy"><dt className="min-w-0">Estimated VEU discount</dt><dd className="text-estimate-blue">−{dollars(standard.applied_discount)}</dd></div>
      </dl>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t-2 border-estimate-blue pt-4 font-extrabold text-estimate-blue"><span className="text-sm uppercase tracking-wider">Your estimated total</span><span className="text-xl">{dollars(standard.estimated_customer_total)}</span></div>
    </div>
    {standard.copayment_capped && <p className="mt-3 text-sm">The discount is limited so your contribution meets the program minimum.</p>}
  </section>;
}

const insulationSource = "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts";
const energyTipsSource = "https://www.energy.vic.gov.au/households/save-energy-and-money/top-10-energy-saving-tips";
function HouseholdBenefits() {
  const id = useId();
  return <section aria-labelledby={id}>
    <h3 id={id} className="text-xl font-extrabold text-estimate-blue sm:text-2xl">What this upgrade could mean for your home</h3>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {[
        { icon: Leaf, value: "$400+ / year*", label: "average potential energy-bill savings from upgrading ceiling insulation" },
        { icon: Flame, value: "Up to 20%*", label: "potential savings on heating and cooling costs" },
        { icon: Sun, value: "Warmer in winter. Cooler in summer.", label: "Better year-round comfort with less energy wasted through the ceiling." },
      ].map(({ icon: Icon, value, label }) => <div key={value} className="rounded-xl bg-estimate-green-soft px-4 py-5"><Icon aria-hidden="true" className="mb-4 size-7 text-estimate-blue" /><p className="text-lg font-extrabold leading-snug text-estimate-blue">{value}</p><p className="mt-2 text-sm leading-relaxed">{label}</p></div>)}
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
    `Onsite Measure + PIESA: ${dollars(fees.piesa)} inc GST`,
    `HI VIC compliance & administration: ${dollars(fees.ap)} inc GST`,
    ...(settings ? [`Access adjustments: fixed +${pct(settings.access_moderate_multiplier)} moderate / +${pct(settings.access_difficult_multiplier)} difficult on the installation component`] : []),
    "Electrical rectification: separately itemised and approved before work",
  ];
  return <section aria-labelledby={id} className="rounded-[1.35rem] border-2 border-estimate-green bg-estimate-green-soft px-5 py-6 sm:px-8">
    <p className="text-xs font-extrabold uppercase tracking-widest text-estimate-green">Price protection</p>
    <h3 id={id} className="mt-2 text-xl font-extrabold leading-snug text-estimate-blue sm:text-2xl">Transparent HI VIC pricing — no installer mark-up surprises.</h3>
    <p className="mt-3 text-sm leading-relaxed">HI VIC sets the customer pricing. Once the onsite facts are confirmed, your final quote is calculated from our set customer rate card. Our partner electricians and insulation installers do not decide what you pay.</p>
    <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">{rows.map((r) => <li key={r} className="flex items-start gap-2 rounded-lg bg-estimate-white px-3 py-2.5 leading-snug"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" />{r}</li>)}</ul>
    <p className="mt-4 text-xs leading-relaxed">Your final total still depends on the measured area, whether removal is needed, access and any electrical rectification.</p>
  </section>;
}

function NextStep({ fee, hasPrice }: { fee: number; hasPrice: boolean }) {
  const id = useId();
  return <section className="estimate-offset rounded-[1.35rem] bg-estimate-blue px-5 py-7 text-estimate-white sm:px-8 sm:py-8" aria-labelledby={`${id}-next-step`}>
    <p className="text-xs font-extrabold uppercase tracking-widest text-estimate-green-light">Your next step</p>
    <h3 id={`${id}-next-step`} className="mt-2 text-2xl font-extrabold leading-tight">Your next step: book your onsite Measure + PIESA</h3>
    <p className="mt-3 text-4xl font-extrabold">{dollars(fee)} <span className="text-base font-semibold">inc GST</span></p>
    <p className="mt-4 rounded-lg bg-estimate-green px-4 py-3 text-sm font-extrabold leading-relaxed text-estimate-white">{hasPrice ? "Already included in your estimated project total — not an extra charge if you proceed." : "Included in the estimated project total — not an extra charge if you proceed."}</p>
    <p className="mt-5 text-sm leading-relaxed">One visit gives us the verified information needed to finalise your job.</p>
    <p className="mt-6 font-bold">What it covers</p>
    <ul className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">{["Exact ceiling-area measurement", "Existing insulation/R-value check", "Whether removal is required", "Roof/ceiling access assessment", "PIESA by a licensed electrician employed by a REC", "Wiring, downlights, exhaust fans and electrical-clearance checks", "Identification of any rectification required before install", "Information required to prepare the final insulation quote"].map((item) => <li key={item} className="flex items-start gap-2 leading-relaxed"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green-light" />{item}</li>)}</ul>
    <div className="mt-7 border-t border-estimate-white/30 pt-5"><p className="font-bold">What happens next?</p><ol className="mt-4 grid gap-4 text-sm sm:grid-cols-3">{["We complete the onsite Measure + PIESA", "You receive your final HI VIC-priced quote", "Once you approve it, we coordinate the qualified installer and manage the job through installation, evidence and VEEC processing"].map((item, index) => <li key={item} className="flex items-start gap-2 leading-relaxed"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-estimate-green-soft font-bold text-estimate-blue">{index + 1}</span>{item}</li>)}</ol></div>
    <div className="mt-7 rounded-lg border border-estimate-green-light/70 bg-estimate-white/10 px-4 py-4 text-center text-sm font-bold">Online booking &amp; payment — coming in the next step</div>
  </section>;
}

function ManagedProcess() {
  const id = useId();
  const cards = [
    { icon: ShieldCheck, title: "Licensed electrical safety assessment", copy: "Your PIESA is completed by a licensed electrician employed by a Registered Electrical Contractor (REC). They check the ceiling space for unsafe wiring, prohibited lighting such as halogen downlights, solar/battery cabling and other electrical hazards before insulation work proceeds.", note: "" },
    { icon: BadgeCheck, title: "EEC Certified Insulation Installer", copy: "Your insulation upgrade is carried out by an EEC Certified Insulation Installer (CII) — the certification required for installers working under the VEU ceiling-insulation activity.", note: "CII certification covers the competency pathway for safe retrofit insulation work, including WHS, measurements and calculations, working safely at heights and bulk insulation installation." },
    { icon: ClipboardCheck, title: "We manage it end-to-end", copy: "Eligibility, onsite assessment, vetted trades, quoting, compliance, evidence, installation coordination and VEEC processing — managed through one HI VIC process.", note: "" },
  ];
  return <section aria-labelledby={id}>
    <p className="text-xs font-extrabold uppercase tracking-widest text-estimate-green">Why HI VIC</p>
    <h3 id={id} className="mt-2 text-xl font-extrabold leading-snug text-estimate-blue sm:text-2xl">One managed pathway. The right qualified people. No chasing trades.</h3>
    <p className="mt-3 text-sm leading-relaxed sm:text-base">From eligibility through to installation and VEEC processing, HI VIC coordinates the people, paperwork and compliance for you.</p>
    <div className="mt-5 grid gap-3">
      {cards.map(({ icon: Icon, title, copy, note }) => <div key={title} className="flex items-start gap-4 rounded-xl border-2 border-estimate-blue bg-estimate-white px-4 py-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-estimate-green-soft"><Icon aria-hidden="true" className="size-5 text-estimate-blue" /></span>
        <div><p className="font-extrabold leading-snug text-estimate-blue">{title}</p><p className="mt-1.5 text-sm leading-relaxed">{copy}</p>{note && <p className="mt-2 text-xs leading-relaxed">{note}</p>}</div>
      </div>)}
    </div>
    <p className="mt-4 text-sm font-semibold leading-relaxed">You don&apos;t need to work out which trades meet the program requirements — we coordinate appropriately qualified participants for the job.</p>
  </section>;
}

function RemovalNote({ est, assumption = false }: { est: Est; assumption?: boolean }) {
  const removal = est.scenarios.find((s) => s.key === "full_removal");
  if (!removal) return null;
  return <p className="border-l-4 border-estimate-blue bg-estimate-blue-pale px-4 py-4 text-sm leading-relaxed">If full removal is required, your estimated total would be around <strong data-testid={assumption ? "calculator-total-full_removal" : "total-full_removal"}>{dollars(removal.by_access.standard.estimated_customer_total)}</strong>. Your onsite assessment confirms whether removal is actually needed.</p>;
}

function EstimateDetails({ data }: { data: CustomerData }) {
  return <div className="border-y border-estimate-blue/20 py-5 text-sm"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What could change the final price? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><ul className="space-y-3 pt-5 leading-relaxed"><li>Final measured ceiling area may differ from this estimate.</li><li>Access is confirmed onsite. Standard access is assumed.{data.estimate ? ` Moderate access may add ${dollars(data.estimate.access_adjustment.moderate)}; difficult access may add ${dollars(data.estimate.access_adjustment.difficult)}.` : ""}{data.accessConcern ? " Access needs checking onsite." : ""}</li><li>Existing insulation may need removal after onsite inspection.</li><li>Electrical rectification, if required, is quoted separately before approval.</li></ul></details></div>;
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, publicPage = false }: { data: CustomerData; publicPage?: boolean }) {
  if (!data.visible || !data.mode) return null;
  const fees = data.fees;
  const Heading = publicPage ? "h1" : "h2";
  return (
    <div className="estimate-brand space-y-7 text-estimate-navy sm:space-y-9" aria-label="Indicative estimate">
       <div>
         <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-estimate-green">GOOD NEWS</p>
         <Heading className="text-2xl font-extrabold leading-tight text-estimate-blue sm:text-3xl">{HEADLINE[data.mode]}</Heading>
          <span className="mt-3 inline-flex max-w-full rounded-full bg-estimate-green-soft px-3 py-2 text-xs font-extrabold uppercase leading-snug text-estimate-navy">{ELIGIBILITY_COPY[data.mode].badge}</span>
          <p className="mt-3 text-sm leading-relaxed text-estimate-navy sm:text-base">{ELIGIBILITY_COPY[data.mode].description}</p>
         {data.mode === "onsite" && !!data.onsiteDrivers?.length && <p className="mt-3 text-sm leading-relaxed text-estimate-navy"><span className="font-bold">We just need to confirm:</span> {[...new Set(data.onsiteDrivers.map(plainOnsiteDriver))].join(" · ")}</p>}
       </div>
      {data.rolloutHold && <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Assessments for private homes open from 1 October 2026. This is a scheduling hold only, not an eligibility result.</p>}
      {!fees ? <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Your estimate is being prepared.</p> : <>
        {data.estimate ? <PriceResult est={data.estimate} area={data.estimate.area.m2} fees={fees} /> : data.calc ? <AreaCalculator calc={data.calc} initial={null} fees={fees} /> : <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>}
        {data.estimate && <><RemovalNote est={data.estimate} /><HouseholdBenefits /><PriceProtection settings={data.calc?.settings} fees={fees} /><NextStep fee={fees.piesa} hasPrice /><ManagedProcess /></>}
        {data.estimate && data.calc && <AreaCalculator calc={data.calc} initial={data.estimate.area.m2} fees={fees} secondary />}
        <EstimateDetails data={data} />
        {data.calc && <details className="group border-b border-estimate-blue/20 pb-5 text-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">How is the VEU discount estimated? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><p className="mt-4 leading-relaxed">We use the official Activity 48 postcode/climate calculation and a {dollars(data.calc.settings.indicative_veec_value)} consumer benchmark calibrated to the Victorian Government&apos;s published example. Final certificate values can change. This is not the live VEEC market price.</p>{data.calc.settings.veec_value_source_url?.startsWith("https://") && <a className="mt-2 inline-block font-bold text-estimate-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={data.calc.settings.veec_value_source_url} target="_blank" rel="noopener noreferrer">View the published example <span aria-hidden="true">↗</span></a>}</details>}
        <p className="pb-6 text-xs leading-relaxed text-estimate-navy">Indicative estimate only. Final price depends on onsite measurement, existing insulation, access, electrical safety, eligibility and certificate values.</p>
      </>}
    </div>
  );
}

/** Pure client-side what-if. Local state only: no server call, never saved to the job, measurements or estimates. */
function AreaCalculator({ calc, initial, fees, secondary = false }: { calc: NonNullable<CustomerData["calc"]>; initial: number | null; fees: NonNullable<CustomerData["fees"]>; secondary?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(!secondary);
  const [raw, setRaw] = useState(secondary ? "" : initial == null ? "" : String(initial));
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, calc.location, calc.insulation as InsulationDeclared, calc.settings);
  return (
    <section className="" data-testid="area-calculator" aria-label="Ceiling area calculator">
      {secondary && !open ? <Button variant="ghost" size="field" className="h-auto min-h-12 max-w-full justify-start whitespace-normal px-0 text-left font-bold text-estimate-blue underline underline-offset-4 hover:bg-transparent hover:text-estimate-blue" onClick={() => setOpen(true)}>Want to test a different ceiling area? <ChevronDown aria-hidden="true" /></Button> : <>
        <div className="rounded-[1.3rem] bg-estimate-blue-pale px-5 py-6 sm:px-7">
        <h3 className="text-xl font-extrabold text-estimate-blue">{secondary ? "Test a different ceiling area" : "See what your upgrade could cost"}</h3>
        <p className="mt-1 text-sm leading-relaxed">Enter a rough ceiling area to see your estimated VEU discount, project price and potential household savings. Nothing you enter here is saved.</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={id}>Approximate ceiling area (m²)</label>
          <input id={id} aria-label="Approximate ceiling area (m²)" inputMode="decimal" type="number" min={CALC_MIN_M2} max={CALC_MAX_M2} className="h-14 w-28 rounded-xl border border-estimate-blue bg-estimate-white px-3 text-lg text-estimate-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Area" />
          <span className="mr-2 text-sm text-estimate-navy">m²</span>
          {CALC_QUICK.map((q) => <Button key={q} type="button" size="field" variant="outline" className={`rounded-full border border-estimate-blue px-3 font-bold text-estimate-navy hover:bg-estimate-green-soft hover:text-estimate-navy ${m2 === q ? "bg-estimate-green-soft" : "bg-estimate-white"}`} aria-pressed={m2 === q} onClick={() => setRaw(String(q))}>{q} m²</Button>)}
        </div>
        {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-2 text-sm text-danger">Enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
        </div>
        {est && <div className="mt-6 space-y-7 sm:space-y-9"><PriceResult est={est} area={m2 ?? 0} fees={fees} assumption />{!secondary && <><RemovalNote est={est} assumption /><HouseholdBenefits /><PriceProtection settings={calc.settings} fees={fees} /><NextStep fee={fees.piesa} hasPrice /><ManagedProcess /></>}</div>}
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
