import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getEnquiryGroups, prepareEnquiryEmailsFn } from "@/lib/enquiry-groups.functions";
import { GROUP_ACTION, GROUP_LABEL, GROUP_ORDER, OTHER_LABEL, OTHER_ORDER, ASSUMED_REFERENCE_AREA_M2, type EnquiryGroup, type OtherReason } from "@/lib/enquiry-groups.core";

export const Route = createFileRoute("/_authenticated/admin/enquiry-groups")({
  head: () => ({
    meta: [
      { title: "Enquiry email groups – Home Insulation Victoria Operations" },
      { name: "description", content: "Website enquiries sorted into clear groups so the office can prepare the right email for each." },
      { property: "og:title", content: "Enquiry email groups – Home Insulation Victoria Operations" },
      { property: "og:description", content: "Website enquiries grouped for preparing emails." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EnquiryGroups,
});

type Data = Awaited<ReturnType<typeof getEnquiryGroups>>;
type Row = Data["rows"][number];
type Prep = Awaited<ReturnType<typeof prepareEnquiryEmailsFn>>;
const PAGE = 50;

function emailState(r: Row) {
  if (!r.lastEmail) return "None sent";
  const s = r.lastEmail.status;
  const word = s === "sent" ? "Sent" : s === "delivered_unrecorded" ? "Sent (record pending)" : s === "failed" ? "Failed" : s === "sending" ? "Sending" : s;
  return `${r.lastEmail.purpose.replace(/_/g, " ")} · ${word}${r.lastEmail.at ? ` ${r.lastEmail.at.slice(0, 10)}` : ""}`;
}

function EnquiryGroups() {
  const load = useServerFn(getEnquiryGroups);
  const prepare = useServerFn(prepareEnquiryEmailsFn);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["enquiry_groups"], queryFn: () => load({ data: {} }) });
  const [group, setGroup] = useState<EnquiryGroup>("likely_size");
  const [reason, setReason] = useState<OtherReason | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [prep, setPrep] = useState<Prep | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoOnly, setVideoOnly] = useState(false);
  const [assumed, setAssumed] = useState<string>(String(ASSUMED_REFERENCE_AREA_M2));
  const [viewing, setViewing] = useState<{ id: string; html: string; subject: string } | null>(null);

  const rows = data?.rows ?? [];
  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<EnquiryGroup, number>;
    const o = Object.fromEntries(OTHER_ORDER.map((g) => [g, 0])) as Record<OtherReason, number>;
    for (const r of rows) { c[r.group]++; if (r.otherReason) o[r.otherReason]++; }
    return { c, o };
  }, [rows]);
  const matching = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.group === group && (group !== "other" || !reason || r.otherReason === reason) && (!videoOnly || r.videoState === "received")
      && (!s || [r.name, r.email, r.address, r.jobNumber, r.reason].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => (a.videoState === b.videoState ? 0 : a.videoState === "received" ? -1 : 1));
  }, [rows, group, reason, q, videoOnly]);
  useEffect(() => { const ids = new Set(matching.map((r) => r.id)); setSel((s) => { const n = new Set([...s].filter((id) => ids.has(id))); return n.size === s.size ? s : n; }); }, [matching]);
  const pageRows = matching.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const pick = (g: EnquiryGroup, r: OtherReason | null = null) => { setGroup(g); setReason(r); setVideoOnly(false); setPage(0); setSel(new Set()); };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allMatchingSelected = matching.length > 0 && matching.every((r) => sel.has(r.id));
  const canPrepare = sel.size > 0 && (group !== "other" || !!reason);

  const runPrepare = async () => {
    setBusy(true);
    try { setPrep(await prepare({ data: { ids: [...sel], group, otherReason: group === "other" ? reason : null, assumedAreaM2: group === "likely_no_size" ? Number(assumed) : null } })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not prepare"); }
    finally { setBusy(false); }
  };

  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Enquiry email groups</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Every website enquiry sits in exactly one group. Groups are for preparing emails only — they never change a job's stage, eligibility result or delivery status.</p>
        </div>
        <Link to="/admin/jobs" className="text-sm font-semibold text-primary underline">Back to Jobs</Link>
         <Link to="/admin/launch-campaign" className="text-sm font-semibold text-primary underline">Existing leads campaign</Link>
      </div>
      {isLoading ? <div role="status" className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Loading enquiries…</div>
      : isError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Could not load enquiries: {(error as Error)?.message}. <button className="underline" onClick={() => refetch()}>Try again</button></div>
      : <>
        <p data-testid="scope" className="mb-3 text-xs text-muted-foreground">
          Showing all {data!.scope.total} records: {data!.scope.websiteJobs} website enquiries + {data!.scope.calculatorListed} calculator registrations ({data!.scope.calculatorMatched} matched to the same contact and property, not listed twice). Not included: {data!.scope.installerSourced} installer-sourced, {data!.scope.otherSources} staff-entered/other, {data!.scope.testHidden} TEST.
        </p>
        <div role="tablist" aria-label="Email groups" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {GROUP_ORDER.map((g, i) => (
            <button key={g} role="tab" aria-selected={group === g} onClick={() => pick(g)} className={`rounded-lg border p-4 text-left transition ${group === g ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "bg-card hover:bg-muted/40"}`}>
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{i + 1}</span>
              <span className="block font-display text-3xl font-bold">{counts.c[g]}</span>
              <span className="block text-sm font-semibold">{GROUP_LABEL[g]}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{GROUP_ACTION[g]}</span>
            </button>
          ))}
        </div>
        {group === "other" && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Reasons">
            <button onClick={() => pick("other", null)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${!reason ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>All ({counts.c.other})</button>
            {OTHER_ORDER.map((o) => <button key={o} onClick={() => pick("other", o)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${reason === o ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{OTHER_LABEL[o]} ({counts.o[o]})</button>)}
          </div>
        )}
        {group === "likely_no_size" && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs"><label htmlFor="assumed" className="font-semibold">Assumed area for this batch (m²)</label><Input id="assumed" type="number" min={20} max={1000} value={assumed} onChange={(e) => setAssumed(e.target.value)} className="h-8 w-24" /><span>Default {ASSUMED_REFERENCE_AREA_M2} m² is the existing estimator setting (typical home). Used only in these drafts and shown as "Assumed area" – never saved as the owner's or a measured size.</span></div>}
        {group === "insulation_check" && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 text-xs"><label className="flex items-center gap-2 font-semibold"><Checkbox checked={videoOnly} onCheckedChange={(v) => { setVideoOnly(!!v); setPage(0); }} /> Video received – priority review only ({rows.filter((r) => r.group === "insulation_check" && r.videoState === "received").length})</label><span className="text-muted-foreground">Videos sort first. A video never confirms eligibility or replaces the free Ready Check.</span></div>}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input aria-label="Search" placeholder="Search name, email, address, job…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); setSel(new Set()); }} className="max-w-sm" />
          <span className="text-sm text-muted-foreground">{matching.length} matching · <strong data-testid="selected-count">{sel.size} selected</strong></span>
          <Button variant="outline" size="sm" onClick={() => setSel(allMatchingSelected ? new Set() : new Set(matching.map((r) => r.id)))}>{allMatchingSelected ? "Clear selection" : `Select all ${matching.length} matching`}</Button>
          <Button size="sm" disabled={!canPrepare || busy} onClick={runPrepare}>{busy ? "Preparing…" : "Prepare email"}</Button>
          {group === "other" && !reason && <span className="text-xs text-muted-foreground">Pick a reason to prepare an email.</span>}
        </div>

        <div className="mt-3 overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <tr><th className="w-10 p-2"><Checkbox aria-label="Select page" checked={pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))} onCheckedChange={(v) => setSel((s) => { const n = new Set(s); for (const r of pageRows) v ? n.add(r.id) : n.delete(r.id); return n; })} /></th>
                <th className="p-2">Name</th><th className="p-2">Address</th><th className="p-2">Group / reason</th><th className="p-2">Ceiling m²</th><th className="p-2">Video</th><th className="p-2">Last email</th><th className="p-2">Next action</th></tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No enquiries in this group.</td></tr>}
              {pageRows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-muted/30">
                  <td className="p-2"><Checkbox aria-label={`Select ${r.name ?? "enquiry"}`} checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} /></td>
                  <td className="p-2"><div className="font-semibold">{r.kind === "job" ? <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">{r.name ?? "—"}</Link> : r.name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.kind === "calculator" ? "Calculator registration" : r.jobNumber}{r.duplicate ? " · repeat enquiry (same contact + property)" : ""}</div></td>
                  <td className="p-2 text-xs">{r.address ?? "—"}</td>
                  <td className="p-2"><div className="text-xs font-semibold">{r.otherReason ? OTHER_LABEL[r.otherReason] : GROUP_LABEL[r.group]}</div><div className="text-xs text-muted-foreground">{r.reason}</div></td>
                  <td className="p-2 text-xs">{r.area.m2 != null ? `${r.area.m2} m²` : "—"}<div className="text-muted-foreground">{r.areaLabel}</div></td>
                  <td className="p-2 text-xs">{r.videoState === "received" ? <span className="font-semibold text-success">Video received – priority review</span> : "None"}</td>
                  <td className={`p-2 text-xs ${r.lastEmail?.status === "failed" ? "font-semibold text-destructive" : ""}`}>{emailState(r)}</td>
                  <td className="p-2 text-xs font-semibold">{r.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </>}

      <Dialog open={!!prep} onOpenChange={(o) => !o && setPrep(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review prepared emails</DialogTitle>
            <DialogDescription>Review only – works with communications off. Nothing is sent, queued or saved.</DialogDescription>
          </DialogHeader>
          {prep && <div className="space-y-3 text-sm">
            {prep.template.key === null
              ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">Blocked: {prep.template.blocked}</div>
              : <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"><dt className="font-semibold">Template</dt><dd>{prep.template.label}</dd>{prep.assumedAreaM2 != null && <><dt className="font-semibold">Area</dt><dd>Assumed area: {prep.assumedAreaM2} m² (not the owner's answer)</dd></>}</dl>}
            <p><strong data-testid="recipient-count">{prep.recipients}</strong> drafts prepared of {prep.selected} selected · {prep.excluded.length} contacts excluded</p>
            {prep.drafts.length > 0 && <div><h3 className="font-semibold">Personalised drafts</h3><ul className="mt-1 divide-y rounded-md border text-xs">{prep.drafts.map((d) => (
              <li key={d.id} className="space-y-1 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{d.name ?? "—"}</strong> · {d.email} · {d.jobNumber}</span>
                  <Button size="sm" variant="outline" onClick={async () => { const r = await prepare({ data: { ids: [d.id], group, otherReason: group === "other" ? reason : null, assumedAreaM2: group === "likely_no_size" ? Number(assumed) : null, withHtmlFor: d.id } }); const x = r.drafts[0]; x?.html ? setViewing({ id: d.id, html: x.html, subject: x.subject }) : toast.error(r.excluded[0]?.reason ?? "Could not render"); }}>View email</Button></div>
                <div data-testid="draft-subject"><span className="font-semibold">Subject:</span> {d.subject}</div>
                <div className="text-muted-foreground">{d.area.m2 != null ? `${d.area.m2} m² · ${d.area.label}` : "No area"} · {d.link}</div>
                <div className="flex flex-wrap gap-1">{d.holds.map((h) => <span key={h} className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold">Send hold: {h}</span>)}</div>
              </li>))}</ul></div>}
            {prep.excluded.length > 0 && <div><h3 className="font-semibold">Excluded contacts and why</h3><ul className="mt-1 divide-y rounded-md border text-xs">{prep.excluded.map((d) => <li key={d.id} className="p-2"><strong>{d.name ?? "—"}</strong>{d.email ? ` · ${d.email}` : ""} — {d.reason}</li>)}</ul></div>}
            <p className="text-xs text-muted-foreground">{prep.sendState} Each person would get their own email — never a shared or BCC list. Estimates are preliminary and not binding.</p>
          </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Draft email preview</DialogTitle><DialogDescription>{viewing?.subject} · links are placeholders until a real send.</DialogDescription></DialogHeader>
          {viewing && <iframe title="Draft email" sandbox="" srcDoc={viewing.html} className="h-[70vh] w-full rounded border bg-white" />}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
