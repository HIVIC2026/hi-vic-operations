// Full Base44 intake handoff: snapshots, consent, media copy (fake storage/fetch), Gate 1 safety. Run: bun test ./tests/
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildBase44Evidence, buildBase44Raw, isFetchableMediaUrl, mediaStoragePath, normaliseState, planBase44Job, planContactConsent, planMediaImport, sanitizeFilename, declaredExtras, MEDIA_MAX_IMAGE_BYTES, MEDIA_MAX_VIDEO_BYTES, MEDIA_MAX_TOTAL_BYTES } from "../src/lib/enquiry.core";
import { evaluateGate1, resolveGate1Facts, type StoredProperty } from "../src/lib/eligibility.core";

// ---- in-memory fake backend for intake.server ----
type Row = Record<string, any>;
const db: Record<string, Row[]> = { workflow_settings: [{ customer_comms_enabled: false }], documents: [], owner_contact_consents: [], workflow_events: [], external_sync_logs: [] };
const stored = new Map<string, number>();
function q(table: string) {
  const filters: [string, unknown][] = [];
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    maybeSingle: async () => ({ data: db[table]!.find((r) => filters.every(([k, v]) => r[k] === v)) ?? null }),
    then: (res: any) => res({ data: db[table]!.filter((r) => filters.every(([k, v]) => r[k] === v)) }),
    insert: async (row: Row) => {
      if (table === "documents" && db.documents!.some((d) => d["job_id"] === row["job_id"] && d["source_system"] === row["source_system"] && d["external_id"] === row["external_id"])) return { error: { message: "duplicate key" } };
      if (table === "owner_contact_consents" && db.owner_contact_consents!.some((d) => d["job_id"] === row["job_id"] && d["consent_key"] === row["consent_key"])) return { error: { message: "duplicate key" } };
      db[table]!.push(row); return { error: null };
    },
  };
  return api;
}
const fakeAdmin = { from: q, storage: { from: () => ({ upload: async (p: string, b: ArrayBuffer) => { stored.set(p, b.byteLength); return { error: null }; } }) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: unknown) => { db.workflow_events!.push({ job_id, event_type, summary, details }); } }));
const { importBase44Media, recordContactConsent } = await import("../src/lib/intake.server");
const { enquirySchema } = await import("../src/lib/enquiry.server");

const okFetch = (bytes: number) => async () => new Response(new Uint8Array(bytes), { status: 200 });
const img = (id: string, extra: Partial<{ mime_type: string; signed_url: string }> = {}) => ({ source_id: id, name: `../photo ${id}.jpg`, mime_type: "image/jpeg", signed_url: `https://base44.example/${id}?sig=x`, ...extra });

describe("payload contract", () => {
  const base = { external_enquiry_id: "b44-1", full_name: "A", email: "a@b.co", address_line: "1 Test St", estimated_area_m2: 150 };
  test("accepts full Base44 payload", () => {
    const r = enquirySchema.safeParse({ ...base, state: "vic", contact_consent: true, contact_consent_version: "v2", contact_consented_at: "2026-09-28T10:00:00+10:00", age_confirmed: true, assistance: "contract_support", contact_preference: "phone",
      base44_answers: { q1: "house" }, base44_screening: { status: "ok", reasons: ["x"] }, base44_ai_observations: { roof: "tile" }, property_research_raw: { any: [1, 2] }, media: [img("m1")] });
    expect(r.success).toBe(true);
  });
  test("rejects non-HTTPS media, >10 files and oversized snapshots", () => {
    expect(enquirySchema.safeParse({ ...base, media: [img("m1", { signed_url: "http://x.co/a" })] }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...base, media: Array.from({ length: 11 }, (_, i) => img(`m${i}`)) }).success).toBe(false);
    expect(enquirySchema.safeParse({ ...base, property_research_raw: { big: "x".repeat(70_000) } }).success).toBe(false);
  });
  test("missing consent still parses (enquiry is never dropped)", () => expect(enquirySchema.safeParse(base).success).toBe(true));
});

describe("snapshots and declarations", () => {
  test("state normalised; raw snapshots preserved as base44 snapshot, declarations stay declared", () => {
    expect(normaliseState(" vic ")).toBe("VIC");
    expect(normaliseState("")).toBeNull();
    const raw = buildBase44Raw({ base44_answers: { over5: "yes" }, base44_screening: { status: "likely" }, base44_ai_observations: { o: 1 }, property_research_raw: { r: 1 }, contact_consent: true });
    expect(raw).toMatchObject({ basis: "base44_snapshot", answers: { over5: "yes" }, screening: { status: "likely" }, ai_observations: { o: 1 }, research_raw: { r: 1 } });
    expect(buildBase44Evidence({ declared_over_five_years: "yes" }).declared.basis).toBe("owner_declaration");
    expect(buildBase44Raw({ media: [] }).media).toEqual([]);
  });
});

