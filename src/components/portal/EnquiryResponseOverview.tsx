// P0-B: compact, actionable "enquiry response status" strip for the Office dashboard.
// The button dispatches ONE authorised batch through the hardened sender; a single row can be retried after a
// confirmed failure. Every decision (who is eligible, who already answered, who opted out) is made server-side.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getEnquiryResponseOverview } from "@/lib/enquiry-response.functions";
import { dispatchEnquiryBacklog, retryFailedEnquirySend } from "@/lib/enquiry-dispatch.functions";

/** One HOT_SEND batch. */
const BATCH = 10;
type DispatchRow = { jobId: string; jobNumber: string | null; outcome: string; detail: string };

function summarise(rows: DispatchRow[]): string {
  const n = (outcome: string) => rows.filter((r) => r.outcome === outcome).length;
  return `${n("sent")} sent · ${n("skipped")} skipped · ${n("blocked")} blocked · ${n("failed")} failed`;
}

export function EnquiryResponseOverview() {
  const load = useServerFn(getEnquiryResponseOverview);
  const dispatch = useServerFn(dispatchEnquiryBacklog);
  const retry = useServerFn(retryFailedEnquirySend);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | "batch" | string>(null);
  const [batch, setBatch] = useState<DispatchRow[] | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["enquiry-response-overview", page],
    queryFn: () => load({ data: { page } }),
    staleTime: 30_000,
  });
  if (isLoading) return <p role="status" className="mb-4 text-sm text-sub">Loading enquiry responses…</p>;
  if (error || !data)
    return (
      <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        Enquiry response counts are unavailable — nothing is shown as zero and nothing can be sent from here.{" "}
        <Button variant="link" size="sm" onClick={() => void refetch()}>Try again</Button>
      </p>
    );
  const { responses, awaiting } = data;
  const counts = { dispatchReady: data.dispatchReady, awaiting: responses.unanswered };
  const working = busy !== null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["enquiry-response-overview"] });

  const sendBatch = async () => {
    if (working) return;
    const n = Math.max(1, Math.min(counts.dispatchReady ?? BATCH, BATCH));
    if (
      !confirm(
        `Send the Save my spot email to ${n === 1 ? "1 enquiry" : `up to ${n} enquiries`} now? Only the oldest unanswered homes are chosen, and each home is checked again — answered, opted-out, in-flight and manual-review enquiries are never emailed.`,
      )
    )
      return;
    setBusy("batch");
    try {
      const out = await dispatch({ data: { limit: BATCH } });
      setBatch(out.results);
      if (out.attempted === 0) toast.info("Nothing is ready to send right now.");
      else toast.success(summarise(out.results));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The batch could not be sent.");
    } finally {
      setBusy(null);
    }
  };

  const retryOne = async (jobId: string, jobNumber: string | null) => {
    if (working) return;
    setBusy(jobId);
    try {
      const out = await retry({ data: { jobId } });
      if (out.outcome === "sent") toast.success(`${jobNumber ?? "Enquiry"}: ${out.detail}`);
      else toast.warning(`${jobNumber ?? "Enquiry"}: ${out.detail}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The retry failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Enquiry response status" className="mb-4 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="font-bold">Enquiry responses</span>
        <span>
          No reply recorded <b data-testid="comms-awaiting">{responses.unanswered}</b>
        </span>
        <span className={responses.unanswered_latest_failed > 0 ? "font-semibold text-destructive" : ""}>
          …of which latest attempt failed <b>{responses.unanswered_latest_failed}</b>
        </span>
        <span>
          Outcome uncertain <b>{responses.uncertain}</b>
        </span>
        <span>
          Ready to send{" "}
          <b data-testid="comms-ready">
            {counts.dispatchReady === null ? "—" : counts.dispatchReady}
          </b>
        </span>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          data-testid="dispatch-batch"
          disabled={working || !counts.dispatchReady}
          onClick={() => void sendBatch()}
          title={
            counts.dispatchReady === null
              ? "The readiness check could not be read. Nothing can be sent until it loads."
              : counts.dispatchReady === 0
                ? "No awaiting enquiry has a current preliminary estimate and an active estimate link yet."
                : undefined
          }
        >
          {busy === "batch"
            ? "Sending…"
            : `Send up to ${Math.min(BATCH, counts.dispatchReady ?? BATCH)}`}
        </Button>
      </div>
      {counts.dispatchReady === null && (
        <p role="alert" className="mt-2 text-xs font-semibold text-destructive">
          Ready-to-send could not be checked, so nothing will be sent from this page. Try reloading.
        </p>
      )}
      {counts.dispatchReady === 0 && counts.awaiting > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          None of the awaiting enquiries can be emailed yet: each one needs a current preliminary
          estimate and an active estimate link.
        </p>
      )}
      {batch && batch.length > 0 && (
        <div
          data-testid="dispatch-results"
          className="mt-2 rounded-md border bg-muted/40 p-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Last batch: {summarise(batch)}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setBatch(null)}>
              Dismiss
            </Button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {batch.map((r) => (
              <li key={r.jobId} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{r.jobNumber ?? r.jobId}</span>
                <span
                  className={
                    r.outcome === "sent"
                      ? "font-semibold text-success"
                      : r.outcome === "failed" || r.outcome === "blocked"
                        ? "font-semibold text-destructive"
                        : "font-semibold"
                  }
                >
                  {r.outcome}
                </span>
                <span className="text-muted-foreground">{r.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {awaiting.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            Who has no reply recorded (page {data.page} of {data.totalPages} · {counts.awaiting} in total)
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm">
            {awaiting.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-t pt-1">
                <span className="font-mono text-xs">{r.jobNumber ?? "—"}</span>
                <span>{r.ownerName ?? "—"}</span>
                <span className="text-muted-foreground">{r.address ?? ""}</span>
                {r.latestAttemptStatus === "failed" && (
                  <span className="font-semibold text-destructive">latest attempt failed{r.latestAttemptAt ? ` ${new Date(r.latestAttemptAt).toLocaleString("en-AU")}` : ""}</span>
                )}
                {!r.hasEmail && <span className="font-semibold text-warning">no email address</span>}
                {r.dispatchReady && (
                  <span data-testid="row-ready" className="font-semibold text-success">
                    ready
                  </span>
                )}
                {r.latestAttemptStatus === "failed" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="retry-send"
                    disabled={working}
                    onClick={() => void retryOne(r.id, r.jobNumber)}
                  >
                    {busy === r.id ? "Retrying…" : "Retry failed send"}
                  </Button>
                )}
                <a href={`/admin/jobs/${r.id}`} className="ml-auto text-primary underline">
                  Open
                </a>
              </li>
            ))}
          </ul>
          {data.totalPages > 1 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {data.page} of {data.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
