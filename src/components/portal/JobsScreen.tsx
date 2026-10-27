// O3 Jobs (approved mock-up; decisions 224, 226, 227, 239): Active / Closed. Active = six stages from Choose installer
// to Final check (one stage per job), Installers' own jobs, three folded piles, filter chips on every column, sortable
// columns, Actions ▾ with bulk Cancel. Closed = Completed · Cancelled · Ineligible · Removed / test, with Reopen + reason.
// The old stat tiles, the Quotes to check block (it lives on Needs me + the Quote card) and per-row fact lines are gone.
import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction, useMe } from "@/hooks/use-me";
import { getActiveJobsList, bulkCancelOfficeJobs, reopenOfficeJob } from "@/lib/office-screens.functions";
import { bulkJobAction } from "@/lib/bulk.functions";
import { getJobListPage } from "@/lib/portal.functions";
import { getNewInstallerJobs } from "@/lib/installer-new-jobs.functions";
import { getMittiPickups, getMittiSyncProblems } from "@/lib/mitti-pickup.functions";
import { JOBS_STAGES, JOBS_STAGE_LABEL, closedWhy, surnameOf, type JobsStage } from "@/lib/office-jobs.core";
import { CLOSED_FILTERS, type JobClosedFilter, type JobClosedView } from "@/lib/job-list-page.core";
import { HEARD_CHIPS, INSULATION_CHIPS, INSULATION_LABEL, LAST_HEARD_LABEL, REGION_CHIPS, REGION_LABEL, SOURCE_CHIPS, SOURCE_LABEL, type ChipFilters, type SortDir } from "@/lib/office-filters.core";
import { checkedLabel, isDefaultListView } from "@/lib/office-needs-snapshot.core";
import { readOfficeList } from "@/lib/office-list-refresh";
import { NewFromInstallers } from "@/components/portal/NewFromInstallers";
import { LoadError } from "@/components/portal/office-tabs";
import { pileCount } from "@/lib/read-state.core";
import { MittiPickupsToLink, MittiSyncProblems } from "@/components/portal/mitti-piles";
import { ActionsMenu, ChipGroup, FilterPanel, Pager, ReasonDialog, SortHead, heardLabel } from "@/components/portal/office-lists";

const CLOSED_LABEL: Record<JobClosedFilter, string> = { all: "All",  completed: "Completed", cancelled: "Cancelled", ineligible: "Ineligible", test: "Removed / test" };

function Tabs({ mode, active, closed }: { mode: "active" | "closed"; active: number | null; closed: number | null }) {
  const tab = "rounded-[10px] px-4 py-2 text-sm font-bold";
  return (
    <div className="mb-4 flex gap-1" role="tablist" aria-label="Jobs">
      <Link role="tab" aria-selected={mode === "active"} to="/admin/jobs/active" className={cn(tab, mode === "active" ? "bg-ink text-white" : "bg-paper text-sub")}>Active{active != null ? ` · ${active}` : ""}</Link>
      <Link role="tab" aria-selected={mode === "closed"} to="/admin/jobs/closed" className={cn(tab, mode === "closed" ? "bg-ink text-white" : "bg-paper text-sub")}>Closed{closed != null ? ` · ${closed.toLocaleString("en-AU")}` : ""}</Link>
    </div>
  );
}

