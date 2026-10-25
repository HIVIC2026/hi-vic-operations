// Decision 378 (Jo 25 Oct 2026): Jobs › Choose installer — our-lead jobs with a saved spot waiting for the office to pick
// an installer, in ONE table with the Enquiries interaction (281/283/285/286): every heading sorts AND filters from a
// small popover, one search box, no chip panel. Columns Job · Owner · Suburb (postcode) · Size · Insulation · Estimate ·
// Waiting since · Coverage, then "Choose installer" (the ChooseInstallerPanel in a dialog; decision 389: its button is
// Release — the owner confirms first; a pending release shows its status and can't be released again). On a
// phone each row is a card with the same fields and the same heading buttons sit above the cards. Needs me folds its
// "Spot saved · waiting for an installer" rows into one link here, so a job is in one Needs me pile only.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChooseInstallerPanel } from "@/components/portal/choose-installer";
import { ColumnHead, Pager, type ColumnFilterValue } from "@/components/portal/office-lists";
import { getInstallerWaitingList } from "@/lib/installer-waiting.functions";
import { INSULATION_LABEL, pageOf, type SortDir } from "@/lib/office-filters.core";
import { estimateLabel, sizeLabel } from "@/lib/enquiry-columns.core";
import {
  INSTALLER_WAITING_COLUMNS, NO_INSTALLER_NOTE, activeWaitingFilters, noInstallerExplain, suburbLabel, waitingSinceLabel, waitingView,
  type InstallerWaitingRow, type WaitingCoverage, type WaitingFilters,
} from "@/lib/installer-waiting-columns.core";

const btn = "inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-50";

function CoverageBadges({ c }: { c: WaitingCoverage }) {
  const badge = (ok: boolean, label: string) => (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", ok ? "bg-mist text-hiv-green" : "bg-danger-soft text-danger")} aria-label={`${label} ${ok ? "covered" : "not covered"}`}>
      {label} {ok ? "✓" : "✗"}
    </span>
  );
  return <span className="flex flex-wrap gap-1">{badge(c.installer, "Installer")}{badge(c.electrician, "Electrician")}</span>;
}

/** The existing Choose installer flow, unchanged. With no installer covering the area it explains that first. */
function ChooseDialog({ row, onClose }: { row: InstallerWaitingRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [anyway, setAnyway] = useState(false);
  useEffect(() => setAnyway(false), [row?.id]);
  const close = () => { onClose(); void qc.invalidateQueries({ queryKey: ["installer-waiting"] }); };
  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose installer · {row?.jobNumber}</DialogTitle>
          <DialogDescription>{row ? `${row.ownerName || "Owner"} · ${suburbLabel(row)}` : ""}</DialogDescription>
        </DialogHeader>
        {row && !row.coverage.installer && !anyway ? (
          <div className="space-y-3 text-sm" data-why="decision 378: no empty list — say why">
            <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 font-semibold text-danger">{NO_INSTALLER_NOTE}</p>
            <p className="text-sub">{noInstallerExplain(row)}</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/partners" search={{ tab: "coverage" }} className={cn(btn, "bg-hiv-green text-white")}>Open Partners › Coverage</Link>
              <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => setAnyway(true)}>Show installers anyway</button>
            </div>
          </div>
        ) : row ? <ChooseInstallerPanel jobId={row.id} /> : null}
        {row && <Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="text-xs font-semibold text-hiv-blue underline">Open the job page</Link>}
      </DialogContent>
    </Dialog>
  );
}

function fieldsOf(r: InstallerWaitingRow, now: number) {
  const w = waitingSinceLabel(r.waitingFrom, now);
  return {
    owner: r.ownerName || "—",
    suburb: suburbLabel(r),
    size: r.areaKind === "measured" ? `${sizeLabel(r.areaM2).replace("~", "")} measured` : sizeLabel(r.areaM2),
    insulation: INSULATION_LABEL[r.insulation],
    estimate: estimateLabel({ dollars: r.estimateDollars, kind: r.estimateDollars == null ? null : "website" }),
    waiting: `${w.relative}${w.date ? ` · ${w.date}` : ""}${r.spotSavedAt ? "" : " (job created)"}`,
  };
}

