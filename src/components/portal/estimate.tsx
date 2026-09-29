import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAdminEstimate, getAdminEstimateLink, getAdminEstimateLinkUrl, getOwnerEstimate } from "@/lib/estimate.functions";
import { LINK_ADMIN_WARNING, LINK_COMMS_OFF } from "@/lib/estimatelink.core";
import { BENCHMARK_LABEL, CALC_ASSUMPTION_LABEL, CALC_EMPTY_BODY, CALC_EMPTY_TITLE, CALC_MAX_M2, CALC_MIN_M2, CALC_NOTE, CALC_QUICK, DISCLAIMER, FEE_DESCRIPTION, FEE_LABEL, benchmarkNote, dollars, electricalNote, parseAssumption, whatIfEstimate, type InsulationDeclared, type RetailSettings, type Scenario } from "@/lib/estimate.core";
import type { LocationVariables } from "@/lib/activity48.core";
import { Pill } from "./badges";

export const HEADLINE = { likely: "Your home looks suitable to progress", onsite: "Your home may be eligible — onsite confirmation needed" } as const;

export type CustomerData = {
  visible: boolean; mode?: "likely" | "onsite"; measureRequired?: boolean; onsiteDrivers?: string[]; rolloutHold?: boolean; accessConcern?: boolean;
  fees?: { piesa: number; ap: number; minCopay: number } | null;
  calc?: { location: LocationVariables; insulation: string | null; settings: RetailSettings } | null; postcodeUnlisted?: boolean;
  estimate?: { area: { m2: number; label: string }; scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } } | null;
};

function ScenarioCard({ s, fees, single }: { s: Scenario; fees: { piesa: number; ap: number }; single: boolean }) {
  const t = s.by_access.standard;
  return (
    <div className="rounded-lg border bg-background p-3">
      {!single && <div className="mb-2 text-sm font-semibold">{s.label}</div>}
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt>R5.0 insulation supply &amp; installation</dt><dd className="text-right">{dollars(t.installation)}</dd>
        {s.removal > 0 && <><dt>Existing insulation removal &amp; disposal ({s.removal_m2} m²)</dt><dd className="text-right">{dollars(s.removal)}</dd></>}
        <dt>Onsite measure + electrical safety assessment</dt><dd className="text-right">{dollars(fees.piesa)}</dd>
        <dt>{FEE_LABEL}<div className="text-xs text-muted-foreground">{FEE_DESCRIPTION}</div></dt><dd className="text-right">{dollars(fees.ap)}</dd>
        <dt className="font-semibold text-primary">Estimated VEU discount</dt><dd className="text-right font-semibold text-primary">−{dollars(t.applied_discount)}</dd>
      </dl>
      <div className="mt-3 border-t pt-2">
        <div className="text-xs text-muted-foreground">Estimated price after VEU discount (inc GST)</div>
        <div className="text-3xl font-bold tracking-tight" data-testid={`total-${s.key}`}>{dollars(t.estimated_customer_total)}</div>
        {t.copayment_capped && <div className="text-xs text-muted-foreground">Discount limited so your contribution is at least the program minimum.</div>}
      </div>
    </div>
  );
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, adminPreview = false }: { data: CustomerData; adminPreview?: boolean }) {
  if (!data.visible || !data.mode) return null;
  const fees = data.fees;
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Indicative estimate">
      <h2 className="text-lg font-bold">{HEADLINE[data.mode]}</h2>
      {data.mode === "onsite" && !!data.onsiteDrivers?.length && <p className="mt-1 text-sm text-muted-foreground">To confirm onsite: {data.onsiteDrivers.join("; ")}</p>}
      {data.rolloutHold && <p className="mt-2 rounded bg-warning-soft px-3 py-2 text-sm text-accent-foreground">Assessments for private homes open from 1 October 2026. This is a scheduling hold only, not an eligibility result.</p>}
      {!fees ? <p className="mt-3 rounded bg-muted px-3 py-2 text-sm">Your estimate is being prepared.</p> : (
        <div className="mt-3 space-y-3">
          {data.estimate ? (
            <>
              <div className="text-sm"><span className="text-muted-foreground">Estimated ceiling area: </span><span className="font-semibold">{data.estimate.area.m2} m²</span> <span className="text-xs text-muted-foreground">({data.estimate.area.label} · final area confirmed onsite)</span></div>
              <EstimateBody est={data.estimate} fees={fees} accessConcern={!!data.accessConcern} />
              {data.calc && <AreaCalculator calc={data.calc} fees={fees} accessConcern={!!data.accessConcern} initial={data.estimate.area.m2} secondary />}
            </>
          ) : data.calc ? (
            <AreaCalculator calc={data.calc} fees={fees} accessConcern={!!data.accessConcern} initial={null} />
          ) : (
            <p className="rounded bg-muted px-3 py-2 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>
          )}
          <p className="text-sm">{electricalNote(fees.piesa)}</p>
          {data.calc && <p className="text-xs text-muted-foreground"><b>{BENCHMARK_LABEL}:</b> {benchmarkNote(data.calc.settings.indicative_veec_value)}</p>}
          <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
          <div className="rounded-lg border-2 border-primary/40 bg-accent p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-primary">Next step</div>
            <div className="font-semibold">Onsite Measure + PIESA — {dollars(fees.piesa)}</div>
            <p className="text-sm">This fee is already included in the estimated price above and forms part of your project price if you go ahead.</p>
            {adminPreview && <p className="mt-1 text-xs text-muted-foreground">Admin preview: booking and payment opens in the next step (not built yet).</p>}
          </div>
        </div>
      )}
    </section>
  );
}

