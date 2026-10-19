/**
 * Office list pagination, search, filtering, sorting and URL state — behaviour.
 *
 * These are the pure helpers that decide what a page contains. Pure only: no database, no network.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  clampPage,
  listControlsPatch,
  listControlsToSearch,
  matchesTerm,
  pageWindow,
  paginate,
  parseListControls,
  sortRows,
  toPage,
  toPageSize,
  totalPagesFor,
  type ListControls,
} from "../src/lib/list-paging.core";
import { countOf, notInChunks, pageMeta, searchFilter, searchWords, toDirection, toEnum } from "../src/lib/list-query.core";
import { JOB_SEARCH_COLUMNS, JOB_SORT_KEYS, JOB_STAGES } from "../src/lib/job-list-page.core";
import { ENQUIRY_SEARCH_COLUMNS, ENQUIRY_SORT_KEYS, ENQUIRY_VIEWS } from "../src/lib/enquiry-list-page.core";

describe("page size and page number are bounded, whatever the caller sends", () => {
  test("only 20 / 50 / 100 are accepted; everything else falls back to 20", () => {
    expect(PAGE_SIZES).toEqual([20, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(toPageSize("50")).toBe(50);
    // A hostile or stale URL cannot ask for the whole table, nor a negative size.
    for (const bad of [0, -1, 7, 1000, 1e9, "abc", null, undefined, {}, Number.NaN, Infinity]) {
      expect(toPageSize(bad)).toBe(20);
    }
  });

  test("page is 1-based and never zero or negative", () => {
    expect(toPage("4")).toBe(4);
    expect(toPage(3.9)).toBe(3);
    for (const bad of [0, -5, "x", null, undefined, Number.NaN]) expect(toPage(bad)).toBe(1);
  });

  test("an out-of-range page is clamped to the last page that has rows", () => {
    expect(totalPagesFor(0, 20)).toBe(1);
    expect(totalPagesFor(20, 20)).toBe(1);
    expect(totalPagesFor(21, 20)).toBe(2);
    expect(clampPage(9, 2)).toBe(2);
    expect(clampPage(3, 0)).toBe(1);
  });
});

describe("paginate — the one slicing rule", () => {
  const rows = Array.from({ length: 95 }, (_, i) => ({ id: i + 1 }));

  test("page 1 reports the right range and total", () => {
    const p = paginate(rows, 1, 20);
    expect(p.rows).toHaveLength(20);
    expect(p.rows[0]!.id).toBe(1);
    expect(p.from).toBe(1);
    expect(p.to).toBe(20);
    expect(p.total).toBe(95);
    expect(p.totalPages).toBe(5);
  });

  test("the last page is short and its range is honest", () => {
    const p = paginate(rows, 5, 20);
    expect(p.rows).toHaveLength(15);
    expect(p.from).toBe(81);
    expect(p.to).toBe(95);
  });

  test("an empty result set still reports page 1 of 1 and a zero range", () => {
    const p = paginate([], 3, 20);
    expect(p.rows).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.totalPages).toBe(1);
    expect(p.page).toBe(1);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
  });

  test("a page past the end is clamped instead of returning nothing", () => {
    const p = paginate(rows, 99, 20);
    expect(p.page).toBe(5);
    expect(p.rows).toHaveLength(15);
  });

  test("every row appears exactly once across all pages", () => {
    const seen = new Set<number>();
    for (let page = 1; page <= paginate(rows, 1, 20).totalPages; page++) {
      for (const r of paginate(rows, page, 20).rows) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(rows.length);
  });
});

describe("compact page numbers", () => {
  test("a short list shows every page and never an ellipsis", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a long list collapses the middle around the current page", () => {
    const items = pageWindow(10, 44);
    expect(items[0]).toBe(1);
    expect(items[items.length - 1]).toBe(44);
    expect(items).toContain(10);
    expect(items).toContain("gap");
    expect(items.length).toBeLessThanOrEqual(7); // compact: never hundreds of buttons
  });

  test("the window always contains the current page and the two ends", () => {
    for (const [current, total] of [
      [1, 50],
      [25, 50],
      [50, 50],
    ] as const) {
      const items = pageWindow(current, total);
      expect(items).toContain(current);
      expect(items).toContain(1);
      expect(items).toContain(total);
    }
  });

  test("at most one ellipsis is needed for a near neighbour", () => {
    expect(pageWindow(3, 6).filter((i) => i === "gap").length).toBeLessThanOrEqual(1);
  });
});

describe("search terms are safe to embed in a PostgREST filter", () => {
  test("a plain term keeps its words, and unusable input yields nothing", () => {
    expect(searchWords("  Smith  Jones ")).toEqual(["Smith", "Jones"]);
    expect(searchWords("")).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords(42)).toEqual([]);
  });

  test("characters that would break the query are dropped, never injected", () => {
    // `or=(...)` / `in.(...)` separators and ILIKE wildcards must not survive into the value.
    expect(searchWords("a,b(c)d*e%f_g\\h")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    // Apostrophes and hyphens are kept on purpose: the office must still be able to find O'Brien.
    expect(searchWords("O'Brien")).toEqual(["O'Brien"]);
    expect(searchWords("'; drop table jobs; --")).toEqual(["';", "drop", "table", "jobs;", "--"]);
  });

  test("a pasted paragraph is capped", () => {
    expect(searchWords(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")).length).toBeLessThanOrEqual(8);
  });

  test("the filter searches every whitelisted column and is null when empty", () => {
    expect(searchFilter("bob", ["job_number", "owner_name"])).toBe("job_number.ilike.*bob*,owner_name.ilike.*bob*");
    expect(searchFilter("", ["job_number"])).toBeNull();
    expect(searchFilter("bob", [])).toBeNull();
    // each word can match in any column, so a multi-word search never narrows to a single column
    expect(searchFilter("bob smith", ["job_number"])).toContain("job_number.ilike.*smith*");
  });

  test("long exclusion lists are split so a request never builds an over-long URL", () => {
    const ids = Array.from({ length: 320 }, (_, i) => `id-${i}`);
    const chunks = notInChunks(ids, 150);
    expect(chunks).toHaveLength(3);
    expect(chunks.join(",").split(",")).toHaveLength(320);
    expect(chunks.every((c) => c.startsWith("(") && c.endsWith(")"))).toBe(true);
    expect(notInChunks([])).toEqual([]);
  });
});

describe("whitelists and directions", () => {
  test("a sort key from the URL is only used when it is on the whitelist", () => {
    expect(toEnum("job_number", JOB_SORT_KEYS, "created_at")).toBe("job_number");
    expect(toEnum("created_at; drop table jobs", JOB_SORT_KEYS, "created_at")).toBe("created_at");
    expect(toEnum("phone", JOB_SORT_KEYS, "created_at")).toBe("created_at");
    expect(toEnum(undefined, JOB_SORT_KEYS, "created_at")).toBe("created_at");
    expect(toEnum("complete", JOB_STAGES, null)).toBe("complete");
    expect(toEnum("not_a_stage", JOB_STAGES, null)).toBeNull();
  });

  test("direction is always one of two values", () => {
    expect(toDirection("asc")).toBe("asc");
    for (const bad of ["ASC", "sideways", "", null, undefined, 1]) expect(toDirection(bad)).toBe("desc");
  });

  test("whitelists cover the real database columns", () => {
    expect(JOB_SORT_KEYS).toContain("last_activity_at");
    expect(JOB_SEARCH_COLUMNS).toContain("owner_email");
    expect(JOB_STAGES.length).toBeGreaterThan(20);
    expect(ENQUIRY_SORT_KEYS).toContain("created_at");
    expect(ENQUIRY_SEARCH_COLUMNS).toContain("owners.email");
    expect(ENQUIRY_VIEWS).toContain("new");
  });

  test("a head-only count reads the count, never the rows", () => {
    expect(countOf({ count: 42, error: null }, "Test")).toBe(42);
    expect(countOf({ count: null, error: null }, "Test")).toBe(0);
    expect(() => countOf({ count: null, error: { message: "boom" } }, "Test")).toThrow("Test unavailable: boom");
    expect(pageMeta(9, 20, 5)).toEqual({ page: 1, pageSize: 20, total: 5, totalPages: 1, current: 1 });
  });
});

describe("search and sort helpers used by any in-memory list", () => {
  test("matchesTerm is a case-insensitive substring match over the allowed fields", () => {
    expect(matchesTerm("bob", ["Alice", "BOB"])).toBe(true);
    expect(matchesTerm("  ", ["anything"])).toBe(true);
    expect(matchesTerm("bob", [null, undefined, "Alice"])).toBe(false);
  });

  test("sortRows is deterministic, nulls last, and tie-broken by id", () => {
    const rows = [
      { id: "b", last_activity_at: "2026-01-02", owner_name: null },
      { id: "c", last_activity_at: "2026-01-03", owner_name: "Zoe" },
      { id: "a", last_activity_at: "2026-01-03", owner_name: "Amy" },
      { id: "d", last_activity_at: null, owner_name: "Bob" },
    ];
    const desc = sortRows(rows, { key: "last_activity_at", direction: "desc", tieBreaker: "id" });
    // equal sort keys resolve by the tie-breaker, never by input order
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
    expect(sortRows(rows, { key: "owner_name", direction: "asc", tieBreaker: "id" }).map((r) => r.id)).toEqual([
      "a",
      "d",
      "c",
      "b",
    ]);
    // same input, same output: no reshuffle between two requests
    expect(sortRows(rows, { key: "last_activity_at", direction: "desc", tieBreaker: "id" }).map((r) => r.id)).toEqual(
      desc.map((r) => r.id),
    );
  });
});

describe("list state lives in the URL", () => {
  const SPEC = { scopeKey: "stage", scopes: ["all", "complete"], defaultScope: "all" };

  test("a clean URL parses to the defaults", () => {
    expect(parseListControls({}, SPEC)).toEqual({
      page: 1,
      pageSize: 20,
      search: "",
      sort: "",
      direction: "desc",
      scope: "all",
    });
  });

  test("a shared link restores the whole view", () => {
    const parsed = parseListControls(
      { page: "3", size: "50", q: " smith ", sort: "created_at", dir: "asc", stage: "complete" },
      SPEC,
    );
    expect(parsed).toEqual({
      page: 3,
      pageSize: 50,
      search: "smith",
      sort: "created_at",
      direction: "asc",
      scope: "complete",
    });
    // round trip: the URL a colleague opens reproduces the same list
    expect(parseListControls(listControlsToSearch(parsed, SPEC), SPEC)).toEqual(parsed);
  });

  test("garbage in the URL falls back instead of breaking the page", () => {
    const parsed = parseListControls({ page: "-4", size: "9999", q: 12, dir: "DROP", stage: "rm -rf" }, SPEC);
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.search).toBe("");
    expect(parsed.direction).toBe("desc");
    expect(parsed.scope).toBe("all");
  });

  test("an over-long search term is truncated, not rejected", () => {
    expect(parseListControls({ q: "x".repeat(500) }, SPEC).search).toHaveLength(120);
  });

  test("defaults are omitted from the URL so the default view stays clean", () => {
    const base: ListControls = { page: 1, pageSize: 20, search: "", sort: "", direction: "desc", scope: "all" };
    expect(listControlsToSearch(base, SPEC)).toEqual({});
  });

  test("changing the result set returns to page 1; paging does not", () => {
    const current: ListControls = { page: 5, pageSize: 20, search: "", sort: "", direction: "desc", scope: "all" };
    for (const patch of [
      { search: "x" },
      { pageSize: 50 },
      { scope: "complete" },
      { sort: "created_at" },
      { direction: "asc" as const },
    ]) {
      expect(listControlsPatch(current, patch).page).toBe(1);
    }
    expect(listControlsPatch(current, { page: 4 }).page).toBe(4);
    expect(listControlsPatch(current, { page: 4 }).pageSize).toBeUndefined();
  });
});



