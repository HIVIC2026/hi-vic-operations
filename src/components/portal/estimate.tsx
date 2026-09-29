import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdminEstimate, getOwnerEstimate } from "@/lib/estimate.functions";
import { DISCLAIMER, MEASURE_REQUIRED, dollars, electricalNote, type Scenario } from "@/lib/estimate.core";
import { Pill } from "./badges";

export const HEADLINE = { likely: "Your home looks suitable to progress", onsite: "Your home may be eligible — onsite confirmation needed" } as const;

type CustomerData = {
  visible: boolean; mode?: "likely" | "onsite"; measureRequired?: boolean; onsiteDrivers?: string[]; rolloutHold?: boolean; accessConcern?: boolean;
  fees?: { piesa: number; ap: number; minCopay: number } | null;
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
        <dt>HI VIC AP management &amp; compliance</dt><dd className="text-right">{dollars(fees.ap)}</dd>
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
      {!data.estimate || !fees ? (
        <p className="mt-3 rounded bg-muted px-3 py-2 text-sm">{data.measureRequired ? MEASURE_REQUIRED : "Your estimate is being prepared."}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="text-sm"><span className="text-muted-foreground">Estimated ceiling area: </span><span className="font-semibold">{data.estimate.area.m2} m²</span> <span className="text-xs text-muted-foreground">({data.estimate.area.label} · final area confirmed onsite)</span></div>
          <div className={data.estimate.scenarios.length > 1 ? "grid gap-3 sm:grid-cols-2" : ""}>
            {data.estimate.scenarios.map((s) => <ScenarioCard key={s.key} s={s} fees={fees} single={data.estimate!.scenarios.length === 1} />)}
          </div>
          {data.estimate.scenarios.length > 1 && <p className="text-sm text-muted-foreground">The onsite assessment determines whether your existing insulation can stay. Suitable existing insulation may remain; unsuitable, metallic or non-compliant insulation must be removed.</p>}
          <p className={`rounded px-3 py-2 text-sm ${data.accessConcern ? "border border-warning bg-warning-soft font-medium" : "bg-muted"}`}>Access is confirmed onsite. Moderate access would add {dollars(data.estimate.access_adjustment.moderate)}; difficult access would add {dollars(data.estimate.access_adjustment.difficult)}.</p>
          <p className="text-sm">{electricalNote(fees.piesa)}</p>
          <p className="text-xs text-muted-foreground">{DISCLAIMER} VEEC market value fluctuates.</p>
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
          <div>× ${Number(s?.indicative_veec_value).toFixed(2)}/VEEC = raw {dollars(e.raw_estimated_discount)} · applied {dollars(e.applied_discount)} (<a className="underline" href={s?.veec_value_source_url} target="_blank" rel="noreferrer">source</a>, checked {s?.veec_value_checked_at})</div>
          <div>Insulation declared: {v.insulationDeclared ?? "not answered"} · scenarios: {e.scenarios.length}</div>
          <div>Access totals (primary): {(["standard", "moderate", "difficult"] as const).map((a) => `${a} ${dollars(e.primary.by_access[a].estimated_customer_total)}`).join(" · ")}</div>
        </div>
      )}
      <div className="rounded-lg border border-dashed p-2"><div className="mb-1 text-xs font-bold uppercase text-muted-foreground">Customer-facing preview</div>{cust.visible ? <CustomerEstimate data={cust} adminPreview /> : <p className="text-sm text-muted-foreground">Nothing is shown to the customer.</p>}</div>
      {e && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Exact calculation audit</summary><pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2">{JSON.stringify({ area: e.area, location: e.location, ghg: e.ghg, raw_estimated_discount: e.raw_estimated_discount, scenarios: e.scenarios, settings: s, history: v.history }, null, 2)}</pre></details>}
    </section>
  );
}