type Est = { scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } };
function EstimateBody({ est, fees, accessConcern }: { est: Est; fees: { piesa: number; ap: number }; accessConcern: boolean }) {
  return (
    <>
      <div className={est.scenarios.length > 1 ? "grid gap-3 sm:grid-cols-2" : ""}>
        {est.scenarios.map((s) => <ScenarioCard key={s.key} s={s} fees={fees} single={est.scenarios.length === 1} />)}
      </div>
      {est.scenarios.length > 1 && <p className="text-sm text-muted-foreground">The onsite assessment determines whether your existing insulation can stay. Suitable existing insulation may remain; unsuitable, metallic or non-compliant insulation must be removed.</p>}
      {est.scenarios.length === 1 && <p className="text-sm text-muted-foreground">Your onsite assessment will confirm whether any existing insulation is present and whether this affects your final price.</p>}
      <p className={`rounded px-3 py-2 text-sm ${accessConcern ? "border border-warning bg-warning-soft font-medium" : "bg-muted"}`}>Access is confirmed onsite. Moderate access would add {dollars(est.access_adjustment.moderate)}; difficult access would add {dollars(est.access_adjustment.difficult)}.</p>
    </>
  );
}

/** Pure client-side what-if. Local state only: no server call, never saved to the job, measurements or estimates. */
function AreaCalculator({ calc, fees, accessConcern, initial, secondary = false }: { calc: NonNullable<CustomerData["calc"]>; fees: { piesa: number; ap: number }; accessConcern: boolean; initial: number | null; secondary?: boolean }) {
  const [open, setOpen] = useState(!secondary);
  const [raw, setRaw] = useState(initial == null ? "" : String(initial));
  const m2 = parseAssumption(raw);
  const est = whatIfEstimate(m2, calc.location, calc.insulation as InsulationDeclared, calc.settings);
  if (!open) return <button type="button" className="text-sm font-medium text-primary underline" onClick={() => setOpen(true)}>Try a different ceiling-area assumption</button>;
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 p-3" data-testid="area-calculator">
      {secondary ? <div className="text-sm font-semibold">Try a different ceiling-area assumption</div> : <><div className="font-semibold">{CALC_EMPTY_TITLE}</div><p className="text-sm">{CALC_EMPTY_BODY}</p></>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input aria-label="Approximate ceiling area (m²)" inputMode="decimal" type="number" min={CALC_MIN_M2} max={CALC_MAX_M2} className="h-12 w-32 rounded-md border bg-background px-3" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="m²" />
        <span className="text-sm">m²</span>
        {CALC_QUICK.map((q) => <button key={q} type="button" className="h-12 rounded-md border bg-background px-3 text-sm" onClick={() => setRaw(String(q))}>{q} m²</button>)}
      </div>
      {raw.trim() !== "" && m2 == null && <p className="mt-1 text-sm text-danger">Enter an area between {CALC_MIN_M2} and {CALC_MAX_M2} m².</p>}
      <p className="mt-2 text-xs text-muted-foreground">{CALC_NOTE}</p>
      {est && <div className="mt-3 space-y-3"><div className="text-sm font-medium">{CALC_ASSUMPTION_LABEL}: {m2} m²</div><EstimateBody est={est} fees={fees} accessConcern={accessConcern} /></div>}
    </div>
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
      <div className="rounded-lg border border-dashed p-2"><div className="mb-1 text-xs font-bold uppercase text-muted-foreground">Customer-facing preview</div>{cust.visible ? <CustomerEstimate data={cust} adminPreview /> : <p className="text-sm text-muted-foreground">Nothing is shown to the customer.</p>}</div>
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
