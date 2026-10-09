// Runtime proof: the automatic Group B sender re-reads both global switches AFTER the once-per-home reservation and
// immediately before the email service. Everything is mocked locally — no hosted database, no network.
// Only test-side override: the real-send approval flag is forced on so the route can reach the reservation.
import { beforeEach, expect, mock, test } from "bun:test";

const J = "00000000-0000-4000-8000-0000000000b2";
type Read = { data: unknown; error: unknown };
const ON_W: Read = { data: { customer_comms_enabled: true }, error: null };
const ON_D: Read = { data: { enabled: true }, error: null };
let wReads: Read[] = [], dReads: Read[] = [];
let wCount = 0, dCount = 0, mediaReads = 0;
let sends: { id: string; status: string; provider?: string; error?: string | null; idempotency_key: string }[] = [];
const fetchCalls: string[] = [];

const rows: Record<string, unknown> = {
  jobs: { id: J, job_number: "HV-TESTB", source: "base44", stage: "preliminary_estimate_ready", created_at: "2026-10-09T00:00:00Z", eligibility_outcome: "likely_eligible", estimated_area_m2: 150, estimated_area_unknown: false, owners: { full_name: "TEST Owner", email: "owner@example.test" }, properties: { address_line: "1 Test St", suburb: "Testville", postcode: "3000" } },
  customer_estimate_links: { id: "link-1", token: "T".repeat(43) },
  indicative_estimates: { id: "est-1", area_m2: 150, area_source: "owner", insulation_declared: "present", scenarios: [{ removal: 0, removal_m2: 0, by_access: { standard: { estimated_customer_total: 3178, applied_discount: 1120, pre_discount_total: 4298, installation: 3600 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 3600 } } }] } },
  retail_estimator_settings: { indicative_veec_value: 70 },
};

function table(name: string) {
  let pending: "insert" | "update" | null = null, payload: Record<string, unknown> = {}, eqVal: unknown = null;
  const q: Record<string, unknown> = {};
  for (const k of ["select", "limit", "in", "order", "is", "gte"]) q[k] = () => q;
  q["eq"] = (_c: string, v: unknown) => { eqVal = v; return q; };
  q["insert"] = (p: Record<string, unknown>) => { pending = "insert"; payload = p; return q; };
  q["update"] = (p: Record<string, unknown>) => { pending = "update"; payload = p; return q; };
  const resolve = async (): Promise<Read> => {
    if (name === "workflow_settings") return wReads[wCount++] ?? ON_W;
    if (name === "customer_delivery_settings") return dReads[dCount++] ?? ON_D;
    if (name === "customer_email_sends") {
      if (pending === "insert") { const r = { id: `send-${sends.length + 1}`, status: "sending", idempotency_key: String(payload["idempotency_key"]) }; sends.push(r); return { data: { id: r.id }, error: null }; }
      if (pending === "update") { const r = sends.find((s) => s.id === eqVal); if (r) Object.assign(r, payload); return { data: null, error: null }; }
      return { data: sends.find((s) => s.idempotency_key === eqVal) ?? null, error: null };
    }
    if (name in rows) return { data: rows[name], error: null };
    return { data: null, error: null }; // opt-outs / responses: none on file
  };
  q["maybeSingle"] = resolve; q["single"] = resolve;
  q["then"] = (ok: (v: Read) => unknown, bad: (e: unknown) => unknown) => resolve().then(ok, bad);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: table } }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => { mediaReads++; return { excluded: false, received: false, uncertain: false, pendingSync: false, count: 0 }; } }));
const realHot = await import("../src/lib/hot-leads.core");
mock.module("../src/lib/hot-leads.core", () => ({ ...realHot, INSULATION_DETAILS_REAL_SEND_APPROVED: true }));
mock.module("../src/lib/comms.server", () => ({ hasCurrentOwnerContactConsent: async () => true, customerCommsEnabled: async () => true, recordCommunication: async () => null }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=" + "U".repeat(43) }));
mock.module("../src/lib/job-live.server", () => ({ jobDeletedBlocker: async () => null }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => {} }));
globalThis.fetch = (async (u: unknown) => { fetchCalls.push(String(u)); return new Response(JSON.stringify({ id: "intercepted" }), { status: 200 }); }) as typeof fetch;
process.env["RESEND_API_KEY"] = "test-only"; process.env["LOVABLE_API_KEY"] = "test-only";

const { sendAutomaticInsulationDetails, GROUP_B_GLOBALS_OFF } = await import("../src/lib/hot-leads-send.server");

beforeEach(() => { wReads = []; dReads = []; wCount = 0; dCount = 0; mediaReads = 0; sends = []; fetchCalls.length = 0; });

test("control: both switches on all the way reaches the (intercepted) email service once", async () => {
  const r = await sendAutomaticInsulationDetails(J);
  expect(r.outcome).toBe("sent");
  expect(fetchCalls).toEqual(["https://connector-gateway.lovable.dev/resend/emails"]);
  expect(sends).toHaveLength(1); expect(sends[0]!.status).toBe("sent");
  expect(sends[0]!.idempotency_key).toContain(":insulation_details:");
  expect([wCount, dCount]).toEqual([2, 2]);
});

const prehandoff: [string, () => void][] = [
  ["workflow switch turned off", () => { wReads = [ON_W, { data: { customer_comms_enabled: false }, error: null }]; }],
  ["delivery switch turned off", () => { dReads = [ON_D, { data: { enabled: false }, error: null }]; }],
  ["workflow settings read fails", () => { wReads = [ON_W, { data: null, error: { message: "down" } }]; }],
  ["delivery settings read fails", () => { dReads = [ON_D, { data: null, error: { message: "down" } }]; }],
];
for (const [name, arrange] of prehandoff) {
  test(`after reservation, ${name} -> blocked, reservation failed/not_sent, zero provider calls`, async () => {
    arrange();
    const r = await sendAutomaticInsulationDetails(J);
    expect(r.outcome).toBe("blocked"); expect(r.detail).toBe(GROUP_B_GLOBALS_OFF);
    expect([wCount, dCount]).toEqual([2, 2]); // entry read passed; second read happened at pre-handoff
    expect(mediaReads).toBe(3); // entry, sender pre-reservation, sender pre-handoff
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ status: "failed", provider: "not_sent", error: GROUP_B_GLOBALS_OFF });
    expect(fetchCalls).toEqual([]);
  });
}

const entry: [string, () => void][] = [
  ["only workflow switch on", () => { dReads = [{ data: { enabled: false }, error: null }]; }],
  ["only delivery switch on", () => { wReads = [{ data: { customer_comms_enabled: false }, error: null }]; }],
  ["settings read failure", () => { wReads = [{ data: null, error: { message: "down" } }]; }],
];
for (const [name, arrange] of entry) {
  test(`route entry with ${name} -> blocked before reservation, zero provider calls`, async () => {
    arrange();
    const r = await sendAutomaticInsulationDetails(J);
    expect(r.outcome).toBe("blocked"); expect(r.detail).toBe(GROUP_B_GLOBALS_OFF);
    expect([wCount, dCount]).toEqual([1, 1]); expect(mediaReads).toBe(0);
    expect(sends).toEqual([]); expect(fetchCalls).toEqual([]);
  });
}
