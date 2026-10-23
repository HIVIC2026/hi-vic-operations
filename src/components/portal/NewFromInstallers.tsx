// Office "New from installers" (Jo 23 Oct 2026): jobs installers added this week, plus any installer job with
// something to sort out. Nothing to tick off — items drop off by themselves. Presentation only.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { getNewInstallerJobs } from "@/lib/installer-new-jobs.functions";
import { NEW_JOB_DAYS, type NewJobItem } from "@/lib/installer-new-jobs.core";
import { mittiAuditUrl } from "@/lib/installer-quote-approval.core";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

function JobLine({ item }: { item: NewJobItem }) {
  const url = mittiAuditUrl(item.mittiAuditId);
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 basis-full break-words text-sm font-medium sm:flex-1 sm:basis-auto">
          {[item.jobNumber, item.owner ?? "Owner", item.address ?? "Address missing", item.installer ?? "Installer"].join(" · ")}
        </span>
        <span className="text-xs text-muted-foreground">{item.how} · {item.ageDays === 0 ? "today" : `${item.ageDays}d ago`}</span>
        <Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: item.jobId }}>Open job<span className="sr-only"> {item.jobNumber}</span></Link></Button>
        {url && <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer">Mitti form<ExternalLink className="h-3 w-3" /><span className="sr-only"> {item.jobNumber}</span></a></Button>}
      </div>
      {item.warnings.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.warnings.map((w) => <li key={w} className="rounded bg-warning/15 px-1.5 py-0.5 text-xs text-foreground">{w}</li>)}
        </ul>
      )}
    </li>
  );
}

export function NewFromInstallers() {
  const load = useServerFn(getNewInstallerJobs);
  const [showTestJobs, setShowTestJobs] = useState(false);
  const q = useQuery({ queryKey: ["new-from-installers", showTestJobs], queryFn: () => load({ data: { showTestJobs } }), staleTime: 60_000 });
  const attention = q.data?.attention ?? [], fresh = q.data?.fresh ?? [];
  return (
    <section aria-label="New from installers" className="space-y-3 border-y py-4" data-new-from-installers>
      <h2 className="font-display text-lg font-bold">
        New from installers
        {attention.length > 0 && <span className="ml-1 rounded-full bg-warning px-2 py-0.5 text-sm text-warning-foreground">{attention.length}</span>}
      </h2>
      <label className="flex min-h-12 items-center gap-2 text-sm"><Switch checked={showTestJobs} onCheckedChange={setShowTestJobs} />Show practice jobs</label>
      {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading installer jobs…</p>
        : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message} <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button></p>
        : <>
          <div data-needs-attention>
            <h3 className="text-sm font-semibold">Needs sorting out ({attention.length})</h3>
            {!attention.length ? <p className="py-2 text-sm text-muted-foreground">Nothing to sort out.</p>
              : <ul className="divide-y">{attention.map((i) => <JobLine key={i.jobId} item={i} />)}</ul>}
          </div>
          {fresh.length > 0 && <div data-added-this-week>
            <h3 className="text-sm font-semibold">Added in the last {NEW_JOB_DAYS} days, all fine ({fresh.length})</h3>
            <ul className="divide-y">{fresh.map((i) => <JobLine key={i.jobId} item={i} />)}</ul>
          </div>}
        </>}
    </section>
  );
}
