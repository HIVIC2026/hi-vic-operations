// Office: Outlook sync status + "Unmatched correspondence" and "Not proceeding?" review queues. Never sends.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-me";
import { checkOutlookConnectionHealth, confirmOutlookSyncMailbox, getOutlookCorrespondenceOverview, resolveCorrespondenceReview, runOutlookSyncNow, setOutlookCatchup } from "@/lib/outlook-correspondence.functions";
import { normaliseMailbox, type OutlookHealth } from "@/lib/outlook-connection.core";

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const CONNECTION_LABEL = {
  not_configured: "Outlook credentials are not configured",
  configured_not_checked: "Configured — mailbox access has not been checked",
  account_connected: "Account connected — shared mailbox setup is incomplete",
  connected: "Shared mailbox access verified",
  failed: "Outlook access check failed",
} as const;
const KIND_LABEL = { unmatched: "Unmatched — which job?", possible_not_proceeding: "May not be proceeding", not_proceeding_progressed: "Not proceeding — job already progressed" } as const;

export function OutlookReview() {
  const load = useServerFn(getOutlookCorrespondenceOverview);
  const { data, isPending, isError, error } = useQuery({ queryKey: ["outlook-correspondence"], queryFn: () => load() });
  const queryClient = useQueryClient();
  const resolve = useAction(resolveCorrespondenceReview);
  const check = useServerFn(checkOutlookConnectionHealth);
  const confirm = useServerFn(confirmOutlookSyncMailbox);
  const runNow = useServerFn(runOutlookSyncNow);
  const setCatchup = useServerFn(setOutlookCatchup);
  const [checked, setChecked] = useState<OutlookHealth | null>(null);
  const [mailboxInput, setMailboxInput] = useState<string | null>(null);
  const [catchupDate, setCatchupDate] = useState("");
  const [busy, setBusy] = useState<"check" | "confirm" | "sync" | "catchup" | null>(null);
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const perform = async (action: "check" | "confirm" | "sync" | "catchup", task: () => Promise<void>) => {
    setBusy(action); setActionProblem(null); setNotice(null);
    try { await task(); }
    catch (e) { setActionProblem(e instanceof Error ? e.message : "The Outlook action failed."); }
    finally { setBusy(null); }
  };
  if (isPending) return <p role="status" className="text-sm">Loading Outlook correspondence…</p>;
  if (isError) return <p role="alert" className="text-sm text-danger">Could not load: {(error as Error).message}</p>;
  const s = data.state;
  const connection = checked && checked.expectedMailbox === (s.expected_mailbox ?? null) ? checked : data.connection;
  const mailbox = mailboxInput ?? s.expected_mailbox ?? "";
  const target = normaliseMailbox(mailbox);
  const counts = (s?.last_counts ?? {}) as Record<string, number>;
  const unmatched = data.reviews.filter((r) => r.kind === "unmatched");
  const intent = data.reviews.filter((r) => r.kind !== "unmatched");
  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-card p-4 text-sm">
        <h2 className="font-display text-lg font-bold">Outlook sync</h2>
        <p className="mt-1 font-semibold">{CONNECTION_LABEL[connection.status]}</p>
        {!connection.configured && <p className="mt-1">Connect Microsoft Outlook in this project's connector settings, then check access here.</p>}
        <p className="mt-1">Authenticated account: <b>{connection.authenticatedAccount?.email ?? "Not checked"}</b></p>
        <p className="mt-1">Selected shared mailbox: <b>{s.expected_mailbox ?? "Not selected"}</b>{connection.checkedAt && <> · checked {fmt(connection.checkedAt)}</>}</p>
        <label className="mt-3 block font-medium" htmlFor="outlook-shared-mailbox">Shared business mailbox address</label>
        <Input id="outlook-shared-mailbox" type="email" className="mt-1 max-w-md" value={mailbox}
          readOnly={!!s.expected_mailbox} onChange={(e) => { setMailboxInput(e.target.value); setChecked(null); }} />
        {!s.expected_mailbox && <p className="mt-1 text-sub">Enter the intended shared mailbox address. The authenticated person's own mailbox can be different. Checking access does not save the address or import emails; confirming it enables scheduled imports.</p>}
        {connection.mailboxReadable && <p className="mt-1">Inbox and Sent Items read access verified for <b>{connection.targetMailbox}</b>.</p>}
        {connection.problem && <p className="mt-1 text-danger">{connection.problem}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy || !connection.configured || (!!mailbox.trim() && !target)}
            onClick={() => void perform("check", async () => { setChecked(await check({ data: target ? { mailbox: target } : {} })); })}>
            {busy === "check" ? "Checking…" : "Check access (read only)"}
          </Button>
          {!s.expected_mailbox && <Button size="sm" disabled={!!busy || !target || !connection.mailboxReadable || connection.targetMailbox !== target}
            onClick={() => void perform("confirm", async () => {
              await confirm({ data: { mailbox: target! } });
              await queryClient.invalidateQueries({ queryKey: ["outlook-correspondence"] });
              setChecked(await check({ data: {} }));
              setNotice("Shared mailbox confirmed. Scheduled correspondence imports are enabled.");
            })}>{busy === "confirm" ? "Saving…" : "Confirm mailbox and enable imports"}</Button>}
          <Button size="sm" variant="outline" disabled={!!busy || !connection.readyForSync}
            onClick={() => void perform("sync", async () => {
              const result = await runNow();
              await queryClient.invalidateQueries({ queryKey: ["outlook-correspondence"] });
              if (!result.ok) throw new Error(result.blocker ?? "The sync pass did not complete.");
              setNotice(`Sync pass completed: ${result.counts.stored} saved, ${result.counts.unmatched} to match, ${result.counts.closed} closed, ${result.counts.flagged} to check.`);
            })}>{busy === "sync" ? "Syncing…" : "Sync now"}</Button>
        </div>
        {actionProblem && <p role="alert" className="mt-2 text-danger">{actionProblem}</p>}
        {notice && <p role="status" className="mt-2">{notice}</p>}
        <p className="mt-3">Last synced mailbox: <b>{s.mailbox ?? "—"}</b> · last run {fmt(s.last_run_at)} · last success {fmt(s.last_ok_at)}</p>
        {s?.last_error && <p className="mt-1 text-danger">Last problem: {s.last_error}</p>}
        {data.pending > 0 && <p className="mt-1 text-danger">{data.pending} message(s) still await completed processing. Pending work is retained for retry.</p>}
        <p className="mt-1 text-sub">Copies owner emails (in and out) from {fmt(s?.backfill_from)} onto each job, every 10 minutes. It never sends anything.
          {Object.keys(counts).length > 0 && <> Last pass: {counts["stored"] ?? 0} saved, {counts["unmatched"] ?? 0} to match, {counts["closed"] ?? 0} closed, {counts["flagged"] ?? 0} to check.</>}</p>
        <div className="mt-3 border-t pt-3">
          <p className="font-medium">Historical catch-up</p>
          <p className="text-sub">Copies older mailbox history onto jobs. It is record-only: imported old mail is never allowed to close or change a job. {s.catchup_from
            ? <>Running from <b>{fmt(s.catchup_from)}</b> — inbound progress {fmt(s.catchup_inbound_cursor)}{s.has_catchup_inbound_continuation ? " (continuing)" : ""}, outbound progress {fmt(s.catchup_outbound_cursor)}{s.has_catchup_outbound_continuation ? " (continuing)" : ""}. Completion clears it automatically.</>
            : "No catch-up set — only mail from the normal start date is imported."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input aria-label="Catch-up start date" type="date" className="h-9 w-40" value={catchupDate} onChange={(e) => setCatchupDate(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!!busy || !catchupDate}
              onClick={() => void perform("catchup", async () => {
                await setCatchup({ data: { from: new Date(`${catchupDate}T00:00:00Z`).toISOString() } });
                await queryClient.invalidateQueries({ queryKey: ["outlook-correspondence"] });
                setNotice("Historical catch-up start saved. The next sync run will pick it up (record-only).");
              })}>{busy === "catchup" ? "Saving…" : "Start historical catch-up"}</Button>
            {s.catchup_from && <Button size="sm" variant="ghost" disabled={!!busy}
              onClick={() => void perform("catchup", async () => {
                await setCatchup({ data: { from: null } });
                await queryClient.invalidateQueries({ queryKey: ["outlook-correspondence"] });
                setNotice("Historical catch-up stopped and cleared.");
              })}>Stop catch-up</Button>}
          </div>
        </div>
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
