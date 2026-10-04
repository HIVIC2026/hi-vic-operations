import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveApJob, getApQueue } from "@/lib/ap-queue.functions";

const T = "AP approval queue – Home Insulation Victoria Portal";
const D = "Jobs waiting for final Accredited Person review, grouped into no flags and flagged.";
export const Route = createFileRoute("/_authenticated/admin/ap-queue")({
  head: () => ({ meta: [{ title: T }, { name: "description", content: D }, { property: "og:title", content: T }, { property: "og:description", content: D }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ApQueuePage,
});

type Item = { id: string; jobNumber: string | null; property: string | null; flags: string[] };

function JobCard({ item }: { item: Item }) {
  const approve = useServerFn(approveApJob);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => approve({ data: { jobId: item.id, note: note.trim() || undefined } }),
    onSuccess: () => { toast.success(`${item.jobNumber ?? "Job"} approved – Ready for VEEC`); qc.invalidateQueries({ queryKey: ["ap-queue"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const flagged = item.flags.length > 0;
  return (
    <li className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Link to="/admin/jobs/$jobId" params={{ jobId: item.id }} className="font-heading font-bold text-primary underline">{item.jobNumber ?? "Job"}</Link>
        <span className="text-sm text-muted-foreground">{item.property}</span>
      </div>
      {flagged && <ul className="list-disc pl-5 text-sm text-danger">{item.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={flagged ? "Note (required): why it is OK to approve" : "Note (optional)"} rows={2} />
      <Button onClick={() => m.mutate()} disabled={m.isPending || (flagged && !note.trim())}>Approve this job</Button>
    </li>
  );
}

function ApQueuePage() {
  const load = useServerFn(getApQueue);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["ap-queue"], queryFn: () => load() });
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">AP approval queue</h1>
          <p className="text-sm text-muted-foreground">Each job is approved on its own and gets its own record. Nothing is approved automatically. Flags come from the job's existing records only.</p>
        </div>
        {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Could not load the queue: {(error as Error).message} <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div>}
        {data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-bold">No flags ({data.clean.length})</h2>
              {data.clean.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="space-y-3">{data.clean.map((i) => <JobCard key={i.id} item={i} />)}</ul>}
            </section>
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-bold text-danger">Flagged ({data.flagged.length})</h2>
              {data.flagged.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="space-y-3">{data.flagged.map((i) => <JobCard key={i.id} item={i} />)}</ul>}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
