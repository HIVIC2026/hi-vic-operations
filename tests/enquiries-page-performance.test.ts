/**
 * /admin/enquiries — read-path performance contract (Phase 1 final stabilisation).
 *
 * Runs the REAL loader (loadEnquiryPage → websiteEnquiries → classifyWebsiteEnquiries) against an in-memory
 * PostgREST-like fake that counts requests, rows, bytes and requests in flight. Nothing here touches a database.
 *
 *  - Paging / search / view / page-size changes reuse the server's short-lived classified snapshot: no reads.
 *  - Results served from the snapshot are byte-identical to a fresh classification.
 *  - Office writes and the explicit Refresh drop the snapshot; failed reads are never cached.
 *  - Related reads go through a bounded pool; the enquiry rows are paged in parallel after one counted read.
 *  - Only base44.raw is selected from enrichment, with a fallback when PostgREST rejects the JSON path.
 *  - The invalid embedded-column or=(...) search can never return; secondary details are never loaded.
 */
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeDb } from "./helpers/enquiry-fake-db";

let db = makeDb(685, { rtt: 1, perRow: 0, jobPerRow: 0 });
const secondary: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => db.client.from(t) } }));
// Secondary detail modules: loading the list must never import them.
mock.module("../src/lib/file-links.server", () => { secondary.push("file-links"); return { signFile: async () => ({ data: null }) }; });
mock.module("@/lib/file-links.server", () => { secondary.push("file-links"); return { signFile: async () => ({ data: null }) }; });
const S = await import("../src/lib/enquiry-groups.server");
const L = await import("../src/lib/list-paging.core");
const Q = await import("../src/lib/list-query.core");

const fresh = (n = 685, o: Parameters<typeof makeDb>[1] = {}) => { db = makeDb(n, { rtt: 1, perRow: 0, jobPerRow: 0, ...o }); S.resetEnquiryListState(); };
const strip = (r: Awaited<ReturnType<typeof S.loadEnquiryPage>>) => { const { asOf: _a, ...rest } = r; return rest; };

beforeEach(() => fresh());

describe("first page", () => {
  test("default view: page 1 of 20, counts for every tile, one bounded read", async () => {
    const r = await S.loadEnquiryPage({ view: "all" });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
    expect(r.rows).toHaveLength(20);
    expect(r.total).toBe(r.counts.all);
    for (const v of ["all", "new", "spot_saved", "photos", "removed"]) expect(typeof r.counts[v]).toBe("number");
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 685 enquiries: 1 counted enquiry read + 12 related tables × 2 id chunks (500 ids each) + 5 independent reads.
    expect(db.stats.requests).toBe(1 + 12 * 2 + 5);
    expect(db.stats.maxInFlight).toBeLessThanOrEqual(12 + 5 + 1);
  });

  test("page sizes 20 / 50 / 100 and out-of-range pages clamp", async () => {
    for (const size of [20, 50, 100]) expect((await S.loadEnquiryPage({ view: "all", pageSize: size })).rows).toHaveLength(size);
    const last = await S.loadEnquiryPage({ view: "all", page: 99_999 });
    expect(last.page).toBe(last.totalPages);
    expect(last.rows.length).toBeGreaterThan(0);
    const bogus = await S.loadEnquiryPage({ view: "nonsense" });
    expect(bogus.total).toBe(bogus.counts.all);
  });

  test("empty results are a valid page, not an error", async () => {
    const r = await S.loadEnquiryPage({ view: "all", search: "zzzqqqnomatch" });
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
  });
});

