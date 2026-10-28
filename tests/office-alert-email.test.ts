// Task 3 (Mitti form retry): the office alert email. One email per failed form, always to info@ (never an owner or
// trade address), paused by the master switch, TEST jobs only to the test allowlist. Fake gateway (fetch), fake test
// sender, in-memory admin DB enforcing the workflow_events primary key. Fictional data only.
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
const testSends: { to: string; subject: string; ctx: unknown }[] = [];
let testStatus: "sent" | "blocked" | "failed" = "sent";
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: unknown, to: string, subject: string) => { testSends.push({ to, subject, ctx }); return { channel: "email", to, status: testStatus, detail: "x" }; },
}));

const gateway: { body: { to: string[]; from: string; subject: string } }[] = [];
let gatewayMode: "ok" | "fail" | "throw" = "ok";
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  if (gatewayMode === "throw") throw new Error("network down");
  gateway.push({ body: JSON.parse(init.body) });
  return gatewayMode === "fail" ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
}) as never;
process.env["RESEND_API_KEY"] = "k"; process.env["LOVABLE_API_KEY"] = "g";

const { sendMittiFailureAlert } = await import("../src/lib/office-alert-email.server");
const { ALERT_SENT_EVENT } = await import("../src/lib/mitti-retry.core");
const { TEST_ALLOWLIST } = await import("../src/lib/test-send.core");

const JOB = "a0000000-0000-4000-8000-0000000000a1";
const QA_JOB = "a0000000-0000-4000-8000-0000000000a2";
const content = { subject: "Form failed", text: "t", html: "<p>t</p>" };
const alerts = () => (T.workflow_events ?? []).filter((e) => e.event_type === ALERT_SENT_EVENT);

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  gateway.length = 0; testSends.length = 0; commsOn = true; gatewayMode = "ok"; testStatus = "sent";
  Object.assign(T, {
    jobs: [{ id: JOB, source: "web" }, { id: QA_JOB, source: "qa_test" }],
    job_assignments: [{ job_id: JOB, role: "installer", active: true, businesses: { onboarding_notes: null } }],
  });
});

describe("sendMittiFailureAlert", () => {
  test("sends once: a second call is already_sent", async () => {
    expect(await sendMittiFailureAlert(JOB, "piesa", "k1", content)).toBe("sent");
    expect(await sendMittiFailureAlert(JOB, "piesa", "k1", content)).toBe("already_sent");
    expect(gateway.length).toBe(1);
    expect(alerts().length).toBe(1);
    expect(alerts()[0]!.internal).toBe(true);
  });
  test("a different alert key sends again", async () => {
    await sendMittiFailureAlert(JOB, "piesa", "k1", content);
    expect(await sendMittiFailureAlert(JOB, "piesa", "k2", content)).toBe("sent");
    expect(gateway.length).toBe(2);
  });
  test("paused when the master switch is off: no send, no event, later call sends", async () => {
    commsOn = false;
    expect(await sendMittiFailureAlert(JOB, "ready_check", "k1", content)).toBe("paused");
    expect(gateway.length).toBe(0);
    expect(alerts().length).toBe(0);
    commsOn = true;
    expect(await sendMittiFailureAlert(JOB, "ready_check", "k1", content)).toBe("sent");
    expect(gateway.length).toBe(1);
  });
  test("send failure leaves no event and the next call retries", async () => {
    gatewayMode = "fail";
    await expect(sendMittiFailureAlert(JOB, "fixes", "k1", content)).rejects.toThrow();
    expect(alerts().length).toBe(0);
    gatewayMode = "throw";
    await expect(sendMittiFailureAlert(JOB, "fixes", "k1", content)).rejects.toThrow();
    expect(alerts().length).toBe(0);
    gatewayMode = "ok"; gateway.length = 0;
    expect(await sendMittiFailureAlert(JOB, "fixes", "k1", content)).toBe("sent");
    expect(gateway.length).toBe(1);
    expect(alerts().length).toBe(1);
  });
  test("test job goes to the allowlist only, via the test sender", async () => {
    expect(await sendMittiFailureAlert(QA_JOB, "install_day", "k1", content)).toBe("test_routed");
    expect(gateway.length).toBe(0);
    expect(testSends.length).toBe(1);
    expect(TEST_ALLOWLIST.email as readonly string[]).toContain(testSends[0]!.to);
    expect(await sendMittiFailureAlert(QA_JOB, "install_day", "k1", content)).toBe("already_sent");
    expect(testSends.length).toBe(1);
  });
  test("TEST partner job is also routed to the test sender", async () => {
    const { TEST_PARTNER_MARK } = await import("../src/lib/test-send.core");
    T.job_assignments![0]!.businesses = { onboarding_notes: TEST_PARTNER_MARK };
    expect(await sendMittiFailureAlert(JOB, "ready_check", "k1", content)).toBe("test_routed"); // installer form → installer business
    expect(gateway.length).toBe(0);
  });
  test("test send failure leaves no event", async () => {
    testStatus = "failed";
    await expect(sendMittiFailureAlert(QA_JOB, "piesa", "k1", content)).rejects.toThrow();
    expect(alerts().length).toBe(0);
  });
  test("never addresses the owner or a trade: real jobs go only to info@", async () => {
    T.owners = [{ id: "o", email: "owner@example.test" }];
    T.job_assignments!.push({ job_id: JOB, role: "electrician", active: true, profiles: { email: "sparky@example.test" } });
    await sendMittiFailureAlert(JOB, "piesa", "k1", content);
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.body.to).toEqual(["info@homeinsulationvictoria.com.au"]);
    expect((alerts()[0]!.details as { to: string }).to).toBe("info@homeinsulationvictoria.com.au");
  });
});

describe("M5: the TEST check uses the trade for that form", () => {
  test("a PIESA or fixes alert for a TEST partner electrician goes to the test sender (the installer is real)", async () => {
    const { TEST_PARTNER_MARK } = await import("../src/lib/test-send.core");
    T.job_assignments!.push({ job_id: JOB, role: "electrician", active: true, businesses: { onboarding_notes: TEST_PARTNER_MARK } });
    expect(await sendMittiFailureAlert(JOB, "piesa", "k1", content)).toBe("test_routed");
    expect(await sendMittiFailureAlert(JOB, "fixes", "k2", content)).toBe("test_routed");
    expect(gateway.length).toBe(0);
    // the installer forms on the same job use the (real) installer business
    expect(await sendMittiFailureAlert(JOB, "install_day", "k3", content)).toBe("sent");
  });
  test("a Ready Check alert for a TEST partner installer is test-routed even with a real electrician", async () => {
    const { TEST_PARTNER_MARK } = await import("../src/lib/test-send.core");
    T.job_assignments![0]!.businesses = { onboarding_notes: TEST_PARTNER_MARK };
    T.job_assignments!.push({ job_id: JOB, role: "electrician", active: true, businesses: { onboarding_notes: null } });
    expect(await sendMittiFailureAlert(JOB, "ready_check", "k1", content)).toBe("test_routed");
  });
});

