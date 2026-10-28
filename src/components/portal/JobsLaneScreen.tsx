// Jobs pages (spec 2026-10-28-jobs-pages-redesign): "Our jobs" and "Installer jobs" — one screen, one lane each.
// Top: search · Needs us · Actions, and the red "Mitti sync problems" line only when there are some. Computer: a table
// whose headings sort AND filter (the Enquiries pop-up). Phone: one card per job and a Filter button that opens the same
// headings in a sheet. Filters, sort and Needs us are kept in this browser per page (saved view; storage may be blocked).
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction, useMe } from "@/hooks/use-me";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getActiveJobsList, bulkCancelOfficeJobs } from "@/lib/office-screens.functions";
import { bulkJobAction } from "@/lib/bulk.functions";
import { getMittiSyncProblems } from "@/lib/mitti-pickup.functions";
import { JOBS_STAGE_LABEL, type JobsStage } from "@/lib/office-jobs.core";
import { JOBS_COLUMNS, DEFAULT_VIEW, costLabel, parseSavedView, savedViewKey, type JobsColumnFilters, type JobsLane, type SavedView } from "@/lib/jobs-columns.core";
import type { SortDir } from "@/lib/office-filters.core";
import type { Range } from "@/lib/enquiry-columns.core";
import { isDefaultListView } from "@/lib/office-needs-snapshot.core";
import { readOfficeList } from "@/lib/office-list-refresh";
import { MittiSyncProblems } from "@/components/portal/mitti-piles";
import { ActionsMenu, ColumnHead, Pager, ReasonDialog, heardLabel, type ColumnFilterValue } from "@/components/portal/office-lists";
import { JobsSwitcher } from "@/components/portal/JobsScreen";
import { listCard } from "@/components/portal/kit";

const TITLE: Record<JobsLane, string> = { ours: "Our jobs", installer: "Installer jobs" };
// Literal class names (Tailwind only sees whole strings): tick box + the 11 columns. Fixed tracks fit their widest
// heading (11px bold capitals + sort mark + filter dot: Insulation ≈ 80, Total cost ≈ 96) and cells; the rest share
// what is left and never force a sideways scroll. Headings wrap (never spill) when a column is narrow.
const COLS = "md:grid-cols-[16px_64px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_56px_52px_84px_96px_minmax(0,1fr)_minmax(0,1fr)]";
const HEAD = "min-w-0 flex-wrap [overflow-wrap:anywhere]";
const CELL = "min-w-0 truncate";

const filterOn = (v: unknown): boolean =>
  typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : !!v && ((v as Range).min != null || (v as Range).max != null);