describe("snapshot reuse — paging, search and view changes do not reread", () => {
  test("after the first page, page 2 / size 50 / search / view changes make zero database requests", async () => {
    await S.loadEnquiryPage({ view: "all" });
    db.reset();
    for (const p of [
      { view: "new" }, { view: "spot_saved" }, { view: "all", page: 2, pageSize: 50 },
      { view: "all", search: "smith" }, { view: "all", search: "gmail" }, { view: "all", search: "0410000123" },
      { view: "new", page: 2, pageSize: 50, search: "smith" },
    ]) await S.loadEnquiryPage(p);
    expect(db.stats.requests).toBe(0);
  });

  test("snapshot results are byte-identical to a fresh classification for every control combination", async () => {
    const combos = [
      { view: "all" }, { view: "new" }, { view: "spot_saved" }, { view: "spot_offered" }, { view: "photos" }, { view: "removed" },
      { view: "all", search: "smith" }, { view: "all", search: "Owner 7 Smith" }, { view: "all", search: "o'brien" }, { view: "all", search: "(test)*%,." },
      { view: "all", search: "3005" }, { view: "all", search: "ENQ-12" }, { view: "all", search: "HV-1010" }, { view: "all", search: "Test St" },
      { view: "all", page: 3, pageSize: 100 }, { view: "new", page: 2, pageSize: 50, search: "gmail" },
    ];
    await S.loadEnquiryPage({ view: "all" });
    for (const c of combos) {
      const cached = strip(await S.loadEnquiryPage(c));
      const recomputed = strip(await S.loadEnquiryPage({ ...c, fresh: true }));
      expect(cached).toEqual(recomputed);
    }
  });

  test("sort or direction changes read in that database order (separate snapshot)", async () => {
    await S.loadEnquiryPage({ view: "all" });
    db.reset();
    const asc = await S.loadEnquiryPage({ view: "all", sort: "job_number", direction: "asc" });
    expect(db.stats.requests).toBeGreaterThan(0);
    const nums = asc.rows.map((r) => r.jobNumber!);
    expect([...nums].sort()).toEqual(nums);
  });

  test("concurrent requests share one in-flight read", async () => {
    await Promise.all([S.loadEnquiryPage({ view: "all" }), S.loadEnquiryPage({ view: "new" }), S.loadEnquiryPage({ view: "all", search: "smith" })]);
    expect(db.stats.byTable["jobs"]!.requests).toBe(1 + 3); // one counted enquiry read + the three outside head counts
  });

  test("the snapshot expires after SNAPSHOT_TTL_MS", async () => {
    const now = spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await S.loadEnquiryPage({ view: "all" });
    db.reset();
    now.mockReturnValue(1_000_000 + S.SNAPSHOT_TTL_MS - 1);
    await S.loadEnquiryPage({ view: "new" });
    expect(db.stats.requests).toBe(0);
    now.mockReturnValue(1_000_000 + S.SNAPSHOT_TTL_MS + 1);
    await S.loadEnquiryPage({ view: "new" });
    expect(db.stats.requests).toBeGreaterThan(0);
    now.mockRestore();
  });

  test("an Office write (remove) and the explicit Refresh drop the snapshot", async () => {
    await S.loadEnquiryPage({ view: "all" });
    S.invalidateEnquirySnapshot();
    db.reset();
    await S.loadEnquiryPage({ view: "all" });
    expect(db.stats.requests).toBeGreaterThan(0);
    db.reset();
    await S.loadEnquiryPage({ view: "all", fresh: true });
    expect(db.stats.requests).toBeGreaterThan(0);
    const src = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    for (const fn of ["export async function removeLeads", "export async function reviewLeadMedia", "export async function noInsulationSaveSpot"]) {
      const body = src.slice(src.indexOf(fn), src.indexOf("\n}\n", src.indexOf(fn)));
      expect(body).toContain("invalidateEnquirySnapshot()");
    }
    const fns = readFileSync("src/lib/enquiry-groups.functions.ts", "utf8");
    expect(fns.match(/invalidateEnquirySnapshot\(\)/g)?.length).toBe(2); // existing-insulation follow-up + estimate link
  });

  test("a failed read is never cached: the next request reads again", async () => {
    fresh(685, { rtt: 1, perRow: 0, jobPerRow: 0, failTable: "owner_contact_consents" });
    await expect(S.loadEnquiryPage({ view: "all" })).rejects.toThrow(/unavailable/);
    const before = db.stats.requests;
    await expect(S.loadEnquiryPage({ view: "all" })).rejects.toThrow();
    expect(db.stats.requests).toBeGreaterThan(before);
  });
});

describe("bounded, parallel database reads", () => {
  test("related reads never exceed the pool width; enquiry rows are paged in parallel after one counted read", async () => {
    fresh(5000, { rtt: 5, perRow: 0, jobPerRow: 0 });
    const r = await S.loadEnquiryPage({ view: "all" });
    expect(r.counts.all).toBeGreaterThan(4000);
    expect(db.stats.maxInFlight).toBeLessThanOrEqual(12 + 5 + 4); // related pool + independent reads + parallel enquiry pages
    expect(db.stats.byTable["jobs"]!.rows).toBe(5000);
  });

  test("only enrichment.base44.raw is selected; a PostgREST that rejects the JSON path falls back to the full document", async () => {
    await S.loadEnquiryPage({ view: "all" });
    const leanBytes = db.stats.bytes;
    const src = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    expect(src).toContain('"postcode, base44_raw:enrichment->base44->raw)"');
    fresh(685, { rtt: 1, perRow: 0, jobPerRow: 0, rejectLean: true });
    const lean = strip(await (async () => { fresh(685, { rtt: 1, perRow: 0, jobPerRow: 0 }); return S.loadEnquiryPage({ view: "all", pageSize: 100 }); })());
    fresh(685, { rtt: 1, perRow: 0, jobPerRow: 0, rejectLean: true });
    const full = strip(await S.loadEnquiryPage({ view: "all", pageSize: 100 }));
    expect(full).toEqual(lean); // same classification either way
    expect(db.stats.bytes).toBeGreaterThan(leanBytes);
  });
});

