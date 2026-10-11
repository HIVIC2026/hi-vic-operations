import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { editHotLeadEmail, getHotLeads, getPossibleDuplicates, previewHotLeadEmail, sendHotLeadTestToJo, sendHotLeadsBatch } from "@/lib/hot-leads.functions";
import { hotSelectionBlocker } from "@/lib/hot-leads.core";

const title = "Hot leads – Home Insulation Victoria Operations";
const description = "Office-only Save my spot list: preliminary prices, local trades and send status for eligible website leads.";
export const Route = createFileRoute("/_authenticated/admin/hot-leads")({
  beforeLoad: () => { throw redirect({ to: "/admin/enquiry-groups", replace: true }); },
  head: () => ({ meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: HotLeadsPage,
});

type ListKey = "likely" | "warm" | "test" | "dupes";
const money = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.floor(n));
const when = (s: string | null) => s ? new Date(s).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
type Row = Awaited<ReturnType<typeof getHotLeads>>["list"][number];

function HotLeadsPage() {
  const [tab, setTab] = useState<ListKey>("likely");
  const load = useServerFn(getHotLeads);
  const send = useServerFn(sendHotLeadsBatch);
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["hot-leads", tab], queryFn: () => load({ data: { list: tab === "dupes" ? "likely" : tab } }), refetchInterval: 60_000, enabled: tab !== "dupes" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [previewing, setPreviewing] = useState<Row | null>(null);
  const [initFor, setInitFor] = useState<string | null>(null);
  useEffect(() => {
    if (data && initFor !== tab) { setSelected(new Set(data.list.filter((r) => r.defaultTicked).map((r) => r.id))); setInitFor(tab); }
  }, [data, tab, initFor]);
  const rows = data?.list ?? [];
  const picked = rows.filter((r) => selected.has(r.id) && r.status === "not_sent");
  const blocker = hotSelectionBlocker(picked);
  const canSendHere = tab === "test" || (tab === "likely" && !!data?.realSendingOn);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Jo (8 Oct): a lead leaves the send queues the moment its spot is saved or it opts out, so the lists always show who still needs the email.
  const ready = rows.filter((r) => r.send === "ready" && r.status === "not_sent");
  const hold = rows.filter((r) => r.send === "hold" && r.status === "not_sent");
  const awaiting = rows.filter((r) => r.status === "sent");
  const saved = rows.filter((r) => r.status === "spot_saved");
  const optedOut = rows.filter((r) => r.status === "opted_out");
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
    <div className="mt-3 overflow-x-auto rounded-2xl border bg-card"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-muted"><tr>{["", "Job", "Name", "Address", "Region", "m²", "Price", "VEU discount", "Trades for this area", "Email sent", "Spot saved", "Unactioned enquiry"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
      <tbody className="divide-y">{list.map((r) => <tr key={r.id} className={r.flags.length ? "bg-accent/40" : ""}>
        <td className="p-3"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${r.jobNumber}`} disabled={r.status !== "not_sent"} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
        <td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="font-semibold text-primary underline">{r.jobNumber}</Link></td>
        <td className="p-3"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div>
          {r.flags.map((f) => <p key={f} className="mt-1 text-xs font-semibold text-destructive">⚠ {f}</p>)}
          {r.note && <p className="mt-1 text-xs font-semibold">ℹ {r.note}</p>}
          {tab !== "warm" && <Button size="sm" variant="outline" className="mt-1" onClick={() => setPreviewing(r)}>Preview email</Button>}
          {r.flags.some((f) => f.includes("typo")) && <Button size="sm" variant="outline" className="mt-1" onClick={() => setEditing(r)}>Edit email</Button>}</td>
        <td className="p-3">{r.address}</td><td className="p-3">{r.region}</td><td className="p-3">{r.area}</td>
        <td className="p-3 font-semibold">{money(r.price)}</td><td className="p-3">{money(r.discount)}</td>
        <td className="p-3 text-xs"><div>Installers: {r.installers.join(", ") || "—"}</div><div>Electricians: {r.electricians.join(", ") || "—"}</div></td>
        <td className="p-3">{r.sentAt ? <span className="text-xs">{when(r.sentAt)}</span> : "—"}</td>
        <td className="p-3">{r.spotSavedAt ? <span className="text-xs font-semibold text-estimate-green">{when(r.spotSavedAt)}</span> : "—"}</td>
        <td className="p-3">{r.status === "opted_out" ? <span className="text-xs font-semibold text-destructive">Opted out</span> : r.sentAt && !r.spotSavedAt ? <span className="text-xs font-semibold">Yes — sent, no spot saved</span> : "—"}</td>
      </tr>)}</tbody></table></div></section>;

  return <AppShell wide><div className="space-y-4">
    <h1 className="font-display text-2xl font-bold">Hot leads</h1>
    <div className="flex flex-wrap gap-2" role="tablist">{([["likely", "Hot"], ["warm", "Warm"], ["test", "TEST (Jo only)"], ["dupes", "Possible duplicates"]] as const).map(([k, l]) => <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} onClick={() => { setTab(k); setProgress(null); }}>{l}</Button>)}</div>
    {tab === "warm" && <p className="text-sm text-muted-foreground">Needs onsite confirmation, no insulation, owner-entered area. Nothing is ticked; the Save my spot email isn't approved for these homes yet.</p>}
    {tab === "test" && <p className="text-sm text-muted-foreground">TEST jobs only. Emails go to Jo's test inbox and nobody else.</p>}
    {tab === "dupes" ? <Duplicates /> : isPending ? <p role="status">Loading leads…</p> : error ? <p role="alert" className="text-destructive">Could not load leads: {(error as Error).message}</p> : data && <>
      <div className="flex flex-wrap gap-3 text-sm"><strong>{rows.length} leads</strong>{tab !== "test" && <><span>Ready to send {ready.length}</span><span>Held {hold.length}</span><span>{data.duplicates} duplicate records hidden</span></>}</div>
      {tab === "likely" && <div className="flex flex-wrap gap-2">{counts.map(([region, n]) => <span key={region} className="rounded-full border px-3 py-1 text-sm">{region} {n}</span>)}</div>}
      <div className="sticky top-0 z-10 rounded-2xl border bg-card p-4">
        <Button size="lg" className="h-12 text-base" disabled={!picked.length || !!blocker || !canSendHere || !!progress?.startsWith("Sending")} onClick={() => setConfirm(true)}>Send Save my spot to {picked.length} selected</Button>
        {!canSendHere && <p className="mt-2 text-sm font-semibold">{tab === "warm" ? "Warm leads can't be sent the Save my spot email yet." : "Sending is switched off. Ask Claude to switch it on."}</p>}
        {blocker && <p className="mt-2 text-sm font-semibold text-destructive">{blocker}</p>}
        {progress && <p role="status" className="mt-2 text-sm">{progress}</p>}
      </div>
      {tab === "likely" ? <>{table(ready, "Ready to send")}{table(hold, "Hold — no local trade confirmed yet")}{table(awaiting, "Sent — waiting for the owner")}{table(saved, "Spot saved ✓")}{table(optedOut, "Opted out")}</> : table(rows, tab === "warm" ? "Warm" : "TEST jobs")}
      {tab === "likely" && data.skipped.length > 0 && <section className="mt-6"><h2 className="font-display text-xl font-bold">Not on this list ({data.skipped.length})</h2>
        <p className="text-sm text-muted-foreground">Likely eligible website leads left out, and why.</p>
        <div className="mt-3 overflow-x-auto rounded-2xl border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr><th className="p-3">Job</th><th className="p-3">Name</th><th className="p-3">Why</th></tr></thead>
          <tbody className="divide-y">{data.skipped.map((x, i) => <tr key={`${x.jobNumber}-${i}`}><td className="p-3">{x.jobNumber}</td><td className="p-3">{x.name ?? "—"}</td><td className="p-3">{x.reason}</td></tr>)}</tbody></table></div></section>}
    </>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Send to {picked.length} homeowners?</AlertDialogTitle><AlertDialogDescription>These are real customers. This can't be undone. Each home is only ever sent this email once.</AlertDialogDescription></AlertDialogHeader>
      <ul className="max-h-60 overflow-y-auto text-sm">{picked.map((r) => <li key={r.id}>{r.jobNumber} — {r.name} ({r.email})</li>)}</ul>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={runSend}>Send</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {previewing && <PreviewEmail row={previewing} onClose={() => setPreviewing(null)} />}
    {editing && <EditEmail row={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["hot-leads"] }); }} />}
  </div></AppShell>;
}

function EditEmail({ row, onClose }: { row: Row; onClose: () => void }) {
  const save = useServerFn(editHotLeadEmail);
  const [email, setEmail] = useState(row.email ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = !email.trim();
  const suggested = (row.email ?? "").replace(/@gmai\.com$/i, "@gmail.com").replace(/@gmial\.com$/i, "@gmail.com").replace(/@hotmial\.com$/i, "@hotmail.com");
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Edit email for {row.jobNumber}</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">The change is recorded in job history.</p>
    {suggested !== row.email && suggested !== email && <Button type="button" variant="outline" onClick={() => setEmail(suggested)}>Use {suggested}</Button>}
    <label className="text-sm font-medium">Email<Input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label className="text-sm font-medium">Reason (optional)<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. typo fixed" /></label>
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    <Button disabled={busy || missing} onClick={async () => { setBusy(true); setErr(null); try { await save({ data: { jobId: row.id, email, reason: reason.trim().length >= 5 ? reason : "Email corrected by office" } }); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save email"}</Button>
  </DialogContent></Dialog>;
}

function Duplicates() {
  const load = useServerFn(getPossibleDuplicates);
  const { data, isPending, error } = useQuery({ queryKey: ["possible-duplicates"], queryFn: () => load() });
  if (isPending) return <p role="status">Looking for duplicates…</p>;
  if (error) return <p role="alert" className="text-destructive">Could not check duplicates: {(error as Error).message}</p>;
  return <section><p className="text-sm text-muted-foreground">Same owner (email or mobile) and same address on more than one open job. Nothing is merged or deleted — Jo decides. The newest is shown first.</p>
    <p className="mt-2 font-semibold">{data.length} possible duplicate groups</p>
    <div className="mt-3 space-y-3">{data.map((g) => <div key={g.jobs[0]!.id} className="rounded-2xl border bg-card p-4 text-sm"><div className="font-semibold">{g.jobs[0]!.name} · {g.jobs[0]!.address}</div>
      <ul className="mt-2 space-y-1">{g.jobs.map((j, i) => <li key={j.id}><Link to="/admin/jobs/$jobId" params={{ jobId: j.id }} className="font-semibold text-primary underline">{j.jobNumber}</Link> · {new Date(j.createdAt).toLocaleDateString("en-AU")} · {j.stage.replace(/_/g, " ")} {i === 0 ? "· newest" : ""}</li>)}</ul></div>)}</div></section>;
}

function PreviewEmail({ row, onClose }: { row: Row; onClose: () => void }) {
  const preview = useServerFn(previewHotLeadEmail);
  const test = useServerFn(sendHotLeadTestToJo);
  const { data, isPending, error } = useQuery({ queryKey: ["hot-lead-preview", row.id], queryFn: () => preview({ data: { jobId: row.id } }) });
  const [testMsg, setTestMsg] = useState<string | null>(null);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{row.jobNumber} — {row.name}</DialogTitle></DialogHeader>
    {isPending ? <p role="status">Preparing preview…</p> : error ? <p className="text-destructive">{(error as Error).message}</p> : data?.preview ? <>
      <p className="text-sm"><strong>To:</strong> {data.preview.to}<br /><strong>Subject:</strong> {data.preview.subject}</p>{!data.preview.linksReady && <p role="status" className="text-xs text-muted-foreground">Preview only: this home has no unsubscribe or referral link yet, so those links are placeholders here. Real links are created only when the email is actually sent.</p>}
      <iframe title="Email preview" srcDoc={data.preview.html} className="h-[60vh] w-full rounded-xl border bg-background" />
    </> : <p className="font-semibold text-destructive">Can't be sent: {data?.detail}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={!data?.preview || testMsg === "Sending…"} onClick={async () => { setTestMsg("Sending…"); try { const r = await test({ data: { jobId: row.id } }); setTestMsg(r.detail); } catch (e) { setTestMsg((e as Error).message); } }}>Send a test to jolowexo@hotmail.com</Button>
      {testMsg && <span role="status" className="text-sm">{testMsg}</span>}
    </div>
    <p className="text-xs text-muted-foreground">The test copy uses this owner's name, address and prices, but its buttons open TEST job HV-1609, so pressing them won't change this lead.</p>
  </DialogContent></Dialog>;
}