describe("contact consent", () => {
  test("true -> granted; false -> not_granted; missing -> unknown and no external contact", () => {
    expect(planContactConsent({ contact_consent: true }).consent_status).toBe("granted");
    expect(planContactConsent({ contact_consent: false }).externalContactPermitted).toBe(false);
    const m = planContactConsent({});
    expect(m.consent_status).toBe("unknown");
    expect(m.externalContactPermitted).toBe(false);
  });
  test("immutable, idempotent record with hash", async () => {
    const i = { contact_consent: true, contact_consent_version: "v2", contact_consented_at: "2026-09-28T00:00:00Z", assistance: "interpreter" };
    expect((await recordContactConsent("job-c", "own", i)).created).toBe(true);
    expect((await recordContactConsent("job-c", "own", i)).created).toBe(false);
    expect(db.owner_contact_consents!.filter((r) => r["job_id"] === "job-c")).toHaveLength(1);
    expect(db.owner_contact_consents![0]!["sha256"]).toMatch(/^[0-9a-f]{64}$/);
    await recordContactConsent("job-m", "own", {});
    expect(db.owner_contact_consents!.find((r) => r["job_id"] === "job-m")?.["consent_status"]).toBe("unknown");
    expect(readFileSync("drizzle/migrations/0028_base44_full_intake_handoff.sql", "utf8")).toContain("owner_contact_consents_immutable");
  });
});

describe("media", () => {
  test("allowlist, HTTPS only, private URIs rejected, filenames sanitised", () => {
    const p = planMediaImport([img("a"), img("b", { mime_type: "application/pdf" }), img("c", { signed_url: "gs://bucket/x" }), img("a")], new Set());
    expect(p.toCopy.map((m) => m.source_id)).toEqual(["a"]);
    expect(p.rejected.map((r) => r.source_id)).toEqual(["b", "c"]);
    expect(isFetchableMediaUrl("https://u:p@x.co/a")).toBe(false);
    expect(sanitizeFilename("../../etc/pass wd.jpg")).toBe("pass_wd.jpg");
    expect(mediaStoragePath("J", "s/1", "x y.png")).toBe("J/intake/base44/s_1-x_y.png");
  });
  test("copies to private storage once; retry does not duplicate", async () => {
    const r1 = await importBase44Media("job-1", [img("m1"), img("m2")], okFetch(1000));
    expect(r1).toEqual({ copied: 2, skipped: 0, failed: 0 });
    const r2 = await importBase44Media("job-1", [img("m1"), img("m2")], okFetch(1000));
    expect(r2).toEqual({ copied: 0, skipped: 2, failed: 0 });
    expect(db.documents!.filter((d) => d["job_id"] === "job-1")).toHaveLength(2);
    expect(db.documents![0]).toMatchObject({ kind: "intake_media", source_system: "base44", external_id: "m1", original_name: "../photo m1.jpg", mime_type: "image/jpeg" });
  });
  test("oversize and failed fetch never throw; logged for retry", async () => {
    const big = await importBase44Media("job-2", [img("big")], okFetch(MEDIA_MAX_IMAGE_BYTES + 1));
    expect(big.failed).toBe(1);
    const bad = await importBase44Media("job-3", [img("x")], async () => { throw new Error("network down"); });
    expect(bad.failed).toBe(1);
    expect(db.workflow_events!.some((e) => e["job_id"] === "job-3" && e["event_type"] === "base44_media_copy_failed")).toBe(true);
    expect(db.external_sync_logs!.some((e) => e["entity_id"] === "job-3" && e["status"] === "error")).toBe(true);
    const later = await importBase44Media("job-3", [img("x")], okFetch(10)); // retry on next sync
    expect(later.copied).toBe(1);
  });
  test("media errors cannot fail the enquiry (wrapped) and run before Gate 1", () => {
    const src = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).toMatch(/try \{ await importBase44Media[\s\S]*catch/);
    expect(src.indexOf("completeIntake(job.id")).toBeLessThan(src.indexOf("enqueueInitialGate1(job.id"));
    expect(src.indexOf("completeIntake(job.id")).toBeGreaterThan(-1);
  });
});

