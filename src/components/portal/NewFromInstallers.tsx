// Office "New from installers" (Jo 23 Oct 2026): every job an installer brings in, until the office marks it
// seen, plus Ready Checks not started after 14 days. Presentation only — "Mark seen" records an acknowledgement.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { getNewInstallerJobs, markInstallerJobsSeen } from "@/lib/installer-new-jobs.functions";
import { NOT_STARTED_REMINDER_DAYS, type NewJobItem } from "@/lib/installer-new-jobs.core";
import { mittiAuditUrl } from "@/lib/installer-quote-approval.core";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const KEY = "new-from-installers";

function JobLine({ item, onSeen, busy }: { item: NewJobItem; onSeen?: () => void; busy?: boolean }) {
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
        {onSeen && <Button variant="outline" size="sm" disabled={busy} onClick={onSeen}>Mark seen<span className="sr-only"> {item.jobNumber}</span></Button>}
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
  const mark = useServerFn(markInstallerJobsSeen);
  const qc = useQueryClient();
  const [showTestJobs, setShowTestJobs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const q = useQuery({ queryKey: [KEY, showTestJobs], queryFn: () => load({ data: { showTestJobs } }), staleTime: 60_000 });
  const fresh = q.data?.fresh ?? [], stale = q.data?.stale ?? [];
  const seen = async (ids: string[], tag: string) => {
    setBusy(tag); setProblem(null);
    try { await mark({ data: { jobIds: ids } }); await qc.invalidateQueries({ queryKey: [KEY] }); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not mark as seen."); }
    finally { setBusy(null); }
  };
  return (
    <section aria-label="New from installers" className="space-y-3 border-y py-4" data-new-from-installers>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">
          New from installers
          {fresh.length > 0 && <span className="ml-1 rounded-full bg-warning px-2 py-0.5 text-sm text-warning-foreground">{fresh.length}</span>}
        </h2>
        {fresh.length > 1 && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => seen(fresh.slice(0, 200).map((i) => i.jobId), "all")}>{busy === "all" ? "Marking…" : `Mark all ${fresh.length} seen`}</Button>}
      </div>
      <p className="text-sm text-sub">Jobs installers have added. Nothing is sent to anyone — marking a job seen only records that the office has looked.</p>
      <label className="flex min-h-12 items-center gap-2 text-sm"><Switch checked={showTestJobs} onCheckedChange={setShowTestJobs} />Show practice jobs</label>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading installer jobs…</p>
        : q.error ? <p role="alert" className="text-sm text-destructive">{q.error.message} <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button></p>
        : <>
          {!fresh.length ? <p className="py-2 text-sm text-muted-foreground">No new installer jobs.</p>
            : <ul className="divide-y">{fresh.map((i) => <JobLine key={i.jobId} item={i} busy={busy !== null} onSeen={() => seen([i.jobId], i.jobId)} />)}</ul>}
          {stale.length > 0 && <div data-not-started>
            <h3 className="text-sm font-semibold">Ready Check not started after {NOT_STARTED_REMINDER_DAYS} days ({stale.length})</h3>
            <ul className="divide-y">{stale.map((i) => <JobLine key={i.jobId} item={i} />)}</ul>
          </div>}
        </>}
    </section>
  );
}
