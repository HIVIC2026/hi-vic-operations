import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEnquiryGroups } from "@/lib/enquiry-groups.functions";
import { STATUS_LABEL, STATUS_ORDER, type EnquiryStatus } from "@/lib/enquiry-groups.core";

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
const PAGE = 50;
const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

function LeadsPage() {
  const load = useServerFn(getEnquiryGroups);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["leads-one-list"], queryFn: () => load({ data: {} }), refetchInterval: 30_000 });
  const [status, setStatus] = useState<EnquiryStatus>("needs_attention");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const rows = data?.rows ?? [];
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((key) => [key, rows.filter((row) => row.status === key).length])) as Record<EnquiryStatus, number>, [rows]);
  const matching = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => row.status === status && (!term || [row.name, row.email, row.address, row.jobNumber].some((value) => value?.toLowerCase().includes(term))));
  }, [rows, status, q]);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE));
  const visible = matching.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);

  return <AppShell wide><div className="space-y-5">
    <header><h1 className="font-display text-2xl font-bold">Leads</h1><p className="mt-1 text-sm text-muted-foreground">Every website homeowner appears once, under their current outcome.</p></header>
    {isLoading ? <p role="status">Loading leads…</p> : error || !data ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Could not load leads. <Button variant="link" onClick={() => refetch()}>Try again</Button></div> : <>
      <p className="text-xs text-muted-foreground">{data.scope.total} current website enquiries. Excluded from this list: {data.scope.duplicateWebsiteEnquiries} older duplicate enquiries, {data.scope.testHidden} TEST, {data.scope.installerSourced} installer customers and {data.scope.calculatorRegistrations} calculator-only registrations.</p>
      <div role="tablist" aria-label="Lead outcomes" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STATUS_ORDER.map((key) => <Button key={key} role="tab" aria-selected={status === key} variant={status === key ? "default" : "outline"} className="h-auto min-h-20 flex-col items-start px-4 py-3 text-left" onClick={() => { setStatus(key); setPage(0); }}><span className="font-display text-2xl font-bold">{counts[key]}</span><span className="whitespace-normal text-sm">{STATUS_LABEL[key]}</span></Button>)}
      </div>
      {status === "needs_attention" && <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"><strong>Only exceptions appear here.</strong> The reason tells the office what stopped automatic sending. The existing-insulation email is currently held here until Jo approves its final appearance. <a href="/campaign-preview" target="_blank" rel="noopener" className="font-semibold text-primary underline">View that email</a>.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Input aria-label="Search leads" placeholder="Search name, email, address or job" value={q} onChange={(event) => { setQ(event.target.value); setPage(0); }} className="max-w-md" /><span className="text-sm text-muted-foreground">{matching.length} in {STATUS_LABEL[status]}</span></div>
      <div className="overflow-x-auto rounded-md border bg-card"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="p-3">Homeowner</th><th className="p-3">Property</th><th className="p-3">Outcome</th><th className="p-3">Estimate</th><th className="p-3">When</th><th className="p-3">Next office action</th></tr></thead><tbody className="divide-y">
        {visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No leads here.</td></tr>}
        {visible.map((row) => <tr key={row.id} className="align-top hover:bg-muted/30"><td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="font-semibold text-primary underline">{row.name ?? "—"}</Link><div className="text-xs text-muted-foreground">{row.jobNumber} · {row.email ?? "No email"}</div></td><td className="p-3">{row.address ?? "—"}</td><td className="p-3 font-semibold">{STATUS_LABEL[row.status]}</td><td className="p-3">{row.area.m2 != null ? `${row.area.m2} m²` : "—"}<div className="text-xs text-muted-foreground">{row.areaLabel}</div></td><td className="p-3">{when(row.status === "needs_attention" ? row.outcomeAt : row.lastEmail?.at)}</td><td className="p-3">{row.status === "needs_attention" ? row.attentionReason ?? row.reason : row.status === "spot_saved" ? "Continue from the saved-spot queue" : row.status === "ineligible" ? "No action unless the owner replies" : "Waiting for the homeowner"}</td></tr>)}
      </tbody></table></div>
      <div className="flex items-center justify-end gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm">Page {Math.min(page, pages - 1) + 1} of {pages}</span><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </>}
  </div></AppShell>;
}