import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, Home, Ruler, ShieldCheck, Sparkles } from "lucide-react";
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

function PriceResult({ est, area, assumption = false }: { est: Est; area: number; assumption?: boolean }) {
  const primary = est.scenarios.find((s) => s.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  const removal = est.scenarios.find((s) => s.key === "full_removal");
  return (
    <div className={assumption ? "border-t border-estimate-blue/20 pt-5" : "estimate-offset rounded-[1.35rem] border-2 border-estimate-blue bg-estimate-white px-5 py-6 sm:px-8 sm:py-8"}>
      <p className="text-xs font-extrabold uppercase tracking-widest text-estimate-blue">Estimated price after VEU discount</p>
      <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1"><strong className="text-5xl font-extrabold leading-none text-estimate-navy sm:text-6xl" data-testid={assumption ? "calculator-total-can_remain" : "total-can_remain"}>{dollars(standard.estimated_customer_total)}</strong><span className="pb-1 text-sm">inc GST</span></div>
      <div className="mt-5 inline-flex flex-wrap items-center gap-x-2 rounded-full bg-estimate-green-soft px-4 py-2 text-sm font-bold text-estimate-navy"><Sparkles aria-hidden="true" className="size-4 shrink-0 text-estimate-green" />Estimated VEU discount: <strong>{dollars(standard.applied_discount)}</strong></div>
      <p className="mt-5 text-sm leading-relaxed">{assumption ? "Calculator estimate only — final area measured onsite." : `Based on an estimated ${area} m² ceiling area, assuming your existing insulation can remain.`}</p>
      {removal && <div className="mt-5 border-t border-estimate-blue/20 pt-4 text-sm"><p className="text-xs font-bold uppercase tracking-widest text-estimate-blue">If full removal is needed</p><p className="mt-1 font-bold">Estimated total: <span data-testid={assumption ? "calculator-total-full_removal" : "total-full_removal"}>{dollars(removal.by_access.standard.estimated_customer_total)}</span></p><p className="mt-1">Your onsite assessment confirms whether removal is actually required.</p></div>}
      {standard.copayment_capped && <p className="mt-3 text-sm">The discount is limited so your contribution meets the program minimum.</p>}
    </div>
  );
}

function Reassurance() {
  return <div className="grid gap-4 sm:grid-cols-3" aria-label="Why this estimate is useful">{[
    { icon: Sparkles, title: "VEU discount included", copy: "Your estimated discount is already applied to the price shown." },
    { icon: ShieldCheck, title: "Managed by HI VIC", copy: "We handle eligibility, compliance, evidence and VEEC processing." },
    { icon: Ruler, title: "Final price confirmed onsite", copy: "One assessment confirms area, insulation, access and electrical safety." },
  ].map(({ icon: Icon, title, copy }) => <div key={title} className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-estimate-green-soft text-estimate-blue"><Icon aria-hidden="true" className="size-5" /></span><div className="min-w-0"><h3 className="text-sm font-bold text-estimate-blue">{title}</h3><p className="mt-1 text-sm leading-relaxed">{copy}</p></div></div>)}</div>;
}

function EstimateDetails({ data }: { data: CustomerData }) {
  const primary = data.estimate?.scenarios.find((s) => s.key === "can_remain") ?? data.estimate?.scenarios[0];
  const standard = primary?.by_access.standard;
  return <div className="divide-y divide-estimate-blue/20 border-y border-estimate-blue/20">
    <details className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What's included in this estimate <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><div className="pt-5 text-sm"><dl className="space-y-4">{[["R5.0 insulation supply & installation", standard ? dollars(standard.installation) : "Included in your calculated estimate"], ["Onsite Measure + PIESA", dollars(data.fees?.piesa ?? 0)], [FEE_LABEL, dollars(data.fees?.ap ?? 0)], ["Estimated VEU discount", standard ? `−${dollars(standard.applied_discount)}` : "Applied to your calculated estimate"]].map(([label, amount]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4"><dt className="min-w-0">{label}</dt><dd className="text-right font-bold">{amount}</dd></div>)}</dl><p className="mt-4 text-sm">{FEE_DESCRIPTION}</p></div></details>
    <details className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What could change the final price? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><ul className="space-y-3 pt-5 text-sm leading-relaxed"><li>Final measured ceiling area may differ from this estimate.</li><li>Access is confirmed onsite. Standard access is assumed.{data.estimate ? ` Moderate access may add ${dollars(data.estimate.access_adjustment.moderate)}; difficult access may add ${dollars(data.estimate.access_adjustment.difficult)}.` : ""}{data.accessConcern ? " Access needs checking onsite." : ""}</li><li>Existing insulation may need removal after onsite inspection.</li><li>Electrical rectification, if required, is quoted separately before approval.</li></ul></details>
  </div>;
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, publicPage = false }: { data: CustomerData; publicPage?: boolean }) {
  const id = useId();
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
        {data.estimate ? <PriceResult est={data.estimate} fees={fees} area={data.estimate.area.m2} /> : !data.calc && <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>}
         {data.estimate && <Assumptions est={data.estimate} accessConcern={data.accessConcern} headingId={`${id}-assumptions`} />}
        {data.calc && <AreaCalculator calc={data.calc} fees={fees} initial={data.estimate?.area.m2 ?? null} secondary={!!data.estimate} />}
         {!data.estimate && <Assumptions accessConcern={data.accessConcern} headingId={`${id}-assumptions`} />}
        {data.calc && <section className="rounded-[1.3rem] bg-estimate-green-soft px-5 py-6 sm:px-7" aria-labelledby={`${id}-veu`}><div className="flex items-start gap-3"><Info aria-hidden="true" className="mt-1 size-5 shrink-0 text-estimate-blue" /><div><p className="text-xs font-extrabold uppercase tracking-widest text-estimate-navy">VEU saving</p><h3 id={`${id}-veu`} className="mt-1 text-lg font-extrabold uppercase tracking-tight text-estimate-blue">How we estimate your VEU discount</h3><p className="mt-2 text-sm leading-relaxed text-estimate-navy">Your estimate uses the official Activity 48 postcode and climate calculation and a {dollars(data.calc.settings.indicative_veec_value)} per VEEC-equivalent consumer benchmark calibrated to the Victorian Government’s published example. It is not the live VEEC market price, and final values can change.</p>{data.calc.settings.veec_value_source_url?.startsWith("https://") && <a className="mt-2 inline-block text-sm font-bold text-estimate-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={data.calc.settings.veec_value_source_url} target="_blank" rel="noopener noreferrer">View the published example <span aria-hidden="true">↗</span></a>}</div></div></section>}
        <section className="estimate-offset rounded-[1.35rem] border-2 border-estimate-blue bg-estimate-blue px-5 py-6 text-estimate-white sm:px-8 sm:py-8" aria-labelledby={`${id}-next-step`}><p className="text-xs font-extrabold uppercase tracking-widest text-estimate-green-light">The next step</p><div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 id={`${id}-next-step`} className="text-xl font-extrabold uppercase tracking-tight sm:text-2xl">Onsite Measure + PIESA</h3><span className="text-2xl font-extrabold">{dollars(fees.piesa)} <span className="text-sm font-normal">inc GST</span></span></div><p className="mt-2 text-sm">{data.estimate ? "This fee is already included in the indicative total above." : "This fee is included in the indicative total once you enter an area."}</p><ul className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{["Confirms exact ceiling area", "Checks existing insulation and removal", "Confirms access", "Completes electrical safety assessment", "Allows a final quote to be prepared"].map((item) => <li key={item} className="flex items-start gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green-light" />{item}</li>)}</ul><p className="mt-6 border-t border-estimate-white/30 pt-4 text-sm">Online booking and payment will be available here in the next step.</p></section>
        <p className="pb-6 text-sm leading-relaxed text-estimate-navy">Indicative estimate only. Final price depends on onsite measurement, existing insulation, access, electrical safety, eligibility and certificate values.</p>
      </>}
    </div>
  );
}

/** Pure client-side what-if. Local state only: no server call, never saved to the job, measurements or estimates. */
function AreaCalculator({ calc, fees, initial, secondary = false }: { calc: NonNullable<CustomerData["calc"]>; fees: { piesa: number; ap: number }; initial: number | null; secondary?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(!secondary);
  const [raw, setRaw] = useState(secondary ? "" : initial == null ? "" : String(initial));
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, calc.location, calc.insulation as InsulationDeclared, calc.settings);
  return (
    <section className="rounded-[1.3rem] border-2 border-estimate-blue bg-estimate-white px-5 py-6 sm:px-7" data-testid="area-calculator" aria-label="Ceiling area calculator">
      {secondary && !open ? <Button variant="ghost" size="field" className="h-auto min-h-12 max-w-full justify-start whitespace-normal px-0 text-left font-bold text-estimate-blue hover:bg-transparent hover:text-estimate-blue" onClick={() => setOpen(true)}>Want to test a different ceiling area? <ChevronDown aria-hidden="true" /></Button> : <>
        <h3 className="text-lg font-extrabold uppercase tracking-tight text-estimate-blue">{secondary ? "Test a different ceiling area" : CALC_EMPTY_TITLE}</h3>
        <p className="mt-1 text-sm text-estimate-navy">Enter an approximate ceiling or upper-floor area.</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={id}>Approximate ceiling area (m²)</label>
          <input id={id} aria-label="Approximate ceiling area (m²)" inputMode="decimal" type="number" min={CALC_MIN_M2} max={CALC_MAX_M2} className="h-12 w-28 rounded-xl border-2 border-estimate-blue bg-estimate-white px-3 text-base text-estimate-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Area" />
          <span className="mr-2 text-sm text-estimate-navy">m²</span>
          {CALC_QUICK.map((q) => <Button key={q} type="button" size="field" variant="outline" className={`rounded-xl border-2 border-estimate-blue px-3 font-bold text-estimate-navy hover:bg-estimate-green-soft hover:text-estimate-navy ${m2 === q ? "bg-estimate-green-soft estimate-offset" : "bg-estimate-white"}`} aria-pressed={m2 === q} onClick={() => setRaw(String(q))}>{q} m²</Button>)}
        </div>
        {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-2 text-sm text-danger">Enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
        <p className="mt-3 text-sm text-estimate-navy">For exploring costs only. This does not change your recorded property details.</p>
        {est && <div className="mt-7 space-y-5"><p className="flex items-center gap-2 text-sm font-bold text-estimate-blue"><CircleHelp aria-hidden="true" className="size-4 shrink-0" />{CALC_ASSUMPTION_LABEL}: {m2} m²</p><PriceResult est={est} fees={fees} area={m2 ?? 0} assumption /></div>}
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
