// Lease fencing and partial-job edit lock through the real confirmBatch (fake TEST data, no network).
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
  recordJobElectricianChoice: async (jobId: string) => { if (hook) { const h = hook; hook = null; await h(); } await db.from("jobs").update({ electrician_choice: "hivic_organise" }).eq("id", jobId); return { choice: "hivic_organise" }; },
}));
let verifyFails = 0; let hook: null | (() => Promise<void>) = null;
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async () => { if (verifyFails > 0) { verifyFails--; throw new Error("storage unavailable"); } } }));

const { confirmBatch, setRowAddress, PARTIAL_JOB_LOCKED } = await import("../src/lib/bulk-import.server");

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


test("A holds past expiry, B takes over, A resumes: A writes/confirms/releases nothing of B's", async () => {
  seed("visited");
  const B_LEASE = new Date(Date.now() + 300_000).toISOString();
  hook = async () => { row().confirm_lease_until = B_LEASE; }; // A's lease expired and B claimed while A was busy
  const a = await confirmBatch("batch-1", ACTOR, []);
  expect(a.created).toBe(0);
  expect(a.incomplete[0]!.reason).toMatch(/Another confirm took over/);
  expect(row().status).toBe("pending");
  expect(row().confirm_lease_until).toBe(B_LEASE); // B's claim untouched
  expect(row().confirm_error ?? null).toBeNull();
  expect(db.t("workflow_events").filter((e) => e.event_type === "bulk_import_confirmed").length).toBe(0);
  // B's lease ends; a later confirm finishes the same single job.
  row().confirm_lease_until = new Date(Date.now() - 1000).toISOString();
  const again = await confirmBatch("batch-1", ACTOR, []);
  expect(again.created).toBe(1);
  expect(count("jobs")).toBe(1);
});

test("job started then measure-up fails: review edits are locked, retry finishes the same job with its original details", async () => {
  seed("visited");
  db.failNext("ceiling_measurements", "insert");
  await confirmBatch("batch-1", ACTOR, []);
  expect(row().job_id).toBeTruthy();
  await expect(setRowAddress("row-1", { full_name: "Changed Name", address_line: "999 Other Road", suburb: "Elsewhere", postcode: "3001" })).rejects.toThrow(PARTIAL_JOB_LOCKED);
  expect((row().extracted as Record<string, unknown>).address_line).toBe("111 Testcase Street");
  expect(row().duplicate_note ?? null).toBeNull();
  const r = await confirmBatch("batch-1", ACTOR, []);
  expect(r.created).toBe(1); expect(count("jobs")).toBe(1); expect(count("owners")).toBe(1);
});
