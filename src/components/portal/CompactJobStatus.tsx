import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { operationsOptions } from "@/lib/operations-query";
import { fmtDate } from "@/lib/workflow";
import type { OperationRow } from "@/lib/operations-preview.core";
import type { PortalTarget } from "@/lib/portal-presentation.core";

export function JobStatusSummary({ row, loadedAt, onOpen }: { row: OperationRow; loadedAt: string; onOpen: (target: PortalTarget) => void }) {
  return <section aria-label="Current job status" className="mb-4 border-y border-line py-3">
    <div className="flex flex-wrap items-center gap-2 text-xs"><b className="text-hiv-blue">{row.bucket}</b><span>{row.process}</span><span className="text-sub">Recorded stage: {row.facts.stage}</span></div>
    <p className="mt-2 text-sm"><span className="text-sub">Eligibility · </span><b>{row.eligibilityLabel}</b></p>
    {row.savedSpot && <p className="mt-1 text-sm font-semibold text-hiv-green">{row.spotSavedOpen ? "Spot saved — waiting for onboarded installer capacity; review tasks take precedence" : "Spot saved — operational handoff or closed outcome now takes precedence"}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Current action</h2><Button size="sm" variant="outline" onClick={() => onOpen("correspondence")}>Communication records</Button></div>
    <ul className="mt-1 space-y-1 text-sm">{row.tasks.map((t,i) => <li key={i} className={t.blocked || t.overdue ? "text-rose" : "text-ink"}><b>{t.party}</b> · {t.label}{t.dueAt && <span className="ml-2 text-xs">{t.overdue ? "Overdue" : "Due"} {fmtDate(t.dueAt)}</span>}</li>)}</ul>
    {!row.tasks.length && <p className="text-sm text-sub">No outstanding task recorded.</p>}
    <p className="mt-2 text-xs text-sub">Latest recorded communication · {row.communicationLabel}{row.communication && ` · ${row.communication.purpose}`}</p>
    <p className="mt-1 text-xs text-sub">Status loaded {fmtDate(loadedAt)} · sending permissions are not connection-health proof.</p>
  </section>;
}

export function CompactJobStatus({ jobId, onOpen }: { jobId: string; onOpen: (target: PortalTarget) => void }) {
  const query = useQuery(operationsOptions);
  const row = query.data?.rows.find(r => r.id === jobId);
  if (query.error) return <div role="alert" className="my-3 text-sm text-rose">Current operational facts could not load. No status inferred. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry status read</Button></div>;
  if (!query.data) return <p role="status" className="my-3 text-sm text-sub">Loading current operational facts…</p>;
  if (!row) return <p role="status" className="my-3 text-sm text-sub">No classified live record available; TEST and other-business records are excluded. Use recorded facts and guarded controls below.</p>;
  return <>
    <JobStatusSummary row={row} loadedAt={query.data.loadedAt} onOpen={onOpen} />
    <details className="mb-3 text-xs text-sub"><summary className="cursor-pointer font-semibold">Automation permissions · health unverified</summary><ul className="mt-2 space-y-1">{query.data.controls.map(c => <li key={c.label}><b>{c.label} · {c.state}</b> — {c.detail}</li>)}</ul></details>
  </>;
}