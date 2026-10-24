// Server-paginated Active / Closed jobs list.
//
// Order of operations is fixed and enforced here: filter (scope) -> search -> stage -> sort -> page,
// all inside PostgREST. The total is an exact count over the same filtered set, so it never depends on
// which page is open, and only the rows on the requested page are enriched and serialised.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { enrichPipeline, jobOverview } from "./job-pipeline.server";
import { reopenPlan } from "./office-jobs.core";
import { retiredStageBlocker } from "./workflow";
import { clampPage, toPage, toPageSize, totalPagesFor } from "./list-paging.core";
import { countOf, notInChunks, searchFilter, toDirection, toEnum } from "./list-query.core";
import {
  JOB_SEARCH_COLUMNS,
  JOB_SORT_KEYS,
  JOB_STAGES,
  closedAllCount,
  closedPile,
  jobArchiveFilter,
  type JobClosedFilter,
  type JobClosedView,
  type JobListParams,
  type JobMode,
} from "./job-list-page.core";

const OPEN_STAGES = "(complete,cancelled)";

/** Closed page rows only (≤ one page of ids, one batched read per table): the facts reopenPlan and closedPile need. */
async function closedRowFacts(ids: string[]) {
  const out = new Map<string, { priorStage: string | null; cancelledReason: string | null; officeRemoved: boolean; contactRank: number; removedLead: boolean; testPriorSource: string | null }>();
  if (!ids.length) return out;
  const [jobs, list, events] = await Promise.all([
    admin.from("jobs").select("id, prior_stage, cancelled_reason").in("id", ids),
    admin.from("office_job_list").select("id, office_removed, contact_rank").in("id", ids),
    admin.from("workflow_events").select("job_id, event_type, details, created_at").in("job_id", ids).in("event_type", ["lead_removed", "marked_test"]).order("created_at", { ascending: true }),
  ]);
  for (const r of [jobs, list, events]) if (r.error) throw new Error(`Closed job details unavailable: ${r.error.message}`);
  for (const j of jobs.data ?? []) out.set(j.id, { priorStage: j.prior_stage ?? null, cancelledReason: j.cancelled_reason ?? null, officeRemoved: false, contactRank: 1, removedLead: false, testPriorSource: null });
  for (const l of list.data ?? []) { const f = l.id ? out.get(l.id) : undefined; if (f) { f.officeRemoved = !!l.office_removed; f.contactRank = l.contact_rank ?? 1; } }
  for (const e of events.data ?? []) {
    const f = e.job_id ? out.get(e.job_id) : undefined;
    if (!f) continue;
    if (e.event_type === "lead_removed") f.removedLead = true;
    else f.testPriorSource = ((e.details as { prior_source?: string | null } | null)?.prior_source) ?? null; // latest wins (ascending order)
  }
  return out;
}

/**
 * A PostgREST builder viewed only through the filters this loader uses, so ONE scope implementation can
 * drive three differently projected queries: the page rows, the head-only counts and the stage chips.
 * Declared as methods on purpose — TypeScript then compares the parameters bivariantly.
 */
interface ScopeChain<T> {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  not(column: string, operator: string, value: unknown): T;
  or(filters: string): T;
}

/**
 * The scope every count and every page shares. The stage chip and the search term are deliberately NOT
 * part of it: they narrow the page only, so the tile totals keep describing the view the office chose.
 */
function scope<T extends ScopeChain<T>>(q: T, archived: ReturnType<typeof jobArchiveFilter>, mode: JobMode, closedView: JobClosedFilter): T {
  let cur = q;
  if (mode === "active") return cur.eq("office_bucket", "active");
  cur = cur.eq("office_bucket", "closed");
  if (mode === "closed" && closedView === "test") {
    cur = cur.or('source.eq.qa_test,office_removed.eq.true,contact_rank.gt.1');
  } else if (mode === "closed" && closedView !== "all") {
    // One pile per job (Jo 21 Oct): Removed/test wins; Ineligible is the catch-all for any other closure.
    cur = cur.or("source.is.null,source.neq.qa_test").eq("office_removed", false).or("contact_rank.is.null,contact_rank.lte.1");
    if (closedView === "completed") cur = cur.eq("stage", "complete");
    else if (closedView === "cancelled") cur = cur.eq("stage", "cancelled");
    else if (closedView === "ineligible") cur = cur.not("stage", "in", OPEN_STAGES);
  }
  // Multiple not.in clauses still share ONE URL. Use the much smaller live TEST complement.
  cur = cur.or(archived.visible);
  for (const chunk of notInChunks(archived.archivedOtherIds)) cur = cur.not("id", "in", chunk);
  return cur;
}

/** Search runs in the database across every searchable column at once. */
function searched<T extends ScopeChain<T>>(q: T, search: string): T {
  const f = searchFilter(search, [...JOB_SEARCH_COLUMNS]);
  return f ? q.or(f) : q;
}

/** Exact count for a narrowed scope. Head-only, so no rows travel for a number. */
async function headCount(q: ReturnType<typeof jobOverview>, what: string): Promise<number> {
  const { count, error } = await q.limit(0);
  return countOf({ count, error }, what);
}

