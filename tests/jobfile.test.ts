import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  buildCorrespondence, buildDocumentIndex, buildManifest, buildTimeline, filterTimeline, inCategory, packPaths, packSelection, planPack, retentionFor, visibleTo, type JobSources,
} from "../src/lib/jobfile.core";
import { evaluateGate1, resolveGate1Facts, type IntelFact } from "../src/lib/eligibility.core";

const J = "11111111-1111-1111-1111-111111111111";
const empty = (): JobSources => ({ documents: [], evidenceFiles: [], piesaRecords: [], piesaDeliveries: [], measurements: [], quotes: [], invoices: [], assignments: [], authorities: [], escNotifications: [], veec: [], propertyFacts: [], declarations: [] });
function sample(): JobSources {
  const s = empty();
  const copy = `${J}/assignment/consumer-v1-abcdef123456.txt`;
  s.documents = [
    { id: "d1", kind: "veec_assignment", title: "Customer Acceptance & VEEC Assignment (your signed copy)", storage_path: copy, created_at: "2026-09-01T00:00:00Z" },
    { id: "d2", kind: "veec_assignment", title: "Completed VEEC Assignment (final copy)", storage_path: `${J}/assignment/final-ffff00001111.txt`, created_at: "2026-09-20T00:00:00Z" },
    { id: "d3", kind: "owner_authority", title: "Owner Authority v1 (accepted)", storage_path: `${J}/authority/v1.txt`, created_at: "2026-08-01T00:00:00Z" },
    { id: "d4", kind: "export", title: "old pack", storage_path: `${J}/exports/job-pack.zip`, created_at: "2026-09-21T00:00:00Z" },
  ];
  s.evidenceFiles = [
    { id: "e1", requirement_id: "r1", storage_path: `${J}/ev/before.jpg`, file_name: "before.jpg", size_bytes: 1000, uploaded_at: "2026-09-10T00:00:00Z", requirement: { category: "before_ceiling_space", label: "Before", status: "verified", verified_by: "u9", verified_at: "2026-09-11T00:00:00Z" } },
    { id: "e2", requirement_id: "r2", storage_path: `${J}/ev/piesa.pdf`, file_name: "piesa.pdf", size_bytes: 2000, uploaded_at: "2026-09-02T00:00:00Z", requirement: { category: "piesa_signoff", label: "PIESA", status: "uploaded" } },
  ];
  s.piesaRecords = [{ id: "p1", kind: "assessment", outcome: "pass", completed_date: "2026-09-02", is_current: true, created_at: "2026-09-02T00:00:00Z" }, { id: "p0", kind: "assessment", outcome: "fail", is_current: false, created_at: "2026-08-20T00:00:00Z" }];
  s.quotes = [{ id: "q1", kind: "installation", status: "accepted", version: 2, created_at: "2026-09-01T00:00:00Z" }, { id: "q0", kind: "installation", status: "superseded", version: 1, created_at: "2026-08-25T00:00:00Z" }];
  s.invoices = [{ id: "i1", xero_invoice_number: "INV-1", xero_reference: "HI VIC HV-1", created_at: "2026-09-01T00:00:00Z" }];
  s.assignments = [{ id: "a1", status: "effective_complete", consumer_signed_at: "2026-09-01T00:00:00Z", consumer_copy_path: copy, consumer_snapshot_sha256: "aa", installer_signed_at: "2026-09-19T00:00:00Z", installer_snapshot_sha256: "bb", final_copy_path: `${J}/assignment/final-ffff00001111.txt` }];
  s.authorities = [{ id: "o1", version: 1, status: "accepted", document_path: `${J}/authority/v1.txt` }];
  s.escNotifications = [{ id: "n1", version: 1, status: "sent", submission_reference: "ESC-9", payload_hash: "cc", created_at: "2026-09-05T00:00:00Z", sent_at: "2026-09-05T01:00:00Z" }];
  s.propertyFacts = [{ id: "f1", fact_key: "in_victoria", source_name: "Vicmap", source_type: "public_gis", source_url: "https://opendata.maps.vic.gov.au/x", is_current: true, is_stale: false, raw_hash: "dd", retrieved_at: "2026-08-01T00:00:00Z" }];
  return s;
}

