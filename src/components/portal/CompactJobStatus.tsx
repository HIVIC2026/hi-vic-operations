import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { operationsJobOptions } from "@/lib/operations-query";
import { fmtDate } from "@/lib/workflow";
import type { OperationRow } from "@/lib/operations-preview.core";
import type { PortalTarget } from "@/lib/portal-presentation.core";
import { getJobBlockers } from "@/lib/portal.functions";
import { BlockersContent } from "./panels";
import { processWords, partyWords, stageWording } from "@/lib/job-wording";
import { communicationPurposeLabel, latestConfirmedSend, taskTags } from "@/lib/portal-presentation.core";

export function CurrentJobBlockers({ jobId }: { jobId: string }) {
  const query = useQuery({ queryKey: ["blockers", jobId], queryFn: () => getJobBlockers({ data: { jobId } }) });
  if (query.error) return <p role="alert" className="my-2 text-sm text-rose">Current blockers could not load — progression is unverified. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry blockers</Button></p>;
  if (!query.data) return <p role="status" className="my-2 text-sm text-sub">Loading current blockers…</p>;
  return <BlockersContent data={query.data} />;
}

export function JobStatusSummary({ row, loadedAt, onOpen }: { row: OperationRow; loadedAt: string; onOpen: (target: PortalTarget) => void }) {
  const target: PortalTarget = row.process === "Quote & payment" ? "quotes" : row.process === "Electrical safety & fixes" ? "piesa" : row.process === "Installation" ? "installation" : row.process === "Evidence & AP review" ? "ap-evidence" : row.process === "VEEC lodgement" ? "veec" : row.process === "Ready Check" ? "ready-check" : "intake-consent";
  const sent = latestConfirmedSend(row.communications);
  return <section aria-label="Current job status" className="mb-4 border-y border-line py-3">
    <div className="flex flex-wrap items-center gap-2 text-xs"><b className="text-hiv-blue">{row.bucket}</b><span>{processWords(row.process)}</span></div>
    <p className="mt-2 text-sm"><span className="text-sub">Eligibility · </span><b>{row.eligibilityLabel}</b></p>
    {row.savedSpot && <p className="mt-1 text-sm font-semibold text-hiv-green">{stageWording("ready_check_ready_to_schedule").tag}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Current action</h2><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onOpen(target)}>Open current records</Button><Button size="sm" variant="outline" onClick={() => onOpen("correspondence")}>Communication records</Button></div></div>
    <ul className="mt-1 space-y-1 text-sm">{row.tasks.map((t,i) => <li key={i} className={t.blocked || t.overdue ? "text-rose" : "text-ink"}><b>{partyWords(t.party)}</b> · {t.label}{taskTags(t, fmtDate).map((g) => <span key={g.text} className="ml-2 text-xs font-semibold">{g.text}</span>)}</li>)}</ul>
    {!row.tasks.length && <p className="text-sm text-sub">No outstanding task recorded.</p>}
    <p className="mt-2 text-xs text-sub">Last email or text sent · {sent ? `${communicationPurposeLabel(sent)} · ${fmtDate(sent.at!)}` : "None confirmed"}</p>
    <p className="mt-1 text-xs text-sub">Status loaded {fmtDate(loadedAt)}</p>
  </section>;
}

export function CompactJobStatus({ jobId, onOpen }: { jobId: string; onOpen: (target: PortalTarget) => void }) {
  const query = useQuery(operationsJobOptions(jobId));
  const row = query.data?.rows.find(r => r.id === jobId);
  if (query.error) return <div role="alert" className="my-3 text-sm text-rose">Current operational facts could not load. No status inferred. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry status read</Button></div>;
  if (!query.data) return <p role="status" className="my-3 text-sm text-sub">Loading current operational facts…</p>;
  if (!row) return <p role="status" className="my-3 text-sm text-sub">No classified live record available; TEST and other-business records are excluded. Use recorded facts and guarded controls below.</p>;
  return <>
    <JobStatusSummary row={row} loadedAt={query.data.loadedAt} onOpen={onOpen} />
    <details className="mb-3 text-xs text-sub"><summary className="cursor-pointer font-semibold">Automatic sending settings</summary><ul className="mt-2 space-y-1">{query.data.controls.map(c => <li key={c.label}><b>{c.label} · {c.state}</b> — {c.detail}</li>)}</ul></details>
  </>;
}