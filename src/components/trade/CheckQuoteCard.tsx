import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { approveMyQuote, getMyQuoteToCheck } from "@/lib/installer-quote-approval.functions";
import { btnClass } from "@/components/portal/kit";
import { Button } from "@/components/ui/button";

const aud = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** Jo 23 Oct: installer checks the whole owner quote, then approves it for the office. Never sends to the owner. */
export function CheckQuoteCard({ jobId, hideStatus = false }: { jobId: string; hideStatus?: boolean }) {
  const load = useServerFn(getMyQuoteToCheck);
  const approve = useServerFn(approveMyQuote);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-quote-to-check", jobId], queryFn: () => load({ data: { jobId } }) });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  if (!d || !d.applies) return null;
  return (
    <section data-check-quote className="rounded-[14px] border border-line bg-paper p-4">
      {!hideStatus && <p className="text-sm font-semibold text-estimate-navy">{d.line}</p>}
      <Button className={btnClass("primary", "h-12 w-full")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>Check quote</Button>
      {open && <div className="mt-3 space-y-2">
        <p className="text-xs text-sub">This is exactly what the owner will see. All prices include GST.</p>
        <ul className="divide-y divide-line">{d.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0"><span className="block font-semibold">{l.description}</span>{l.explanation && <span className="block text-sub">{l.explanation}</span>}</span><span className="shrink-0 tabular-nums">{aud(l.total)}</span></li>
        ))}</ul>
        <p className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{aud(d.subtotal)}</span></p>
        <p className="flex justify-between text-sm"><span>VEU rebate</span><span className="tabular-nums">−{aud(d.rebate)}</span></p>
        <p className="flex justify-between font-bold"><span>Owner pays</span><span className="tabular-nums">{aud(d.total)}</span></p>
        {d.blockers.length > 0 && <ul data-quote-blockers className="space-y-1 text-sm font-semibold text-destructive">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        {!d.sent && d.state !== "approved" && <Button className={btnClass("primary", "h-12 w-full")} disabled={!d.canApprove || busy}
          onClick={async () => { setBusy(true); setErr(null); try { await approve({ data: { jobId, quoteId: d.quoteId } }); await Promise.all([qc.invalidateQueries({ queryKey: ["my-quote-to-check", jobId] }), qc.invalidateQueries({ queryKey: ["mitti-job-presentation", jobId] }), qc.invalidateQueries({ queryKey: ["trade-home"] })]); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{d.buttonLabel}</Button>}
        {d.state === "approved" && !d.sent && <p className="text-sm text-sub">You approved this quote. The office will check it and send it to the owner.</p>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </div>}
    </section>
  );
}
