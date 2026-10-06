import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { editHotLeadEmail, getHotLeads, sendHotLeadsBatch } from "@/lib/hot-leads.functions";
import { HOT_STATUS_LABEL, hotSelectionBlocker } from "@/lib/hot-leads.core";

const title = "Hot leads – Home Insulation Victoria Operations";
const description = "Office-only Save my spot list: preliminary prices, local trades and send status for eligible website leads.";
export const Route = createFileRoute("/_authenticated/admin/hot-leads")({
  head: () => ({ meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: HotLeadsPage,
});

type ListKey = "likely" | "warm" | "test";
const money = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.floor(n));
const when = (s: string | null) => s ? new Date(s).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
type Row = Awaited<ReturnType<typeof getHotLeads>>["list"][number];

function HotLeadsPage() {
  const [tab, setTab] = useState<ListKey>("likely");
  const load = useServerFn(getHotLeads);
  const send = useServerFn(sendHotLeadsBatch);
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["hot-leads", tab], queryFn: () => load({ data: { list: tab } }), refetchInterval: 15000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [initFor, setInitFor] = useState<string | null>(null);
  useEffect(() => {
    if (data && initFor !== tab) { setSelected(new Set(data.list.filter((r) => r.defaultTicked).map((r) => r.id))); setInitFor(tab); }
  }, [data, tab, initFor]);
  const rows = data?.list ?? [];
  const picked = rows.filter((r) => selected.has(r.id) && r.status === "not_sent");
  const blocker = hotSelectionBlocker(picked);
  const canSendHere = tab === "test" || (tab === "likely" && !!data?.realSendingOn);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ready = rows.filter((r) => r.send === "ready");
  const hold = rows.filter((r) => r.send === "hold");
  const counts = useMemo(() => [...ready.reduce((m, r) => m.set(r.region, (m.get(r.region) ?? 0) + 1), new Map<string, number>())], [ready]);

  async function runSend() {
    setConfirm(false);
    const ids = picked.map((r) => r.id);
    const size = data?.batchSize ?? 10;
    let sent = 0, other = 0;
    for (let i = 0; i < ids.length; i += size) {
      setProgress(`Sending ${Math.min(i + size, ids.length)} of ${ids.length}…`);
      try {
        const res = await send({ data: { jobIds: ids.slice(i, i + size) } });
        sent += res.filter((r) => r.outcome === "sent").length; other += res.filter((r) => r.outcome !== "sent").length;
      } catch (e) { setProgress(`Stopped: ${(e as Error).message}`); await qc.invalidateQueries({ queryKey: ["hot-leads"] }); return; }
    }
    setProgress(`${sent} sent${other ? `, ${other} not sent (already sent, opted out or blocked)` : ""}.`);
    await qc.invalidateQueries({ queryKey: ["hot-leads"] });
  }

  const table = (list: Row[], label: string) => <section className="mt-6"><h2 className="font-display text-xl font-bold">{label} ({list.length})</h2>
    <div className="mt-3 overflow-x-auto rounded-2xl border bg-card"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-muted"><tr>{["", "Job", "Name", "Address", "Region", "m²", "Price", "VEU discount", "Trades for this area", "Status"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
      <tbody className="divide-y">{list.map((r) => <tr key={r.id} className={r.flags.length ? "bg-accent/40" : ""}>
        <td className="p-3"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${r.jobNumber}`} disabled={r.status !== "not_sent"} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
        <td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="font-semibold text-primary underline">{r.jobNumber}</Link></td>
        <td className="p-3"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div>
          {r.flags.map((f) => <p key={f} className="mt-1 text-xs font-semibold text-destructive">⚠ {f}</p>)}
          {r.flags.some((f) => f.includes("typo")) && <Button size="sm" variant="outline" className="mt-1" onClick={() => setEditing(r)}>Edit email</Button>}</td>
        <td className="p-3">{r.address}</td><td className="p-3">{r.region}</td><td className="p-3">{r.area}</td>
        <td className="p-3 font-semibold">{money(r.price)}</td><td className="p-3">{money(r.discount)}</td>
        <td className="p-3 text-xs"><div>Installers: {r.installers.join(", ") || "—"}</div><div>Electricians: {r.electricians.join(", ") || "—"}</div></td>
        <td className="p-3"><span className={r.status === "spot_saved" ? "font-semibold text-estimate-green" : r.status === "opted_out" ? "text-destructive" : ""}>{HOT_STATUS_LABEL[r.status]}</span>{r.sentAt && <div className="text-xs text-muted-foreground">{when(r.sentAt)}</div>}</td>
      </tr>)}</tbody></table></div></section>;

  return <AppShell wide><div className="space-y-4">
    <h1 className="font-display text-2xl font-bold">Hot leads</h1>
    <div className="flex flex-wrap gap-2" role="tablist">{([["likely", "Hot"], ["warm", "Warm"], ["test", "TEST (Jo only)"]] as const).map(([k, l]) => <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} onClick={() => { setTab(k); setProgress(null); }}>{l}</Button>)}</div>
    {tab === "warm" && <p className="text-sm text-muted-foreground">Needs onsite confirmation, no insulation, owner-entered area. Nothing is ticked; the Save my spot email isn't approved for these homes yet.</p>}
    {tab === "test" && <p className="text-sm text-muted-foreground">TEST jobs only. Emails go to Jo's test inbox and nobody else.</p>}
    {isPending ? <p role="status">Loading leads…</p> : error ? <p role="alert" className="text-destructive">Could not load leads: {(error as Error).message}</p> : data && <>
      <div className="flex flex-wrap gap-3 text-sm"><strong>{rows.length} leads</strong>{tab !== "test" && <><span>Ready to send {ready.length}</span><span>Held {hold.length}</span><span>{data.duplicates} duplicate records hidden</span></>}</div>
      {tab === "likely" && <div className="flex flex-wrap gap-2">{counts.map(([region, n]) => <span key={region} className="rounded-full border px-3 py-1 text-sm">{region} {n}</span>)}</div>}
      <div className="sticky top-0 z-10 rounded-2xl border bg-card p-4">
        <Button size="lg" className="h-12 text-base" disabled={!picked.length || !!blocker || !canSendHere || !!progress?.startsWith("Sending")} onClick={() => setConfirm(true)}>Send Save my spot to {picked.length} selected</Button>
        {!canSendHere && <p className="mt-2 text-sm font-semibold">{tab === "warm" ? "Warm leads can't be sent the Save my spot email yet." : "Sending is switched off. Ask Claude to switch it on."}</p>}
        {blocker && <p className="mt-2 text-sm font-semibold text-destructive">{blocker}</p>}
        {progress && <p role="status" className="mt-2 text-sm">{progress}</p>}
      </div>
      {tab === "likely" ? <>{table(ready, "Ready to send")}{table(hold, "Hold — no local trade confirmed yet")}</> : table(rows, tab === "warm" ? "Warm" : "TEST jobs")}
    </>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Send to {picked.length} homeowners?</AlertDialogTitle><AlertDialogDescription>This can't be undone.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={runSend}>Send</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {editing && <EditEmail row={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["hot-leads"] }); }} />}
  </div></AppShell>;
}

function EditEmail({ row, onClose }: { row: Row; onClose: () => void }) {
  const save = useServerFn(editHotLeadEmail);
  const [email, setEmail] = useState(row.email ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Edit email for {row.jobNumber}</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Only change this once Jo has confirmed the right address. The change is recorded in job history.</p>
    <label className="text-sm font-medium">Email<Input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label className="text-sm font-medium">Why it's changing<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Jo confirmed with the owner" /></label>
    {err && <p className="text-sm text-destructive">{err}</p>}
    <Button onClick={async () => { try { await save({ data: { jobId: row.id, email, reason } }); onClose(); } catch (e) { setErr((e as Error).message); } }}>Save email</Button>
  </DialogContent></Dialog>;
}
