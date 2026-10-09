import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-me";
import { listDeletedJobs, restoreJob } from "@/lib/office.functions";

export const Route = createFileRoute("/_authenticated/admin/deleted")({
  head: () => ({ meta: [{ title: "Deleted jobs – Home Insulation Victoria Portal" }, { name: "description", content: "Jobs the office deleted, with reasons, and restore." }, { property: "og:title", content: "Deleted jobs – Home Insulation Victoria Portal" }, { property: "og:description", content: "Jobs the office deleted, with reasons, and restore." }] }),
  component: DeletedJobs,
});

function DeletedJobs() {
  const load = useServerFn(listDeletedJobs);
  const { data, error } = useQuery({ queryKey: ["deleted-jobs"], queryFn: () => load() });
  return (
    <AppShell wide>
      <h1 className="font-display text-2xl font-semibold">Deleted jobs</h1>
      <p className="mb-4 text-sm text-muted-foreground">These jobs are hidden from every list and nothing can be sent for them. Their history is kept and you can restore them.</p>
      {error ? <p role="alert" className="text-sm text-danger">Deleted jobs could not be loaded.</p> : !data ? <p role="status">Loading…</p> : !data.length ? <p>No deleted jobs.</p> : (
        <div className="overflow-x-auto rounded-[22px] border bg-card"><table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Job</th><th className="p-3">Owner</th><th className="p-3">Suburb</th><th className="p-3">Deleted</th><th className="p-3">Reason</th><th className="p-3"></th></tr></thead>
          <tbody>{data.map((r) => <Row key={r.id} r={r} />)}</tbody>
        </table></div>
      )}
    </AppShell>
  );
}

function Row({ r }: { r: { id: string; jobNumber: string; owner: string | null; suburb: string | null; deletedAt: string | null; reason: string | null } }) {
  const restore = useAction(restoreJob);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <tr className="border-b last:border-0">
      <td className="p-3 font-semibold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="text-primary underline">{r.jobNumber}</Link></td>
      <td className="p-3">{r.owner ?? "—"}</td><td className="p-3">{r.suburb ?? "—"}</td>
      <td className="p-3">{r.deletedAt ? new Date(r.deletedAt).toLocaleString("en-AU") : "—"}</td><td className="p-3">{r.reason}</td>
      <td className="p-3">{!open ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Restore</Button> :
        <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (await restore({ jobId: r.id, reason }, `${r.jobNumber} restored`)) setOpen(false); }}>
          <input aria-label={`Reason for restoring ${r.jobNumber}`} className="h-9 rounded-md border px-2" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" size="sm" disabled={reason.trim().length < 3}>Restore</Button></form>}</td>
    </tr>
  );
}
