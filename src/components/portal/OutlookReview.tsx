// Office: Outlook sync status + "Unmatched correspondence" and "Not proceeding?" review queues. Never sends.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-me";
import { getOutlookCorrespondenceOverview, resolveCorrespondenceReview, runOutlookSyncNow } from "@/lib/outlook-correspondence.functions";

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const KIND_LABEL = { unmatched: "Unmatched — which job?", possible_not_proceeding: "May not be proceeding", not_proceeding_progressed: "Not proceeding — job already progressed" } as const;

export function OutlookReview() {
  const load = useServerFn(getOutlookCorrespondenceOverview);
  const { data, isPending, isError, error } = useQuery({ queryKey: ["outlook-correspondence"], queryFn: () => load() });
  const resolve = useAction(resolveCorrespondenceReview);
  const runNow = useAction(runOutlookSyncNow);
  const [busy, setBusy] = useState(false);
  if (isPending) return <p role="status" className="text-sm">Loading Outlook correspondence…</p>;
  if (isError) return <p role="alert" className="text-sm text-danger">Could not load: {(error as Error).message}</p>;
  const s = data.state;
  const counts = (s?.last_counts ?? {}) as Record<string, number>;
  const unmatched = data.reviews.filter((r) => r.kind === "unmatched");
  const intent = data.reviews.filter((r) => r.kind !== "unmatched");
  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-card p-4 text-sm">
        <h2 className="font-display text-lg font-bold">Outlook sync</h2>
        {!data.connected ? (
          <p className="mt-1 font-semibold text-danger">Outlook is not connected yet — no emails are being copied onto jobs.</p>
        ) : (
          <p className="mt-1">Mailbox <b>{s?.mailbox ?? "—"}</b> · last run {fmt(s?.last_run_at)} · last success {fmt(s?.last_ok_at)}</p>
        )}
        {s?.last_error && <p className="mt-1 text-danger">Last problem: {s.last_error}</p>}
        <p className="mt-1 text-sub">Copies homeowner emails (in and out) from {fmt(s?.backfill_from)} onto each job, every 10 minutes. It never sends anything.
          {Object.keys(counts).length > 0 && <> Last pass: {counts["stored"] ?? 0} saved, {counts["unmatched"] ?? 0} to match, {counts["closed"] ?? 0} closed, {counts["flagged"] ?? 0} to check.</>}</p>
        <Button className="mt-2" size="sm" variant="outline" disabled={busy || !data.connected} onClick={async () => { setBusy(true); await runNow({}, "Sync pass finished"); setBusy(false); }}>{busy ? "Syncing…" : "Sync now"}</Button>
      </section>

      <ReviewList title={`Unmatched correspondence (${unmatched.length})`} empty="No emails waiting to be matched." items={unmatched} resolve={resolve} />
      <ReviewList title={`Not proceeding? (${intent.length})`} empty="Nothing to check." items={intent} resolve={resolve} />
    </div>
  );
}

type Review = Awaited<ReturnType<typeof getOutlookCorrespondenceOverview>>["reviews"][number];
function ReviewList({ title, empty, items, resolve }: { title: string; empty: string; items: Review[]; resolve: ReturnType<typeof useAction<{ reviewId: string; action: "assign" | "dismiss" | "close_job"; jobNumber?: string; reason?: string }, { ok: boolean }>> }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-bold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-sub">{empty}</p> : (
        <ul className="space-y-2">{items.map((r) => <ReviewItem key={r.id} r={r} resolve={resolve} />)}</ul>
      )}
    </section>
  );
}

function ReviewItem({ r, resolve }: { r: Review; resolve: Parameters<typeof ReviewList>[0]["resolve"] }) {
  const [num, setNum] = useState(r.candidates[0]?.jobNumber ?? "");
  const [reason, setReason] = useState(r.suggestedReason ?? "Customer not proceeding");
  return (
    <li className="rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
        <span className="rounded bg-workspace-sun px-1.5 py-0.5 font-semibold text-foreground">{KIND_LABEL[r.kind]}</span>
        <span>{r.direction === "inbound" ? `From ${r.from ?? "unknown"}` : `To ${r.recipients.join(", ")}`}</span>
        <span>{fmt(r.at)}</span>
        {r.jobNumber && <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId! }} className="font-semibold text-primary underline">{r.jobNumber}</Link>}
      </div>
      <p className="mt-1 text-xs">{r.reason}</p>
      {r.subject && <div className="mt-1 font-medium">{r.subject}</div>}
      <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sub">{r.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {r.kind === "unmatched" ? (<>
          {r.candidates.length > 0 && <span className="text-xs">Possible: {r.candidates.map((c) => c.jobNumber).join(", ")}</span>}
          <Input aria-label="Job number" className="h-9 w-32" placeholder="HV-1234" value={num} onChange={(e) => setNum(e.target.value)} />
          <Button size="sm" onClick={() => void resolve({ reviewId: r.id, action: "assign", jobNumber: num }, "Email added to the job")}>Add to job</Button>
        </>) : (<>
          <Input aria-label="Closure reason" className="h-9 w-80" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="destructive" onClick={() => { if (window.confirm(`Close ${r.jobNumber ?? "this job"} with reason “${reason}”? Nothing is deleted.`)) void resolve({ reviewId: r.id, action: "close_job", reason }, "Job closed"); }}>Close job</Button>
        </>)}
        <Button size="sm" variant="ghost" onClick={() => void resolve({ reviewId: r.id, action: "dismiss" }, "Dismissed")}>{r.kind === "unmatched" ? "Not a customer email" : "Keep open — dismiss"}</Button>
      </div>
    </li>
  );
}