describe("repeat sync and Gate 1 safety", () => {
  test("repeat sync updates the same job without stage change", () => {
    const p = planBase44Job({ external_enquiry_id: "b44-1", preliminary_outcome: "likely_eligible" }, { stage: "assessment_booking" });
    expect(p.kind).toBe("update");
    expect(p.moveTo).toBeNull();
    expect("stage" in p.patch).toBe(false);
  });
  const prop = (b: unknown): StoredProperty => ({ state: "VIC", postcode: "3056", occupancy: "owner_occupied", is_residential: null, year_built: null, enrichment: { base44: b } });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – preliminary result + declarations + raw snapshots alone cannot auto-pass", () => {
    const b = { ...buildBase44Evidence({ declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no" }), raw: buildBase44Raw({ base44_screening: { status: "likely_eligible" }, property_research_raw: { year: 1990 } }) };
    expect(evaluateGate1(resolveGate1Facts(prop(b), { lifeSupportStatus: "no", preliminaryOutcome: "likely_eligible" }, 5, 2026)).outcome).toBeNull();
  });
  test("full normalised research can still feed existing Gate 1 rules", () => {
    const research = { status: "complete", state: "vic", postcode: "3056", formatted_address: "1 Test St", premises_classification: "Residential dwelling", first_appearance_year: 2001 };
    const b = { ...buildBase44Evidence({ declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no", property_research: research }), raw: buildBase44Raw({ base44_answers: { insulation: "none" } }) };
    expect(evaluateGate1(resolveGate1Facts(prop(b), { lifeSupportStatus: "no", preliminaryOutcome: null }, 5, 2026)).outcome).toBe("likely_eligible");
  });
});

describe("communications", () => {
  test("intake sends nothing and comms lock default stays false", () => {
    const src = readFileSync("src/lib/intake.server.ts", "utf8") + readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).not.toMatch(/sendMessage|sendEmail|sms|resend|twilio/i);
    expect(readFileSync("drizzle/migrations/0028_base44_full_intake_handoff.sql", "utf8")).not.toContain("customer_comms_enabled");
  });
});

describe("follow-up: Base44 limits, consent guard, extra declarations", () => {
  test("limits match Base44: 25 MB per file (image and video), 40 MB total", () => {
    expect(MEDIA_MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MEDIA_MAX_VIDEO_BYTES).toBe(25 * 1024 * 1024);
    expect(MEDIA_MAX_TOTAL_BYTES).toBe(40 * 1024 * 1024);
  });
  test("a 24 MB video is accepted; 25 MB + 1 rejected; total over 40 MB stops further copies", async () => {
    const mb = 1024 * 1024;
    const v = (id: string) => img(id, { mime_type: "video/mp4" });
    expect((await importBase44Media("job-v1", [v("v1")], okFetch(24 * mb))).copied).toBe(1);
    expect((await importBase44Media("job-v2", [v("v2")], okFetch(25 * mb + 1))).failed).toBe(1);
    const r = await importBase44Media("job-v3", [v("a"), v("b")], okFetch(21 * mb));
    expect(r).toEqual({ copied: 1, skipped: 0, failed: 1 });
  });
  test("consent guard: granted passes, missing/not_granted blocks, legacy job without record blocks", async () => {
    const { hasCurrentOwnerContactConsent, assertOwnerContactConsent, assertCustomerDeliveryAllowed, customerDeliveryState } = await import("../src/lib/comms.server");
    await recordContactConsent("job-g", "own", { contact_consent: true, contact_consent_version: "v1" });
    await recordContactConsent("job-n", "own", { contact_consent: false });
    expect(await hasCurrentOwnerContactConsent("job-g")).toBe(true);
    expect(await hasCurrentOwnerContactConsent("job-n")).toBe(false);
    expect(await hasCurrentOwnerContactConsent("legacy-job")).toBe(false);
    await expect(assertOwnerContactConsent("legacy-job", "email")).rejects.toThrow(/No contact consent/);
    // global lock is checked first and still fails closed even with consent
    await expect(assertCustomerDeliveryAllowed("job-g", "email")).rejects.toThrow(/PRE-LAUNCH/);
    expect(await customerDeliveryState("job-g")).toBe("pending_comms_lock");
    db.workflow_settings![0]!["customer_comms_enabled"] = true;
    expect(await customerDeliveryState("job-g")).toBe("ready_to_send");
    expect(await customerDeliveryState("job-n")).toBe("not_ready");
    await expect(assertCustomerDeliveryAllowed("job-n", "email")).rejects.toThrow(/No contact consent/);
    db.workflow_settings![0]!["customer_comms_enabled"] = false;
  });
  test("owner-targeting delivery paths require both locks; portal and trade-only paths do not need consent", () => {
    const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(pf).toContain('await assertCustomerDeliveryAllowed(data.jobId, `${data.channel} message`)');
    expect(pf).not.toContain('"owner authority request"'); // legacy request retired entirely
    expect(pf).toMatch(/if \(data\.channel === "email" \|\| data\.channel === "sms"\)/); // portal messages untouched
    expect(readFileSync("src/lib/assignment.server.ts", "utf8")).toContain("customerDeliveryState(jobId)");
    expect(readFileSync("src/lib/consent.server.ts", "utf8")).toContain("customerDeliveryState(p.jobId)");
  });
  test("existing insulation and top-floor answers are picked up as declared", () => {
    expect(declaredExtras({ existing_insulation: "no", is_top_floor: true })).toEqual({ existing_insulation: "no", top_floor: "yes" });
    expect(declaredExtras(null)).toEqual({ existing_insulation: null, top_floor: null });
  });
  test("reads the live Base44 answer keys insulation and top_floor", () => {
    expect(declaredExtras({ insulation: "yes", top_floor: "no" })).toEqual({ existing_insulation: "yes", top_floor: "no" });
    expect(declaredExtras({ insulation: false, top_floor: false })).toEqual({ existing_insulation: "no", top_floor: "no" });
    // live keys win over legacy spellings when both are present
    expect(declaredExtras({ insulation: "yes", existing_insulation: "no", top_floor: "yes", is_top_floor: "no" }))
      .toEqual({ existing_insulation: "yes", top_floor: "yes" });
    expect(declaredExtras({ other: "x" })).toEqual({ existing_insulation: null, top_floor: null });
  });
});
