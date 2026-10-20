// Real confirmBatch source path against an in-memory stand-in database (fake TEST data, no network).
// Rules: a row is "confirmed" only once every record is saved; a failure part-way stays pending with its reason and
// partial job linked; confirming again finishes the SAME job with no duplicate owners/properties/jobs/files/quotes.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeDb } from "./helpers/bulk-confirm-fake-db";

const db = fakeDb();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string, event_type: string, summary: string, details = {}) => { const r = await db.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details }); if ((r as { error: unknown }).error) throw new Error("event failed"); },
  WorkflowError: class extends Error {},
}));
mock.module("../src/lib/pilot.server", () => ({
  logPartner: async (_j: unknown, _a: string, type: string, summary: string) => { db.t("partner_log").push({ type, summary }); },
  intakeSourceFor: async () => "qa_test",
}));
mock.module("../src/lib/job-electrician.server", () => ({
  recordJobElectricianChoice: async (jobId: string) => { await db.from("jobs").update({ electrician_choice: "hivic_organise" }).eq("id", jobId); return { choice: "hivic_organise" }; },
}));
let verifyFails = 0;
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => { if (verifyFails > 0) { verifyFails--; throw new Error("storage unavailable"); } } }));

const { confirmBatch } = await import("../src/lib/bulk-import.server");

const BIZ = "biz-test", ACTOR = "user-test";
const consent = { confirmed_by: ACTOR, confirmed_at: "2026-10-20T00:00:00Z", wording: "TEST consent" };
function seed(stage: "visited" | "quoted", files: { path: string; name: string }[] = [], manifest: Record<string, unknown>[] = []) {
  db.reset();
  db.t("bulk_import_batches").push({ id: "batch-1", business_id: BIZ, status: "analysed", summary: {}, file_manifest: manifest, electrician_plan: { mode: "hivic" } });
  db.t("bulk_import_rows").push({ id: "row-1", batch_id: "batch-1", row_index: 0, status: "pending", sort_result: "covers_ready_check", import_stage: stage, matched_files: files, missing_evidence: [], duplicate_note: null, electrician_plan: null, confirm_lease_until: null,
    extracted: { full_name: "TEST Owner", email: "test.owner@hivic-test.example", phone: "0400000000", address_line: "111 Testcase Street", suburb: "Testville", postcode: "3000", area_m2: 120, existing_insulation: "R5 batts", site_check: "yes", quoted_answer: stage === "quoted" ? "yes" : "no", price_inc_gst: stage === "quoted" ? 2400 : null, owner_consent: consent } });
  db.t("veu_location_variables").push({ postcode: "3000", metropolitan_or_regional: "Metropolitan", regional_factor: 1, climate_zone: 1 });
  db.t("retail_estimator_settings").push({ is_current: true, ap_management_inc_gst: 349, piesa_assessment_inc_gst: 349, indicative_veec_value: 80, minimum_customer_copayment_inc_gst: 200 });
}
const count = (t: string) => db.t(t).length;
const row = () => db.t("bulk_import_rows")[0]!;
beforeEach(() => { verifyFails = 0; });

test("measure-up failure after the job insert: row stays pending, result says not finished, retry finishes the same job", async () => {
  seed("visited");
  db.failNext("ceiling_measurements", "insert");
  const first = await confirmBatch("batch-1", ACTOR, []);
  expect(first.created).toBe(0);
  expect(first.failed).toBe(1);
  expect(first.remaining).toBe(1);
  expect(first.incomplete[0]!.reason).toContain("Measure-up could not be saved");
  expect(row().status).toBe("pending");
  expect(row().job_id).toBe(db.t("jobs")[0]!.id);
  expect(db.t("bulk_import_batches")[0]!.status).toBe("analysed");

  const second = await confirmBatch("batch-1", ACTOR, []);
  expect(second.created).toBe(1);
  expect(row().status).toBe("confirmed");
  expect(db.t("bulk_import_batches")[0]!.status).toBe("confirmed");
  expect([count("owners"), count("properties"), count("jobs"), count("ceiling_measurements"), count("owner_eligibility_links")]).toEqual([1, 1, 1, 1, 1]);
  expect(db.t("workflow_events").filter((e) => e.event_type === "bulk_import_confirmed").length).toBe(1);
});

