import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, CircleHelp, Home, Info, Ruler, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminEstimate, getAdminEstimateLink, getAdminEstimateLinkUrl, getOwnerEstimate } from "@/lib/estimate.functions";
import { LINK_ADMIN_WARNING, LINK_COMMS_OFF } from "@/lib/estimatelink.core";
import { BENCHMARK_LABEL, CALC_ASSUMPTION_LABEL, CALC_EMPTY_TITLE, CALC_MAX_M2, CALC_MIN_M2, CALC_QUICK, FEE_DESCRIPTION, FEE_LABEL, dollars, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings, type Scenario } from "@/lib/estimate.core";
import type { LocationVariables } from "@/lib/activity48.core";
import { Pill } from "./badges";

export const HEADLINE = { likely: "Your home looks suitable to progress", onsite: "Your home may be eligible — onsite confirmation needed" } as const;

export type CustomerData = {
  visible: boolean; mode?: "likely" | "onsite"; measureRequired?: boolean; onsiteDrivers?: string[]; rolloutHold?: boolean; accessConcern?: boolean;
  fees?: { piesa: number; ap: number; minCopay: number } | null;
  calc?: { location: LocationVariables; insulation: string | null; settings: RetailSettings } | null; postcodeUnlisted?: boolean;
  estimate?: { area: { m2: number; label: string }; scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } } | null;
};

type Est = { scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } };

