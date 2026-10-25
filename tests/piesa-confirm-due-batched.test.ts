// Perf 25 Oct 2026: the PIESA owner-confirmation sweep decides each job's next step from ONE batched read of records,
// confirmations and recorded steps (was ownerPiesaConfirmFacts + doneSteps per job per tick). Same rule as before:
// latest owner-confirmed-kind record (initial/reassessment), unsigned record → nothing, a confirmation of THAT record →
// nothing, steps counted per record, one step per tick in schedule order. Also the fixes sweep (post_rectification).
import { describe, expect, mock, test } from "bun:test";
import { makeCounterDb } from "./helpers/query-counter-db";

const NOW = new Date("2026-10-25T03:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const tables = {
  piesa_records: [
    { id: "rA", job_id: "A", kind: "initial", created_at: ago(2), signed_off_by: "e1", completed_date: "2026-10-25" },
    { id: "rB", job_id: "B", kind: "initial", created_at: ago(30), signed_off_by: "e1", completed_date: "2026-10-24" },
    { id: "rC", job_id: "C", kind: "initial", created_at: ago(30), signed_off_by: "e1", completed_date: "2026-10-24" },
    { id: "rD1", job_id: "D", kind: "initial", created_at: ago(200), signed_off_by: "e1", completed_date: "2026-10-16" },
    { id: "rD2", job_id: "D", kind: "reassessment", created_at: ago(1), signed_off_by: "e1", completed_date: "2026-10-25" },
    { id: "rE", job_id: "E", kind: "initial", created_at: ago(30), signed_off_by: null, completed_date: "2026-10-24" },
    { id: "rF", job_id: "F", kind: "initial", created_at: ago(200), signed_off_by: "e1", completed_date: "2026-10-16" },
    { id: "rG", job_id: "G", kind: "post_rectification", created_at: ago(30), signed_off_by: "e1", completed_date: "2026-10-24" },
  ],
  workflow_events: [
    { job_id: "B", event_type: "piesa_owner_confirm_reminder", details: { step: "request", piesa_record_id: "rB" }, created_at: ago(29) },
    { job_id: "C", event_type: "piesa_owner_confirmed", details: { piesa_record_id: "rC", name: "Owner C", signed_at: ago(10) }, created_at: ago(10) },
    { job_id: "D", event_type: "piesa_owner_confirmed", details: { piesa_record_id: "rD1", name: "Owner D", signed_at: ago(150) }, created_at: ago(150) },
    { job_id: "F", event_type: "piesa_owner_confirm_reminder", details: { step: "request", piesa_record_id: "rF" }, created_at: ago(199) },
    { job_id: "F", event_type: "piesa_owner_confirm_reminder", details: { step: "reminder_1", piesa_record_id: "rF" }, created_at: ago(170) },
    { job_id: "F", event_type: "piesa_owner_confirm_reminder", details: { step: "reminder_3", piesa_record_id: "rF" }, created_at: ago(120) },
    { job_id: "F", event_type: "piesa_owner_confirm_reminder", details: { step: "office_alert_5", piesa_record_id: "rF" }, created_at: ago(80) },
  ],
};
const db = makeCounterDb(tables, { rtt: 0, perRow: 0 });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.client }));

describe("batched confirmation-step decisions", () => {
  test("PIESA owner confirmation: same next step per job as the per-job rule", async () => {
    const { duePiesaConfirmSteps } = await import("@/lib/piesa-owner-confirm-send.server");
    const due = await duePiesaConfirmSteps(["A", "B", "C", "D", "E", "F", "G", "none"], NOW);
    expect(Object.fromEntries(due)).toEqual({ A: "request", B: "reminder_1", D: "request" });
    // One read each of records, confirmations and steps — not ~8 per job.
    expect(db.stats.requests).toBe(3);
    expect(db.stats.writes).toEqual([]);
  });
  test("electrical fixes confirmation: only post_rectification records count", async () => {
    const { dueFixesConfirmSteps } = await import("@/lib/piesa-fixes-confirm-send.server");
    const due = await dueFixesConfirmSteps(["A", "G"], NOW);
    expect(Object.fromEntries(due)).toEqual({ G: "request" });
  });
});
