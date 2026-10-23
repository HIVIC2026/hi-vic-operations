import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ExternalLink } from "lucide-react";
import { getInstallerQuotesToCheck } from "@/lib/installer-quote-review.functions";
import { WAITING_ON_INSTALLER, mittiAuditUrl, waitingStatus } from "@/lib/installer-quote-approval.core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InstallerQuoteDraftPanel } from "./installer-quote";
import { Switch } from "@/components/ui/switch";

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }));

function MittiButton({ id, jobNumber }: { id: string | null | undefined; jobNumber: string }) {
  const url = mittiAuditUrl(id);
  if (!url) return <Button variant="outline" size="sm" disabled>Mitti form</Button>;
  return <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer">Mitti form<ExternalLink className="h-3 w-3" /><span className="sr-only"> {jobNumber}</span></a></Button>;
}

export function QuotesToCheck() {
  const load = useServerFn(getInstallerQuotesToCheck);
  const [showTestJobs, setShowTestJobs] = useState(false);
  const q = useQuery({ queryKey: ["installer-quotes-to-check", showTestJobs], queryFn: () => load({ data: { showTestJobs } }), staleTime: 60_000 });
  type Row = NonNullable<typeof q.data>["rows"][number];
  const [selected, setSelected] = useState<Row | null>(null);
  const [popup, setPopup] = useState<{ title: string; items: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const ready = q.data?.rows ?? [], waiting = q.data?.waiting ?? [];
  const line = (r: Row) => [r.jobNumber, r.owner ?? "Owner", r.suburb ?? "Suburb missing", r.installer ?? "Installer"].join(" · ");
  return <section aria-label="Quotes to check" className="space-y-3 border-y py-4">
    <h2 className="font-display text-lg font-bold">Quotes to check</h2>
    <label className="flex min-h-12 items-center gap-2 text-sm"><Switch checked={showTestJobs} onCheckedChange={setShowTestJobs} />Show practice jobs</label>
    {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading quotes…</p> : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message} <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button></p> : <>
      <div data-ready-for-you>
        <h3 className="text-sm font-semibold">Ready for you ({ready.length})</h3>
        {!ready.length ? <p className="py-2 text-sm text-muted-foreground">Nothing ready yet.</p> : <ul className="divide-y">
          {ready.map(row => <li key={row.jobId} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{line(row)}</span>
            {row.reasons.length > 0 && <button type="button" className="rounded bg-destructive px-1.5 py-0.5 text-xs font-semibold text-destructive-foreground" onClick={() => setPopup({ title: `${row.jobNumber} · Held`, items: row.reasons })}>Held</button>}
            <span className="text-sm font-semibold tabular-nums">{money(row.total)}</span>
            <Button size="sm" onClick={() => setSelected(row)}>Check &amp; send<span className="sr-only"> {row.jobNumber}</span></Button>
            <MittiButton id={row.mittiAuditId} jobNumber={row.jobNumber} />
          </li>)}
        </ul>}
      </div>
      <div data-waiting-on-installer>
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between py-2 text-sm font-semibold text-muted-foreground">
          Waiting on installer ({waiting.length})<ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && <ul className="divide-y">{waiting.map(row => {
          const missing = row.reasons.filter(r => r !== WAITING_ON_INSTALLER);
          return <li key={row.jobId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{line(row)}</span>
            <span className="text-xs text-muted-foreground">{waitingStatus(row.reasons)}</span>
            <Button variant="ghost" size="sm" disabled={!missing.length} onClick={() => setPopup({ title: `${row.jobNumber} · What's missing`, items: missing })}>What's missing</Button>
            <MittiButton id={row.mittiAuditId} jobNumber={row.jobNumber} />
          </li>;
        })}</ul>}
      </div>
    </>}
    <Dialog open={!!popup} onOpenChange={o => { if (!o) setPopup(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg">
        <DialogHeader><DialogTitle>{popup?.title}</DialogTitle><DialogDescription className="sr-only">Reasons</DialogDescription></DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">{popup?.items.map(i => <li key={i}>{i}</li>)}</ul>
      </DialogContent>
    </Dialog>
    <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>{selected?.jobNumber} · Draft quote</DialogTitle><DialogDescription>{selected?.owner} · {selected?.address} · {selected?.installer}</DialogDescription></DialogHeader>
        {selected && <InstallerQuoteDraftPanel jobId={selected.jobId} />}
      </DialogContent>
    </Dialog>
  </section>;
}