export function InstallerWaitingScreen() {
  const load = useServerFn(getInstallerWaitingList);
  const [includeTest, setIncludeTest] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<WaitingFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "waiting", d: "asc" });
  const [page, setPage] = useState(1);
  const [choosing, setChoosing] = useState<InstallerWaitingRow | null>(null);
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 200); return () => clearTimeout(t); }, [typed]);
  const q = useQuery({ queryKey: ["installer-waiting", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 30_000 });
  const d = q.data;
  const now = d?.now ?? Date.now();
  const view = d ? waitingView(d.rows, { search, filters, sort: sort.k, dir: sort.d }, now) : [];
  const shown = pageOf(view, page);
  const active = activeWaitingFilters(filters);
  const noInstaller = d?.rows.filter((r) => !r.coverage.installer).length ?? 0;
  const onFilter = (k: string, v: ColumnFilterValue) => { setFilters({ ...filters, [k]: v } as WaitingFilters); setPage(1); };
  const onSort = (k: string, dd: SortDir) => { setSort({ k, d: dd }); setPage(1); };
  const heads = (className?: string) => INSTALLER_WAITING_COLUMNS.map((c) => <ColumnHead key={c.key} col={c} sort={sort.k} dir={sort.d} value={filters[c.key] as ColumnFilterValue} onSort={onSort} onFilter={onFilter} {...(className ? { className } : {})} />);
  // Literal class names (Tailwind only sees whole strings).
  const cols = "lg:grid-cols-[76px_minmax(0,1fr)_minmax(0,1.1fr)_96px_78px_88px_minmax(0,1fr)_minmax(0,1fr)_auto]";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Choose installer</h1>
          <p className="text-sm text-sub">{d ? `${d.rows.length.toLocaleString("en-AU")} spot${d.rows.length === 1 ? "" : "s"} saved, waiting for an installer${noInstaller ? ` · ${noInstaller} with no installer covering the area` : ""}` : "Our leads with a saved spot, waiting for you to pick an installer"}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/admin/jobs/active" className="font-semibold text-hiv-blue underline">All active jobs</Link>
          <button type="button" className="font-semibold text-hiv-blue underline" onClick={() => setIncludeTest(!includeTest)}>{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2" data-why="decision 378: one search box; headings sort and filter; no chip panel">
        <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search owner, suburb, postcode or job number" aria-label="Search jobs waiting for an installer" className="h-10 w-full max-w-[420px] bg-paper" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-sub">{d ? `${view.length.toLocaleString("en-AU")} · showing ${shown.rows.length}` : "Loading…"}{q.isFetching && d ? " · updating…" : ""}</span>
          {active.length > 0 && <button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={() => { setFilters({}); setPage(1); }}>Clear {active.length} filter{active.length === 1 ? "" : "s"}</button>}
        </div>
      </div>
      {/* Phone: the same heading buttons (sort + filter) above the cards. */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 rounded-[12px] border border-line bg-mist px-3 py-2 lg:hidden" aria-label="Sort or filter">{heads()}</div>
      {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">The list could not load — this does not mean no job is waiting. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
          <div className={cn("hidden gap-x-3 border-b border-line bg-mist px-3 py-2 lg:grid", cols)}>{heads()}<span /></div>
          {!d ? <p className="p-6 text-center text-sm text-sub">Loading…</p> : shown.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{search || active.length ? "No job matches that search." : "No saved spot is waiting for an installer."}</p> : (
            <ul>
              {shown.rows.map((r) => {
                const f = fieldsOf(r, now);
                return (
                  <li key={r.id} className={cn("grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line px-3 py-3 text-[13px] last:border-b-0 lg:items-center lg:gap-y-0 lg:py-2.5", cols)} data-job={r.jobNumber}>
                    <span className="col-span-2 flex items-center gap-2 font-semibold lg:col-span-1">
                      <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">{r.jobNumber}</Link>
                      {r.isTest && <span className="rounded bg-warning-soft px-1 text-[10px] font-bold">TEST</span>}
                    </span>
                    <span className="text-sub lg:hidden">Owner</span><span className="truncate font-semibold lg:font-normal">{f.owner}</span>
                    <span className="text-sub lg:hidden">Suburb</span><span className="truncate">{f.suburb}</span>
                    <span className="text-sub lg:hidden">Size</span><span>{f.size}</span>
                    <span className="text-sub lg:hidden">Insulation</span><span>{f.insulation}</span>
                    <span className="text-sub lg:hidden">Estimate</span><span>{f.estimate}</span>
                    <span className="text-sub lg:hidden">Waiting since</span><span className="text-sub">{f.waiting}{r.lastOffer && <span className="block text-[11px]">Last offer {r.lastOffer.status === "declined" ? `declined${r.lastOffer.name ? ` by ${r.lastOffer.name}` : ""}` : `lapsed${r.lastOffer.name ? ` (${r.lastOffer.name})` : ""}`}</span>}{r.release?.line && <span className={cn("block text-[11px] font-semibold", r.release.state === "lapsed" ? "text-danger" : "text-hiv-blue")} data-release={r.release.state}>{r.release.line}</span>}</span>
                    <span className="text-sub lg:hidden">Coverage</span>
                    <span><CoverageBadges c={r.coverage} />{!r.coverage.installer && <span className="mt-1 block text-[11px] font-semibold text-danger">{NO_INSTALLER_NOTE}</span>}</span>
                    <span className="col-span-2 mt-1 lg:col-span-1 lg:mt-0">
                      {r.release && !r.release.releasable
                        ? <button type="button" disabled className={cn(btn, "w-full border border-line bg-paper text-sub lg:w-auto")} title={r.release.line ?? undefined}>Released</button>
                        : <button type="button" className={cn(btn, "w-full lg:w-auto", r.coverage.installer ? "bg-hiv-green text-white" : "border border-danger/50 bg-paper text-danger")} onClick={() => setChoosing(r)} title={r.coverage.installer ? undefined : NO_INSTALLER_NOTE}>Choose installer</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {d && <Pager page={shown.page} totalPages={shown.totalPages} total={shown.total} shown={shown.rows.length} onPage={setPage} />}
      <ChooseDialog row={choosing} onClose={() => setChoosing(null)} />
    </div>
  );
}
