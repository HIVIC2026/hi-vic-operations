import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, CircleHelp, MapPinned, UsersRound, XCircle } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAdminCoverage } from "@/lib/coverage.functions";
import { groupAreasByRegion } from "@/lib/coverage-regions.core";

export const Route = createFileRoute("/_authenticated/admin/coverage")({
  head: () => ({ meta: [{ title: "Service Coverage – Home Insulation Victoria Portal" }, { name: "description", content: "REC and installer team capacity and service coverage for Home Insulation Victoria." }, { property: "og:title", content: "Service Coverage – Home Insulation Victoria Portal" }, { property: "og:description", content: "REC and installer team capacity and service coverage for Home Insulation Victoria." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: CoveragePage,
});

const labels = { serviceable: "Covered", partial: "Verify", unserviceable: "Gap", not_configured: "Not set up" } as const;
const tones = { serviceable: "border-success/30 bg-success-soft text-success", partial: "border-warning/40 bg-warning-soft text-foreground", unserviceable: "border-danger/40 bg-danger-soft text-danger", not_configured: "border-muted bg-muted text-muted-foreground" } as const;
const icons = { serviceable: CheckCircle2, partial: AlertTriangle, unserviceable: XCircle, not_configured: CircleHelp } as const;

function StateBadge({ state }: { state: keyof typeof labels }) {
  const Icon = icons[state];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${tones[state]}`}><Icon className="h-3.5 w-3.5" />{labels[state]}</span>;
}

function PartnerNames({ matches, empty }: { matches: Array<{ id: string; name: string }>; empty: string }) {
  if (!matches.length) return <span className="text-danger">{empty}</span>;
  return <span>{matches.map((match) => match.name).join(", ")}</span>;
}

function CoveragePage() {
  const load = useServerFn(getAdminCoverage);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["admin-coverage"], queryFn: () => load(), retry: 3, staleTime: 30_000 });
  const rows = data?.rows ?? [];
  const partners = (data?.partners ?? []).map((partner) => ({
    ...partner,
    capabilities: partner.capabilities ?? [],
    service_postcodes: partner.service_postcodes ?? [],
    workers: partner.workers ?? [],
    members: partner.members ?? [],
  }));
  const areas = data?.areas ?? [];
  const regions = groupAreasByRegion(areas);
  const maxRegion = Math.max(1, ...regions.map((r) => r.enquiryCount));
  const readyPartners = partners.filter((partner) => !partner.blocker && !!partner.coverage_verified_at && partner.service_postcodes.length > 0);
  const recPartners = readyPartners.filter((partner) => partner.business_type === "rec" || partner.capabilities?.includes("electrician"));
  const installerPartners = readyPartners.filter((partner) => partner.business_type === "eec_installer" || partner.capabilities?.includes("installer"));
  const readyIds = new Set(readyPartners.map((partner) => partner.id));
  const approvedWorkers = partners.flatMap((partner) => readyIds.has(partner.id) ? partner.workers.filter((worker) => worker.approved) : []);
  const verifiedPostcodes = new Set(readyPartners.flatMap((partner) => partner.service_postcodes));
  const setupGaps = partners.filter((partner) => partner.blocker || !partner.coverage_verified_at || !partner.service_postcodes.length).length;
  const enquiryCounts = { serviceable: rows.filter((row) => row.overall === "serviceable").length, partial: rows.filter((row) => row.overall === "partial" || row.overall === "not_configured").length, unserviceable: rows.filter((row) => row.overall === "unserviceable").length };

  return <AppShell wide>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><MapPinned className="h-6 w-6 text-primary" /> Service coverage</h1><p className="mt-1 text-sm text-muted-foreground">Where our teams operate, who is available, and where we need partner coverage.</p></div>
      <Button asChild variant="outline"><Link to="/admin/businesses">Manage partner coverage</Link></Button>
    </div>

    {error && <div role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Coverage could not be loaded. Existing records are safe. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
    {isPending ? <div role="status" className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Checking teams and coverage…</div> : <>
      <section className="mb-6" aria-labelledby="network-heading">
        <h2 id="network-heading" className="mb-3 text-lg font-bold">Network at a glance</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-md border border-l-4 border-l-primary bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Ready REC businesses</div><div className="mt-1 text-3xl font-bold">{recPartners.length}</div><div className="text-xs text-muted-foreground">Approved and coverage verified</div></div>
          <div className="rounded-md border border-l-4 border-l-success bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Ready installers</div><div className="mt-1 text-3xl font-bold">{installerPartners.length}</div><div className="text-xs text-muted-foreground">Approved and coverage verified</div></div>
          <div className="rounded-md border border-l-4 border-l-primary bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Approved field people</div><div className="mt-1 text-3xl font-bold">{approvedWorkers.length}</div><div className="text-xs text-muted-foreground">Across ready partner businesses</div></div>
          <div className="rounded-md border border-l-4 border-l-success bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Verified postcodes</div><div className="mt-1 text-3xl font-bold">{verifiedPostcodes.size}</div><div className="text-xs text-muted-foreground">Exact or grouped coverage entries</div></div>
          <div className="rounded-md border border-l-4 border-l-warning bg-card p-4"><div className="text-sm font-semibold text-muted-foreground">Partner setup gaps</div><div className="mt-1 text-3xl font-bold">{setupGaps}</div><div className="text-xs text-muted-foreground">Approval, credentials or area setup</div></div>
        </div>
      </section>

      <section className="mb-6" aria-labelledby="area-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="area-heading" className="text-lg font-bold">Where our enquiries are, and who covers them</h2><p className="text-sm text-muted-foreground">Suburbs are grouped into regions of Victoria. Darker tiles have more enquiries; the colour shows whether we have a verified REC and installer there.</p></div><Badge variant="outline">{areas.length} suburbs in {regions.filter((r) => r.enquiryCount > 0).length} regions</Badge></div>
        <div className="mb-4 rounded-md border bg-card p-3">
          <div className="grid grid-cols-6 gap-1.5" style={{ gridTemplateRows: "repeat(4, minmax(64px, auto))" }} role="list" aria-label="Schematic map of Victoria regions">
            {regions.map((region) => {
              const tone = region.state === "covered" ? "border-success bg-success-soft" : region.state === "partial" ? "border-warning bg-warning-soft" : region.state === "gap" ? "border-danger bg-danger-soft" : "border-dashed border-muted bg-muted/40";
              const weight = region.enquiryCount ? Math.min(1, 0.35 + region.enquiryCount / maxRegion) : 1;
              return <a key={region.id} role="listitem" href={`#region-${region.id}`} style={{ gridColumn: region.col, gridRow: region.row, opacity: weight }} className={`flex flex-col justify-between rounded-md border-2 p-1.5 text-left hover:ring-2 hover:ring-primary ${tone}`}>
                <span className="text-[11px] font-semibold leading-tight sm:text-xs">{region.name}</span>
                <span className="text-lg font-bold leading-none sm:text-2xl">{region.enquiryCount}<span className="ml-1 text-[10px] font-normal text-muted-foreground">enq</span></span>
              </a>;
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-success" />REC + installer verified</span><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-warning" />Some teams</span><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-danger" />No teams yet</span><span>Map is schematic (approximate postcode regions), not to scale.</span></div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {regions.filter((r) => r.enquiryCount > 0).sort((a, b) => b.enquiryCount - a.enquiryCount).map((region) => (
            <div key={region.id} id={`region-${region.id}`} className="rounded-md border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-semibold uppercase text-muted-foreground">{region.group}</div><h3 className="text-base font-bold">{region.name}</h3></div><div className="text-right"><div className="text-2xl font-bold">{region.enquiryCount}</div><div className="text-xs text-muted-foreground">enquiries · {region.areas.length} suburbs</div></div></div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold">REC teams ({region.recTeams.length})</dt><dd className="text-xs"><PartnerNames matches={region.recTeams} empty="Need an REC here" /></dd></div>
                <div><dt className="font-semibold">Installer teams ({region.installerTeams.length})</dt><dd className="text-xs"><PartnerNames matches={region.installerTeams} empty="Need an installer here" /></dd></div>
              </dl>
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-primary">Show suburbs ({region.coveredAreas} of {region.areas.length} fully covered)</summary>
                <ul className="mt-2 flex flex-wrap gap-1.5">{region.areas.map((area) => <li key={`${area.postcode}-${area.suburb}`} className={`rounded-full border px-2 py-0.5 text-xs ${tones[area.overall]}`}>{area.suburb || "Suburb missing"} {area.postcode ?? ""} · {area.enquiryCount}</li>)}</ul>
              </details>
            </div>
          ))}
          {areas.length === 0 && <div className="rounded-md border bg-card p-8 text-center text-muted-foreground">No active enquiry areas to assess.</div>}
        </div>
      </section>

      <section className="mb-6" aria-labelledby="teams-heading">
        <div className="mb-3"><h2 id="teams-heading" className="flex items-center gap-2 text-lg font-bold"><UsersRound className="h-5 w-5 text-primary" /> Partner team directory</h2><p className="text-sm text-muted-foreground">People counts include approved field workers only. Office contacts are shown separately.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {partners.map((partner) => {
            const isRec = partner.business_type === "rec" || partner.capabilities?.includes("electrician");
            const fieldWorkers = partner.workers.filter((worker) => worker.approved);
            const pendingWorkers = partner.workers.length - fieldWorkers.length;
            const ready = !partner.blocker && !!partner.coverage_verified_at && partner.service_postcodes.length > 0;
            return <article key={partner.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-bold">{partner.name}</div><div className="text-xs font-semibold uppercase text-muted-foreground">{isRec ? "REC / electrician" : "Installer"}</div></div><Badge variant={ready ? "default" : "outline"}>{ready ? "Ready for matching" : "Setup required"}</Badge></div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-y py-3"><div><div className="text-2xl font-bold">{fieldWorkers.length}</div><div className="text-xs text-muted-foreground">Approved field {fieldWorkers.length === 1 ? "person" : "people"}</div></div><div><div className="text-2xl font-bold">{partner.service_postcodes.length}</div><div className="text-xs text-muted-foreground">Verified postcode {partner.service_postcodes.length === 1 ? "entry" : "entries"}</div></div></div>
              <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-semibold">Field team</dt><dd className="text-muted-foreground">{fieldWorkers.map((worker) => worker.name).join(", ") || "No approved workers listed"}{pendingWorkers > 0 ? ` · ${pendingWorkers} awaiting approval` : ""}</dd></div><div><dt className="font-semibold">Office contacts</dt><dd className="text-muted-foreground">{partner.members.map((member) => member.name).join(", ") || "No active contact linked"}</dd></div><div><dt className="font-semibold">Coverage</dt><dd className="text-muted-foreground">{partner.service_postcodes.join(", ") || partner.declared_service_origin || "No area configured"}{partner.declared_travel_radius_km ? ` · ${partner.declared_travel_radius_km === 9999 ? "Anywhere in Victoria" : `${partner.declared_travel_radius_km} km from declared base`}` : ""}</dd></div>{partner.declared_excluded_areas && <div><dt className="font-semibold text-warning">Exclusions</dt><dd className="text-muted-foreground">{partner.declared_excluded_areas}</dd></div>}</dl>
              {!ready && <div className="mt-3 rounded-md bg-warning-soft p-2 text-xs font-semibold">{partner.blocker || "Verified postcodes still need to be set"}</div>}
            </article>;
          })}
          {partners.length === 0 && <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground lg:col-span-2">No REC or installer businesses are recorded yet.</div>}
        </div>
      </section>

      <section aria-labelledby="enquiry-heading"><div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="enquiry-heading" className="text-lg font-bold">Active enquiry check</h2><p className="text-sm text-muted-foreground">Individual enquiries against verified REC and installer coverage.</p></div><div className="flex gap-2"><Badge variant="outline">{enquiryCounts.serviceable} covered</Badge><Badge variant="outline">{enquiryCounts.partial} verify</Badge><Badge variant="outline">{enquiryCounts.unserviceable} gaps</Badge></div></div><div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground"><tr><th className="p-3">Enquiry</th><th className="p-3">Area</th><th className="p-3">REC / electrician</th><th className="p-3">Installer</th><th className="p-3">Overall</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-3"><Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="font-bold text-primary hover:underline">{row.job_number}</Link><div className="max-w-64 truncate text-xs text-muted-foreground">{row.address}</div></td><td className="p-3">{[row.suburb, row.postcode].filter(Boolean).join(" ") || <span className="text-danger">Missing postcode</span>}</td><td className="p-3"><StateBadge state={row.rec.state} /><div className="mt-1 max-w-72 text-xs text-muted-foreground">{row.rec.matches.map((item) => item.name).join(", ") || row.rec.declared.map((item) => `${item.name}: ${item.description}`).join("; ") || "No eligible verified REC"}</div></td><td className="p-3"><StateBadge state={row.installer.state} /><div className="mt-1 max-w-72 text-xs text-muted-foreground">{row.installer.matches.map((item) => item.name).join(", ") || row.installer.declared.map((item) => `${item.name}: ${item.description}`).join("; ") || "No eligible verified installer"}</div></td><td className="p-3"><StateBadge state={row.overall} /></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No active enquiries to assess.</td></tr>}
        </tbody></table>
      </div></section>
    </>}
  </AppShell>;
}