describe("Job File document index", () => {
  test("1. indexes multiple sources without duplicating physical files", () => {
    const docs = buildDocumentIndex(sample());
    const paths = docs.map((d) => d.storagePath).filter(Boolean);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(docs.map((d) => d.relatedEntity))).toEqual(new Set(["documents", "evidence_requirements", "piesa_records", "quotes", "invoices", "customer_assignments", "esc_notifications", "property_facts"]));
    expect(docs.some((d) => d.storagePath?.includes("/exports/"))).toBe(false);
  });
  test("2. signed/final records are immutable and marked final/signed", () => {
    const docs = buildDocumentIndex(sample());
    expect(docs.find((d) => d.id === "documents:d2")).toMatchObject({ status: "final", immutable: true });
    expect(docs.find((d) => d.id === "documents:d1")).toMatchObject({ status: "signed", immutable: true });
    expect(docs.find((d) => d.id === "customer_assignments:a1:installer")).toMatchObject({ status: "signed", immutable: true });
    expect(docs.find((d) => d.id === "esc_notifications:n1")).toMatchObject({ status: "final", immutable: true });
  });
  test("3. superseded docs retained but excluded from the default pack", () => {
    const docs = buildDocumentIndex(sample());
    expect(docs.find((d) => d.id === "quotes:q0")?.status).toBe("superseded");
    expect(docs.find((d) => d.id === "piesa_records:p0")?.status).toBe("superseded");
    const pack = packSelection(docs);
    expect(pack.some((d) => d.status === "superseded" || d.status === "historical")).toBe(false);
    expect(packSelection(docs, { includeSuperseded: true }).some((d) => d.id === "quotes:q0")).toBe(true);
  });
  test("4. role access hides finance/compliance internals from trades and owner", () => {
    const docs = buildDocumentIndex(sample());
    const elec = visibleTo(docs, "electrician"), inst = visibleTo(docs, "installer"), owner = visibleTo(docs, "owner");
    for (const list of [elec, inst]) {
      expect(list.some((d) => ["quotes", "invoices", "esc_notifications", "property_facts"].includes(d.relatedEntity))).toBe(false);
      expect(list.some((d) => d.docType === "veec_assignment")).toBe(false);
    }
    expect(owner.some((d) => ["esc_notifications", "property_facts"].includes(d.relatedEntity) || d.category === "Installation" && d.relatedEntity === "evidence_requirements")).toBe(false);
    expect(owner.some((d) => d.relatedEntity === "quotes")).toBe(true);
    expect(visibleTo(docs, "admin").length).toBe(docs.length);
    const fns = readFileSync("src/lib/jobfile.functions.ts", "utf8");
    expect((fns.match(/requireJobRole|requireAdmin\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  test("5. legacy Owner Authority appears historical, deprecated and is not a gate", () => {
    const d = buildDocumentIndex(sample()).find((x) => x.id === "documents:d3")!;
    expect(d).toMatchObject({ status: "historical", deprecated: true, category: "Customer / Consent" });
    expect(buildDocumentIndex(sample()).some((x) => x.id === "owner_authorities:o1")).toBe(false); // same file, not duplicated
    expect(readFileSync("src/lib/workflow.server.ts", "utf8")).not.toMatch(/owner_authorit[^\n]*blocker/i);
  });
  test("6. system-generated records auto-file into the right categories", () => {
    const docs = buildDocumentIndex(sample());
    const cat = (id: string) => docs.find((d) => d.id === id)!;
    expect(cat("documents:d1").category).toBe("ESC / VEEC");
    expect(cat("documents:d1").alsoIn).toContain("Customer / Consent");
    expect(cat("evidence_files:e2").category).toBe("Electrical / PIESA");
    expect(cat("evidence_files:e1").category).toBe("Installation");
    expect(cat("esc_notifications:n1").category).toBe("ESC / VEEC");
    expect(cat("property_facts:f1").category).toBe("Property");
    expect(cat("invoices:i1").category).toBe("Payments");
    expect(inCategory(docs, "Evidence").length).toBeGreaterThanOrEqual(2);
  });
});

describe("Correspondence and timeline", () => {
  const msgs = [{ id: "m1", sender_id: "owner1", body: "Hi", channel: "portal", internal: false, created_at: "2026-09-02T00:00:00Z" }, { id: "m2", sender_id: "adm", body: "note", channel: "portal", internal: true, created_at: "2026-09-03T00:00:00Z" }];
  const comms = [{ id: "c1", direction: "outbound", channel: "phone", body: "Called owner", visibility: "customer", delivery_status: "recorded", created_at: "2026-09-04T00:00:00Z", sent_at: "2026-09-04T00:00:00Z" },
    { id: "c2", direction: "internal", channel: "note", body: "margin talk", visibility: "internal", delivery_status: "recorded", created_at: "2026-09-01T00:00:00Z" }];
  const corr = buildCorrespondence(msgs, comms, (id) => (id === "adm" ? "admin" : null));
  test("7. portal messages + manual communication appear together", () => {
    expect(corr.map((c) => c.id)).toEqual(["job_communications:c2", "messages:m1", "messages:m2", "job_communications:c1"]);
  });
  test("8. internal correspondence hidden from owner/trade", () => {
    for (const r of ["owner", "electrician", "installer"] as const) expect(visibleTo(corr, r).some((c) => c.internal)).toBe(false);
    expect(visibleTo(corr, "owner").some((c) => c.id === "job_communications:c1")).toBe(true);
    expect(visibleTo(corr, "installer").some((c) => c.id === "job_communications:c1")).toBe(false);
  });
  test("9. timeline chronological and visibility-filtered", () => {
    const tl = buildTimeline({ events: [{ id: "w2", event_type: "quote_accepted", summary: "b", created_at: "2026-09-05T00:00:00Z", internal: false }, { id: "w1", event_type: "gate1_auto", summary: "a", created_at: "2026-08-01T00:00:00Z", internal: true }], correspondence: corr, bookings: [], evidence: buildDocumentIndex(sample()) });
    const ats = tl.map((t) => t.at); expect([...ats].sort()).toEqual(ats);
    expect(visibleTo(tl, "owner").some((t) => t.internal)).toBe(false);
    expect(filterTimeline(tl, "money").every((t) => t.tags.includes("money"))).toBe(true);
    expect(filterTimeline(tl, "internal").length).toBeGreaterThan(0);
  });
});

describe("Job pack", () => {
  test("10. manifest carries hashes, source, version and status", () => {
    const items = packSelection(buildDocumentIndex(sample()));
    const m = buildManifest(items, packPaths(items));
    const esc = m.find((e) => e.id === "esc_notifications:n1")!;
    expect(esc).toMatchObject({ sha256: "cc", source_system: expect.any(String), status: "final" });
    expect(m.find((e) => e.id === "quotes:q1")!.version).toBe("2");
    expect(m.find((e) => e.id === "evidence_files:e1")!.pack_path).toBe("Installation/before.jpg");
  });
  test("11. default pack excludes internal and superseded", () => {
    const docs = buildDocumentIndex(sample()).map((d, i) => (i === 0 ? { ...d, internal: true } : d));
    const p = packSelection(docs);
    expect(p.some((d) => d.internal)).toBe(false);
    expect(packSelection(docs, { includeInternal: true }).some((d) => d.internal)).toBe(true);
  });
  test("12. no public storage URLs anywhere", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) expect(readFileSync(f, "utf8")).not.toMatch(/getPublicUrl|\/object\/public\//);
    const m = buildManifest(buildDocumentIndex(sample()), new Map());
    expect(JSON.stringify(m)).not.toMatch(/object\/public/);
    expect(m.filter((e) => e.storage_ref).every((e) => e.storage_ref!.startsWith("job-files:"))).toBe(true);
  });
  test("13. large exports switch to manifest + signed links, never browser concatenation", () => {
    const docs = buildDocumentIndex(sample()).map((d) => (d.relatedEntity === "evidence_requirements" ? { ...d, sizeBytes: 900 * 1024 * 1024 } : d));
    expect(planPack(docs).mode).toBe("manifest_with_links");
    expect(planPack(buildDocumentIndex(sample())).mode).toBe("zip");
    const ui = readFileSync("src/components/portal/jobfile.tsx", "utf8");
    expect(ui).not.toMatch(/arrayBuffer|new Blob|createObjectURL/);
  });
  test("retention is at least 6 years", () => {
    expect(retentionFor({ assignmentRetainUntil: null, jobCreatedAt: "2026-01-01T00:00:00Z", completedAt: null }).retainUntil >= "2032-01-01").toBe(true);
  });
});

describe("14. Gate 1 uses Property Intelligence only when trusted", () => {
  const prop = { state: null, postcode: "3000", occupancy: "owner_occupied", is_residential: null, year_built: null, enrichment: { previous_ceiling_insulation_upgrade: false, base44: { raw: { answers: { insulation: "none" } } } } };
  const f = (k: string, v: unknown, o: Partial<IntelFact> = {}): IntelFact => ({ fact_key: k, value: v, evidence_kind: "direct", confidence: "high", source_type: "public_gis", source_name: "Vicmap", is_current: true, is_stale: false, ...o });
  const job = { lifeSupportStatus: "no", preliminaryOutcome: "likely_eligible" };
  test("trusted direct facts can pass", () => {
    const facts = resolveGate1Facts(prop, job, 5, 2026, [f("address_verified", true), f("in_victoria", true), f("ncc_class_evidence", "class1"), f("age_evidence", { date: "2010-01-01", kind: "historical_imagery_same_footprint" })]);
    expect(facts.state).toBe("VIC"); expect(facts.isResidential).toBe(true); expect(facts.verifiedMinAgeYears).toBe(16);
    expect(evaluateGate1(facts).outcome).toBe("likely_eligible");
  });
  test("inferred/low-confidence/stale facts never set facts; stays review", () => {
    const facts = resolveGate1Facts(prop, job, 5, 2026, [f("address_verified", true), f("in_victoria", true, { confidence: "medium" }), f("ncc_class_evidence", "class1", { evidence_kind: "inferred" }), f("age_evidence", { date: "2010-01-01", kind: "historical_imagery_same_footprint" }, { is_stale: true }), f("residential_likelihood", "high")]);
    expect(facts.state).toBeNull(); expect(facts.isResidential).toBeNull(); expect(facts.verifiedMinAgeYears ?? null).toBeNull();
    expect(evaluateGate1(facts).outcome).toBeNull();
  });
  test("direct hard evidence auto-fails; flat roof forces review", () => {
    expect(evaluateGate1(resolveGate1Facts(prop, job, 5, 2026, [f("address_verified", true), f("in_victoria", false)])).outcome).toBe("does_not_appear_eligible");
    const flat = resolveGate1Facts(prop, job, 5, 2026, [f("address_verified", true), f("in_victoria", true), f("ncc_class_evidence", "class1"), f("age_evidence", { date: "2010-01-01", kind: "historical_imagery_same_footprint" }), f("roof_form", "low_slope_flat", { evidence_kind: "inferred", confidence: "low" })]);
    expect(evaluateGate1(flat).outcome).toBe("needs_onsite_confirmation");
  });
  test("preliminary Base44 result alone never passes", () => {
    expect(evaluateGate1(resolveGate1Facts(prop, job, 5, 2026, [])).outcome).toBeNull();
  });
});
