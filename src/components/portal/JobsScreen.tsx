// Jobs pages (spec 2026-10-28-jobs-pages-redesign): the page switcher shared by Our jobs · Installer jobs · Closed jobs,
// and Closed jobs (decision 227: Completed · Cancelled · Ineligible · Removed / test, with Reopen + reason), unchanged.
// Our jobs and Installer jobs live in JobsLaneScreen.tsx.
import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction } from "@/hooks/use-me";
import { getJobsLaneCounts, reopenOfficeJob } from "@/lib/office-screens.functions";
import { bulkJobAction } from "@/lib/bulk.functions";
import { getJobListPage } from "@/lib/portal.functions";
import { closedWhy, surnameOf } from "@/lib/office-jobs.core";
import { CLOSED_FILTERS, type JobClosedFilter, type JobClosedView } from "@/lib/job-list-page.core";
import type { SortDir } from "@/lib/office-filters.core";
import { LoadError } from "@/components/portal/office-tabs";
import { ActionsMenu, Pager, ReasonDialog, SortHead } from "@/components/portal/office-lists";

const CLOSED_LABEL: Record<JobClosedFilter, string> = { all: "All",  completed: "Completed", cancelled: "Cancelled", ineligible: "Ineligible", test: "Removed / test" };

/** Where the three Jobs pages live (one place to change). */
const JOBS_PAGES = { ours: "/admin/jobs/ours", installer: "/admin/jobs/installers", closed: "/admin/jobs/closed" } as const;

/** "Our jobs 384 · Installer jobs 26 · Closed jobs" under the page title, on phone and computer. */
export function JobsSwitcher({ current }: { current: "ours" | "installer" | "closed" }) {
  const countsFn = useServerFn(getJobsLaneCounts);
  const counts = useQuery({ queryKey: ["jobs-lane-counts"], queryFn: () => countsFn({ data: {} }), staleTime: 60_000, retry: 1 });
  const c = counts.data;
  const item = (k: "ours" | "installer" | "closed", label: string, n: number | undefined) => (
    <Link to={JOBS_PAGES[k]} aria-current={current === k ? "page" : undefined} className={cn("whitespace-nowrap", current === k ? "font-bold text-ink" : "font-semibold text-hiv-blue hover:underline")}>
      {label}{n != null ? ` ${n.toLocaleString("en-AU")}` : ""}
    </Link>
  );
  return (
    <nav aria-label="Jobs pages" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {item("ours", "Our jobs", c?.ours)}<span className="text-sub">·</span>
      {item("installer", "Installer jobs", c?.installer)}<span className="text-sub">·</span>
      {item("closed", "Closed jobs", undefined)}
    </nav>
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
      <ReasonDialog open={!!reopening} title={`Reopen ${reopening?.jobNumber ?? ""}`} description="Undoes what closed it: back to the stage it was at, an ineligible decision back to confirm-on-site, or a test mark removed. The history is kept. The installer or electrician it was released from is not re-offered automatically." action="Reopen" onOpenChange={(v) => !v && setReopening(null)} run={async (reason) => { const r = await reopen({ jobId: reopening!.id, reason }, "Reopened"); if (r) { void qc.invalidateQueries(); return true; } return false; }} />
      <ReasonDialog open={dialog === "mark_test"} title={`Mark ${ids.length} as test`} description="They move to Removed / test." action="Mark as test" onOpenChange={(v) => setDialog(v ? "mark_test" : null)} run={async (reason) => { const r = await bulk({ jobIds: ids, action: "mark_test", reason }, "Marked as test"); setPicked(new Set()); return !!r; }} />
      <ReasonDialog open={dialog === "delete"} title={`Delete ${ids.length}`} description="TEST jobs only — real jobs are refused and kept." action="Delete" danger onOpenChange={(v) => setDialog(v ? "delete" : null)} run={async (reason) => { const r = await bulk({ jobIds: ids, action: "delete", reason }); if (r?.failed.length) toast.error(r.failed[0]!.error ?? "Some were not deleted"); setPicked(new Set()); void qc.invalidateQueries(); return !!r; }} />
    </div>
  );
}

export function JobsScreen({ mode }: { mode: "closed" }) {
  return (
    <div>
      <h1 className="mb-1 font-display text-[30px] font-extrabold leading-tight text-ink">Closed jobs</h1>
      <JobsSwitcher current="closed" />
      <ClosedJobs />
    </div>
  );
}
