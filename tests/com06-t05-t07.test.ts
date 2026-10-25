// COM-06 (P1-R3-COM-06-INTEGRATION-GATE-01) WORKSTREAM B — executable T05/T06/T07.
// Fully isolated: in-memory admin DB + stubbed fetch. No network, no real provider, no real credentials.
// The two communication switches are ON in the fixture (save_my_spot_real_send_enabled=true,
// customer_comms_enabled=true) so COM-04's runtime realSendingOn() returns true and the real send
// path is exercised against the stub provider.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
let seq = 0;
const writes: string[] = [];

// P1-R3-S103: automatic Save-my-spot SELECTION must be explicitly enabled (with no extra filters,
// i.e. no additional restriction) for the automatic route to reach the sender. It defaults to
// DISABLED and fails closed; missing / invalid / unreadable configurations are proven in
// tests/p1-r3-s103-office-automatic-sending-rules.test.ts.
const S103_AUTO_RULES = { version: 1, enabled: true, activatedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "test",
  rules: { eligibility: { enabled: false, outcomes: [] }, insulation: { enabled: false, values: [] },
    ceilingArea: { enabled: false, minM2: null, maxM2: null, includeUnknownArea: false },
    postcode: { enabled: false, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null },
    jobStatus: { enabled: false, stages: [] }, enquiryDate: { enabled: false, window: "last_3_days", fromDate: null, toDate: null } } };
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let values: unknown = null; let returning = false;
  let exactCount = false, headOnly = false; // PostgREST count: "exact" / head (fakes predate the senders' exact counts)
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => kind === "eq" ? r[k] === v : kind === "neq" ? r[k] !== v : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : kind === "like" ? String(r[k] ?? "").startsWith(String(v).replace(/%$/, "")) : true);
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "insert") {
      writes.push(`insert:${table}`);
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      for (const r of list) {
        if (table === "customer_email_sends" && rows().some((x) => x.idempotency_key === r.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      const added = list.map((r) => ({ id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...(table === "customer_email_sends" ? { status: "sending", error: null, sent_at: null, provider: null, provider_message_id: null } : {}), ...r }));
      rows().push(...added); return { data: added, error: null };
    }
    if (op === "update") {
      writes.push(`update:${table}`);
      const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    const hit = rows().filter(match);
    return { data: headOnly ? null : hit, error: null, count: exactCount ? hit.length : null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (op !== "select") returning = true; else { exactCount = o?.count === "exact"; headOnly = o?.head === true; } return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    like: (k: string, pat: string) => { f.push([k, "like", pat]); return q; },
    neq: (k: string, v: unknown) => { f.push([k, "neq", v]); return q; }, not: () => q, gte: () => q, order: () => q, limit: () => q, range: () => q, or: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
const events: { type: string; details: Row }[] = [];
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Row) => { events.push({ type, details }); }, requireAdmin: async () => {}, transition: async () => {} }));
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"u".repeat(32)}`;
const realSafety = await import("../src/lib/emailsafety.server");
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, unsubscribeUrlForJob: async () => UNSUB }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) }));
const realComms = await import("../src/lib/comms.server");
const comms: Row[] = [];
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async (x: Row) => { comms.push(x); return "comm-1"; } }));

type Mode = "ok" | "422" | "hang";
let mode: Mode = "ok";
const calls: { url: string; idem: string }[] = [];
globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url: String(u), idem: headers["Idempotency-Key"] ?? "" });
  if (mode === "ok") return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
  if (mode === "hang") return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason ?? new DOMException("timeout", "TimeoutError"))));
  return new Response(JSON.stringify({ message: `fake ${mode}` }), { status: Number(mode) });
}) as typeof fetch;
process.env["RESEND_API_KEY"] = "com06-local-test-not-real";
process.env["LOVABLE_API_KEY"] = "com06-local-test-not-real";

const S = await import("../src/lib/hot-leads-send.server");
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");

const J = "b0000000-0000-4000-8000-0000000006b2";
const KEY = `${LAUNCH_CAMPAIGN}:save_my_spot:${J}`;
const sendRow = () => (T.customer_email_sends ?? []).find((r) => r.idempotency_key === KEY) ?? null;
const auto = () => maybeAutoRouteLeadEmail(J);

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  mode = "ok"; calls.length = 0; events.length = 0; comms.length = 0; writes.length = 0;
  Object.assign(T, {
    jobs: [{ id: J, job_number: "HV-9606", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: "2026-10-01T00:00:00Z", deleted_at: null,
      eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 120, estimated_area_unknown: false,
      owners: { full_name: "COM06 Sample", email: "com06.sample@example.test" }, properties: { address_line: "6 Gate Street", suburb: "Testville", postcode: "3000", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } } }],
    customer_estimate_links: [{ id: "l6", job_id: J, token: "T6".repeat(43), purpose: "step3_estimate", status: "active", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }], // a usable link has a future expiry (sender since 20 Oct)
    veu_location_variables: [{ postcode: "3000" }], // S102: establish service coverage for the automatic offer_spot send
    indicative_estimates: [{ id: "e6", job_id: J, status: "current", area_m2: 120, area_source: "owner_estimate", insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] } }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74 }],
    owner_contact_consents: [{ job_id: J, consent_status: "granted", created_at: "2026-10-01T00:00:00Z" }],
    // T05 core: BOTH communication switches ON in an isolated fixture.
    workflow_settings: [{ id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: true, save_my_spot_auto_rules: S103_AUTO_RULES }],
    customer_email_optouts: [], lead_campaign_responses: [], job_communications: [], customer_email_sends: [], ceiling_measurements: [], property_area_estimates: [], customer_referral_tokens: [], post_intake_work: [],
  });
});

describe("T05: both switches ON, mocked provider sends exactly once", () => {
  test("automatic trigger -> one provider call; row recorded as sent with provider id; later triggers skip without provider calls", async () => {
    await auto();
    expect(calls.length).toBe(1);
    expect(sendRow()).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "re_1", error: null });
    expect(typeof sendRow()!.sent_at).toBe("string");
    expect(calls[0]!).toMatchObject({ url: "https://connector-gateway.lovable.dev/resend/emails", idem: KEY });
    // second automatic trigger, same event: no second provider call
    await auto();
    expect(calls.length).toBe(1);
  });

  test("Office send button on the same eligible job -> exactly one provider call, then skipped", async () => {
    const [r1] = await S.sendSaveMySpot([J], "office-1");
    expect(r1!.outcome).toBe("sent");
    expect(calls.length).toBe(1);
    const [r2] = await S.sendSaveMySpot([J], "office-1");
    expect(r2!.outcome).toBe("skipped");
    expect(calls.length).toBe(1);
  });
});

describe("T06: duplicate eligibility does not produce duplicate sends", () => {
  test("same eligible event submitted twice -> one reservation, one provider call", async () => {
    const first = await auto();
    const second = await auto();
    expect(calls.length).toBe(1);
    expect(sendRow()).toMatchObject({ status: "sent" });
    void first; void second;
  });

  test("post-intake automatic route and Office button both fire for same job -> still one send", async () => {
    await auto();
    expect(calls.length).toBe(1);
    const [r] = await S.sendSaveMySpot([J], "office-1");
    expect(r!.outcome).toBe("skipped");
    expect(calls.length).toBe(1);
  });
});

describe("T07: repeated webhook / retry does not produce duplicate sends", () => {
  test("webhook repeated while first send in flight -> second trigger skipped, one provider call", async () => {
    mode = "hang";
    const first = S.sendSaveMySpot([J], "office-1");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(1);
    expect(calls[0]!.idem).toBe(KEY);
    // repeated webhook while in flight is suppressed
    await auto();
    expect(calls.length).toBe(1);
    void first;
  }, 30_000);

  test("confirmed provider failure -> retry sends exactly once more; success suppresses further retries", async () => {
    mode = "422";
    await auto();
    expect(calls.length).toBe(1);
    expect(sendRow()!.status).toBe("failed");
    // repeated webhook while failed: exactly one re-send (the failed row is retryable)
    mode = "ok";
    await auto();
    expect(calls.length).toBe(2);
    expect(sendRow()!.status).toBe("sent");
    // further repeats do not send again
    await auto();
    expect(calls.length).toBe(2);
  });

  test("idempotency key uniqueness blocks a duplicate row insert even if retried", async () => {
    mode = "422";
    await auto();
    expect(calls.length).toBe(1);
    // racing two triggers on the same failed row: only one re-reserves and calls the provider
    mode = "ok";
    await Promise.all([auto(), auto()]);
    expect(calls.length).toBe(2);
  });
});