export function JobsLaneScreen({ lane, initialStage }: { lane: JobsLane; initialStage?: JobsStage | undefined }) {
  const { data: me } = useMe();
  const testOffice = me?.roles.includes("qa_office") ?? false;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const load = useServerFn(getActiveJobsList);
  const syncFn = useServerFn(getMittiSyncProblems);
  const [view, setView] = useState<SavedView>(DEFAULT_VIEW);
  const [readyLane, setReadyLane] = useState<JobsLane | null>(null); // the lane whose saved view is loaded
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Saved view: read once per lane (an old bookmark's stage wins once), written on every change. Storage can throw
  // (private window, blocked site data): the page then simply opens on the default view and forgets.
  useEffect(() => {
    let saved: SavedView = DEFAULT_VIEW;
    try { saved = parseSavedView(localStorage.getItem(savedViewKey(lane))); } catch { saved = DEFAULT_VIEW; }
    setView(initialStage ? { ...saved, filters: { ...saved.filters, stage: [initialStage] } } : saved);
    setPage(1);
    setPicked(new Set());
    setReadyLane(lane);
  }, [lane]); // eslint-disable-line react-hooks/exhaustive-deps -- initialStage applies once, on opening
  useEffect(() => {
    if (readyLane !== lane) return;
    try { localStorage.setItem(savedViewKey(lane), JSON.stringify(view)); } catch { /* not kept: storage unavailable */ }
  }, [readyLane, lane, view]);
  // Search as you type: a short pause, then the list refreshes from page 1.
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [typed]);

  // Decision 383: the opening view comes from the server's saved copy (worked out now after an office action in this
  // tab); while the server refreshes it, ask again in 5 s. One retry, not three.
  const q = useQuery({
    queryKey: ["office-jobs", lane, view, search, page],
    queryFn: () => {
      const v = { lane, search, sort: view.sort, dir: view.dir, page, filters: view.filters, needsUs: view.needsUs, includeTest: false };
      return readOfficeList("jobs", isDefaultListView(v), (refresh) => load({ data: { ...v, refresh } }));
    },
    enabled: readyLane === lane,
    placeholderData: keepPreviousData, staleTime: 30_000, retry: 1, refetchInterval: (x) => (x.state.data?.refreshing ? 5_000 : false),
  });
  // The TEST office never sees the Mitti line (it is real-job data).
  const sync = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => syncFn(), staleTime: 60_000, enabled: !!me && !testOffice });
  const syncCount = sync.data?.rows.length ?? 0;

  const cancel = useAction(bulkCancelOfficeJobs);
  const bulk = useAction(bulkJobAction);
  const d = q.data;
  const ids = [...picked];
  const cols = JOBS_COLUMNS({ nextSteps: d?.nextSteps ?? [], installers: d?.installers ?? [] });
  const anyFilter = Object.values(view.filters).some(filterOn);
  const change = (patch: Partial<SavedView>) => { setView({ ...view, ...patch }); setPage(1); };
  const onSort = (k: string, dd: SortDir) => change({ sort: k, dir: dd });
  const onFilter = (k: string, v: ColumnFilterValue) => change({ filters: { ...view.filters, [k]: v } as JobsColumnFilters });
  const clearFilters = () => change({ filters: {} });
  const after = (r: { done: number; failed: { error?: string }[] } | undefined, what: string) => { if (!r) return false; if (r.failed.length) toast.error(`${r.done} ${what}; ${r.failed.length} not: ${r.failed[0]!.error ?? "failed"}`); else toast.success(`${r.done} ${what}`); setPicked(new Set()); void qc.invalidateQueries(); return true; };
  const toggle = (id: string, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); };
  const open = (id: string) => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: id } });

  return (
    <div>
      <h1 className="mb-1 font-display text-[30px] font-extrabold leading-tight text-ink">{TITLE[lane]}</h1>
      <JobsSwitcher current={lane} />
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search job number, owner or suburb" aria-label="Search jobs" className="h-11 w-full rounded-[12px] bg-paper sm:max-w-[320px]" />
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Switch checked={view.needsUs} onCheckedChange={(v) => change({ needsUs: v })} aria-label="Needs us" className="data-[state=checked]:bg-hiv-blue" />
          Needs us
        </label>
        <span className="ml-auto flex items-center gap-3">
          {anyFilter && <button type="button" className="hidden text-sm font-semibold text-hiv-blue underline md:inline" onClick={clearFilters}>Clear filters</button>}
          <button type="button" className="inline-flex min-h-[38px] items-center rounded-[10px] border border-line bg-paper px-3 text-[13px] font-bold text-hiv-blue md:hidden" onClick={() => setSheetOpen(true)}>Filter</button>
          <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "cancel", label: "Cancel", danger: true }, { key: "hold", label: "Put on hold" }, { key: "mark_test", label: "Mark as test" }, { key: "delete", label: "Delete (test jobs only)", danger: true }]} />
        </span>
      </div>
      {!testOffice && syncCount > 0 && (
        <button type="button" aria-expanded={syncOpen} onClick={() => setSyncOpen(!syncOpen)} className="mb-2 text-sm font-semibold text-danger">
          Mitti sync problems · {syncCount} {syncOpen ? "▾" : "›"}
        </button>
      )}
      {!testOffice && syncOpen && syncCount > 0 && <div className="mb-3"><MittiSyncProblems /></div>}
      {anyFilter && <p className="mb-2 md:hidden"><button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={clearFilters}>Clear filters</button></p>}

      {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">Jobs could not be loaded. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
        <div className={listCard}>
          <div className={cn("hidden items-start gap-x-1.5 border-b border-line bg-mist px-2 py-2 md:grid", COLS)}>
            <input type="checkbox" aria-label="Select all on this page" checked={!!d?.rows.length && d.rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(d?.rows.map((r) => r.id)) : new Set())} />
            {cols.map((c) => <ColumnHead key={c.key} col={c} sort={view.sort || "heard"} dir={view.sort ? view.dir : "desc"} value={view.filters[c.key as keyof JobsColumnFilters]} onSort={onSort} onFilter={onFilter} className={HEAD} />)}
          </div>
          {!d ? <p role="status" className="p-6 text-center text-sm text-sub">Loading jobs…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">No jobs match. {anyFilter && <button type="button" className="font-semibold text-hiv-blue underline" onClick={clearFilters}>Clear filters</button>}</p> : (
            <ul>
              {d.rows.map((r) => {
                const area = r.areaM2 != null && r.areaM2 > 0 ? `${Math.round(r.areaM2)} m²` : "—";
                const cost = costLabel(r.cost);
                const ins = r.insulation === "yes" ? "Yes" : "No";
                const heard = heardLabel(r.lastHeardAt, r.lastHeardChannel);
                const job = `${r.jobNumber}${r.isTest ? " · TEST" : ""}`;
                const tick = <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 md:mt-0" aria-label={`Select ${r.jobNumber}`} checked={picked.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(r.id, e.target.checked)} />;
                return (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    {/* Phone: one card per job — Next step on top, then the facts in the spec's order. */}
                    <div className="flex cursor-pointer gap-3 px-4 py-3 md:hidden" onClick={() => open(r.id)}>
                      {tick}
                      <div className="grid min-w-0 flex-1 gap-0.5 text-[13px]">
                        <span className={cn("break-words text-[15px] font-semibold text-ink", r.next.late && "text-danger")}>{r.next.text}</span>
                        <span className="truncate text-ink">{[job, r.owner || "—", r.suburb].filter(Boolean).join(" · ")}</span>
                        <span className="truncate text-sub">{JOBS_STAGE_LABEL[r.stage]} · {`${r.days} d`}</span>
                        <span className="truncate text-sub">{[area, `Insulation ${ins}`, cost].join(" · ")}</span>
                        <span className="truncate text-sub">{[r.installer ?? "—", heard].join(" · ")}</span>
                      </div>
                    </div>
                    {/* Computer: the 11 columns in the spec's order. */}
                    <div className={cn("hidden cursor-pointer items-center gap-x-1.5 px-2 py-2.5 text-[13px] hover:bg-mist md:grid", COLS)} onClick={() => open(r.id)}>
                      {tick}
                      <span className="min-w-0 break-words font-semibold">{job}</span>
                      <span className={cn("min-w-0 break-words", r.next.late && "text-danger")}>{r.next.text}</span>
                      <span className={CELL}>{r.owner || "—"}</span>
                      <span className={cn(CELL, "text-sub")}>{r.suburb ?? ""}</span>
                      <span className={CELL}>{JOBS_STAGE_LABEL[r.stage]}</span>
                      <span className={CELL}>{`${r.days} d`}</span>
                      <span className={CELL}>{area}</span>
                      <span className={CELL}>{ins}</span>
                      <span className={CELL} title={cost}>{cost}</span>
                      <span className={CELL}>{r.installer ?? "—"}</span>
                      <span className={cn(CELL, "text-sub")}>{heard}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {d && <Pager page={d.page} totalPages={d.totalPages} total={d.total} shown={d.rows.length} onPage={setPage} />}

      {/* Phone: the same headings (sort + filter) as a full-screen list. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="inset-0 flex h-[100dvh] max-h-none w-full flex-col gap-0 overflow-y-auto bg-paper pb-0">
          <SheetHeader><SheetTitle>Filter</SheetTitle></SheetHeader>
          <div className="mt-3 grid gap-1">
            {cols.map((c) => <div key={c.key} className="border-b border-line py-3 last:border-b-0"><ColumnHead col={c} sort={view.sort || "heard"} dir={view.sort ? view.dir : "desc"} value={view.filters[c.key as keyof JobsColumnFilters]} onSort={onSort} onFilter={onFilter} className="text-sm" /></div>)}
          </div>
          {anyFilter && <button type="button" className="mt-3 self-start text-sm font-semibold text-hiv-blue underline" onClick={clearFilters}>Clear filters</button>}
          <div className="sticky bottom-0 mt-auto bg-paper py-4">
            <SheetClose asChild><button type="button" className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] bg-ink px-4 text-[14px] font-bold text-white">Close</button></SheetClose>
          </div>
        </SheetContent>
      </Sheet>

      <ReasonDialog open={dialog === "cancel"} title={`Cancel ${ids.length} job${ids.length === 1 ? "" : "s"}`} description="Each moves to Closed; reminders and texts stop; held install days and installers are released; history is kept." action="Cancel jobs" danger presets={["Owner changed mind", "Not eligible", "No response", "Duplicate"]} onOpenChange={(v) => setDialog(v ? "cancel" : null)} run={async (reason) => after(await cancel({ jobIds: ids, reason }), "cancelled")} />
      <ReasonDialog open={dialog === "hold"} title={`Put ${ids.length} job${ids.length === 1 ? "" : "s"} on hold`} description="Reminders and texts pause; the 30-day clock is unchanged." action="Put on hold" onOpenChange={(v) => setDialog(v ? "hold" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "hold", reason }), "put on hold")} />
      <ReasonDialog open={dialog === "mark_test"} title={`Mark ${ids.length} as test`} description="They move to Closed › Removed / test." action="Mark as test" onOpenChange={(v) => setDialog(v ? "mark_test" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "mark_test", reason }), "marked as test")} />
      <ReasonDialog open={dialog === "delete"} title={`Delete ${ids.length}`} description="TEST jobs only — real jobs are refused and kept." action="Delete" danger onOpenChange={(v) => setDialog(v ? "delete" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "delete", reason }), "deleted")} />
    </div>
  );
}
