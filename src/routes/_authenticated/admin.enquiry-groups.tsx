import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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

  const rows = data?.rows ?? [];
  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<EnquiryGroup, number>;
    const o = Object.fromEntries(OTHER_ORDER.map((g) => [g, 0])) as Record<OtherReason, number>;
    for (const r of rows) { c[r.group]++; if (r.otherReason) o[r.otherReason]++; }
    return { c, o };
  }, [rows]);
  const matching = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.group === group && (group !== "other" || !reason || r.otherReason === reason)
      && (!s || [r.name, r.email, r.address, r.jobNumber, r.reason].some((v) => v?.toLowerCase().includes(s))));
  }, [rows, group, reason, q]);
  const pageRows = matching.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const pick = (g: EnquiryGroup, r: OtherReason | null = null) => { setGroup(g); setReason(r); setPage(0); setSel(new Set()); };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allMatchingSelected = matching.length > 0 && matching.every((r) => sel.has(r.id));
  const canPrepare = sel.size > 0 && (group !== "other" || !!reason);

  const runPrepare = async () => {
    setBusy(true);
    try { setPrep(await prepare({ data: { ids: [...sel], group, otherReason: group === "other" ? reason : null } })); }
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
        <Link to="/admin" search={{ tab: "enquiries" }} className="text-sm font-semibold text-primary underline">Back to Enquiries</Link>
      </div>
      {isLoading ? <div role="status" className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Loading enquiries…</div>
      : isError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Could not load enquiries: {(error as Error)?.message}. <button className="underline" onClick={() => refetch()}>Try again</button></div>
      : <>
        <p data-testid="scope" className="mb-3 text-xs text-muted-foreground">
          Showing all {data!.scope.total} records: {data!.scope.websiteJobs} website enquiries + {data!.scope.calculatorListed} calculator registrations not matched to an enquiry ({data!.scope.calculatorMatched} matched by email and not listed twice). {data!.scope.testHidden} TEST records hidden.
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
        {group === "likely_no_size" && <p className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">Assumed area: {ASSUMED_REFERENCE_AREA_M2} m² from the existing estimator setting (typical Victorian home). It is only used for the preliminary estimate and is never saved as the owner's or a measured size.</p>}
        {group === "insulation_check" && <p className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">The calculator + video request can't be prepared yet: there is no approved email for it and no secure no-login video upload for owners. A video never confirms eligibility or replaces the free Ready Check.</p>}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input aria-label="Search" placeholder="Search name, email, address, job…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="max-w-sm" />
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
                  <td className="p-2"><div className="font-semibold">{r.kind === "job" ? <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">{r.name ?? "—"}</Link> : r.name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.kind === "calculator" ? "Calculator registration" : r.jobNumber}{r.contactFlags.duplicate ? " · repeat enquiry" : ""}</div></td>
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
            <DialogDescription>Review only. Nothing has been sent, queued or saved. Each recipient would get their own email — never a shared or BCC list.</DialogDescription>
          </DialogHeader>
          {prep && <div className="space-y-3 text-sm">
            <div role="status" className="rounded-md border border-warning/40 bg-warning/5 p-3 font-semibold">{prep.sendState}</div>
            {prep.template.key === null
              ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">Blocked: {prep.template.blocked}</div>
              : <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"><dt className="font-semibold">Template</dt><dd>{prep.template.label}</dd><dt className="font-semibold">Subject</dt><dd>{prep.template.subject}</dd></dl>}
            <p><strong data-testid="recipient-count">{prep.recipients}</strong> of {prep.selected} selected would receive an email · {prep.excluded.length} excluded</p>
            {prep.drafts.length > 0 && <div><h3 className="font-semibold">Recipients</h3><ul className="mt-1 divide-y rounded-md border text-xs">{prep.drafts.map((d) => <li key={d.id} className="p-2"><strong>{d.name ?? "—"}</strong> · {d.email} · {d.area.m2 != null ? `${d.area.m2} m² (${d.area.label})` : "no area"} · {d.link}</li>)}</ul></div>}
            {prep.excluded.length > 0 && <div><h3 className="font-semibold">Excluded and why</h3><ul className="mt-1 divide-y rounded-md border text-xs">{prep.excluded.map((d) => <li key={d.id} className="p-2"><strong>{d.name ?? "—"}</strong>{d.email ? ` · ${d.email}` : ""} — {d.reason}</li>)}</ul></div>}
            <p className="text-xs text-muted-foreground">Estimates are preliminary and not binding. Group and contact checks run again at send time.</p>
          </div>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
