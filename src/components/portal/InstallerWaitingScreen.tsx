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
import { AreaBatchSuggestions, BatchesReadyToSend, ChooseInstallerPanel } from "@/components/portal/choose-installer";
import { ColumnHead, Pager, type ColumnFilterValue } from "@/components/portal/office-lists";
import { Pill, PillTabs, listCard } from "@/components/portal/kit";
import { getInstallerWaitingList } from "@/lib/installer-waiting.functions";
import { showAreaBatches } from "@/lib/area-batch.core";
import { useMe } from "@/hooks/use-me";
import { INSULATION_LABEL, REGION_LABEL, pageOf, type SortDir } from "@/lib/office-filters.core";
import { estimateLabel, sizeLabel } from "@/lib/enquiry-columns.core";
import {
  INSTALLER_WAITING_COLUMNS, NO_INSTALLER_NOTE, activeWaitingFilters, areaCounts, coverageGap, inArea, inWaitingTab, isWaitingOwner, noInstallerExplain, recruitAreas,
  suburbLabel, waitingCountLine, waitingCounts, waitingSinceLabel, waitingView,
  type InstallerWaitingRow, type WaitingArea, type WaitingCoverage, type WaitingFilters, type WaitingTab,
} from "@/lib/installer-waiting-columns.core";

const btn = "inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-50";

/** Jo 27 Oct 2026: one soft tag. Green when an installer AND an electrician cover the area; pink names what's missing. */
function CoverageTag({ c }: { c: WaitingCoverage }) {
  const gap = coverageGap(c);
  return gap ? <Pill tone="rose">{gap} nearby</Pill> : <Pill tone="green">Installer + electrician nearby</Pill>;
}