/** Three small piles, one fold line each (decision 224); counts come from the same caches as the full piles. */
function Piles() {
  const [open, setOpen] = useState<"new" | "mitti" | "sync" | null>(null);
  const newFn = useServerFn(getNewInstallerJobs), pickFn = useServerFn(getMittiPickups), syncFn = useServerFn(getMittiSyncProblems);
  const fresh = useQuery({ queryKey: ["new-from-installers", false], queryFn: () => newFn({ data: { showTestJobs: false } }), staleTime: 60_000 });
  const picks = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => pickFn(), staleTime: 60_000, retry: 1 });
  const sync = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => syncFn(), staleTime: 60_000 });
  const line = (k: "new" | "mitti" | "sync", label: string, count: string) => (
    <button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className={cn("text-sm font-semibold", open === k ? "text-ink" : "text-hiv-blue")}>{label} · {count} {open === k ? "▾" : "›"}</button>
  );
  return (
    <div className="mb-4" data-why="audit §3 blocks: New from installers (31), Mitti pick-ups (Mitti-first rule), sync problems">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {line("new", "New from installers", pileCount({ count: fresh.data ? (fresh.data.attention?.length ?? 0) + (fresh.data.fresh?.length ?? 0) : undefined, failed: fresh.isError }))}
        {line("mitti", "Ready Checks started in Mitti", pileCount({ count: picks.data?.rows.length, failed: picks.isError }))}
        {line("sync", "Mitti sync problems", pileCount({ count: sync.data?.rows.length, failed: sync.isError }))}
      </div>
      {open === "new" && <div className="mt-3">{fresh.isError && !fresh.data ? <LoadError what="New from installers" error={fresh.error} retry={() => void fresh.refetch()} /> : <NewFromInstallers />}</div>}
      {open === "mitti" && <div className="mt-3">{picks.isError && !picks.data ? <LoadError what="Ready Checks started in Mitti" error={picks.error} retry={() => void picks.refetch()} /> : picks.data?.rows.length === 0 ? <p className="text-sm text-sub">No Ready Checks waiting to be linked.</p> : <MittiPickupsToLink />}</div>}
      {open === "sync" && <div className="mt-3">{sync.isError && !sync.data ? <LoadError what="Mitti sync problems" error={sync.error} retry={() => void sync.refetch()} /> : sync.data?.rows.length === 0 ? <p className="text-sm text-sub">No Mitti sync problems.</p> : <MittiSyncProblems />}</div>}
    </div>
  );
}

