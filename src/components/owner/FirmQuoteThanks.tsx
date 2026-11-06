import type React from "react";
import { Check } from "lucide-react";
import { formatDueDate } from "@/lib/firm-quote.core";
import { FIRM_PAGE_COPY } from "@/lib/firm-quote-page-copy.core";

/** Jo-approved (7 Nov 2026) thank-you shown after "Proceed to firm quote", and again whenever the owner reopens
 *  their estimate link once the request is recorded. Presentation only. */
export function FirmQuoteThanks({ firstName, dueBy }: { firstName: string | null; dueBy: string }) {
  return <div role="status" className="mt-8">
    <h1 className="text-center font-display text-[32px] font-extrabold leading-[1.15] sm:text-4xl">{FIRM_PAGE_COPY.thanks(firstName)}</h1>
    <ul className="mt-6 space-y-4 rounded-[22px] border border-estimate-line bg-estimate-white p-5 text-[15px] leading-relaxed sm:p-6">
      <Tick>{FIRM_PAGE_COPY.assessment}</Tick>
      <Tick>{FIRM_PAGE_COPY.emailBy} <strong>{formatDueDate(dueBy)}</strong>.</Tick>
      <Tick>{FIRM_PAGE_COPY.nothingLocked}</Tick>
    </ul>
    <p className="mt-6 text-center text-xs text-estimate-navy/70">{FIRM_PAGE_COPY.footer}</p>
  </div>;
}

function Tick({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-3">
    <Check aria-hidden className="mt-1 h-5 w-5 shrink-0 text-estimate-green" strokeWidth={3} />
    <span>{children}</span>
  </li>;
}
