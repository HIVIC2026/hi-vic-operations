// Part 3 Task 16: how many REAL jobs are still at an old pre-acceptance step. READ-ONLY (selects only, writes nothing).
// Usage: bun scripts/old-flow-inflight-count.ts
// SQL it runs (through the service client; run it in a place that already has the portal's environment):
//   select job_id, status, starts_at from appointment_proposals
//     where kind = 'ready_check' and note = 'ready_check_time' and status = 'proposed' and starts_at > now();
//   select job_id, event_type, created_at from workflow_events
//     where event_type in ('run_slot_proposed','run_slot_confirmed','run_slot_released','run_slot_cancelled','run_slot_confirm_failed');
//   select id from jobs where id in (...those job ids...) and deleted_at is null and source <> 'qa_test'
//     and stage not in ('cancelled','complete');          -- real, live jobs only
// A step with a non-zero count: those jobs keep the old way (their old screen still shows); do not move that installer
// onto the new flow until they finish. Exit 0 always (it only reports).
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { OLD_FLOW_STEPS_P3, RUN_SLOT_END_EVENTS, jobsConfirmingRunWindow, jobsPickingReadyCheckTimes } from "../src/lib/old-flow-steps.core";
import { READY_CHECK_TIME_NOTE } from "../src/lib/ready-check-times.core";

const PAGE = 1000;
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

const now = new Date();
const times = await all<{ job_id: string; status: string; starts_at: string }>((a, b) =>
  admin.from("appointment_proposals").select("job_id, status, starts_at").eq("kind", "ready_check").eq("note", READY_CHECK_TIME_NOTE).eq("status", "proposed").gt("starts_at", now.toISOString()).range(a, b));
const slots = await all<{ job_id: string; event_type: string; created_at: string }>((a, b) =>
  admin.from("workflow_events").select("job_id, event_type, created_at").in("event_type", ["run_slot_proposed", ...RUN_SLOT_END_EVENTS]).order("created_at", { ascending: true }).range(a, b));

const byStep: Record<string, string[]> = {
  "owner picking Ready Check times": jobsPickingReadyCheckTimes(times, now),
  "owner confirming a run window": jobsConfirmingRunWindow(slots),
};
const candidates = [...new Set(Object.values(byStep).flat())];
const real = new Map<string, string>();
for (let i = 0; i < candidates.length; i += 200) {
  const { data, error } = await admin.from("jobs").select("id, job_number, source, stage, deleted_at").in("id", candidates.slice(i, i + 200));
  if (error) { console.error(`Could not read jobs: ${error.message}`); process.exit(1); }
  for (const j of data ?? []) if (!j.deleted_at && j.source !== "qa_test" && !["cancelled", "complete"].includes(String(j.stage))) real.set(j.id, String(j.job_number ?? j.id));
}

console.log("Real jobs still at an old pre-acceptance step (test jobs, deleted and cancelled jobs left out)");
console.log("Step".padEnd(36), "Jobs");
let total = 0;
for (const s of OLD_FLOW_STEPS_P3) {
  const jobs = (byStep[s.step] ?? []).filter((id) => real.has(id));
  total += jobs.length;
  console.log(s.step.padEnd(36), String(jobs.length).padEnd(4), jobs.map((id) => real.get(id)).join(", "));
}
console.log(total === 0 ? "None: the old screens only ever show for a job at one of these steps, so removing them strands nobody." : `${total} real job(s) at an old step: leave them on the old way (their old screen still shows) and ask Jo before moving that installer.`);
