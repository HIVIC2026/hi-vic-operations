import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { TradeShell } from "@/components/trade/TradeShell";
import { Button } from "@/components/trade/trade-ui";
import { WorkerForm, WorkerRemoveButton, WorkerStatus } from "@/components/portal/workers";
import { listMyWorkers } from "@/lib/worker-links.functions";
import { createWorkerCompletionLink } from "@/lib/worker-invite.functions";
import { WorkerInvites } from "@/components/portal/worker-invites";
import { workerListQueryKey } from "@/lib/worker-invite.core";
import { EEC_TEAM_LABEL, eecState } from "@/lib/worker-compliance.core";

export const Route = createFileRoute("/_authenticated/partner/workers")({
  head: () => ({ meta: [
    { title: "Your staff – Home Insulation Victoria" }, { name: "description", content: "Invite and manage staff who work under your company." }, { property: "og:title", content: "Your staff – Home Insulation Victoria" }, { property: "og:description", content: "Invite and manage staff who work under your company." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Workers,
});

function Workers() {
  const load = useServerFn(listMyWorkers);
  const sample = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1";
  const sampleData = { business: { id: "00000000-0000-0000-0000-000000000000", name: "Sample Electrical", trading_name: "Sample Electrical" }, canManage: true, workers: [] };
  const { data, error, refetch } = useQuery({ queryKey: workerListQueryKey(sample), queryFn: () => sample ? Promise.resolve(sampleData) : load(), initialData: sample ? sampleData : undefined });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  if (error) return <TradeShell installer><div role="alert" className="rounded-[18px] border border-line bg-paper shadow-card p-6 text-sm"><p className="text-danger">Your staff could not be loaded.</p><Button className="mt-3" variant="outline" onClick={() => refetch()}>Try again</Button></div></TradeShell>;
  if (data === undefined) return <TradeShell installer><p className="text-sub">Loading…</p></TradeShell>;
  if (data === null) return <TradeShell installer><p className="rounded-[18px] border border-line bg-paper shadow-card p-6 text-sm text-sub">Your account isn't linked to a partner business yet.</p></TradeShell>;
  const done = () => { setEditing(null); refetch(); };
  return (
    <TradeShell installer>
      <Link to="/field/business/team" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ArrowLeft className="h-4 w-4" />Team</Link>
      <h1 className="font-display text-[26px] font-bold leading-tight">Your staff</h1>
      <p className="mb-4 text-sm text-sub">One business profile for {data.business?.trading_name || data.business?.name}. Invite each staff member using their own link. They provide their own details and declarations, and our office must approve them before they can access assigned jobs. Staff cannot see business rates or bank details.</p>
      {data.canManage && data.business && <WorkerInvites businessId={data.business.id} sample={sample} />}
      {!sample && data.canManage && editing !== "new" && <Button className="mb-4" size="field" variant="outline" onClick={() => setEditing("new")}>+ Add staff member manually</Button>}
      {!sample && editing === "new" && <div className="mb-4"><WorkerForm businessId={data.business!.id} onDone={done} /></div>}
      <ul className="space-y-2">
        {data.workers.map((w) => !sample && editing === w.id ? <li key={w.id}><WorkerForm businessId={data.business!.id} worker={w} onDone={done} /></li> : (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-line bg-paper shadow-card p-3 text-sm">
            <div>
              <div className="font-semibold">{w.full_legal_name} <span className="font-normal text-sub">· {w.trade_role === "electrician" ? `Electrician · licence ${w.licence_number}` : "Installer"}</span></div>
              <div className="text-sub">{w.mobile} · {w.email}</div>
              {w.approval_status === "rejected" && w.rejection_reason && <div className="text-xs text-danger">Reason: {w.rejection_reason}</div>}
            </div>
            <div className="flex items-center gap-2">
              <WorkerStatus s={w.approval_status} />
              {!sample && data.canManage && <><Button size="sm" variant="outline" onClick={() => setEditing(w.id)}>Edit</Button><WorkerRemoveButton id={w.id} onDone={refetch} /></>}
            </div>
          </li>
        ))}
        {!data.workers.length && <li className="text-sm text-sub">No staff added yet.</li>}
      </ul>
    </TradeShell>
  );
}
