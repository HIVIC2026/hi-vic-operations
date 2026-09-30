import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, CircleHelp, MapPinned, XCircle } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAdminCoverage } from "@/lib/coverage.functions";

export const Route = createFileRoute("/_authenticated/admin/coverage")({
  head: () => ({ meta: [{ title: "Service Coverage – HI VIC Portal" }, { name: "description", content: "REC and installer service coverage for active HI VIC enquiries." }, { property: "og:title", content: "Service Coverage – HI VIC Portal" }, { property: "og:description", content: "REC and installer service coverage for active HI VIC enquiries." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: CoveragePage,
});

const labels = { serviceable: "Serviceable", partial: "Partial / verify", unserviceable: "Not covered", not_configured: "Not configured" } as const;
const tones = { serviceable: "border-success/30 bg-success-soft text-success", partial: "border-warning/40 bg-warning-soft text-foreground", unserviceable: "border-danger/40 bg-danger-soft text-danger", not_configured: "border-muted bg-muted text-muted-foreground" } as const;
const icons = { serviceable: CheckCircle2, partial: AlertTriangle, unserviceable: XCircle, not_configured: CircleHelp } as const;

function StateBadge({ state }: { state: keyof typeof labels }) {
  const Icon = icons[state];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${tones[state]}`}><Icon className="h-3.5 w-3.5" />{labels[state]}</span>;
}

function CoveragePage() {
  const load = useServerFn(getAdminCoverage);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["admin-coverage"], queryFn: () => load(), retry: 3, staleTime: 30_000 });
  const rows = data?.rows ?? [];
  const counts = { serviceable: rows.filter((row) => row.overall === "serviceable").length, partial: rows.filter((row) => row.overall === "partial" || row.overall === "not_configured").length, unserviceable: rows.filter((row) => row.overall === "unserviceable").length };
  return <AppShell wide>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><MapPinned className="h-6 w-6 text-primary" /> Service coverage</h1><p className="mt-1 text-sm text-muted-foreground">Verified postcode coverage for both trades required on every active enquiry.</p></div>
      <Button asChild variant="outline"><Link to="/admin/businesses">Manage partner coverage</Link></Button>
    </div>
    <section className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Coverage summary">
      <div className="rounded-md border border-l-4 border-l-success bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Fully serviceable</div><div className="mt-1 text-2xl font-bold">{counts.serviceable}</div><div className="text-xs text-muted-foreground">REC and installer confirmed</div></div>
      <div className="rounded-md border border-l-4 border-l-warning bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Needs verification</div><div className="mt-1 text-2xl font-bold">{counts.partial}</div><div className="text-xs text-muted-foreground">One trade missing or coverage unverified</div></div>
      <div className="rounded-md border border-l-4 border-l-danger bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Not covered</div><div className="mt-1 text-2xl font-bold">{counts.unserviceable}</div><div className="text-xs text-muted-foreground">No eligible verified partner</div></div>
    </section>
    {error && <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Coverage could not be loaded. Existing records are safe. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
    {isPending ? <div role="status" className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Checking coverage…</div> : <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground"><tr><th className="p-3">Enquiry</th><th className="p-3">Area</th><th className="p-3">REC / electrician</th><th className="p-3">Installer</th><th className="p-3">Overall</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="font-bold text-primary hover:underline">{row.job_number}</Link><div className="max-w-64 truncate text-xs text-muted-foreground">{row.address}</div></td><td className="p-3">{[row.suburb, row.postcode].filter(Boolean).join(" ") || <span className="text-danger">Missing postcode</span>}</td><td className="p-3"><StateBadge state={row.rec.state} /><div className="mt-1 max-w-72 text-xs text-muted-foreground">{row.rec.matches.map((item) => item.name).join(", ") || row.rec.declared.map((item) => `${item.name}: ${item.description}`).join("; ") || "No eligible verified REC"}</div></td><td className="p-3"><StateBadge state={row.installer.state} /><div className="mt-1 max-w-72 text-xs text-muted-foreground">{row.installer.matches.map((item) => item.name).join(", ") || row.installer.declared.map((item) => `${item.name}: ${item.description}`).join("; ") || "No eligible verified installer"}</div></td><td className="p-3"><StateBadge state={row.overall} /></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No active enquiries to assess.</td></tr>}
      </tbody></table>
    </div>}
    <section className="mt-5"><h2 className="mb-2 text-lg font-bold">Partner coverage setup</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(data?.partners ?? []).map((partner) => <div key={partner.id} className="rounded-md border bg-card p-4"><div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{partner.name}</div><div className="text-xs text-muted-foreground">{partner.business_type === "rec" ? "REC / electrician" : "Installer"}</div></div><Badge variant="outline">{partner.coverage_verified_at ? "Verified" : "Needs setup"}</Badge></div><div className="mt-2 text-xs"><b>Postcodes:</b> {partner.service_postcodes.join(", ") || "None"}</div>{partner.declared_service_origin && <div className="mt-1 text-xs text-muted-foreground">Declared: {partner.declared_service_origin}{partner.declared_travel_radius_km ? ` · ${partner.declared_travel_radius_km === 9999 ? "Anywhere VIC" : `${partner.declared_travel_radius_km} km`}` : ""}</div>}{partner.declared_excluded_areas && <div className="mt-1 text-xs text-warning">Exclusions: {partner.declared_excluded_areas}</div>}{partner.business_type === "eec_installer" && <div className="mt-1 text-xs">Free quote-lead measure-ups: <b>{partner.free_measureups_for_hivic_quote_leads === true ? "Yes" : partner.free_measureups_for_hivic_quote_leads === false ? "No" : "Not recorded"}</b></div>}</div>)}</div></section>
  </AppShell>;
}