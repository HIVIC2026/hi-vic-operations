// Task 2 (ESC robot finish): the failure email to info@. One email per robot failure, paused by the master switch,
// TEST jobs get nothing. Fake gateway (fetch), in-memory admin DB enforcing the workflow_events primary key. Fictional data only.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
function from(table: string) {
  let op: "select" | "insert" | "update" | "delete" = "select"; let values: unknown = null;
  const f: [string, unknown][] = [];
  const rows = () => (T[table] ??= []);
  const match = (r: Row) => f.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === "insert") {
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      for (const r of list) if (r.id && rows().some((x) => x.id === r.id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      rows().push(...list.map((r) => ({ ...r }))); return { data: list, error: null };
    }
    if (op === "update") { const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row); return { data: hit, error: null }; }
    if (op === "delete") { T[table] = rows().filter((r) => !match(r)); return { data: null, error: null }; }
    return { data: rows().filter(match), error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q, eq: (k: string, v: unknown) => { f.push([k, v]); return q; }, limit: () => q, order: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; }, delete: () => { op = "delete"; return q; },
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));

let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (jobId: string, _a: unknown, eventType: string, summary: string, details: Record<string, unknown>, opts: { internal?: boolean }) => {
    (T.workflow_events ??= []).push({ id: crypto.randomUUID(), job_id: jobId, event_type: eventType, summary, details, internal: opts.internal ?? false });
  },
}));

const gateway: { body: { to: string[]; subject: string; text: string } }[] = [];
let gatewayMode: "ok" | "throw" = "ok";
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  if (gatewayMode === "throw") throw new Error("network down");
  gateway.push({ body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
}) as never;
process.env["RESEND_API_KEY"] = "k"; process.env["LOVABLE_API_KEY"] = "g";

const { robotAlertContent } = await import("../src/lib/esc-robot-alert.core");
const { sendRobotFailureAlert } = await import("../src/lib/esc-robot-alert.server");
const { recordRobotFailure } = await import("../src/lib/esc-registry-robot.server");

const JOB = "a0000000-0000-4000-8000-0000000000a1";
const QA_JOB = "a0000000-0000-4000-8000-0000000000a2";
const alerts = () => (T.workflow_events ?? []).filter((e) => e.event_type === "esc_robot_alert_sent");

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  gateway.length = 0; commsOn = true; gatewayMode = "ok";
  Object.assign(T, {
    jobs: [{ id: JOB, job_number: "HV-1234", source: "web", property_id: "p1" }, { id: QA_JOB, job_number: "HV-9", source: "qa_test", property_id: "p1" }],
    properties: [{ id: "p1", address_line: "1 Example St", suburb: "Testville", state: "VIC", postcode: "3000" }],
  });
});

describe("robotAlertContent", () => {
  const base = { jobNumber: "HV-1234", address: "1 Example St, Testville VIC 3000", step: "fill_form", jobUrl: "https://example.test/admin/jobs/x" };
  test("install notice subject and next step", () => {
    const c = robotAlertContent({ ...base, task: "install_notification" });
    expect(c.subject).toBe("Robot couldn't lodge – HV-1234 (install notice)");
    expect(c.text).toContain("Lodge it by hand in the VEU Registry from the Registry block on the job, 24 hours to 5 days before the install.");
    expect(c.html).toContain("https://example.test/admin/jobs/x");
  });
  test("VEEC subject and next step; no error or login text", () => {
    const c = robotAlertContent({ ...base, task: "veec_creation", address: null });
    expect(c.subject).toBe("Robot couldn't lodge – HV-1234 (VEECs)");
    expect(c.text).toContain("Create them by hand from Final check.");
    for (const s of [c.text, c.html]) expect(s.toLowerCase()).not.toContain("password");
  });
});

describe("sendRobotFailureAlert", () => {
  const p = { jobId: JOB, eventKey: "k1", task: "install_notification" as const, step: "fill_form" };
  test("sends one email to info@", async () => {
    expect(await sendRobotFailureAlert(p)).toBe("sent");
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.body.to).toEqual(["info@homeinsulationvictoria.com.au"]);
    expect(gateway[0]!.body.text).toContain("1 Example St");
    expect(alerts().length).toBe(1);
  });
  test("same eventKey twice sends once", async () => {
    await sendRobotFailureAlert(p);
    expect(await sendRobotFailureAlert(p)).toBe("already_sent");
    expect(gateway.length).toBe(1);
  });
  test("test job gets nothing", async () => {
    expect(await sendRobotFailureAlert({ ...p, jobId: QA_JOB })).toBe("test_skipped");
    expect(gateway.length).toBe(0);
    expect(alerts().length).toBe(0);
  });
  test("comms off pauses and removes the lock", async () => {
    commsOn = false;
    expect(await sendRobotFailureAlert(p)).toBe("paused");
    expect(gateway.length).toBe(0);
    expect(alerts().length).toBe(0);
    commsOn = true;
    expect(await sendRobotFailureAlert(p)).toBe("sent");
  });
});

describe("recordRobotFailure", () => {
  test("a failing email never stops the failure event", async () => {
    gatewayMode = "throw";
    const err = console.error; console.error = () => {};
    try {
      await recordRobotFailure({ jobId: JOB, task: "install_notification", notificationId: "n1", mode: "live", step: "fill_form", error: "boom", screenshotPath: null, registryUrl: null });
    } finally { console.error = err; }
    expect((T.workflow_events ?? []).some((e) => e.event_type === "esc_registry_robot_failed")).toBe(true);
    expect(alerts().length).toBe(0);
  });
  test("emails once on failure", async () => {
    await recordRobotFailure({ jobId: JOB, task: "veec_creation", notificationId: null, mode: "live", step: "fill_form", error: "boom", screenshotPath: null, registryUrl: null });
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.body.subject).toBe("Robot couldn't lodge – HV-1234 (VEECs)");
  });
});
