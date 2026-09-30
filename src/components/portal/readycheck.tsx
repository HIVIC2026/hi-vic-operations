import { dollars } from "@/lib/estimate.core";
import {
  ALLOWANCE_COPY, ELECTRICAL_OBSERVATION_DISCLAIMER, TEST_REC_RATE_CARD, UNPRICEABLE_COPY,
  computeElectricalAllowance, measuredQuote, reconcilePiesa, type AllowanceSnapshot, type Observations,
} from "@/lib/readycheck.core";

/** TEST-MODE sample observations (preview only). */
export const SAMPLE_OBSERVATIONS: Observations = {
  "elec.downlight_count": 8, "elec.downlight_type": "halogen", "elec.rcd_visible": "not_visible",
  "elec.switchboard_type": "modern_breakers", "elec.damaged_wiring_visible": "no", "elec.unusual_condition": true,
};

export function MeasuredQuoteView({ insulation, removal = 0, access = 0, allowance, piesa, ap, discount }: { insulation: number; removal?: number; access?: number; allowance: AllowanceSnapshot | null; piesa: number; ap: number; discount: number }) {
  const q = measuredQuote({ insulation, removal, access, allowance, piesa, ap, discount, readyCheckPaid: true });
  return <section className="estimate-brand estimate-quote-card px-5 py-7 text-estimate-navy sm:px-8" aria-label="Measured project estimate">
    <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green">Your measured project estimate</p>
    <dl className="mt-4 text-sm">
      {q.rows.map((r) => <div key={r.key}>
        <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-estimate-blue-soft py-3 ${r.kind === "line" ? "" : "font-extrabold"} ${r.kind === "discount" || r.kind === "credit" ? "text-estimate-green" : ""}`}>
          <dt className="min-w-0">{r.label}</dt>
          <dd data-testid={`measured-${r.key}`}>{r.kind === "discount" || r.kind === "credit" ? "−" : ""}{dollars(r.amount)}</dd>
        </div>
        {r.key === "allowance" && allowance && <details className="estimate-secondary-card my-3 text-xs"><summary className="cursor-pointer font-bold text-estimate-blue">View itemised allowance</summary><ul className="mt-2 space-y-1">{allowance.lines.map((l) => <li key={l.code} className="flex justify-between gap-3"><span>{l.description} × {l.quantity}</span><strong>{dollars(l.amountIncGst)}</strong></li>)}</ul><p className="mt-3 leading-relaxed">{ALLOWANCE_COPY}</p></details>}
      </div>)}
    </dl>
    {q.unpriceable && <p className="estimate-secondary-card mt-4 text-sm font-bold">{UNPRICEABLE_COPY}</p>}
    <p className="mt-4 text-xs font-bold">All prices incl GST.</p>
  </section>;
}

export function MeasuredQuoteSample({ insulation, piesa, ap, discount, existingInsulation }: { insulation: number; piesa: number; ap: number; discount: number; existingInsulation: boolean }) {
  const allowance = computeElectricalAllowance(SAMPLE_OBSERVATIONS, TEST_REC_RATE_CARD, 1);
  const cases = [
    { label: "Same scope", items: [{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }] },
    { label: "Lower scope", items: [{ code: "DL_HALOGEN_REPLACE", quantity: 6 }] },
    { label: "Higher scope", items: [{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }, { code: "SWB_CERAMIC", quantity: 1 }] },
  ];
  return <div className="space-y-5">
    <p className="bg-warning-soft px-4 py-3 text-xs font-extrabold uppercase text-warning-foreground">Test mode · sample rate card fixtures only — not agreed live REC rates</p>
    <MeasuredQuoteView insulation={insulation} removal={existingInsulation ? 2250 : 0} allowance={allowance} piesa={piesa} ap={ap} discount={discount} />
    <section className="estimate-secondary-card text-sm" aria-label="Ready Check observations">
      <p className="text-xs font-extrabold uppercase text-estimate-blue">Ready Check electrical observations (internal)</p>
      <p className="mt-2 font-bold">{ELECTRICAL_OBSERVATION_DISCLAIMER}</p>
    </section>
    <section className="estimate-secondary-card text-sm" aria-label="PIESA reconciliation">
      <p className="text-xs font-extrabold uppercase text-estimate-blue">PIESA reconciliation sample (admin · test mode)</p>
      <ul className="mt-3 space-y-2">{cases.map((c) => { const r = reconcilePiesa(c.items, TEST_REC_RATE_CARD, allowance); return <li key={c.label} className="flex flex-wrap justify-between gap-2" data-testid={`recon-${r.outcome}`}><span className="font-bold">{c.label}</span><span>Allowance {dollars(r.preliminary_total)} → actual {dollars(r.actual_total)} · variance {r.variance >= 0 ? "+" : "−"}{dollars(Math.abs(r.variance))} · {r.outcome === "higher" ? "customer approval required" : r.outcome === "lower" ? "amount reduced" : "proceed"}</span></li>; })}</ul>
    </section>
  </div>;
}
