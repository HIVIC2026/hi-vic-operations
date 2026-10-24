import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyOwnerQuote } from "@/lib/installer-quote-status.functions";
import { btnClass } from "@/components/portal/kit";
import { Button } from "@/components/ui/button";

const aud = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** Installer sees the whole owner quote and its status. Jo 24 Oct 2026: no approval step for installer jobs (A1) or
 *  our leads (A2) — the installer presses Complete in Mitti and the office sends the quote. Read-only. */
export function OwnerQuoteCard({ jobId, hideStatus = false }: { jobId: string; hideStatus?: boolean }) {
  const load = useServerFn(getMyOwnerQuote);
  const q = useQuery({ queryKey: ["my-owner-quote", jobId], queryFn: () => load({ data: { jobId } }) });
  const [open, setOpen] = useState(false);
  const d = q.data;
  if (!d || !d.applies) return null;
  return (
    <section data-owner-quote className="rounded-[14px] border border-line bg-paper p-4">
      {!hideStatus && <p className="text-sm font-semibold text-estimate-navy">{d.line}</p>}
      <Button className={btnClass("primary", "h-12 w-full")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>See the owner's quote</Button>
      {open && <div className="mt-3 space-y-2">
        <p className="text-xs text-sub">This is exactly what the owner will see. All prices include GST.</p>
        <ul className="divide-y divide-line">{d.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0"><span className="block font-semibold">{l.description}</span>{l.explanation && <span className="block text-sub">{l.explanation}</span>}</span><span className="shrink-0 tabular-nums">{aud(l.total)}</span></li>
        ))}</ul>
        <p className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{aud(d.subtotal)}</span></p>
        <p className="flex justify-between text-sm"><span>VEU rebate</span><span className="tabular-nums">−{aud(d.rebate)}</span></p>
        <p className="flex justify-between font-bold"><span>Owner pays</span><span className="tabular-nums">{aud(d.total)}</span></p>
        {d.blockers.length > 0 && <ul data-quote-blockers className="space-y-1 text-sm font-semibold text-destructive">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        {!d.sent && <p className="text-sm text-sub">{d.held || d.formCompleted ? "The office is checking the quote and will send it to the owner." : "When your Ready Check is finished, press Complete in Mitti. The office checks the quote and sends it to the owner."}</p>}
      </div>}
    </section>
  );
}
