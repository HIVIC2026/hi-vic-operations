import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dollars } from "@/lib/estimate.core";
import {
  UNPRICEABLE_COPY,
  measuredQuote, type AllowanceSnapshot, type Observations, type Reconciliation,
} from "@/lib/readycheck.core";
import { CUSTOMER_APPROVAL_REASSURANCE, CUSTOMER_MEASURED_QUOTE, CUSTOMER_PIESA_STAGE, CUSTOMER_QUOTE_LABELS, CUSTOMER_WHAT_COULD_CHANGE, discountAmount, measuredCustomerRows } from "@/lib/customer-quote-system";
import { CustomerStageHero } from "./estimate";

/** TEST-MODE sample observations (preview only). */
export const SAMPLE_OBSERVATIONS: Observations = {
  "elec.downlight_count": 8, "elec.downlight_type": "halogen", "elec.rcd_visible": "not_visible",
  "elec.switchboard_type": "modern_breakers", "elec.damaged_wiring_visible": "no", "elec.unusual_condition": true,
};

const rowCls = "grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-estimate-blue-soft py-4";

/** Customer measured estimate — same card hierarchy as the preliminary quote. Math from measuredQuote(); display order from measuredCustomerRows(). */
export function MeasuredQuoteView({ insulation, removal = 0, access = 0, allowance, piesa, ap, discount }: { insulation: number; removal?: number; access?: number; allowance: AllowanceSnapshot | null; piesa: number; ap: number; discount: number }) {
  const q = measuredQuote({ insulation, removal, access, allowance, piesa, ap, discount, readyCheckPaid: true });
  const rows = measuredCustomerRows({ piesa, installation: insulation, removal, access, allowance: allowance?.preliminary_electrical_allowance_total ?? 0, apManagement: ap });
  const M = CUSTOMER_MEASURED_QUOTE;
  return <div className="estimate-brand space-y-6 text-estimate-navy">
    <CustomerStageHero eyebrow={M.eyebrow} heading={M.heading} intro={M.subcopy} />
    <section className="estimate-quote-card px-5 py-7 sm:px-8" aria-label="Measured project estimate" data-testid="measured-quote-card">
      <dl className="text-sm">
        {rows.map((r) => <div key={r.key} className={rowCls}><dt className="min-w-0 font-semibold leading-relaxed">{r.label}{r.note && <span className="mt-1 block text-xs font-normal">{r.note}</span>}</dt><dd className="font-extrabold text-estimate-blue" data-testid={`measured-${r.key}`}>{dollars(r.amount)}</dd></div>)}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-4"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.projectTotal}</dt><dd className="font-extrabold text-estimate-blue" data-testid="measured-projectTotal">{dollars(q.gross)}</dd></div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-estimate-green/30 bg-estimate-green-soft px-4 py-4 text-estimate-green" data-testid="quote-discount-band"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.discount}</dt><dd className="text-2xl font-extrabold leading-none" data-testid="measured-discount">{discountAmount(discount)}</dd></div>
      </dl>
      <div className="mt-5" data-testid="quote-final-cost">
        <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-navy">{M.labels.finalCost}</p>
        <p className="mt-2 text-5xl font-extrabold leading-none text-estimate-blue" data-testid="measured-finalCost">{dollars(q.costAfter)}</p>
      </div>
      {q.unpriceable && <p className="estimate-secondary-card mt-5 text-sm font-bold">{UNPRICEABLE_COPY}</p>}
      <div className="mt-6 border-t border-estimate-blue-soft pt-5">
        <h2 className="text-sm font-extrabold text-estimate-blue">{M.stillChangeHeading}</h2>
        <ul className="mt-3 space-y-3 text-sm leading-relaxed">{M.stillChange.map((c) => <li key={c} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" /><span>{c}</span></li>)}</ul>
        <p className="mt-4 text-sm font-extrabold leading-relaxed" data-testid="approval-reassurance">{CUSTOMER_APPROVAL_REASSURANCE}</p>
        <p className="mt-3 text-xs font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
      </div>
    </section>
  </div>;
}

/** Customer PIESA stage. Never shows rate-card codes, reconciliation or admin wording. */
export function PiesaStageView({ complete, reconciliation, hadAllowance = true, onApprove }: { complete: boolean; reconciliation: Reconciliation | null; hadAllowance?: boolean; onApprove?: () => void }) {
  const S = CUSTOMER_PIESA_STAGE;
  const required = !!reconciliation && (reconciliation.actual_total > 0 || reconciliation.unmatched.length > 0);
  const r = reconciliation;
  return <div className="estimate-brand space-y-6 text-estimate-navy">
    <CustomerStageHero eyebrow="YOUR PROJECT" heading={S.heading} intro={complete ? S.after : S.before} />
    <section className="estimate-quote-card px-5 py-7 sm:px-8" data-testid="piesa-card">
      {!complete && <p className="text-sm leading-relaxed">{S.performedBy}</p>}
      {complete && !required && <><p className="text-xl font-extrabold text-estimate-blue">{S.noneHeading}</p><p className="mt-2 text-sm leading-relaxed">{S.noneCopy}</p></>}
      {complete && required && r && <>
        <p className="text-xl font-extrabold text-estimate-blue">{S.requiredHeading}</p>
        <dl className="mt-4 text-sm">
          {r.lines.map((l) => <div key={l.code} className={rowCls}><dt className="min-w-0 font-semibold">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</dt><dd className="font-extrabold text-estimate-blue">{dollars(l.amountIncGst)}</dd></div>)}
          {r.unmatched.map((u, i) => <div key={`u${i}`} className={rowCls}><dt className="min-w-0 font-semibold">{u.description ?? "Additional electrical work"}</dt><dd className="font-extrabold text-estimate-blue">Price to be confirmed</dd></div>)}
        </dl>
        {hadAllowance && <dl className="estimate-secondary-card mt-5 space-y-2 text-sm" data-testid="piesa-compare">
          <div className="flex justify-between gap-4"><dt>{S.compare.preliminary}</dt><dd className="font-bold">{dollars(r.preliminary_total)}</dd></div>
          <div className="flex justify-between gap-4"><dt>{S.compare.confirmed}</dt><dd className="font-bold">{dollars(r.actual_total)}</dd></div>
          <div className="flex justify-between gap-4 border-t border-estimate-blue-soft pt-2 font-extrabold"><dt>{S.compare.difference}</dt><dd className={r.variance < 0 ? "text-estimate-green" : "text-estimate-blue"}>{r.variance === 0 ? dollars(0) : `${r.variance > 0 ? "+" : "−"}${dollars(Math.abs(r.variance))}`}</dd></div>
        </dl>}
        <p className="mt-4 text-sm leading-relaxed">{r.requires_customer_approval ? S.higher : r.outcome === "lower" ? S.lower : S.same}</p>
        {r.requires_customer_approval && <Button type="button" size="field" className="estimate-action-button mt-5 h-auto min-h-14 w-full px-5 py-4 font-extrabold" disabled={!onApprove} onClick={onApprove}>{S.approveCta}</Button>}
      </>}
      <p className="mt-5 text-sm font-extrabold leading-relaxed" data-testid="approval-reassurance">{CUSTOMER_APPROVAL_REASSURANCE}</p>
      <p className="mt-3 text-xs font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
    </section>
  </div>;
}