describe("search correctness over the WHOLE classified set", () => {
  const fields = (r: { jobNumber: string | null; reference: string | null; name: string | null; email: string | null; phone: string | null; address: string | null; postcode: string | null }) =>
    [r.jobNumber, r.reference, r.name, r.email, r.phone, r.address, r.postcode];
  test("every supported field matches, multi-word widens, results span beyond the first page", async () => {
    const all = await S.loadEnquiryPage({ view: "all", pageSize: 100, page: 1 });
    const probe = all.rows[5]!;
    for (const term of [probe.jobNumber!, probe.reference!, probe.name!.split(" ")[0]!, probe.email!, probe.phone!, probe.address!.split(",")[0]!, probe.postcode!]) {
      const r = await S.loadEnquiryPage({ view: "all", search: term, pageSize: 100 });
      expect(r.rows.some((x) => x.id === probe.id) || r.total > 100).toBe(true);
    }
    const smith = await S.loadEnquiryPage({ view: "all", search: "smith", pageSize: 20 });
    expect(smith.total).toBeGreaterThan(20); // matched across the whole set, not just one page
    const multi = await S.loadEnquiryPage({ view: "all", search: "smith gmail" });
    expect(multi.total).toBeGreaterThanOrEqual(smith.total);
    const words = Q.searchWords("smith gmail");
    expect(multi.rows.every((r) => words.some((w) => L.matchesTerm(w, fields(r))))).toBe(true);
  });
  test("apostrophes, special characters and empty or missing terms are safe", async () => {
    for (const term of ["o'brien", "(test)*%,.", "   ", ""]) await S.loadEnquiryPage({ view: "all", search: term });
    const missing = await S.loadEnquiryPage({ view: "all" } as never);
    expect(missing.total).toBe(missing.counts.all);
  });
  test("no PostgREST or= with embedded columns is ever sent (PGRST100 regression)", async () => {
    await S.loadEnquiryPage({ view: "all", search: "smith" });
    for (const o of db.ors) expect(o).not.toMatch(/owners\.|properties\./);
    const src = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    expect(src).not.toMatch(/\.or\([^)]*(owners|properties)\./);
  });
});

describe("lazy secondary details", () => {
  test("loading the list imports no media signing and fetches no secondary details", async () => {
    secondary.length = 0;
    await S.loadEnquiryPage({ view: "all" });
    expect(secondary).toEqual([]);
    const src = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    const head = src.slice(0, src.indexOf("const MEDIA_OUTCOMES"));
    // Email renderers, retail settings and file signing are imported lazily (types only at module level).
    expect(head).not.toMatch(/^import \{[^}]*\} from "\.\/(jo-outcome-email\.core|estimate\.server|file-links\.server)"/m);
    expect(Object.keys(db.stats.byTable).sort()).not.toContain("veu_location_variables");
  });
  test("the workspace asks for a fresh read only on Refresh / Try again and keys every request by its controls", () => {
    const ui = readFileSync("src/components/portal/EnquiriesWorkspace.tsx", "utf8");
    expect(ui).toContain('queryKey: ["enquiries-workspace-page", current]');
    expect(ui).toContain("placeholderData: keepPreviousData");
    expect(ui.match(/freshNext\.current = true/g)?.length).toBe(2);
  });
});

describe("snapshot cache (pure)", () => {
  test("shares in-flight reads, expires by TTL, drops on invalidate and never keeps a failure", async () => {
    const { createSnapshotCache } = await import("../src/lib/snapshot-cache.core");
    const c = createSnapshotCache<number>(100);
    let loads = 0;
    const load = () => { loads++; return Promise.resolve(loads); };
    const [a, b] = [c.get("k", load, 0), c.get("k", load, 50)];
    expect(a).toBe(b);
    expect(await a).toBe(1);
    expect(await c.get("k", load, 150)).toBe(2); // expired
    c.invalidate();
    expect(await c.get("k", load, 160)).toBe(3);
    const failing = c.get("bad", () => Promise.reject(new Error("x")), 0);
    await expect(failing).rejects.toThrow();
    await Promise.resolve();
    expect(await c.get("bad", () => Promise.resolve(9), 1)).toBe(9);
  });
});
