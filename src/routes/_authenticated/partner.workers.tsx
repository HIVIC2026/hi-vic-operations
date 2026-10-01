import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, FilePenLine, Link2, ShieldCheck } from "lucide-react";
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
  if (error) return <AppShell><div role="alert" className="rounded-lg border border-danger bg-danger-soft p-6"><h1 className="font-display text-2xl font-bold">Staff records could not be loaded</h1><p className="mt-2 text-sm leading-relaxed">Try again. No invitation has been created or sent.</p><Button className="mt-4" variant="outline" onClick={() => refetch()}>Try again</Button></div></AppShell>;
  if (data === undefined) return <AppShell><div className="rounded-lg border bg-card p-6"><p className="font-display text-xl font-bold">Loading your staff records…</p><p className="mt-2 text-sm text-muted-foreground">Checking your business link and invitations.</p></div></AppShell>;
  if (data === null) return <AppShell><div className="rounded-lg border bg-card p-6"><h1 className="font-display text-2xl font-bold">Business access is not linked yet</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">The office must link your approved REC business to your portal account before you can create staff invitations. Contact Home Insulation Victoria if your business has already been approved.</p></div></AppShell>;
  const done = () => { setEditing(null); refetch(); };
  return (
    <AppShell>
      <Link to="/partner" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      {sample && <div role="status" className="mb-4 rounded-lg border border-primary/25 bg-secondary p-3 text-sm font-bold">Sample preview only — no data is saved and no invitation or staff record can be changed.</div>}
      <p className="text-xs font-extrabold uppercase tracking-wider text-success">Business team</p>
      <h1 className="mt-1 font-display text-3xl font-bold">Invite your staff</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{data.business?.trading_name || data.business?.name} keeps the company details, rates and payment information in its business profile. Each team member has their own staff record and must be approved before accessing an assigned job.</p>
      <div className="my-5 grid gap-3 sm:grid-cols-3">
        {[{ icon: Link2, title: "Create and copy a link", copy: "Nothing is sent automatically." }, { icon: FilePenLine, title: "Team member completes it", copy: "They enter their own trade details and sign declarations." }, { icon: ShieldCheck, title: "Office approval", copy: "Approval is required before job access." }].map(({ icon: Icon, title, copy }) => <div key={title} className="rounded-lg bg-secondary p-4"><Icon className="mb-3 size-5 text-success" /><p className="font-bold">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy}</p></div>)}
      </div>
       {data.canManage && data.business && <WorkerInvites businessId={data.business.id} sample={sample} />}
       {!sample && data.canManage && editing !== "new" && <div className="mb-5 border-t pt-5"><p className="mb-3 text-xs leading-relaxed text-muted-foreground"><strong>Office record only:</strong> adding someone manually creates a pending company record. It does not record the worker's personal declarations. Use an invitation whenever the worker can complete their own details.</p><Button size="field" variant="outline" onClick={() => setEditing("new")}>Add an office record manually</Button></div>}
       {!sample && editing === "new" && data.business && <div className="mb-4"><WorkerForm businessId={data.business.id} onDone={done} /></div>}
      <h2 className="mb-3 font-display text-xl font-bold">Staff records</h2>
      <ul className="space-y-2">
         {data.workers.map((w) => !sample && editing === w.id ? <li key={w.id}><WorkerForm businessId={data.business?.id ?? ""} worker={w} onDone={done} /></li> : (
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
        {!data.workers.length && <li className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No staff records yet. Create a personal invitation above. Business owners who perform onsite work should also have their own approved staff record.</li>}
      </ul>
    </AppShell>
  );
}
