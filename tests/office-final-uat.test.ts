/**
 * Final Office Portal UAT regressions (D1 + D4) and the performance shape of the list loaders.
 * Pure/static only: no database, no sending.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isNewEnquiry } from "../src/lib/enquiry-groups.core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D1 — New enquiries filter", () => {
  test("'new' means no recorded send at all", () => {
    expect(isNewEnquiry({ lastEmail: null })).toBe(true);
    expect(isNewEnquiry({ lastEmail: undefined })).toBe(true);
    expect(isNewEnquiry({ lastEmail: { purpose: "preliminary_ineligible", status: "sent" } })).toBe(false);
    expect(isNewEnquiry({ lastEmail: { purpose: "insulation_video_request", status: "failed" } })).toBe(false);
  });

  test("the tile count and the list share ONE definition", () => {
    // The single definition moved to the server: `inEnquiryView` decides membership, and BOTH the
    // tile counts and the page come from it. There is no second client-side copy left to drift.
    const loader = read("src/lib/enquiry-groups.server.ts");
    expect(loader).toContain("export function inEnquiryView");
    expect(loader).toMatch(/view === "new"\)\s*return isNewEnquiry\(row\)/);
    expect(loader).toMatch(/classified\.filter\(\(r\) => inEnquiryView\(r, v\)\)/);
    expect(loader).toContain("const matching = classified.filter((r) => inEnquiryView(r, view));");
    const ui = read("src/components/portal/EnquiriesWorkspace.tsx");
    // The UI reads counts from the server; it no longer recomputes them from a full array.
    expect(ui).toContain("const counts = (data?.counts ?? {})");
    expect(ui).toContain("const viewCount = (key: EnquiryPageView) => counts[key] ?? 0;");
    expect(ui).not.toContain("rows.filter(isNewEnquiry)");
    // no fall-through to the status column (the original defect: status === "new" matched nothing)
    expect(loader).not.toMatch(/row\.status === "new"/);
  });

  test("?status=new survives route validation and the tile exists", () => {
    // The route whitelist is now the shared view list, so a tile and its URL parameter cannot diverge.
    const spec = read("src/lib/enquiry-list-page.core.ts");
    expect(spec).toMatch(/"all",\s*"new",\s*\.\.\.STATUS_ORDER/);
    const route = read("src/routes/_authenticated/admin.enquiries.tsx");
    expect(route).toContain("parseListControls(s, ENQUIRY_SPEC)");
    const ui = read("src/components/portal/EnquiriesWorkspace.tsx");
    expect(ui).toContain('new: "New · no email sent"');
  });

  test("search is applied by the database BEFORE the view filter and the page", () => {
    const src = read("src/lib/enquiry-groups.server.ts");
    // search is pushed into PostgREST, and ordering comes after it
    const searchAt = src.indexOf("const f = searchFilter(query.search ?? \"\"");
    const orderAt = src.indexOf('q.order(query.sort ?? "created_at"');
    expect(searchAt).toBeGreaterThan(-1);
    expect(orderAt).toBeGreaterThan(searchAt);
    // the paged loader classifies -> counts -> filters by view -> pages, in that order
    const classifyAt = src.indexOf("await websiteEnquiries({ search, sort: sortKey, ascending })");
    const countsAt = src.indexOf("counts[v] = classified.filter((r) => inEnquiryView(r, v)).length");
    const viewAt = src.indexOf("const matching = classified.filter((r) => inEnquiryView(r, view));");
    const pageAt = src.indexOf("const page = paginate(matching, wanted, size);");
    expect(classifyAt).toBeGreaterThan(-1);
    expect(countsAt).toBeGreaterThan(classifyAt);
    expect(viewAt).toBeGreaterThan(countsAt);
    expect(pageAt).toBeGreaterThan(viewAt);
  });
});

describe("D4 — legacy routes", () => {
  test("/admin/jobs redirects to active jobs without touching /admin/jobs/:id", () => {
    const src = read("src/routes/_authenticated/admin.jobs.tsx");
    expect(src).toContain('to: "/admin/jobs/active"');
    expect(src).toContain('=== "/admin/jobs"');
    expect(src).toContain("<Outlet />");
  });
  test("/admin/quotes redirects to the existing quote queue", () => {
    const src = read("src/routes/_authenticated/admin.quotes.tsx");
    expect(src).toContain('to: "/admin/board"');
    expect(src).toContain('tab: "quotes"');
  });
  test("/admin/board only keeps the Quote approvals queue", () => {
    const src = read("src/routes/_authenticated/admin.board.tsx");
    expect(src).toContain('if (tab === "quotes") return;');
    expect(src).toContain('to: "/admin/jobs/active"');
    expect(src).not.toContain("LEGACY JOB BOARD");
  });
});

describe("D2 — list loaders avoid the measured bottlenecks", () => {
  test("enquiries: outside scope is head-counted, job chunks run in parallel", () => {
    const src = read("src/lib/enquiry-groups.server.ts");
    expect(src).toContain('count: "exact", head: true');
    expect(src).not.toContain('.select("source, channel")');
    expect(src).toContain("Promise.all(chunks.map");
    expect(src).toContain("const CHUNK = 500");
    // the removal scan is part of the main parallel batch, not a trailing round trip
    // (perf: the independent reads — calculator, settings, outside head counts — now join that same batch)
    expect(src).toMatch(/reviewed,\s*removedRows\],\s*\[interests, cfg, testHiddenRes, installerRes, otherRes\]\]\s*=\s*await Promise\.all/);
  });
  test("active jobs: independent reads are batched and sends are purpose-filtered", () => {
    // The pipeline read moved to its own server module so the paged loader can share the enrichment.
    const src = read("src/lib/job-pipeline.server.ts");
    expect(src).toMatch(/\{ data: inv \},\s*\{ data: rc \},\s*\{ data: bk \},\s*\{ data: asg \}/);
    expect(src).toContain('.in("purpose", [LAUNCH_CAMPAIGN, "preliminary_ineligible", "insulation_video_request"])');
    expect(src).toContain("msgIds.map((chunk) => admin.from(\"messages\")");
    expect(src).not.toContain('admin.from("customer_email_sends").select("job_id,purpose,status,idempotency_key"),');
    // every enrichment read is now scoped to the rows it was handed
    expect(src).toContain(".in(\"job_id\", NONE)");
    expect(src).not.toMatch(/admin\.from\("(invoices|bookings|job_assignments)"\)\.select\([^)]*\)\n?\s*[,)]/);
  });
});
