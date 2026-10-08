import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEnquiryGroups, getLeadMedia, removeLeadsFn, reviewLeadMediaFn, existingInsulationSaveSpotFn } from "@/lib/enquiry-groups.functions";
import { MEDIA_OUTCOME_LABEL, STATUS_LABEL, STATUS_ORDER, type EnquiryStatus, type MediaReviewOutcome } from "@/lib/enquiry-groups.core";

export const Route = createFileRoute("/_authenticated/admin/enquiry-groups")({
  head: () => ({ meta: [
    { title: "Leads – Home Insulation Victoria Operations" },
    { name: "description", content: "One current outcome for every Home Insulation Victoria homeowner enquiry." },
    { property: "og:title", content: "Leads – Home Insulation Victoria Operations" },
    { property: "og:description", content: "One current outcome for every homeowner enquiry." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: LeadsPage,
});

type Data = Awaited<ReturnType<typeof getEnquiryGroups>>;
type Row = Data["rows"][number];
const PAGE = 50;
const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

function ExistingInsulationFollowup({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const action = useServerFn(existingInsulationSaveSpotFn);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const run = async (previewOnly: boolean) => {
    setBusy(true); setMessage(null);
    try {
      const r = await action({ data: { jobId, preview: previewOnly } });
      setMessage(r.detail);
      if (r.preview) setPreview(r.preview);
      if (!previewOnly && r.outcome === "sent") onDone();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare the follow-up. Try again."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">Preliminary only. The free Ready Check confirms insulation, eligibility and price.</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>Preview Save your spot</Button><Button size="sm" disabled={busy} onClick={() => run(false)}>Send Save your spot</Button></div>{message && <p role="status" className="text-sm">{message}</p>}{preview && <><p className="text-sm font-semibold">{preview.subject}</p><iframe title="Existing-insulation Save your spot email" sandbox="" srcDoc={preview.html} className="h-[650px] w-full border" /></>}</div>;
}

function MediaReview({ row, onDone }: { row: Row; onDone: () => void }) {
  const loadMedia = useServerFn(getLeadMedia);
  const review = useServerFn(reviewLeadMediaFn);
  const { data, isLoading, error } = useQuery({ queryKey: ["lead-media", row.id], queryFn: () => loadMedia({ data: { jobId: row.id } }) });
  const [busy, setBusy] = useState<MediaReviewOutcome | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const act = async (outcome: MediaReviewOutcome) => {
    setBusy(outcome);
    try {
      await review({ data: { jobId: row.id, outcome } });
      setSaved(MEDIA_OUTCOME_LABEL[outcome]);
      onDone();
    } finally { setBusy(null); }
  };
  return <div className="space-y-3 rounded-md border bg-muted/20 p-3">
    {isLoading ? <p role="status" className="text-sm">Loading photos…</p> : error ? <p role="alert" className="text-sm text-destructive">Could not load the photos. Try again.</p> : <>
      <div className="flex flex-wrap gap-3">
        {(data?.files ?? []).map((f) => f.mimeType?.startsWith("video/")
          ? <video key={f.id} src={f.url} controls className="h-40 rounded-md border bg-black" />
          : <a key={f.id} href={f.url} target="_blank" rel="noopener"><img src={f.url} alt={`Uploaded by ${row.name ?? "owner"}`} className="h-40 rounded-md border object-cover" /></a>)}
        {data?.pendingSync && <p role="status" className="text-sm">Original enquiry attachments are awaiting import. Do not ask the owner to upload again.</p>}
        {data && data.files.length === 0 && !data.pendingSync && <p className="text-sm text-muted-foreground">No files found.</p>}
      </div>
      {saved ? <p role="status" className="text-sm font-semibold text-primary">Saved: {saved}</p> : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => act("below_r2")}>{MEDIA_OUTCOME_LABEL.below_r2}</Button>
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => act("over_r2")}>{MEDIA_OUTCOME_LABEL.over_r2}</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("unclear")}>{MEDIA_OUTCOME_LABEL.unclear}</Button>
        </div>
      )}
    </>}
  </div>;
}

function LeadsPage() {
  const load = useServerFn(getEnquiryGroups);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["leads-one-list"], queryFn: () => load({ data: {} }), refetchInterval: 30_000 });
  const [tab, setTab] = useState<EnquiryStatus | "photos" | "removed">("needs_attention");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const remove = useServerFn(removeLeadsFn);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("Fake or test enquiry");
  const allRows = data?.rows ?? [];
  const rows = useMemo(() => allRows.filter((row) => !row.removed), [allRows]);
  const removedRows = useMemo(() => allRows.filter((row) => row.removed), [allRows]);
  const doRemove = async () => {
    const ids = [...picked].filter((id) => rows.some((r) => r.id === id && r.kind === "job"));
    if (!ids.length) return;
    const reason = removeReason.trim() || "Fake or test enquiry";
    setRemoving(true);
    try { const r = await remove({ data: { ids, reason: reason.trim() } }); setRemoveMsg(`Removed ${r.removed} lead${r.removed === 1 ? "" : "s"}.`); setPicked(new Set()); await refetch(); }
    catch (e) { setRemoveMsg((e as Error).message); }
    finally { setRemoving(false); }
  };
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((key) => [key, rows.filter((row) => row.status === key).length])) as Record<EnquiryStatus, number>, [rows]);
  const photoRows = useMemo(() => rows.filter((row) => row.mediaCount > 0 && !row.mediaChecked), [rows]);
  const matching = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = tab === "photos" ? photoRows : tab === "removed" ? removedRows : rows.filter((row) => row.status === tab);
    return base.filter((row) => !term || [row.name, row.email, row.address, row.jobNumber].some((value) => value?.toLowerCase().includes(term)));
  }, [rows, photoRows, removedRows, tab, q]);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const visible = matching.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);
  const tabLabel = tab === "photos" ? "Photos to check" : tab === "removed" ? "Removed" : STATUS_LABEL[tab];

  return <AppShell wide><div className="space-y-5">
    <header><h1 className="font-display text-2xl font-bold">Leads</h1><p className="mt-1 text-sm text-muted-foreground">Website homeowner email queue only; installer-supplied and other classified leads are shown separately.</p><Link to="/admin/operations" search={{ category: "leads" }} className="mt-2 inline-flex text-sm font-semibold text-primary underline">All classified leads · both sources, saved spots and media review</Link></header>
    {isLoading ? <p role="status">Loading leads…</p> : error || !data ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Could not load leads. <Button variant="link" onClick={() => refetch()}>Try again</Button></div> : <>
      <p className="text-xs text-muted-foreground">{data.scope.total} current website enquiries. Excluded from this list: {data.scope.duplicateWebsiteEnquiries} older duplicate enquiries, {data.scope.testHidden} TEST, {data.scope.installerSourced} installer customers and {data.scope.calculatorRegistrations} calculator-only registrations.</p>
      <div role="tablist" aria-label="Lead outcomes" className="grid grid-cols-2 gap-3 md:grid-cols-7">
        {STATUS_ORDER.map((key) => <Button key={key} role="tab" aria-selected={tab === key} variant={tab === key ? "default" : "outline"} className="h-auto min-h-20 flex-col items-start px-4 py-3 text-left" onClick={() => { setTab(key); setPage(0); }}><span className="font-display text-2xl font-bold">{counts[key]}</span><span className="whitespace-normal text-sm">{STATUS_LABEL[key]}</span></Button>)}
        <Button role="tab" aria-selected={tab === "photos"} variant={tab === "photos" ? "default" : "outline"} className="h-auto min-h-20 flex-col items-start px-4 py-3 text-left" onClick={() => { setTab("photos"); setPage(0); }}><span className="font-display text-2xl font-bold">{photoRows.length}</span><span className="whitespace-normal text-sm">Photos to check</span></Button>
        <Button role="tab" aria-selected={tab === "removed"} variant={tab === "removed" ? "default" : "outline"} className="h-auto min-h-20 flex-col items-start px-4 py-3 text-left" onClick={() => { setTab("removed"); setPage(0); setPicked(new Set()); }}><span className="font-display text-2xl font-bold">{removedRows.length}</span><span className="whitespace-normal text-sm">Removed</span></Button>
      </div>
      {tab === "needs_attention" && <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"><strong>Only exceptions appear here.</strong> The reason tells the office what stopped automatic sending. The existing-insulation email is currently held here until Jo approves its final appearance. <a href="/campaign-preview" target="_blank" rel="noopener" className="font-semibold text-primary underline">View that email</a>.</div>}
      {tab === "photos" && <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"><strong>Homeowners who sent photos or videos.</strong> Open each one, look at the pictures, then choose: below R2 moves them to the Save my spot offer, R2 or above moves them to ineligible, and not clear asks for more pictures.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Input aria-label="Search leads" placeholder="Search name, email, address or job" value={q} onChange={(event) => { setQ(event.target.value); setPage(0); }} className="max-w-md" /><div className="flex items-center gap-3">{tab !== "removed" && <Input aria-label="Reason for removing" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} className="h-9 w-56" />}{tab !== "removed" && <Button size="sm" variant="destructive" disabled={picked.size === 0 || removing} onClick={doRemove}>{removing ? "Removing…" : `Remove selected (${picked.size})`}</Button>}<span className="text-sm text-muted-foreground">{matching.length} in {tabLabel}</span></div></div>
      {removeMsg && <p role="status" className="text-sm font-semibold">{removeMsg}</p>}
      <div className="overflow-x-auto rounded-md border bg-card"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="w-10 p-3">{tab !== "removed" && <input type="checkbox" aria-label="Select all on this page" checked={visible.length > 0 && visible.every((r) => picked.has(r.id))} onChange={(e) => setPicked((prev) => { const n = new Set(prev); for (const r of visible) { if (e.target.checked) n.add(r.id); else n.delete(r.id); } return n; })} />}</th><th className="p-3">Homeowner</th><th className="p-3">Property</th><th className="p-3">Outcome</th><th className="p-3">Estimate</th><th className="p-3">When</th><th className="p-3">Next office action</th></tr></thead><tbody className="divide-y">
        {visible.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No leads here.</td></tr>}
        {visible.map((row) => <tr key={row.id} className="align-top hover:bg-muted/30"><td className="p-3">{tab !== "removed" && row.kind === "job" && <input type="checkbox" aria-label={`Select ${row.name ?? row.jobNumber ?? "lead"}`} checked={picked.has(row.id)} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(row.id); else n.delete(row.id); return n; })} />}</td><td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="font-semibold text-primary underline">{row.name ?? "—"}</Link><div className="text-xs text-muted-foreground">{row.jobNumber} · {row.email ?? "No email"}</div></td><td className="p-3">{row.address ?? "—"}</td><td className="p-3 font-semibold">{STATUS_LABEL[row.status]}{row.mediaOutcome ? <div className="text-xs font-normal text-muted-foreground">Photo review: {MEDIA_OUTCOME_LABEL[row.mediaOutcome]}</div> : null}</td><td className="p-3">{row.area.m2 != null ? `${row.area.m2} m²` : "—"}<div className="text-xs text-muted-foreground">{row.areaLabel}</div></td><td className="p-3">{when(row.status === "needs_attention" ? row.outcomeAt : row.lastEmail?.at)}</td><td className="p-3">{tab === "photos" ? (
          <div className="space-y-2">
            <Button size="sm" variant="outline" onClick={() => setOpenId(openId === row.id ? null : row.id)}>{openId === row.id ? "Hide photos" : `View ${row.mediaCount} photo${row.mediaCount === 1 ? "" : "s"}/video`}</Button>
            {openId === row.id && <MediaReview row={row} onDone={() => refetch()} />}
          </div>
        ) : tab === "removed" ? "Removed by office" : row.mediaOutcome === "below_r2" && row.status !== "spot_saved" && row.status !== "ineligible" ? <ExistingInsulationFollowup jobId={row.id} onDone={() => refetch()} /> : row.status === "needs_attention" ? row.attentionReason ?? row.reason : row.status === "spot_saved" ? "Continue from the saved-spot queue" : row.status === "ineligible" ? "No action unless the owner replies" : "Waiting for the homeowner"}</td></tr>)}
      </tbody></table></div>
      <div className="flex items-center justify-end gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {Math.min(page, pages - 1) + 1} of {pages}</span><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </>}
  </div></AppShell>;
}
