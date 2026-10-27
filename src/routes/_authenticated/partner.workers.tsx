import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { TradeShell } from "@/components/trade/TradeShell";
import { Button } from "@/components/trade/trade-ui";
import { WorkerForm, WorkerRemoveButton, WorkerStatus } from "@/components/portal/workers";
import { listMyWorkers, setWorkerRole } from "@/lib/worker-links.functions";
import { workerRoleLabel } from "@/lib/worker-role.core";
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
            <div className="min-w-0">
              <div className="font-semibold">{w.full_legal_name} <span className="font-normal text-sub">· {w.trade_role === "electrician" ? `Electrician · licence ${w.licence_number}` : "Installer"}</span></div>
              <div className="text-sub">{w.mobile} · {w.email}</div>
              {w.trade_role === "installer" && (() => { const s = eecState(w as never); return s !== "not_applicable" && <div className={s === "verified" ? "text-xs font-bold text-estimate-green" : s === "awaiting_check" ? "text-xs text-sub" : "text-xs font-bold text-danger"}>{EEC_TEAM_LABEL[s]}</div>; })()}
              {w.trade_role === "installer" && <div className={`text-xs font-bold ${w.worker_role ? "text-sub" : "text-danger"}`}>{workerRoleLabel(w.trade_role, w.worker_role)}{w.mitti_status ? ` · Mitti: ${w.mitti_status}` : ""}</div>}
              {!sample && data.canManage && w.trade_role === "installer" && <RolePicker id={w.id} role={w.worker_role ?? null} onDone={refetch} />}
              {w.approval_status === "rejected" && w.rejection_reason && <div className="text-xs text-danger">Reason: {w.rejection_reason}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <WorkerStatus s={w.approval_status} />
              {!sample && data.canManage && w.trade_role === "installer" && eecState(w as never) !== "verified" && <CertLinkButton workerId={w.id} name={w.full_legal_name} />}
              {!sample && data.canManage && <><Button size="sm" variant="outline" onClick={() => setEditing(w.id)}>Edit</Button><WorkerRemoveButton id={w.id} onDone={refetch} /></>}
            </div>
          </li>
        ))}
        {!data.workers.length && <li className="text-sm text-sub">No staff added yet.</li>}
      </ul>
    </TradeShell>
  );
}

/** Owner action: generate a single-use link so the worker uploads their own certificate. No upload control here. */
function CertLinkButton({ workerId, name }: { workerId: string; name: string }) {
  const create = useServerFn(createWorkerCompletionLink);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (link) return (
    <div className="w-full rounded-lg bg-success-soft p-2 text-xs">
      <div className="mb-1 font-semibold">Certificate link for {name} — send this to them:</div>
      <div className="break-all font-mono">{link}</div>
      <Button size="sm" className="mt-1 h-10" onClick={() => { void navigator.clipboard.writeText(link); }}>Copy link</Button>
      <p className="mt-1 text-sub">Single use, lasts 14 days. You won't see it again — create a new one if it's lost.</p>
    </div>
  );
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        try { const r = await create({ data: { workerId } }); setLink(`${window.location.origin}/join/${r.token}`); }
        catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); }
        finally { setBusy(false); }
      }}>{busy ? "Creating…" : "Create certificate link"}</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

/** Decision 411: the business owner sets Lead installer or Crew. */
function RolePicker({ id, role, onDone }: { id: string; role: string | null; onDone: () => void }) {
  const save = useServerFn(setWorkerRole);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {(["lead", "crew"] as const).map((r) => (
        <Button key={r} size="sm" variant={role === r ? "default" : "outline"} className="h-10" disabled={busy || role === r} onClick={async () => {
          setBusy(true); setErr("");
          try { await save({ data: { id, role: r } }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
        }}>{r === "lead" ? "Lead installer" : "Crew"}</Button>
      ))}
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </div>
  );
}
