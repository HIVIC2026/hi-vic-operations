import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkerStatus } from "@/components/portal/workers";
import { OfficeWorkerCompliance } from "@/components/portal/worker-compliance";
import { OfficeMittiInvites } from "@/components/portal/mitti-invites";
import { decideWorker, listWorkerApprovals } from "@/lib/worker-links.functions";
import { prepareTradeLogin } from "@/lib/trade-access.functions";

export const Route = createFileRoute("/_authenticated/admin/workers")({
  head: () => ({ meta: [{ title: "Staff approvals – Home Insulation Victoria Operations" }, { name: "description", content: "Approve staff listed under partner companies before they get job links." }, { property: "og:title", content: "Staff approvals – Home Insulation Victoria Operations" }, { property: "og:description", content: "Approve staff listed under partner companies before they get job links." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Approvals,
});

function Approvals() {
  const load = useServerFn(listWorkerApprovals);
  const { data, refetch } = useQuery({ queryKey: ["worker-approvals"], queryFn: () => load() });
  const pending = (data ?? []).filter((w) => w.approval_status === "pending");
  const rest = (data ?? []).filter((w) => w.approval_status !== "pending");
  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold">Staff approvals</h1>
      <p className="mb-4 text-sm text-muted-foreground">Staff listed by partner companies. Check the licence or qualification, then approve — only approved staff can receive job links.</p>
      <OfficeWorkerCompliance />
      <OfficeMittiInvites />
      <h2 className="mb-2 font-semibold">Waiting for approval ({pending.length})</h2>
      <ul className="mb-6 space-y-2">{pending.map((w) => <Row key={w.id} w={w} onDone={refetch} />)}{!pending.length && <li className="text-sm text-muted-foreground">Nothing waiting.</li>}</ul>
      <h2 className="mb-2 font-semibold">All staff</h2>
      <ul className="space-y-2">{rest.map((w) => <Row key={w.id} w={w} onDone={refetch} />)}</ul>
    </AppShell>
  );
}

function Row({ w, onDone }: { w: { id: string; full_legal_name: string; trade_role: string; licence_number: string | null; qualification: string | null; mobile: string | null; email: string | null; approval_status: string; rejection_reason: string | null; businesses: unknown }; onDone: () => void }) {
  const decide = useServerFn(decideWorker);
  const prepare = useServerFn(prepareTradeLogin);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const act = async (approve: boolean) => {
    try { await decide({ data: { id: w.id, approve, reason: approve ? null : reason } }); toast.success(approve ? "Staff member approved" : "Staff member rejected"); onDone(); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const login = async () => {
    try {
      const r = await prepare({ data: { workerId: w.id, send: false, redirectTo: window.location.origin } });
      if (r.link) { await navigator.clipboard.writeText(r.link).catch(() => undefined); toast.success("Sign-in set up. Set-password link copied — send it to them yourself (invite emails are off until Jo approves the wording)."); }
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <li className="rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{w.full_legal_name} <span className="font-normal text-muted-foreground">· {(w.businesses as { name: string } | null)?.name}</span></div>
          <div className="text-muted-foreground">{w.trade_role === "electrician" ? `Electrician · licence ${w.licence_number}` : `Installer · ${w.qualification ?? ""}`} · {w.mobile} · {w.email}</div>
          {w.rejection_reason && <div className="text-xs text-danger">Reason: {w.rejection_reason}</div>}
        </div>
        <div className="flex items-center gap-2">
          <WorkerStatus s={w.approval_status} />
          {w.approval_status !== "approved" && <Button size="sm" onClick={() => act(true)}>Approve</Button>}
          {w.approval_status === "approved" && <Button size="sm" variant="outline" onClick={login}>Copy set-password link</Button>}
          {w.approval_status !== "rejected" && !rejecting && <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>Reject</Button>}
        </div>
      </div>
      {rejecting && <div className="mt-2 flex gap-2"><Input placeholder="Reason (shown to the company)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="destructive" onClick={() => act(false)}>Confirm reject</Button></div>}
    </li>
  );
}

