import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallerQuotesToCheck } from "@/lib/installer-quote-review.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InstallerQuoteDraftPanel } from "./installer-quote";

export function QuotesToCheck() {
  const load = useServerFn(getInstallerQuotesToCheck);
  const q = useQuery({ queryKey: ["installer-quotes-to-check"], queryFn: () => load(), staleTime: 60_000 });
  const [selected, setSelected] = useState<NonNullable<typeof q.data>["rows"][number] | null>(null);
  return <section aria-label="Quotes to check" className="space-y-3 border-y py-4">
    <h2 className="font-display text-lg font-bold">Quotes to check {q.data ? `(${q.data.rows.length})` : ""}</h2>
    {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading quotes…</p> : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message} <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button></p> : !q.data?.rows.length ? <p className="text-sm text-muted-foreground">No quotes to check.</p> : <ul className="divide-y">
      {q.data.rows.map(row => <li key={row.jobId} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 break-words"><p className="font-semibold">{row.jobNumber} · {row.owner ?? "Owner"}</p><p className="text-sm">{row.address ?? "Address missing"}</p><p className="text-sm text-muted-foreground">{row.installer ?? "Installer not assigned"}</p></div>
          <span className="shrink-0 font-semibold tabular-nums">{row.total == null ? "—" : row.total.toLocaleString("en-AU", { style: "currency", currency: "AUD" })}</span>
          <Button variant="outline" size="sm" onClick={() => setSelected(row)}>{row.quoteId ? "Open quote" : "See what's missing"}<span className="sr-only"> {row.jobNumber}</span></Button>
        </div>
        {row.reasons.length > 0 && <ul className="mt-2 text-sm text-destructive">{row.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
        {row.notes.length > 0 && <ul className="mt-1 text-sm text-muted-foreground">{row.notes.map(n => <li key={n}>{n}</li>)}</ul>}
      </li>)}
    </ul>}
    {(q.data?.waiting?.length ?? 0) > 0 && <div data-waiting-on-installer className="opacity-60">
      <h3 className="pt-2 text-sm font-semibold text-muted-foreground">Waiting on installer ({q.data!.waiting.length})</h3>
      <ul className="divide-y">{q.data!.waiting.map(row => <li key={row.jobId} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        <span className="min-w-0 flex-1">{row.jobNumber} · {row.owner ?? "Owner"} · {row.installer ?? "Installer"}</span>
        <span className="tabular-nums">{row.total == null ? "—" : row.total.toLocaleString("en-AU", { style: "currency", currency: "AUD" })}</span>
        <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>View<span className="sr-only"> {row.jobNumber}</span></Button>
      </li>)}</ul>
    </div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>{selected?.jobNumber} · Draft quote</DialogTitle><DialogDescription>{selected?.owner} · {selected?.address} · {selected?.installer}</DialogDescription></DialogHeader>
        {selected && <InstallerQuoteDraftPanel jobId={selected.jobId} />}
      </DialogContent>
    </Dialog>
  </section>;
}