function PriceResult({ est, fees, area, assumption = false }: { est: Est; fees: { piesa: number; ap: number }; area: number; assumption?: boolean }) {
  const primary = est.scenarios.find((s) => s.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  const removal = est.scenarios.find((s) => s.key === "full_removal");
  return (
    <div className="space-y-7">
      <div className="overflow-hidden rounded-lg border border-primary/20 bg-card shadow-sm">
        <div className="px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
          <p className="text-sm font-medium text-muted-foreground">Estimated price after VEU discount</p>
          <div className="mt-2 flex items-end gap-3"><span className="text-5xl font-extrabold leading-none text-foreground sm:text-6xl" data-testid={assumption ? "calculator-total-can_remain" : "total-can_remain"}>{dollars(standard.estimated_customer_total)}</span><span className="pb-1 text-sm text-muted-foreground">inc GST</span></div>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-5 text-sm sm:text-base"><span className="inline-flex items-center gap-2 font-semibold text-primary"><Sparkles aria-hidden="true" className="size-4" />Estimated VEU discount</span><strong className="text-lg text-primary">−{dollars(standard.applied_discount)}</strong></div>
        </div>
      </div>
      {removal ? (
        <div className="border-l-4 border-warning bg-warning-soft px-5 py-4">
          <p className="font-semibold">If full removal is required: approximately <span data-testid={assumption ? "calculator-total-full_removal" : "total-full_removal"}>{dollars(removal.by_access.standard.estimated_customer_total)}</span></p>
          <p className="mt-1 text-sm text-foreground/80">Your onsite assessment confirms whether existing insulation can remain or must be removed.</p>
        </div>
      ) : <p className="text-sm text-muted-foreground">Your onsite assessment will confirm whether any unexpected existing insulation is present and whether it affects your final price.</p>}
      <section aria-label="What this estimate includes" className="border-t pt-7">
        <h3 className="text-lg font-bold">What this estimate includes</h3>
        <dl className="mt-4 divide-y divide-border">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"><dt className="flex min-w-0 items-center gap-3"><Home aria-hidden="true" className="size-5 shrink-0 text-primary" /><span>R5.0 insulation supply &amp; installation <span className="block text-sm text-muted-foreground">Based on {area} m²{assumption ? " calculator assumption" : " estimated ceiling area"}</span></span></dt><dd className="shrink-0 font-semibold">{dollars(standard.installation)}</dd></div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"><dt className="flex min-w-0 items-center gap-3"><Ruler aria-hidden="true" className="size-5 shrink-0 text-primary" /><span>Onsite Measure + PIESA</span></dt><dd className="shrink-0 font-semibold">{dollars(fees.piesa)}</dd></div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"><dt className="flex min-w-0 items-center gap-3"><ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-primary" /><span>{FEE_LABEL}<details className="mt-1 text-sm text-muted-foreground"><summary className="cursor-pointer text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">What this covers</summary><p className="pt-1">{FEE_DESCRIPTION}</p></details></span></dt><dd className="shrink-0 self-start pt-1 font-semibold">{dollars(fees.ap)}</dd></div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-primary"><dt className="flex min-w-0 items-center gap-3 font-semibold"><Sparkles aria-hidden="true" className="size-5 shrink-0" />Estimated VEU discount</dt><dd className="shrink-0 font-bold">−{dollars(standard.applied_discount)}</dd></div>
        </dl>
        {standard.copayment_capped && <p className="mt-2 text-sm text-muted-foreground">The discount is limited so your contribution meets the program minimum.</p>}
      </section>
    </div>
  );
}

function Assumptions({ est, drivers, accessConcern }: { est?: Est | null | undefined; drivers?: string[] | undefined; accessConcern?: boolean | undefined }) {
  return (
    <section className="border-t pt-7" aria-labelledby="assumptions-heading">
      <h3 id="assumptions-heading" className="text-lg font-bold">What may change</h3>
      <p className="mt-1 text-sm text-muted-foreground">Your final price is confirmed after the onsite assessment.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div><Ruler aria-hidden="true" className="mb-2 size-5 text-primary" /><h4 className="font-semibold">Ceiling area</h4><p className="mt-1 text-sm text-muted-foreground">Final measurement onsite.</p></div>
        <div><Home aria-hidden="true" className="mb-2 size-5 text-primary" /><h4 className="font-semibold">Access</h4><p className="mt-1 text-sm text-muted-foreground">Access is confirmed onsite. Standard access is assumed.{est ? ` Moderate access may add ${dollars(est.access_adjustment.moderate)}; difficult access may add ${dollars(est.access_adjustment.difficult)}.` : ""}{accessConcern ? " Access needs checking onsite." : ""}</p></div>
        <div><ShieldCheck aria-hidden="true" className="mb-2 size-5 text-primary" /><h4 className="font-semibold">Electrical</h4><p className="mt-1 text-sm text-muted-foreground">Safety assessment included; rectification, if required, is quoted separately before approval.</p></div>
      </div>
      {!!drivers?.length && <div className="mt-5 border-l-2 border-primary pl-4"><h4 className="text-sm font-semibold">We need to confirm onsite</h4><p className="mt-1 text-sm text-muted-foreground">{drivers.join(" · ")}</p></div>}
    </section>
  );
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, publicPage = false }: { data: CustomerData; publicPage?: boolean }) {
  if (!data.visible || !data.mode) return null;
  const fees = data.fees;
  const Heading = publicPage ? "h1" : "h2";
  return (
    <div className="space-y-8 text-foreground" aria-label="Indicative estimate">
      <div><p className="mb-2 text-sm font-semibold text-primary">Your home estimate</p><Heading className="text-2xl font-bold leading-tight sm:text-3xl">{HEADLINE[data.mode]}</Heading></div>
      {data.rolloutHold && <p className="border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">Assessments for private homes open from 1 October 2026. This is a scheduling hold only, not an eligibility result.</p>}
      {!fees ? <p className="bg-muted px-4 py-3 text-sm">Your estimate is being prepared.</p> : <>
        {data.estimate ? <PriceResult est={data.estimate} fees={fees} area={data.estimate.area.m2} /> : !data.calc && <p className="bg-muted px-4 py-3 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>}
        <Assumptions est={data.estimate} drivers={data.onsiteDrivers} accessConcern={data.accessConcern} />
        {data.calc && <AreaCalculator calc={data.calc} fees={fees} initial={data.estimate?.area.m2 ?? null} secondary={!!data.estimate} />}
        {data.calc && <section className="border-t pt-7" aria-labelledby="veu-heading"><div className="flex items-start gap-3"><Info aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" /><div><h3 id="veu-heading" className="text-lg font-bold">How we estimate your VEU discount</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your estimate uses the official Activity 48 postcode and climate calculation and a {dollars(data.calc.settings.indicative_veec_value)} per VEEC-equivalent consumer benchmark calibrated to the Victorian Government’s published example. It is not the live VEEC market price, and final values can change.</p>{data.calc.settings.veec_value_source_url?.startsWith("https://") && <a className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={data.calc.settings.veec_value_source_url} target="_blank" rel="noopener noreferrer">View the published example <span aria-hidden="true">↗</span></a>}</div></div></section>}
        <section className="rounded-lg bg-brand-dark px-5 py-6 text-brand-dark-foreground sm:px-8 sm:py-8" aria-labelledby="next-step-heading"><p className="text-sm font-semibold text-sidebar-primary">THE NEXT STEP</p><div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 id="next-step-heading" className="text-xl font-bold sm:text-2xl">Onsite Measure + PIESA</h3><span className="text-2xl font-bold">{dollars(fees.piesa)} <span className="text-sm font-normal">inc GST</span></span></div><p className="mt-2 text-sm text-brand-dark-foreground/80">{data.estimate ? "This fee is already included in the indicative total above." : "This fee is included in the indicative total once you enter an area."}</p><ul className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{["Confirms exact ceiling area", "Checks existing insulation and removal", "Confirms access", "Completes electrical safety assessment", "Allows a final quote to be prepared"].map((item) => <li key={item} className="flex items-start gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sidebar-primary" />{item}</li>)}</ul><p className="mt-6 border-t border-brand-dark-foreground/20 pt-4 text-sm text-brand-dark-foreground/80">Online booking and payment will be available here in the next step.</p></section>
        <p className="pb-6 text-sm leading-relaxed text-muted-foreground">Indicative estimate only. Final price depends on onsite measurement, existing insulation, access, electrical safety, eligibility and certificate values.</p>
      </>}
    </div>
  );
}

/** Pure client-side what-if. Local state only: no server call, never saved to the job, measurements or estimates. */
function AreaCalculator({ calc, fees, initial, secondary = false }: { calc: NonNullable<CustomerData["calc"]>; fees: { piesa: number; ap: number }; initial: number | null; secondary?: boolean }) {
  const [open, setOpen] = useState(!secondary);
  const [raw, setRaw] = useState(secondary ? "" : initial == null ? "" : String(initial));
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, calc.location, calc.insulation as InsulationDeclared, calc.settings);
  return (
    <section className="border-t pt-7" data-testid="area-calculator" aria-label="Ceiling area calculator">
      {secondary && !open ? <Button variant="ghost" size="field" className="h-auto min-h-12 max-w-full justify-start whitespace-normal px-0 text-left text-primary hover:bg-transparent hover:text-primary" onClick={() => setOpen(true)}>Want to test a different ceiling area? <ChevronDown aria-hidden="true" /></Button> : <>
        <h3 className="text-lg font-bold">{secondary ? "Test a different ceiling area" : CALC_EMPTY_TITLE}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Enter an approximate ceiling or upper-floor area.</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={secondary ? "area-secondary" : "area-primary"}>Approximate ceiling area (m²)</label>
          <input id={secondary ? "area-secondary" : "area-primary"} aria-label="Approximate ceiling area (m²)" inputMode="decimal" type="number" min={CALC_MIN_M2} max={CALC_MAX_M2} className="h-12 w-28 rounded-md border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Area" />
          <span className="mr-2 text-sm text-muted-foreground">m²</span>
          {CALC_QUICK.map((q) => <Button key={q} type="button" size="field" variant={m2 === q ? "secondary" : "outline"} className="px-3" aria-pressed={m2 === q} onClick={() => setRaw(String(q))}>{q} m²</Button>)}
        </div>
        {raw.trim() !== "" && m2 == null && <p role="alert" className="mt-2 text-sm text-danger">Enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
        <p className="mt-3 text-sm text-muted-foreground">For exploring costs only. This does not change your recorded property details.</p>
        {est && <div className="mt-7 space-y-5"><p className="flex items-center gap-2 text-sm font-semibold text-primary"><CircleHelp aria-hidden="true" className="size-4" />{CALC_ASSUMPTION_LABEL}: {m2} m²</p><PriceResult est={est} fees={fees} area={m2 ?? 0} assumption /></div>}
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
