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
    const src = read("src/components/portal/EnquiriesWorkspace.tsx");
    expect(src).toContain("const newRows = useMemo(() => rows.filter(isNewEnquiry), [rows]);");
    // count
    expect(src).toMatch(/key === "new"\s*\?\s*newRows\.length/);
    // list
    expect(src).toMatch(/view === "new"\s*\?\s*newRows/);
    // no fall-through to the status column (the defect: status === "new" matched nothing)
    expect(src).not.toMatch(/rows\.filter\(\(row\) => row\.status === view\)[\s\S]{0,80}new/);
  });

  test("?status=new survives route validation and the tile exists", () => {
    const route = read("src/routes/_authenticated/admin.enquiries.tsx");
    expect(route).toMatch(/"all",\s*"new",\s*"spot_saved"/);
    expect(route).toContain("VIEWS.includes");
    const ui = read("src/components/portal/EnquiriesWorkspace.tsx");
    expect(ui).toContain('new: "New · no email sent"');
    expect(ui).toContain('["all", "new", ...STATUS_ORDER');
  });

  test("search still applies after the view filter", () => {
    const src = read("src/components/portal/EnquiriesWorkspace.tsx");
    const base = src.indexOf("const base =");
    const term = src.indexOf("const term = q.trim().toLowerCase();");
    const search = src.indexOf("return base.filter(");
    expect(term).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(term);
    expect(search).toBeGreaterThan(base);
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
    expect(src).toMatch(/reviewed,\s*removedRows\]\s*=\s*await Promise\.all/);
  });
  test("active jobs: independent reads are batched and sends are purpose-filtered", () => {
    const src = read("src/lib/portal.functions.ts");
    expect(src).toContain("const [{ data: inv }, { data: rc }, { data: bk }, { data: asg }] = await Promise.all");
    expect(src).toContain('.in("purpose", [LAUNCH_CAMPAIGN, "preliminary_ineligible", "insulation_video_request"])');
    expect(src).toContain("Promise.all(\n    msgIds.map(");
    expect(src).not.toContain('admin.from("customer_email_sends").select("job_id,purpose,status,idempotency_key"),');
  });
});
