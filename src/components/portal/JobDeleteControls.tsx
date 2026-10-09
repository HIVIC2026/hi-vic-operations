import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { deleteJob, getJobDeleteState, restoreJob } from "@/lib/office.functions";

/** Office-only Delete job / Restore job. Recoverable; history is kept. */
export function JobDeleteControls({ jobId }: { jobId: string }) {
  const load = useServerFn(getJobDeleteState);
  const { data } = useQuery({ queryKey: ["job-delete-state", jobId], queryFn: () => load({ data: { jobId } }) });
  const del = useAction(deleteJob);
  const restore = useAction(restoreJob);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!data) return null;
  const deleted = !!data.deletedAt;
  return (
    <div className="my-3">
      {deleted && <div role="status" className="mb-2 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">This job is deleted ({new Date(data.deletedAt!).toLocaleString("en-AU")}): {data.reason}. It is hidden from every list and nothing can be sent for it. Its history is kept.</div>}
      {!open ? <Button size="sm" variant={deleted ? "outline" : "destructive"} onClick={() => setOpen(true)}>{deleted ? "Restore job" : "Delete job"}</Button> : (
        <form className="space-y-2 rounded-md border border-line p-3" onSubmit={async (e) => { e.preventDefault(); const ok = deleted ? await restore({ jobId, reason }, "Job restored") : await del({ jobId, reason }, "Job deleted"); if (ok) { setOpen(false); setReason(""); } }}>
          <label className="block text-sm font-semibold" htmlFor="job-delete-reason">{deleted ? "Why are you restoring this job?" : "Why are you deleting this job?"}</label>
          <Textarea id="job-delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          <p className="text-xs text-muted-foreground">{deleted ? "The job returns to the lists it belongs in." : "The job disappears from the pipeline, lists and trade/owner screens, and nothing more is sent. Signed, payment and history records are kept, and you can restore it."}</p>
          <div className="flex gap-2"><Button type="submit" size="sm" variant={deleted ? "default" : "destructive"} disabled={reason.trim().length < 3}>{deleted ? "Restore job" : "Delete job"}</Button><Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}

/** Compact Delete button for one list row. */
export function RowDeleteButton({ jobId, jobNumber }: { jobId: string; jobNumber: string }) {
  const del = useAction(deleteJob);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="destructive" aria-label={`Delete ${jobNumber}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>Delete</Button>;
  return (
    <form className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (await del({ jobId, reason }, `${jobNumber} deleted`)) setOpen(false); }}>
      <input aria-label={`Reason for deleting ${jobNumber}`} className="h-9 min-w-[10rem] rounded-md border border-line px-2 text-sm" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
      <Button type="submit" size="sm" variant="destructive" disabled={reason.trim().length < 3}>Delete {jobNumber}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}
