import { expect, mock, test } from "bun:test";
import { memoryPostgrest } from "./helpers/memory-postgrest";
const tables = {
  jobs: [{ id: "job-a", source: "qa_test", job_number: "HV-A", qa_archived_at: null }, { id: "job-b", source: "qa_test", job_number: "HV-B", qa_archived_at: null }, { id: "real", source: "website", job_number: "HV-REAL", qa_archived_at: null }],
  profiles: [{ id: "person-a", email: "a@hivic-test.example" }, { id: "person-b", email: "b@hivic-test.example" }],
  job_assignments: [{ id: "a", job_id: "job-a", user_id: "person-a", role: "installer", active: true }, { id: "b", job_id: "job-b", user_id: "person-b", role: "installer", active: true }],
  ceiling_measurements: [{ job_id: "job-a", external_source: "mitti", external_id: "sim_a", is_current: true }, { job_id: "job-b", external_source: "mitti", external_id: "sim_b", is_current: true }],
  mitti_sim_audits: [{ id: "sim_a", items: [], completed: false }, { id: "sim_b", items: [], completed: false }],
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: memoryPostgrest(tables) }));
const { practiceForm } = await import("../src/lib/mitti-practice.server");
test("two TEST installers can read only their own bound form", async () => {
  expect((await practiceForm("person-a", "job-a", "sim_a")).jobNumber).toBe("HV-A");
  expect((await practiceForm("person-b", "job-b", "sim_b")).jobNumber).toBe("HV-B");
  await expect(practiceForm("person-a", "job-b", "sim_b")).rejects.toThrow("isn't assigned");
  await expect(practiceForm("person-b", "job-a", "sim_a")).rejects.toThrow("isn't assigned");
  await expect(practiceForm("person-a", "job-a", "sim_b")).rejects.toThrow("isn't assigned");
  await expect(practiceForm("person-a", "real", "sim_a")).rejects.toThrow("isn't assigned");
});