test("job insert failure removes this attempt's owner and property, so a retry never duplicates them", async () => {
  seed("visited");
  db.failNext("jobs", "insert");
  const first = await confirmBatch("batch-1", ACTOR, []);
  expect(first.failed).toBe(1);
  expect([count("owners"), count("properties"), count("jobs")]).toEqual([0, 0, 0]);
  await confirmBatch("batch-1", ACTOR, []);
  expect([count("owners"), count("properties"), count("jobs")]).toEqual([1, 1, 1]);
});

test("uncertain job write (saved, response lost) is recovered — one job, one owner, one property", async () => {
  seed("visited");
  db.failNext("jobs", "insert", "uncertain");
  const r = await confirmBatch("batch-1", ACTOR, []);
  expect(r.created).toBe(1);
  expect([count("owners"), count("properties"), count("jobs")]).toEqual([1, 1, 1]);
});

test("quote failure is reported, never counted as a success; retry makes exactly one quote with its lines", async () => {
  seed("quoted");
  db.failNext("quote_items", "insert");
  const first = await confirmBatch("batch-1", ACTOR, []);
  expect(first.created).toBe(0);
  expect(row().status).toBe("pending");
  expect(String(row().confirm_error)).toContain("injected");
  const second = await confirmBatch("batch-1", ACTOR, []);
  expect(second.created).toBe(1);
  expect(second.results[0]!.quote).toBe("draft_saved");
  expect(count("quotes")).toBe(1);
  expect(count("quote_items")).toBeGreaterThanOrEqual(2);
  expect(count("jobs")).toBe(1);
});

test("a stored file that can't be attached keeps the row pending; retry attaches it once", async () => {
  const stored = `partners/${BIZ}/imports/u1-quote.pdf`;
  seed("visited", [{ path: "111 Testcase Street/quote.pdf", name: "quote.pdf" }], [{ path: "111 Testcase Street/quote.pdf", name: "quote.pdf", type: "application/pdf", stored_path: stored }]);
  verifyFails = 1;
  const first = await confirmBatch("batch-1", ACTOR, []);
  expect(first.created).toBe(0);
  expect(first.incomplete[0]!.reason).toContain("could not be attached");
  expect(row().status).toBe("pending");
  const second = await confirmBatch("batch-1", ACTOR, []);
  expect(second.created).toBe(1);
  expect(db.t("documents").map((d) => d.storage_path)).toEqual([stored]);
});

test("a matched file with no stored copy is shown as not attached (not silently 'attached')", async () => {
  seed("visited", [{ path: "photos.zip/roof.heic.bin", name: "roof.bin" }], [{ path: "photos.zip/roof.heic.bin", name: "roof.bin", type: "" }]);
  const r = await confirmBatch("batch-1", ACTOR, []);
  expect(r.created).toBe(1);
  expect(r.results[0]!.attached).toEqual([]);
  expect(r.results[0]!.notAttached).toEqual(["photos.zip/roof.heic.bin"]);
  expect(count("documents")).toBe(0);
});

test("a second confirm while the first holds the row does nothing (no duplicate job)", async () => {
  seed("visited");
  row().confirm_lease_until = new Date(Date.now() + 60_000).toISOString();
  const r = await confirmBatch("batch-1", ACTOR, []);
  expect(r.alreadyTaken).toBe(1);
  expect(count("jobs")).toBe(0);
  expect(row().status).toBe("pending");
});

test("a confirmed batch stays confirmed history and cannot be confirmed again", async () => {
  seed("visited");
  await confirmBatch("batch-1", ACTOR, []);
  await expect(confirmBatch("batch-1", ACTOR, [])).rejects.toThrow("not ready to confirm");
  expect(count("jobs")).toBe(1);
});
