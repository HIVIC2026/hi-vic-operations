/**
 * Final Office Portal UAT regressions (D1 + D4) and the performance shape of the list loaders.
 * Pure/static only: no database, no sending.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isNewEnquiry } from "../src/lib/enquiry-groups.core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D1 — confirmed first-response paging", () => {
  test("only a confirmed first response excludes New", () => {
    expect(isNewEnquiry({ sentPurposes: [] })).toBe(true);
    expect(isNewEnquiry({ sentPurposes: ["preliminary_ineligible"] })).toBe(false);
    expect(isNewEnquiry({ lastEmail: { purpose: "insulation_video_request", status: "failed" }, sentPurposes: [] })).toBe(true);
    expect(isNewEnquiry({ sentPurposes: ["office_notification"] })).toBe(true);
  });
  test("counts and rows come from the same database page", () => {
    const loader = read("src/lib/office-enquiry-page.server.ts");
    expect(loader).toContain("office_enquiry_page");
    expect(loader).toContain("await loadEnquiryGroups(result.ids)");
    expect(loader).toContain("...result, rows:");
    expect(read("src/components/portal/EnquiriesWorkspace.tsx")).not.toContain("rows.filter(isNewEnquiry)");
  });
  test("New survives route validation", () => {
    const route = read("src/routes/_authenticated/admin.enquiries.tsx");
    expect(route).toContain('"new"');
    expect(route).toContain('VIEWS.includes(s["status"] as EnquiryView)');
    expect(read("src/lib/enquiry-list-page.core.ts")).toMatch(/"all",\s*"new",\s*\.\.\.STATUS_ORDER/);
  });
  test("search is passed into paging before enrichment", () => {
    const src = read("src/lib/office-enquiry-page.server.ts");
    expect(src.indexOf("p_search: search")).toBeGreaterThan(-1);
    expect(src.indexOf("await loadEnquiryGroups(result.ids)")).toBeGreaterThan(src.indexOf("p_search: search"));
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
  test("enquiries enrich only the supplied page IDs", () => {
    const src = read("src/lib/enquiry-groups.server.ts");
    expect(src).toContain("loadEnquiryGroups(visibleIds: string[])");
    expect(src).toContain('.in("id", visibleIds)');
    expect(src).toContain("ids.slice(i, i + CHUNK)");
    expect(src).not.toContain('.select("source, channel")');
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
