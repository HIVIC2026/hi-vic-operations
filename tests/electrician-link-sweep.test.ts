// Part 6 fix wave I2: the 15-minute tick gives every active electrician assignment its job link text when none was ever
// sent (an allocation whose text was held, or a path that never texted). Idempotent: one `electrician_link_text_held`
// per key + reason; a sent text (electrician_link_text_sent) ends the retries. The REAL electrician-link.server sweep runs
// against an in-memory database; the link/text step is a recording fake.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", J2 = "00000000-0000-4000-8000-0000000000a2", ELEC = "00000000-0000-4000-8000-0000000000b2";
const WA = "00000000-0000-4000-8000-0000000000c1", WB = "00000000-0000-4000-8000-0000000000c2";
const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ id: `e${tables["workflow_events"]!.length}`, job_id: jobId, actor_id: actorId, event_type: eventType, summary, details, created_at: new Date().toISOString() });
  },
}));
const server = await import("../src/lib/electrician-link.server");
const calls: unknown[][] = [];
let outcome: Awaited<ReturnType<typeof server.linkAfterAllocation>> = "held";
const deps = () => ({ link: async (jobId: string, workerId: string) => { calls.push([jobId, workerId]); return outcome; } });

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.length = 0; outcome = "held";
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: "website", stage: "piesa_and_install_window_pending", deleted_at: null }, { id: J2, job_number: "HV-5002", source: "website", stage: "cancelled", deleted_at: null }];
  tables["job_assignments"] = [
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: null },
    { id: "a9", job_id: J2, business_id: ELEC, role: "electrician", active: true, user_id: null },
  ];
  tables["partner_workers"] = [
    { id: WA, business_id: ELEC, full_legal_name: "Alex Amp", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null },
    { id: WB, business_id: ELEC, full_legal_name: "Bea Bolt", mobile: "0433 333 333", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: "u-bea" },
  ];
  tables["workflow_events"] = [
    { id: "al", job_id: J, event_type: "in_house_electrician_allocated", summary: "", details: { worker_id: WA, business_id: ELEC }, created_at: "2026-11-02T00:00:00Z" },
    { id: "al2", job_id: J2, event_type: "in_house_electrician_allocated", summary: "", details: { worker_id: WA, business_id: ELEC }, created_at: "2026-11-02T00:00:00Z" },
  ];
}
beforeEach(seed);
const held = () => tables["workflow_events"]!.filter((e) => e["event_type"] === "electrician_link_text_held");

describe("sweepElectricianLinks", () => {
  test("an active assignment with no text sent: the link step runs once for the allocated worker; held → one held record per key + reason; a closed job is skipped", async () => {
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(calls).toEqual([[J, WA]]);
    expect(held()).toHaveLength(1);
    expect(held()[0]!["details"]).toMatchObject({ key: `electrician-link:v1:${J}:${WA}`, worker_id: WA, reason: "held" });
    // Same tick again, same reason: nothing new recorded (the step still runs — it is the one that may now succeed).
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(held()).toHaveLength(1);
    // A different reason is a new record.
    outcome = "no_mobile";
    await server.sweepElectricianLinks(new Date(), deps());
    expect(held().map((e) => (e["details"] as { reason: string }).reason)).toEqual(["held", "no_mobile"]);
  });
  test("once the text went (electrician_link_text_sent for that key) the assignment is left alone", async () => {
    tables["workflow_events"]!.push({ id: "s", job_id: J, event_type: "electrician_link_text_sent", summary: "", details: { key: `electrician-link:v1:${J}:${WA}`, worker_id: WA }, created_at: "2026-11-02T01:00:00Z" });
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 0, sent: 0, held: 0 });
    expect(calls).toHaveLength(0);
  });
  test("a sent text counts as sent and records nothing held", async () => {
    outcome = "sent";
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(held()).toHaveLength(0);
  });
  test("a legacy assignment with a profile and no allocation event finds the worker by profile", async () => {
    tables["workflow_events"] = [];
    tables["job_assignments"]![0]!["user_id"] = "u-bea";
    await server.sweepElectricianLinks(new Date(), deps());
    expect(calls).toEqual([[J, WB]]);
  });
  test("no worker can be found: skipped, nothing recorded", async () => {
    tables["workflow_events"] = [];
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 0, sent: 0, held: 0 });
    expect(calls).toHaveLength(0);
  });
  test("a read failure logs and does nothing", async () => {
    delete tables["job_assignments"];
    expect(await server.sweepElectricianLinks(new Date(), deps())).toEqual({ checked: 0, sent: 0, held: 0 });
  });
  test("wired into the tick in its own try/catch", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepElectricianLinks");
    expect(tick).toContain('"allocation tick: electrician link sweep failed"');
  });
});
