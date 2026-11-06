import type React from "react";
import { Check } from "lucide-react";
import { formatDueDate } from "@/lib/firm-quote.core";
import { FIRM_PAGE_COPY, firmEstimateBox } from "@/lib/firm-quote-page-copy.core";

type Estimate = { rebate: number; price: number; fullPrice: number; areaM2: number };

/** Jo-approved (7 Nov 2026) thank-you shown after "Proceed to firm quote", and again whenever the owner reopens
 *  their estimate link once the request is recorded. The estimate link also shows email 1's rebate box (Jo 7 Nov, 3a).
 *  Presentation only. */
export function FirmQuoteThanks({ firstName, dueBy, estimate }: { firstName: string | null; dueBy: string; estimate?: Estimate | null }) {
  return <div role="status" className="mt-8">
    <h1 className="text-center font-display text-[32px] font-extrabold leading-[1.15] sm:text-4xl">{FIRM_PAGE_COPY.thanks(firstName)}</h1>
    <ul className="mt-6 space-y-4 rounded-[22px] border border-estimate-line bg-estimate-white p-5 text-[15px] leading-relaxed sm:p-6">
      <Tick>{FIRM_PAGE_COPY.assessment}</Tick>
      <Tick>{FIRM_PAGE_COPY.emailBy} <strong>{formatDueDate(dueBy)}</strong>.</Tick>
      <Tick>{FIRM_PAGE_COPY.nothingLocked}</Tick>
    </ul>
    {estimate && <FirmEstimateBox {...estimate} />}
    <p className="mt-6 text-center text-xs text-estimate-navy/70">{FIRM_PAGE_COPY.footer}</p>
  </div>;
}

/** Same look as the estimate page's existing rebate box and big price. */
function FirmEstimateBox(e: Estimate) {
  const b = firmEstimateBox(e);
  return <section data-firm-estimate className="mt-6 rounded-[22px] bg-estimate-mist p-5">
    <div className="rounded-[18px] border-2 border-estimate-green bg-estimate-mint px-3 py-[18px] text-center">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">{b.rebateLabel}</p>
      <p className="mt-1 font-display text-[38px] font-extrabold leading-[42px] text-estimate-green">{b.rebate}</p>
    </div>
    <div className="pb-1 pt-[18px] text-center">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">{b.priceLabel}</p>
      <p className="mt-1 font-display text-[46px] font-extrabold leading-[50px] text-estimate-blue">{b.price}</p>
      <p className="mt-1 text-xs font-bold">{b.fullPrice}</p>
      <p className="mt-2 text-xs">{b.basis}</p>
    </div>
  </section>;
}

function Tick({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-3">
    <Check aria-hidden className="mt-1 h-5 w-5 shrink-0 text-estimate-green" strokeWidth={3} />
    <span>{children}</span>
  </li>;
}
