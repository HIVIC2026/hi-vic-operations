// Server-paginated Active / Closed jobs list.
//
// Order of operations is fixed and enforced here: filter (scope) -> search -> stage -> sort -> page,
// all inside PostgREST. The total is an exact count over the same filtered set, so it never depends on
// which page is open, and only the rows on the requested page are enriched and serialised.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { archivedQaJobIds, enrichPipeline, jobOverview } from "./job-pipeline.server";
import { clampPage, toPage, toPageSize, totalPagesFor } from "./list-paging.core";
import { countOf, notInChunks, searchFilter, toDirection, toEnum } from "./list-query.core";
import {
  JOB_SEARCH_COLUMNS,
  JOB_SORT_KEYS,
  JOB_STAGES,
  type JobClosedView,
  type JobListParams,
  type JobMode,
} from "./job-list-page.core";

const OPEN_STAGES = "(complete,cancelled)";

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
function scope<T extends ScopeChain<T>>(q: T, archived: string[], mode: JobMode, closedView: JobClosedView): T {
  let cur = q;
  if (mode === 'active') return cur.eq('office_bucket', 'active');
  cur = cur.eq('office_bucket', 'closed');
  if (mode === "closed" && closedView === "test") {
    cur = cur.or('source.eq.qa_test,office_removed.eq.true,contact_rank.gt.1');
  } else {
    cur = cur.neq("source", "qa_test");
    if (closedView === "completed") cur = cur.eq("stage", "complete");
    else if (closedView === "cancelled") cur = cur.eq("stage", "cancelled");
    else if (closedView === "ineligible") cur = cur.not("stage", "in", OPEN_STAGES).eq("eligibility_outcome", "does_not_appear_eligible");
  }
  // Archived TEST journeys stay hidden exactly as before; the id list is split so the URL stays legal.
  for (const chunk of notInChunks(archived)) cur = cur.not("id", "in", chunk);
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
  const archived = await archivedQaJobIds();
  const scoped = (m: JobMode = mode, v: JobClosedView = closedView) => scope(jobOverview("exact", true), archived, m, v);
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

  const first = await run(wanted);
  const totalPages = totalPagesFor(first.total, size);
  const current = clampPage(wanted, totalPages);
  // A page can point past the end once the result set shrinks; re-read the clamped page rather than
  // showing an empty list the office cannot escape.
  const page = current === wanted ? first : await run(current);

  const [stageRows, tiles, oldest] = await Promise.all([
    // One narrow single-column read feeds the stage chips; full rows are never downloaded just to count.
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
  ]);
  if (stageRows.error) throw new Error(`Stage counts unavailable: ${stageRows.error.message}`);

  const stageCounts: Record<string, number> = {};
  for (const r of stageRows.data ?? []) stageCounts[r.stage ?? "unknown"] = (stageCounts[r.stage ?? "unknown"] ?? 0) + 1;

  const enriched = await enrichPipeline(page.rows);
  // Closed jobs show why they were closed.
  const cancelledIds = enriched.filter((r) => r.stage === "cancelled" && r.id).map((r) => r.id!);
  const reasons = new Map<string, string | null>();
  if (cancelledIds.length) {
    const { data: rs, error: re } = await admin.from("jobs").select("id, cancelled_reason").in("id", cancelledIds);
    if (re) throw new Error(`Closure reasons unavailable: ${re.message}`);
    for (const r of rs ?? []) reasons.set(r.id, r.cancelled_reason);
  }
  const rows = enriched.map((r) => (r.id && reasons.has(r.id) ? { ...r, cancelled_reason: reasons.get(r.id) ?? null } : r));
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
        : { completed: tiles[0], cancelled: tiles[1], ineligible: tiles[2], test: tiles[3] },
  };
}
