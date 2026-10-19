/**
 * Office list pagination — structural guarantees.
 *
 * Pins the server-side pipeline (filter -> search -> sort -> page) and proves the browser no longer
 * downloads the whole table and slices it. Static only: no database, no network, no sending.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const JOBS = read("src/lib/job-list-page.server.ts");
const PIPELINE = read("src/lib/job-pipeline.server.ts");
const PORTAL_FNS = read("src/lib/portal.functions.ts");
const ENQUIRIES = read("src/lib/enquiry-groups.server.ts");
const ENQUIRY_FNS = read("src/lib/enquiry-groups.functions.ts");
const JOBS_UI = read("src/components/portal/JobsWorkspace.tsx");
const ENQUIRIES_UI = read("src/components/portal/EnquiriesWorkspace.tsx");
const PAGER = read("src/components/portal/ListPagination.tsx");

describe("the job list is paged by the database", () => {
  test("the pipeline runs filter -> search -> stage -> sort -> page", () => {
    const at = (needle: string) => JOBS.indexOf(needle);
    const order = [
      at("function scope<"),
      at("const f = searchFilter(search,"),
      at('if (stage) q = q.eq("stage", stage);'),
      at(".order(sortKey,"),
      at(".range(from, from + size - 1)"),
    ];
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the page is bounded by a SQL range with a deterministic tie-breaker", () => {
    expect(JOBS).toContain('.order("id", { ascending: true })');
    expect(JOBS).toMatch(/\.range\(from, from \+ size - 1\)/);
    expect(JOBS).not.toContain(".slice((page");
  });

  test("counts are exact and independent of the page being shown", () => {
    // the page read asks for an exact count in the same request that returns the rows
    expect(JOBS).toContain('jobOverview("exact")');
    expect(PIPELINE).toContain('admin.from("job_overview").select(JOB_LIST_COLUMNS, count ? { count } : undefined)');
    expect(JOBS).toContain(".limit(0)"); // head-only counts transfer no rows
  });

  test("a page past the end is re-read at the clamped page", () => {
    expect(JOBS).toContain("const current = clampPage(wanted, totalPages);");
    expect(JOBS).toContain("current === wanted ? first : await run(current)");
  });

  test("only the rows on the page are enriched", () => {
    expect(JOBS).toContain("const rows = await enrichPipeline(page.rows);");
    expect(PIPELINE).toContain('admin.from("invoices").select("job_id,last_sync_error").in("job_id", NONE)');
    expect(PIPELINE).toContain('.in("id", NONE)');
  });

  test("the browser no longer filters, searches, sorts or slices the whole list", () => {
    expect(JOBS_UI).toContain("getJobListPage");
    expect(JOBS_UI).not.toContain("getAdminPipeline");
    expect(JOBS_UI).not.toContain("const shown = useMemo");
    expect(JOBS_UI).not.toMatch(/\.filter\(\s*\(j\)/);
    expect(JOBS_UI).not.toMatch(/matching\.slice|rows\.slice/);
    expect(JOBS_UI).toContain("<ListPagination");
  });

  test("the paged read is admin-only and every parameter is bounded", () => {
    expect(PORTAL_FNS).toMatch(
      /export const getJobListPage = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)/,
    );
    expect(PORTAL_FNS).toMatch(/await requireAdmin\(context\.supabase\);[\s\S]{0,400}loadJobListPage/);
    expect(PORTAL_FNS).toContain("page: z.number().int().min(1).max(100_000).default(1)");
    expect(PORTAL_FNS).toContain("pageSize: z.number().int().min(1).max(100).default(20)");
  });
});

describe("shared list behaviour", () => {
  test("search is debounced at 300 ms and the state is in the URL", () => {
    const hook = read("src/hooks/use-list-controls.ts");
    expect(hook).toContain("useDebouncedValue(term, 300)");
    expect(hook).toContain("listControlsToSearch");
    expect(read("src/hooks/use-debounced-value.ts")).toContain("delay = 300");
    for (const route of [
      "src/routes/_authenticated/admin.jobs.active.tsx",
      "src/routes/_authenticated/admin.jobs.closed.tsx",
      "src/routes/_authenticated/admin.enquiries.tsx",
    ]) {
      expect(read(route)).toContain("validateSearch");
      expect(read(route)).toContain("parseListControls");
      expect(read(route)).toContain("resetScroll: false");
    }
  });

  test("a stale response can never overwrite a newer page", () => {
    for (const ui of [JOBS_UI, ENQUIRIES_UI]) {
      expect(ui).toContain("placeholderData: keepPreviousData");
      // the whole control set is the query key, so React Query keys each view separately
      expect(ui).toMatch(/queryKey: \[[^\]]*controls\]/);
      expect(ui).toContain("aria-busy={busy}");
    }
  });

  test("the shared pager is accessible, complete and has one empty state", () => {
    expect(PAGER).toContain("aria-label={`${label} pagination`}");
    expect(PAGER).toContain('aria-current={item === page ? "page" : undefined}');
    expect(PAGER).toContain('aria-live="polite"');
    expect(PAGER).toContain('aria-label="Previous page"');
    expect(PAGER).toContain('aria-label="Next page"');
    expect(PAGER).toContain("Rows per page");
    expect(PAGER).toContain("Showing ${from}–${to} of ${total}");
    expect(PAGER).toContain("No ${label} to show");
    expect(PAGER).toContain("Page ${page} of ${totalPages}");
    expect(PAGER).toContain("Updating…");
    expect(PAGER).toContain("{PAGE_SIZES.map");
  });
});

describe("the enquiries list is paged by the server too", () => {
  test("the full row set is no longer downloaded and sliced in React", () => {
    expect(ENQUIRIES_UI).not.toContain("matching.slice");
    expect(ENQUIRIES_UI).not.toContain("safePage");
    expect(ENQUIRIES_UI).not.toContain("const PAGE = 50");
    expect(ENQUIRIES_UI).not.toContain("rows.filter((row) => !row.removed)");
    expect(ENQUIRIES_UI).toContain("<ListPagination");
    expect(ENQUIRIES).toContain("const page = paginate(matching, wanted, size);");
  });

  test("search happens in the database and the view is whitelisted", () => {
    expect(ENQUIRIES).toContain('searchFilter(query.search ?? "", [...ENQUIRY_SEARCH_COLUMNS])');
    expect(ENQUIRIES).toContain("const view = ENQUIRY_VIEW_KEYS.includes(params.view)");
  });

  test("every tile count comes from the same filtered set as the list", () => {
    expect(ENQUIRIES).toContain("counts[v] = classified.filter((r) => inEnquiryView(r, v)).length");
    expect(ENQUIRIES).toContain("const matching = classified.filter((r) => inEnquiryView(r, view));");
    expect(ENQUIRIES_UI).toContain("const counts = (data?.counts ?? {})");
  });

  test("only the current page is serialised to the browser", () => {
    expect(ENQUIRY_FNS).toContain("export const getEnquiryPage = createServerFn");
    expect(ENQUIRY_FNS).toMatch(/await requireAdmin\(context\.supabase\);[\s\S]{0,400}loadEnquiryPage/);
    expect(ENQUIRY_FNS).toContain("return { ...r, rows: r.rows.map(wireRow) };");
    expect(ENQUIRY_FNS).toContain("pageSize: z.number().int().min(1).max(100).default(20)");
  });
});

describe("regression: nothing here changes an email, a payment or a workflow", () => {
  test("the new loaders are read-only and are not server functions themselves", () => {
    for (const src of [JOBS, PIPELINE]) {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src).not.toContain("createServerFn");
    }
    // enquiry-groups.server.ts keeps its two pre-existing writers untouched; nothing else may write
    expect(ENQUIRIES.match(/\.insert\(/g) ?? []).toHaveLength(1);
    expect(ENQUIRIES.match(/\.update\(/g) ?? []).toHaveLength(1);
    expect(ENQUIRIES).toContain("export async function reviewLeadMedia");
    expect(ENQUIRIES).toContain("export async function removeLeads");
  });

  test("the enquiry group rules and the existing full pipeline read are untouched", () => {
    const core = read("src/lib/enquiry-groups.core.ts");
    expect(core).toContain("export function isNewEnquiry(row: { lastEmail: unknown }): boolean");
    expect(core).toContain("return !row.lastEmail;");
    expect(PORTAL_FNS).toContain("export const getAdminPipeline = createServerFn");
    expect(ENQUIRIES).toContain("export async function loadEnquiryGroups()");
  });
});