export async function loadJobListPage(params: JobListParams) {
  const { mode, closedView } = params;
  const size = toPageSize(params.pageSize);
  const wanted = toPage(params.page);
  const search = params.search ?? "";
  const stage = toEnum(params.stage, JOB_STAGES, null);
  const sortKey = toEnum(params.sort, JOB_SORT_KEYS, "last_activity_at") ?? "last_activity_at";
  const ascending = toDirection(params.direction) === "asc";
  // Archived TEST jobs and deleted jobs are independent reads, so they run side by side (speed, 21 Oct).
  const readArchived = async () => {
    const rows: Array<{ id: string; source: string | null; qa_archived_at: string | null }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("jobs").select("id,source,qa_archived_at")
        .or("source.eq.qa_test,qa_archived_at.not.is.null").order("id").range(from, from + 999);
      if (error) throw new Error(`Archived TEST jobs could not be read: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  const [archiveRows, { data: deleted, error: deletedError }] = await Promise.all([
    readArchived(),
    // Deleted jobs live only on the Deleted jobs page.
    admin.from("jobs").select("id").not("deleted_at", "is", null).limit(5000),
  ]);
  const archived = jobArchiveFilter(archiveRows);
  if (deletedError) throw new Error(`Deleted jobs could not be read: ${deletedError.message}`);
  archived.archivedOtherIds.push(...(deleted ?? []).map(r => r.id).filter(id => !archived.archivedOtherIds.includes(id)));
  const scoped = (m: JobMode = mode, v: JobClosedFilter = closedView) => scope(jobOverview("exact", true), archived, m, v);
  const searchedScope = () => searched(scoped(), search);

  const run = async (page: number) => {
    const from = (page - 1) * size;
    let q = searchedScope();
    if (stage) q = q.eq("stage", stage);
    // `id` is always the last ORDER BY: the stable tie-breaker that stops equal sort keys reshuffling
    // between requests, which would otherwise show one record on two pages at once.
    const { data, count, error } = await q
      .order(sortKey, { ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`Jobs could not be loaded: ${error.message}`);
    return { rows: data ?? [], total: count ?? 0 };
  };

  // The chips, tiles and oldest-job reads do not depend on the page, so they start alongside it.
  const sidePromise = Promise.all([
    searched(scope(admin.from("office_job_list" as "job_overview").select("stage"), archived, mode, closedView), search).limit(5000),
    mode === "active"
      ? Promise.all([
          headCount(searchedScope().eq("eligibility_review_required", true), "Review-required count"),
          headCount(searchedScope().eq("payment_status", "overdue"), "Overdue payment count"),
          headCount(searchedScope().in("urgency", ["red", "expired"]), "Safety attention count"),
        ])
      : Promise.all([
          headCount(searched(scoped("closed", "completed"), search), "Completed count"),
          headCount(searched(scoped("closed", "cancelled"), search), "Cancelled count"),
          headCount(searched(scoped("closed", "ineligible"), search), "Ineligible count"),
          headCount(searched(scoped("closed", "test"), search), "Removed / test count"),
        ]),
    // Oldest open job, so the footer no longer needs every row to find one value.
    mode === "active" ? searchedScope().order("created_at", { ascending: true, nullsFirst: false }).limit(1) : Promise.resolve({ data: [], error: null }),
  ] as const);
  sidePromise.catch(() => undefined);
  const first = await run(wanted);
  const totalPages = totalPagesFor(first.total, size);
  const current = clampPage(wanted, totalPages);
  // A page can point past the end once the result set shrinks; re-read the clamped page rather than
  // showing an empty list the office cannot escape.
  const page = current === wanted ? first : await run(current);

  const [stageRows, tiles, oldest] = await sidePromise;
  if (stageRows.error) throw new Error(`Stage counts unavailable: ${stageRows.error.message}`);

  const stageCounts: Record<string, number> = {};
  for (const r of stageRows.data ?? []) stageCounts[r.stage ?? "unknown"] = (stageCounts[r.stage ?? "unknown"] ?? 0) + 1;

  const enriched = await enrichPipeline(page.rows);
  // Closed jobs show why they were closed, which pile they are in (for "All") and whether Reopen applies.
  const closedFacts = mode === "closed" ? await closedRowFacts(enriched.map((r) => r.id).filter((id): id is string => !!id)) : null;
  const rows = enriched.map((r) => {
    const f = r.id ? closedFacts?.get(r.id) : undefined;
    if (!f) return r;
    const plan = reopenPlan({ stage: r.stage, priorStage: f.priorStage, eligibilityOutcome: r.eligibility_outcome ?? null, source: r.source ?? null, testPriorSource: f.testPriorSource, removedLead: f.removedLead, duplicateContact: f.contactRank > 1, retired: retiredStageBlocker });
    const closedAs = closedPile({ source: r.source ?? null, office_removed: f.officeRemoved, contact_rank: f.contactRank, stage: r.stage, deleted: false });
    return { ...r, cancelled_reason: f.cancelledReason, closed_as: closedAs === "deleted" ? "test" as const : closedAs, removed_lead: f.removedLead, can_reopen: plan.ok, reopen_blocker: plan.ok ? null : plan.blocker };
  });
  const start = (current - 1) * size;
  return {
    rows,
    page: current,
    pageSize: size,
    total: page.total,
    totalPages,
    from: page.total === 0 ? 0 : start + 1,
    to: page.total === 0 ? 0 : start + page.rows.length,
    stageCounts,
    oldestActiveCreatedAt: oldest.data?.[0]?.created_at ?? null,
    tiles:
      mode === "active"
        ? { inProgress: page.total, reviewRequired: tiles[0], paymentOverdue: tiles[1], safetyAttention: tiles[2] }
        : { completed: tiles[0], cancelled: tiles[1], ineligible: tiles[2], test: tiles[3], all: closedAllCount({ completed: tiles[0], cancelled: tiles[1], ineligible: tiles[2], test: tiles[3] ?? 0 }) },
  };
}
