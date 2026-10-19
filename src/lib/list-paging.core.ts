/**
 * ONE pagination implementation for every Office list.
 *
 * Pure helpers (no React, no database) so counts, paging and searching can be unit tested. Server
 * functions apply filter -> search -> sort -> page with `paginate()`, so only the visible rows
 * cross the wire.
 */

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export const isPageSize = (v: unknown): v is PageSize => PAGE_SIZES.includes(v as PageSize);
export const toPageSize = (v: unknown): PageSize => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return isPageSize(n) ? n : DEFAULT_PAGE_SIZE;
};

/** Page number is always 1-based and never below 1. */
export const toPage = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
};

export const totalPagesFor = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil((Number.isFinite(total) ? Math.max(0, total) : 0) / Math.max(1, pageSize)));

/** A page can never point past the end, even when the result set shrinks under the user. */
export const clampPage = (page: number, totalPages: number): number =>
  Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, totalPages));

export type PageWindowItem = number | "gap";

/** Compact page numbers with ellipses: 1 … 8 9 10 … 44 (never hundreds of buttons). */
export function pageWindow(current: number, totalPages: number, span = 1): PageWindowItem[] {
  const pages = Math.max(1, totalPages);
  const page = clampPage(current, pages);
  const items: PageWindowItem[] = [];
  const push = (n: number) => { if (!items.includes(n)) items.push(n); };
  // A short list is shown in full: an ellipsis across two pages is worse than two more buttons.
  if (pages <= 7) for (let n = 1; n <= pages; n++) push(n);
  else {
    const gapAfter = (n: number) => {
      const last = items[items.length - 1];
      // An ellipsis only appears when MORE THAN ONE page is hidden: "1 2 3 4 5", never "1 2 3 … 5".
      if (last !== "gap" && typeof last === "number" && n - last > 2) items.push("gap");
    };
    push(1);
    for (let n = page - span; n <= page + span; n++) if (n > 1 && n < pages) { gapAfter(n); push(n); }
    gapAfter(pages);
    push(pages);
  }
  return items;
}

export type Paged<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** 1-based index of the first row on this page, 0 when empty. */
  from: number;
  to: number;
};

/** The single slicing rule used by every server-side list. */
export function paginate<T>(rows: T[], page: number, pageSize: number): Paged<T> {
  const total = rows.length;
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const totalPages = totalPagesFor(total, size);
  const current = clampPage(page, totalPages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageSize: size,
    total,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
  };
}

/** Case-insensitive substring match over the fields a page is allowed to search. */
export function matchesTerm(term: string, fields: (string | null | undefined)[]): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(t));
}

/** Deterministic ordering with a stable tie-breaker, nulls last. */
export function sortRows<T>(
  rows: T[],
  sort: { key: keyof T; direction: "asc" | "desc"; tieBreaker: keyof T },
): T[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const value = (r: T, key: keyof T) => {
    const v = r[key] as unknown;
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return String(v);
  };
  return [...rows].sort((a, b) => {
    const av = value(a, sort.key);
    const bv = value(b, sort.key);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last, both directions
    if (bv === null) return -1;
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), "en-AU", { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp * dir;
    const at = value(a, sort.tieBreaker);
    const bt = value(b, sort.tieBreaker);
    if (at === null || bt === null) return 0;
    return String(at).localeCompare(String(bt), "en-AU", { numeric: true, sensitivity: "base" });
  });
}

// ---------- URL state ----------
// Every paged list keeps its page, size, search, sort, direction and page-local filter in the URL, so a
// refresh, a shared link and the back button all restore the same view.

export type ListControls = {
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  direction: "asc" | "desc";
  /** Page-local filter that also travels in the URL (job stage, closed-job tab, enquiry view). */
  scope: string;
};

export type ListSearchSpec = { scopeKey: string; scopes?: readonly string[]; defaultScope?: string };

/** Read the shared list parameters out of a URL; anything unusable falls back to the default. */
export function parseListControls(raw: Record<string, unknown>, spec: ListSearchSpec): ListControls {
  const num = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? Math.floor(n) : NaN;
  };
  const rawScope = raw[spec.scopeKey];
  return {
    page: Math.max(1, num(raw["page"]) || 1),
    pageSize: toPageSize(raw["size"]),
    search: typeof raw["q"] === "string" ? raw["q"].trim().slice(0, 120) : "",
    sort: typeof raw["sort"] === "string" ? raw["sort"].slice(0, 40) : "",
    direction: raw["dir"] === "asc" ? "asc" : "desc",
    scope:
      typeof rawScope === "string" && (!spec.scopes || spec.scopes.includes(rawScope))
        ? rawScope
        : (spec.defaultScope ?? "all"),
  };
}

/**
 * Serialise back to URL parameters, omitting defaults so a default view keeps a clean link.
 *
 * The result is a sparse `Record`, never a `ListControls`. That matters: a route whose search type is
 * a complete object forces every `navigate()` call — including the redirects in other routes — to carry
 * all six values. A sparse type keeps those redirects compiling and keeps the URL readable.
 */
export function listControlsToSearch(
  c: ListControls,
  spec: ListSearchSpec,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (c.page !== 1) out["page"] = c.page;
  if (c.pageSize !== DEFAULT_PAGE_SIZE) out["size"] = c.pageSize;
  if (c.search) out["q"] = c.search;
  if (c.sort) out["sort"] = c.sort;
  if (c.direction === "asc") out["dir"] = "asc";
  if (c.scope && c.scope !== (spec.defaultScope ?? "all")) out[spec.scopeKey] = c.scope;
  return out;
}

/** Changing anything that alters the result set always returns to page 1. */
export function listControlsPatch(current: ListControls, patch: Partial<ListControls>): Partial<ListControls> {
  const reshapes =
    patch.search !== undefined ||
    patch.pageSize !== undefined ||
    patch.scope !== undefined ||
    patch.sort !== undefined ||
    patch.direction !== undefined;
  return reshapes && patch.page === undefined ? { ...patch, page: 1 } : patch;
}