export function ActiveJobs({ includeTest = false, initialStage }: { includeTest?: boolean; initialStage?: JobsStage | undefined }) {
  const { data: me } = useMe();
  const testOffice = me?.roles.includes("qa_office") ?? false;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const load = useServerFn(getActiveJobsList);
  const [stage, setStage] = useState<JobsStage[]>(initialStage ? [initialStage] : []);
  const [own, setOwn] = useState(false);
  const [f, setF] = useState<ChipFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "", d: "desc" });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  const filters: ChipFilters = { ...f, ...(stage.length ? { stage } : {}), ...(own ? { ownJobs: true } : {}) };
  // Decision 383: the opening view comes from the server's saved copy (worked out now after an office action in this
  // tab); while the server refreshes it, ask again in 5 s. One retry, not three, for the office's heaviest list.
  const q = useQuery({
    queryKey: ["office-active-jobs", filters, sort, page, includeTest],
    queryFn: () => {
      const view = { search: "", sort: sort.k, dir: sort.d, page, filters, includeTest };
      return readOfficeList("jobs", isDefaultListView(view), (refresh) => load({ data: { ...view, refresh } }));
    },
    placeholderData: keepPreviousData, staleTime: 30_000, retry: 1, refetchInterval: (x) => (x.state.data?.refreshing ? 5_000 : false),
  });
  const cancel = useAction(bulkCancelOfficeJobs);
  const bulk = useAction(bulkJobAction);
  const d = q.data;
  const ids = [...picked];
  const after = (r: { done: number; failed: { error?: string }[] } | undefined, what: string) => { if (!r) return false; if (r.failed.length) toast.error(`${r.done} ${what}; ${r.failed.length} not: ${r.failed[0]!.error ?? "failed"}`); else toast.success(`${r.done} ${what}`); setPicked(new Set()); void qc.invalidateQueries(); return true; };
  const set = (patch: Partial<ChipFilters>) => { setF({ ...f, ...patch }); setPage(1); };
  const activeFilters = !!(stage.length || own || f.installer?.length || f.region?.length || f.insulation?.length || f.heard?.length || f.source?.length);
  const installerOpts = useMemo(() => [...(d?.installers ?? []), "none"], [d?.installers]);
  return (
    <div>
      <p className="mb-3 text-sm text-sub">{d ? `${d.all} active · from Choose installer to Final check · every job in one stage.` : "Loading jobs…"} <Link to="/admin/jobs/choose-installer" className="font-semibold text-hiv-blue underline" data-why="decision 378">Choose installer list</Link></p>
      {!testOffice && <Piles />}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Stage" data-why="decision 239 six stages, one pile per job (0218); 31 installers' own jobs">
        <button type="button" aria-pressed={!stage.length} onClick={() => { setStage([]); setPage(1); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", !stage.length ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>All {d?.all ?? ""}</button>
        {JOBS_STAGES.map((s) => {
          const on = stage.includes(s.key);
          return <button key={s.key} type="button" aria-pressed={on} onClick={() => { setStage(on ? stage.filter((x) => x !== s.key) : [...stage, s.key]); setPage(1); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>{s.label} {d?.stageCounts[s.key] ?? ""}</button>;
        })}
        <button type="button" aria-pressed={own} onClick={() => { setOwn(!own); setPage(1); }} className={cn("ml-2 rounded-full border px-3 py-1 text-xs font-semibold", own ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>Installers’ own jobs {d?.ownCount ?? ""}</button>
      </div>
      <FilterPanel note="Pick as many as you like · every column is sortable." active={activeFilters} onClear={() => { setF({}); setStage([]); setOwn(false); setPage(1); }}>
        <ChipGroup label="Installer" options={installerOpts} labels={Object.fromEntries(installerOpts.map((i) => [i, i === "none" ? "None yet" : i]))} value={f.installer ?? []} onChange={(v) => set({ installer: v })} />
        <ChipGroup label="Suburb / area" options={REGION_CHIPS} labels={REGION_LABEL} value={f.region ?? []} onChange={(v) => set({ region: v })} />
        <ChipGroup label="Insulation" options={INSULATION_CHIPS} labels={INSULATION_LABEL} value={f.insulation ?? []} onChange={(v) => set({ insulation: v })} />
        <ChipGroup label="Last heard" options={HEARD_CHIPS} labels={LAST_HEARD_LABEL} value={f.heard ?? []} onChange={(v) => set({ heard: v })} />
        <ChipGroup label="Source" options={SOURCE_CHIPS} labels={SOURCE_LABEL} value={f.source ?? []} onChange={(v) => set({ source: v })} />
      </FilterPanel>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-sub">{d ? `${d.total} of ${d.all} match` : ""}{d?.fromCopy ? ` · checked ${checkedLabel(d.computedAt, false)}` : ""}{(q.isFetching || d?.refreshing) && d ? " · updating…" : ""}</span>
        <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "cancel", label: "Cancel", danger: true }, { key: "hold", label: "Put on hold" }, { key: "mark_test", label: "Mark as test" }, { key: "delete", label: "Delete (test jobs only)", danger: true }]} />
      </div>
      {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">Jobs could not be loaded. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
          <div className="hidden grid-cols-[28px_80px_minmax(0,120px)_minmax(0,120px)_110px_minmax(0,1fr)_minmax(0,150px)_minmax(0,140px)] gap-x-3 border-b border-line bg-mist px-3 py-2 md:grid">
            <input type="checkbox" aria-label="Select all on this page" checked={!!d?.rows.length && d.rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(d?.rows.map((r) => r.id)) : new Set())} />
            {([["Job", "job"], ["Owner", "owner"], ["Suburb", "suburb"], ["Stage", "stage"], ["Status", "status"], ["Last heard from us", "heard"], ["Installer", "installer"]] as const).map(([l, k]) => <SortHead key={k} label={l} k={k} sort={sort.k || "heard"} dir={sort.d} onSort={(kk, dd) => { setSort({ k: kk, d: dd }); setPage(1); }} />)}
          </div>
          {!d ? <p className="p-6 text-center text-sm text-sub">Loading jobs…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">No jobs match. {activeFilters && <button type="button" className="font-semibold text-hiv-blue underline" onClick={() => { setF({}); setStage([]); setOwn(false); }}>Clear filters</button>}</p> : (
            <ul>
              {d.rows.map((r) => (
                <li key={r.id} className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-mist md:grid-cols-[28px_80px_minmax(0,120px)_minmax(0,120px)_110px_minmax(0,1fr)_minmax(0,150px)_minmax(0,140px)] md:items-center" onClick={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: r.id } })}>
                  <input type="checkbox" aria-label={`Select ${r.jobNumber}`} checked={picked.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                  <span className="font-semibold">{r.jobNumber}{r.isTest ? " · TEST" : ""}</span>
                  <span className="col-start-2 truncate md:col-auto">{r.surname || r.owner}</span>
                  <span className="col-start-2 truncate text-sub md:col-auto">{r.suburb ?? ""}</span>
                  <span className="col-start-2 md:col-auto"><span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-hiv-blue">{JOBS_STAGE_LABEL[r.stage]}</span></span>
                  <span className="col-start-2 min-w-0 break-words md:col-auto">{r.status}{r.lifeSupport ? <span className="ml-1 text-rose">· life support</span> : null}</span>
                  <span className="col-start-2 text-sub md:col-auto">{heardLabel(r.lastHeardAt, r.lastHeardChannel)}</span>
                  <span className="col-start-2 truncate md:col-auto">{r.installer ? `${r.installer}${r.ownJob ? " (own)" : ""}` : r.stage === "choose_installer" ? "Choose installer" : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {d && <Pager page={d.page} totalPages={d.totalPages} total={d.total} shown={d.rows.length} onPage={setPage} />}
      <ReasonDialog open={dialog === "cancel"} title={`Cancel ${ids.length} job${ids.length === 1 ? "" : "s"}`} description="Each moves to Closed; reminders and texts stop; held install days and installers are released; history is kept (decision 227)." action="Cancel jobs" danger presets={["Owner changed mind", "Not eligible", "No response", "Duplicate"]} onOpenChange={(v) => setDialog(v ? "cancel" : null)} run={async (reason) => after(await cancel({ jobIds: ids, reason }), "cancelled")} />
      <ReasonDialog open={dialog === "hold"} title={`Put ${ids.length} job${ids.length === 1 ? "" : "s"} on hold`} description="Reminders and texts pause; the 30-day clock is unchanged." action="Put on hold" onOpenChange={(v) => setDialog(v ? "hold" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "hold", reason }), "put on hold")} />
      <ReasonDialog open={dialog === "mark_test"} title={`Mark ${ids.length} as test`} description="They move to Closed › Removed / test." action="Mark as test" onOpenChange={(v) => setDialog(v ? "mark_test" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "mark_test", reason }), "marked as test")} />
      <ReasonDialog open={dialog === "delete"} title={`Delete ${ids.length}`} description="TEST jobs only — real jobs are refused and kept." action="Delete" danger onOpenChange={(v) => setDialog(v ? "delete" : null)} run={async (reason) => after(await bulk({ jobIds: ids, action: "delete", reason }), "deleted")} />
    </div>
  );
}

export function ClosedJobs() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const load = useServerFn(getJobListPage);
  const reopen = useAction(reopenOfficeJob);
  const bulk = useAction(bulkJobAction);
  const [view, setView] = useState<JobClosedFilter>("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "last_activity_at", d: "desc" });
  const [reopening, setReopening] = useState<{ id: string; jobNumber: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["office-closed-jobs", view, page, sort], queryFn: () => load({ data: { mode: "closed", closedView: view, stage: "all", search: "", sort: sort.k, direction: sort.d, page, pageSize: 50 } }), placeholderData: keepPreviousData, staleTime: 30_000 });
  const d = q.data;
  const tiles = d?.tiles as Record<JobClosedFilter, number> | undefined;
  const ids = [...picked];
  return (
    <div data-why="audit §3 Closed tab; decision 227 Reopen with reason">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Closed as">
          {CLOSED_FILTERS.map((k) => <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setPage(1); setPicked(new Set()); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", view === k ? "border-ink bg-ink text-white" : "border-line bg-paper text-sub")}>{CLOSED_LABEL[k]} {tiles ? tiles[k].toLocaleString("en-AU") : ""}</button>)}
        </div>
        <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "mark_test", label: "Mark as test" }, { key: "delete", label: "Delete (test jobs only)", danger: true }]} />
      </div>
      {q.isError ? <LoadError what="Closed jobs" error={q.error} retry={() => void q.refetch()} /> : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
          <div className="hidden grid-cols-[28px_80px_minmax(0,140px)_minmax(0,1fr)_110px_minmax(0,1.4fr)_90px_80px] gap-x-3 border-b border-line bg-mist px-3 py-2 md:grid">
            <span />
            {([["Job", "job_number"], ["Owner", "owner_name"], ["Address", "property_address"], ["Closed as", "stage"]] as const).map(([l, k]) => <SortHead key={k} label={l} k={k} sort={sort.k} dir={sort.d} onSort={(kk, dd) => { setSort({ k: kk, d: dd }); setPage(1); }} />)}
            <span className="text-[11px] font-bold uppercase tracking-wide text-sub">Why</span>
            <SortHead label="Closed" k="last_activity_at" sort={sort.k} dir={sort.d} onSort={(kk, dd) => setSort({ k: kk, d: dd })} />
            <span />
          </div>
          {!d ? <p className="p-6 text-center text-sm text-sub">Loading…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">Nothing here.</p> : (
            <ul>
              {d.rows.map((r) => {
                const id = r.id ?? "";
                const c = r as { cancelled_reason?: string | null; closed_as?: JobClosedView; removed_lead?: boolean; can_reopen?: boolean; reopen_blocker?: string | null };
                const closedAs: JobClosedView = c.closed_as ?? (view === "all" ? "ineligible" : view);
                const why = closedWhy({ stage: r.stage, cancelledReason: c.cancelled_reason ?? null, installedAt: null, veecSubmittedAt: null, source: r.source ?? null, removed: closedAs === "test" && r.source !== "qa_test" });
                return (
                  <li key={id} className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-mist md:grid-cols-[28px_80px_minmax(0,140px)_minmax(0,1fr)_110px_minmax(0,1.4fr)_90px_80px] md:items-center" onClick={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: id } })}>
                    <input type="checkbox" aria-label={`Select ${r.job_number}`} checked={picked.has(id)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(id); else n.delete(id); setPicked(n); }} />
                    <span className="font-semibold">{r.job_number}</span>
                    <span className="col-start-2 truncate md:col-auto">{surnameOf(r.owner_name) || r.owner_name}</span>
                    <span className="col-start-2 truncate text-sub md:col-auto">{r.property_address}</span>
                    <span className="col-start-2 md:col-auto">{CLOSED_LABEL[closedAs]}</span>
                    <span className="col-start-2 min-w-0 break-words md:col-auto">{why}</span>
                    <span className="col-start-2 text-sub md:col-auto">{r.last_activity_at ? new Date(r.last_activity_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) : ""}</span>
                    <span className="col-start-2 md:col-auto">{c.can_reopen ? <button type="button" className="font-semibold text-hiv-blue underline" onClick={(e) => { e.stopPropagation(); setReopening({ id, jobNumber: r.job_number ?? "" }); }}>Reopen</button> : closedAs !== "completed" && c.reopen_blocker ? <span className="text-[11px] text-sub" title={c.reopen_blocker}>Stays closed</span> : null}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {d && <Pager page={d.page} totalPages={d.totalPages} total={d.total} shown={d.rows.length} onPage={setPage} />}
      <ReasonDialog open={!!reopening} title={`Reopen ${reopening?.jobNumber ?? ""}`} description="Undoes what closed it: back to the stage it was at, an ineligible decision back to confirm-on-site, or a test mark removed. The history is kept (decision 227). The installer or electrician it was released from is not re-offered automatically." action="Reopen" onOpenChange={(v) => !v && setReopening(null)} run={async (reason) => { const r = await reopen({ jobId: reopening!.id, reason }, "Reopened"); if (r) { void qc.invalidateQueries(); return true; } return false; }} />
      <ReasonDialog open={dialog === "mark_test"} title={`Mark ${ids.length} as test`} description="They move to Removed / test." action="Mark as test" onOpenChange={(v) => setDialog(v ? "mark_test" : null)} run={async (reason) => { const r = await bulk({ jobIds: ids, action: "mark_test", reason }, "Marked as test"); setPicked(new Set()); return !!r; }} />
      <ReasonDialog open={dialog === "delete"} title={`Delete ${ids.length}`} description="TEST jobs only — real jobs are refused and kept." action="Delete" danger onOpenChange={(v) => setDialog(v ? "delete" : null)} run={async (reason) => { const r = await bulk({ jobIds: ids, action: "delete", reason }); if (r?.failed.length) toast.error(r.failed[0]!.error ?? "Some were not deleted"); setPicked(new Set()); void qc.invalidateQueries(); return !!r; }} />
    </div>
  );
}

export function JobsScreen({ mode, initialStage }: { mode: "active" | "closed"; initialStage?: JobsStage | undefined }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-[30px] font-extrabold leading-tight text-ink">Jobs</h1>
      <Tabs mode={mode} active={null} closed={null} />
      {mode === "active" ? <ActiveJobs initialStage={initialStage} /> : <ClosedJobs />}
    </div>
  );
}