/** Saved spots with nobody nearby, by suburb, so the office knows where to find partners. */
function RecruitCard({ rows }: { rows: InstallerWaitingRow[] }) {
  const places = recruitAreas(rows);
  return (
    <aside className="rounded-[18px] border border-rose/30 bg-[#fff8fb] p-4" aria-label="Areas to recruit in">
      <h2 className="font-display text-[17px] font-bold text-ink">Areas to recruit in</h2>
      {places.length === 0 ? <p className="mt-1 text-sm text-sub">Every saved spot has an installer and an electrician nearby.</p> : (
        <>
          <p className="mt-1 text-[13px] text-sub">Saved spots with no installer or electrician close by.</p>
          <ul className="mt-3 space-y-2">
            {places.slice(0, 8).map((p) => (
              <li key={p.place} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{p.place}</span><span className="block text-[12px] text-rose">{p.missing}</span></span>
                <span className="shrink-0 tabular-nums text-sub">{p.n} {p.n === 1 ? "job" : "jobs"}</span>
              </li>
            ))}
          </ul>
          {places.length > 8 && <p className="mt-2 text-[12px] text-sub">and {places.length - 8} more {places.length - 8 === 1 ? "place" : "places"}</p>}
        </>
      )}
      <Link to="/admin/partners" search={{ tab: "coverage" }} className="mt-3 inline-block text-sm font-semibold text-hiv-blue">Find partners for these areas ›</Link>
    </aside>
  );
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
        ) : row ? <ChooseInstallerPanel jobId={row.id} reportLoad /> : null}
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
  const { data: me } = useMe();
  const [includeTest, setIncludeTest] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<WaitingFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "waiting", d: "asc" });
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<WaitingTab>("to_release");
  const [area, setArea] = useState<WaitingArea>("everywhere");
  const [choosing, setChoosing] = useState<InstallerWaitingRow | null>(null);
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 200); return () => clearTimeout(t); }, [typed]);
  const q = useQuery({ queryKey: ["installer-waiting", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 30_000 });
  const d = q.data;
  const now = d?.now ?? Date.now();
  // Jo 27 Oct 2026: released spots get their own tab; the area pills group the rest by where they are.
  const inTab = d ? d.rows.filter((r) => inWaitingTab(r, tab)) : [];
  const areas = areaCounts(inTab);
  const view = d ? waitingView(inTab.filter((r) => inArea(r, area)), { search, filters, sort: sort.k, dir: sort.d }, now) : [];
  const shown = pageOf(view, page);
  const active = activeWaitingFilters(filters);
  const noInstaller = d?.rows.filter((r) => !r.coverage.installer).length ?? 0;
  const waitingOwner = d?.rows.filter(isWaitingOwner).length;
  const onFilter = (k: string, v: ColumnFilterValue) => { setFilters({ ...filters, [k]: v } as WaitingFilters); setPage(1); };
  const onSort = (k: string, dd: SortDir) => { setSort({ k, d: dd }); setPage(1); };
  const pickTab = (t: WaitingTab) => { setTab(t); setArea("everywhere"); setPage(1); };
  const pickArea = (a: WaitingArea) => { setArea(a); setPage(1); };
  const heads = (className?: string) => INSTALLER_WAITING_COLUMNS.map((c) => <ColumnHead key={c.key} col={c} sort={sort.k} dir={sort.d} value={filters[c.key] as ColumnFilterValue} onSort={onSort} onFilter={onFilter} {...(className ? { className } : {})} />);
  // Literal class names (Tailwind only sees whole strings).
  const cols = "lg:grid-cols-[76px_minmax(0,1fr)_minmax(0,1.1fr)_96px_78px_88px_minmax(0,1fr)_minmax(0,1fr)_auto]";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Choose installer</h1>
          <p className="mt-1 text-sm text-sub">{d ? `${waitingCountLine(waitingCounts(d.rows))}${noInstaller ? ` · ${noInstaller.toLocaleString("en-AU")} with no installer able to take the area` : ""}` :"Our leads with a saved spot, waiting for you to pick an installer"}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/admin/jobs/active" className="font-semibold text-hiv-blue">All active jobs ›</Link>
          <button type="button" className="font-semibold text-hiv-blue underline" onClick={() => setIncludeTest(!includeTest)}>{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</button>
        </div>
      </div>
      {/* A48 batch 2: not for the TEST office login (its functions are not on the TEST office allowlist). */}
      {showAreaBatches(me?.roles) && <BatchesReadyToSend includeTest={includeTest} />}
      {showAreaBatches(me?.roles) && <AreaBatchSuggestions includeTest={includeTest} />}
      <PillTabs<WaitingTab> label="Saved spots" value={tab} onChange={pickTab} options={[
        { value: "to_release", label: "To release", count: d ? d.rows.length - (waitingOwner ?? 0) : null },
        { value: "waiting_owner", label: "Waiting for owner", count: waitingOwner ?? null },
      ]} />
      {areas.length > 0 && (
        <PillTabs<WaitingArea> label="Area" className="mt-2" value={area} onChange={pickArea} options={[
          { value: "everywhere", label: "Everywhere", count: inTab.length },
          ...areas.map((a) => ({ value: a.area as WaitingArea, label: REGION_LABEL[a.area], count: a.n })),
        ]} />
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-why="decision 378: one search box; headings sort and filter; no chip panel">
            <p className="text-[13px] text-sub">{tab === "waiting_owner" ? "Released to an installer. The owner confirms first; a reminder goes on day 2 and the release lapses on day 5." : "Saved a spot and ready for you to pick an installer."}</p>
            <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search owner, suburb, postcode or job" aria-label="Search jobs waiting for an installer" className="h-11 w-full max-w-[320px] rounded-[12px] bg-paper" />
          </div>
          <div className="mb-2 flex items-center justify-end gap-3">
            <span className="text-sm text-sub">{d ? `${view.length.toLocaleString("en-AU")} · showing ${shown.rows.length}` : "Loading…"}{q.isFetching && d ? " · updating…" : ""}</span>
            {active.length > 0 && <button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={() => { setFilters({}); setPage(1); }}>Clear {active.length} filter{active.length === 1 ? "" : "s"}</button>}
          </div>
          {/* Phone: the same heading buttons (sort + filter) above the cards. */}
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 rounded-[12px] border border-line bg-paper px-3 py-2 lg:hidden" aria-label="Sort or filter">{heads()}</div>
          {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">The list could not load — this does not mean no job is waiting. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
            <div className={listCard}>
              <div className={cn("hidden gap-x-3 border-b border-line bg-[#fafbfe] px-5 py-2.5 lg:grid", cols)}>{heads()}<span /></div>
              {!d ? <p className="p-6 text-center text-sm text-sub">Loading…</p> : shown.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{search || active.length || area !== "everywhere" ? "No job matches that search." : tab === "waiting_owner" ? "No released spot is waiting for the owner." : "No saved spot is waiting for an installer."}</p> : (
                <ul>
                  {shown.rows.map((r) => {
                    const f = fieldsOf(r, now);
                    return (
                      <li key={r.id} className={cn("grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[#eef1f6] px-4 py-3.5 text-[14px] last:border-b-0 lg:min-h-[54px] lg:items-center lg:gap-y-0 lg:px-5 lg:py-2.5", cols)} data-job={r.jobNumber}>
                        <span className="col-span-2 flex items-center gap-2 text-sub lg:col-span-1">
                          <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">{r.jobNumber}</Link>
                          {r.isTest && <span className="rounded bg-warning-soft px-1 text-[10px] font-bold text-foreground">TEST</span>}
                        </span>
                        <span className="text-sub lg:hidden">Owner</span><span className="truncate font-semibold text-ink">{f.owner}</span>
                        <span className="text-sub lg:hidden">Suburb</span><span className="truncate">{f.suburb}</span>
                        <span className="text-sub lg:hidden">Size</span><span>{f.size}</span>
                        <span className="text-sub lg:hidden">Insulation</span><span>{f.insulation}</span>
                        <span className="text-sub lg:hidden">Estimate</span><span className="font-display text-[16px] font-bold text-ink">{f.estimate}</span>
                        <span className="text-sub lg:hidden">Waiting since</span><span className="text-[13px] text-sub">{f.waiting}{r.lastOffer && <span className="block text-[12px]">Last offer {r.lastOffer.status === "declined" ? `declined${r.lastOffer.name ? ` by ${r.lastOffer.name}` : ""}` : `lapsed${r.lastOffer.name ? ` (${r.lastOffer.name})` : ""}`}</span>}{r.release?.line && <span className={cn("block text-[12px] font-semibold", r.release.state === "lapsed" ? "text-rose" : "text-hiv-blue")} data-release={r.release.state}>{r.release.line}</span>}</span>
                        <span className="text-sub lg:hidden">Nearby</span>
                        <span><CoverageTag c={r.coverage} /></span>
                        <span className="col-span-2 mt-1 lg:col-span-1 lg:mt-0">
                          {r.release && !r.release.releasable
                            ? <button type="button" disabled className={cn(btn, "w-full border border-line bg-paper text-sub lg:w-auto")} title={r.release.line ?? undefined}>Released</button>
                            : <button type="button" className={cn(btn, "w-full lg:w-auto", r.coverage.installer ? "bg-hiv-green text-white" : "border border-rose/40 bg-paper text-rose")} onClick={() => setChoosing(r)} title={r.coverage.installer ? undefined : NO_INSTALLER_NOTE}>Choose installer</button>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {d && <Pager page={shown.page} totalPages={shown.totalPages} total={shown.total} shown={shown.rows.length} onPage={setPage} />}
        </section>
        {d && <RecruitCard rows={d.rows} />}
      </div>
      <ChooseDialog row={choosing} onClose={() => setChoosing(null)} />
    </div>
  );
}
