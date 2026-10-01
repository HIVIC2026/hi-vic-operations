import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { WorkerForm, WorkerRemoveButton, WorkerStatus } from "@/components/portal/workers";
import { listMyWorkers } from "@/lib/worker-links.functions";
import { WorkerInvites } from "@/components/portal/worker-invites";
import { workerListQueryKey } from "@/lib/worker-invite.core";

export const Route = createFileRoute("/_authenticated/partner/workers")({
  head: () => ({ meta: [{ title: "Your workers – Home Insulation Victoria" }, { name: "description", content: "Add the electricians and installers who work under your company." }, { property: "og:title", content: "Your workers – Home Insulation Victoria" }, { property: "og:description", content: "Add the electricians and installers who work under your company." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Workers,
});

function Workers() {
  const load = useServerFn(listMyWorkers);
  const sample = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1";
  const sampleData = { business: { id: "00000000-0000-0000-0000-000000000000", name: "Sample Electrical", trading_name: "Sample Electrical" }, canManage: true, workers: [] };
  const { data, error, refetch } = useQuery({ queryKey: workerListQueryKey(sample), queryFn: () => sample ? Promise.resolve(sampleData) : load(), initialData: sample ? sampleData : undefined });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  if (error) return <AppShell><div role="alert" className="rounded-xl border bg-card p-6 text-sm"><p className="text-danger">Your workers could not be loaded.</p><Button className="mt-3" variant="outline" onClick={() => refetch()}>Try again</Button></div></AppShell>;
  if (data === undefined) return <AppShell><p className="text-muted-foreground">Loading…</p></AppShell>;
  if (data === null) return <AppShell><p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Your account isn't linked to a partner business yet.</p></AppShell>;
  const done = () => { setEditing(null); refetch(); };
  return (
    <AppShell>
      <Link to="/partner" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <h1 className="text-2xl font-bold">Your workers</h1>
      <p className="mb-4 text-sm text-muted-foreground">One account for {data.business?.trading_name || data.business?.name}. List the people who do the work — they don't need their own login. When they're on a job, they get a private link to just that job: the form to fill in, the timeline, and messages with the owner. Home Insulation Victoria approves each new worker once.</p>
      {data.canManage && data.business && <WorkerInvites businessId={data.business.id} sample={sample} />}
      {!sample && data.canManage && editing !== "new" && <Button className="mb-4" size="field" variant="outline" onClick={() => setEditing("new")}>+ Add worker myself (incl. me, if I do the work)</Button>}
      {!sample && editing === "new" && <div className="mb-4"><WorkerForm businessId={data.business!.id} onDone={done} /></div>}
      <ul className="space-y-2">
        {data.workers.map((w) => !sample && editing === w.id ? <li key={w.id}><WorkerForm businessId={data.business!.id} worker={w} onDone={done} /></li> : (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm">
            <div>
              <div className="font-semibold">{w.full_legal_name} <span className="font-normal text-muted-foreground">· {w.trade_role === "electrician" ? `Electrician · licence ${w.licence_number}` : "Installer"}</span></div>
              <div className="text-muted-foreground">{w.mobile} · {w.email}</div>
              {w.approval_status === "rejected" && w.rejection_reason && <div className="text-xs text-danger">Reason: {w.rejection_reason}</div>}
            </div>
            <div className="flex items-center gap-2">
              <WorkerStatus s={w.approval_status} />
              {!sample && data.canManage && <><Button size="sm" variant="outline" onClick={() => setEditing(w.id)}>Edit</Button><WorkerRemoveButton id={w.id} onDone={refetch} /></>}
            </div>
          </li>
        ))}
        {!data.workers.length && <li className="text-sm text-muted-foreground">No workers yet.</li>}
      </ul>
    </AppShell>
  );
}
