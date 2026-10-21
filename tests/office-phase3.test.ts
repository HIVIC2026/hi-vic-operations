import { describe, expect, test } from "bun:test";
import { OFFICE_HEADINGS, OFFICE_TOOLS, sectionFor, tabActive } from "../src/lib/office-nav";
import { bucketCategory, categoryBucket, filterOperations } from "../src/lib/operations-filter.core";
import { buildOperationsPreview, type OperationInput } from "../src/lib/operations-preview.core";

const now = Date.parse("2026-10-08T08:35:00Z");
const make = (id: string): OperationInput => ({ id, jobNumber: `TEST-${id}`, owner: "TEST", address: "TEST address", source: "website", channel: "hivic_sourced", businessUnit: "hivic", originatingInstaller: null, assignedInstaller: null, eligibility: "likely_eligible", eligibilityReason: null, verifiedEligibility: null, insulation: "none", mediaCount: 0, mediaReview: null, actualHandoff: false, evidence: [], communications: [], failures: [], facts: { id, stage: "preliminary_estimate_ready", createdAt: "2026-09-01T00:00:00Z", lastActivityAt: null, enteredStageAt: null } });
describe("phase 3 presentation mapping", () => {
  test("one primary navigation maps to the five consolidated workspaces", () => {
    expect(OFFICE_HEADINGS.map((h) => h.key)).toEqual(["enquiries", "active", "closed", "communications", "templates"]);
    expect(sectionFor("/admin/enquiries")).toBe("enquiries");
    expect(sectionFor("/admin/enquiry-groups")).toBe("enquiries");
    expect(sectionFor("/admin/jobs/active")).toBe("active");
    expect(sectionFor("/admin/jobs/closed")).toBe("closed");
    expect(sectionFor("/admin/communications")).toBe("communications");
    expect(sectionFor("/admin/templates")).toBe("templates");
    expect(sectionFor("/admin/board")).toBe("more");
    expect(OFFICE_TOOLS.some((t) => t.to === "/admin/ap-queue")).toBe(true);
    expect(OFFICE_TOOLS.some((t) => t.to === "/admin/needs-me")).toBe(false);
    expect(tabActive(OFFICE_HEADINGS[1] ?? { label: "missing", to: "/admin" }, "/admin/enquiries", { status: "all" })).toBe(false);
  });
  test("every classified row remains in exactly one canonical category", () => {
    const a = make("lead"), b = make("active"), c = make("closed"), d = make("unknown");
    b.actualHandoff = true; b.facts.rcOfferAt = "2026-10-08T08:00:00Z";
    c.facts.stage = "complete"; d.facts.stage = "unmapped";
    const data = buildOperationsPreview([a,b,c,d], [], now);
    const ids = ["leads", "active", "closed", "needs"].flatMap(category => filterOperations(data.rows, { category }).map(r => r.id));
    expect(ids.length).toBe(4); expect(new Set(ids).size).toBe(4);
    for (const r of data.rows) expect(categoryBucket(bucketCategory(r.bucket))).toBe(r.bucket);
  });
  test("saved/media flags combine with source eligibility and search without losing installer leads", () => {
    const a = make("saved-media"), b = make("other");
    a.channel = "installer_sourced"; a.originatingInstaller = "TEST supplying business"; a.mediaCount = 2;
    a.facts.campaign = { spotSavedAt: "2026-09-01T00:00:00Z", optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: "2026-09-01T00:00:00Z" };
    const data = buildOperationsPreview([a,b], [], now);
    for (const flag of ["spot", "media"]) expect(filterOperations(data.rows, { category: "leads", flag, source: "installer_sourced", eligibility: "Likely eligible / no insulation", q: "supplying" }).map(r => r.id)).toEqual([a.id]);
    expect(data.rows[0]?.process).toBe("Insulation review");
    expect(data.rows[0]?.tasks.every(t => !t.dueAt && !t.overdue)).toBe(true);
  });
  test("recorded purpose-specific success prevents the old uncontacted claim", () => {
    const a = make("sent");
    a.communications = [{ purpose: "step3_estimate", status: "sent", at: "2026-10-08T08:00:00Z" }];
    const row = buildOperationsPreview([a], [], now).rows[0];
    expect(row?.process).toBe("Offer & owner response");
    expect(row?.tasks[0]?.party).toBe("Owner");
    expect(row?.communicationLabel).toBe("Sent — timestamp recorded");
  });
});