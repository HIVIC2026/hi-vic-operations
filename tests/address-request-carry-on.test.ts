// Final review C2 (plan 2026-10-28, full address required): a job held for the owner's full address carries on by
// itself. End to end with the REAL code: the sweep sends the address request email (real guarded sender, stubbed email
// service), Save my spot is held, the owner picks their address on the REAL owner page server function, and the REAL
// automatic router then sends Save my spot. In-memory database and a stubbed fetch only: no network, no real email.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
let seq = 0;
const AUTO_RULES = { version: 1, enabled: true, activatedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "test",
  rules: { eligibility: { enabled: false, outcomes: [] }, insulation: { enabled: false, values: [] },
    ceilingArea: { enabled: false, minM2: null, maxM2: null, includeUnknownArea: false },
    postcode: { enabled: false, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null },
    jobStatus: { enabled: false, stages: [] }, enquiryDate: { enabled: false, window: "last_3_days", fromDate: null, toDate: null } } };
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let values: unknown = null; let returning = false;
  let exactCount = false, headOnly = false; let lim = Infinity;
  const orders: { col: string; asc: boolean }[] = [];
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => kind === "eq" ? get(r, k) === v : kind === "neq" ? get(r, k) !== v : kind === "in" ? (v as unknown[]).includes(get(r, k)) : kind === "is" ? (get(r, k) ?? null) === v : true);
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "insert") {
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      for (const r of list) if (table === "customer_email_sends" && rows().some((x) => x.idempotency_key === r.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const added = list.map((r) => ({ id: `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...(table === "customer_email_sends" ? { status: "sending", error: null, sent_at: null, provider: null, provider_message_id: null } : {}), ...r }));
      rows().push(...added); return { data: added, error: null };
    }
    if (op === "update") {
      const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    let hit = rows().filter(match);
    for (const o of [...orders].reverse()) hit = [...hit].sort((x, y) => String(get(x, o.col)).localeCompare(String(get(y, o.col))) * (o.asc ? 1 : -1));
    const count = hit.length;
    hit = hit.slice(0, lim);
    return { data: headOnly ? null : hit, error: null, count: exactCount ? count : null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (op !== "select") returning = true; else { exactCount = o?.count === "exact"; headOnly = o?.head === true; } return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; }, neq: (k: string, v: unknown) => { f.push([k, "neq", v]); return q; },
    like: () => q, not: () => q, gte: () => q, or: () => q, range: () => q,
    order: (c: string, o?: { ascending?: boolean }) => { orders.push({ col: c, asc: o?.ascending !== false }); return q; },
    limit: (n: number) => { lim = n; return q; },
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
// Server functions run their handler directly (same stand-in as the other server-fn tests).
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (fn: typeof validate) => { validate = fn; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => (a: { data: unknown }) => h({ data: validate(a.data), context: {} }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"u".repeat(32)}`;
const realSafety = await import("../src/lib/emailsafety.server");
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, unsubscribeUrlForJob: async () => UNSUB }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
// Owner link already exists (seeded); link creation / estimate refresh are not under test.
mock.module("../src/lib/estimatelink.server", () => ({ ensureOwnerLink: async () => true, syncStep3: async () => ({}) }));
const realComms = await import("../src/lib/comms.server");
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async () => "comm-1" }));
// The text goes through the one real SMS sender in production; here it simply reports "sent" (texts are not under test).
const realSms = await import("../src/lib/sms.server");
mock.module("../src/lib/sms.server", () => ({ ...realSms, sendRealSms: async () => ({ status: "sent", detail: "ok", sid: "SM1" }) }));
mock.module("../src/lib/address-lookup.server", () => ({
  searchAddressSuggestions: async () => [],
  lookupAddressDetails: async (id: string) => id === "vic" ? { label: "12 Wattle St, Brighton VIC 3186", street: "12 Wattle St", suburb: "Brighton", postcode: "3186", state: "VIC", country: "AU", provider: "google_places_au", latitude: null, longitude: null } : null,
}));

// ---------- stubbed email service ----------
const calls: { idem: string; to: string; subject: string }[] = [];
globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string | string[]; subject?: string };
  calls.push({ idem: headers["Idempotency-Key"] ?? "", to: String(Array.isArray(body.to) ? body.to[0] : body.to), subject: String(body.subject ?? "") });
  return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
}) as typeof fetch;
process.env["RESEND_API_KEY"] = "local-test-not-real";
process.env["LOVABLE_API_KEY"] = "local-test-not-real";

const { sweepAddressRequests } = await import("../src/lib/address-request.server");
const { saveOwnerAddress } = await import("../src/lib/address-request.functions");
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { ADDRESS_REQUEST_BLOCK_REASON } = await import("../src/lib/address-request.core");
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");

const J = "a0000000-0000-4000-8000-0000000007c2";
const TOKEN = "T".repeat(43);
const SAVE_SPOT_KEY = `${LAUNCH_CAMPAIGN}:save_my_spot:${J}`;
const REQUEST_KEY = `address-request:v1:${J}`;
const sends = () => (T.customer_email_sends ?? []).map((r) => [r.purpose, r.idempotency_key, r.status]);

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  calls.length = 0;
  const owner = { id: "o1", full_name: "Sam Sample", email: "sam.sample@example.test", phone: "0400000000" };
  const property = { id: "p1", address_line: "Brighton VIC 3186", suburb: "Brighton", postcode: "3186", state: "VIC", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } };
  Object.assign(T, {
    owners: [owner], properties: [property],
    jobs: [{ id: J, job_number: "HV-9701", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: "2026-10-27T00:00:00Z", deleted_at: null,
      owner_id: "o1", property_id: "p1", eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 120, estimated_area_unknown: false,
      owners: owner, properties: property }],
    customer_estimate_links: [{ id: "l1", job_id: J, token: TOKEN, purpose: "step3_estimate", status: "active", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }],
    veu_location_variables: [{ postcode: "3186" }],
    indicative_estimates: [{ id: "e1", job_id: J, status: "current", area_m2: 120, area_source: "owner_estimate", insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] } }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74 }],
    owner_contact_consents: [{ job_id: J, consent_status: "granted", created_at: "2026-10-01T00:00:00Z" }],
    workflow_settings: [{ id: 1, address_request_live_at: "2026-10-20T00:00:00Z", sms_message_switches: { address_request: true }, save_my_spot_real_send_enabled: true, customer_comms_enabled: true, save_my_spot_auto_rules: AUTO_RULES }],
    customer_email_optouts: [], lead_campaign_responses: [], job_communications: [], customer_email_sends: [], workflow_events: [], sms_messages: [],
    ceiling_measurements: [], property_area_estimates: [], customer_referral_tokens: [], post_intake_work: [], customer_engagement_events: [],
  });
});

describe("held for the full address → owner answers → Save my spot goes by itself", () => {
  test("request sent; Save my spot held; owner saves; the router sends Save my spot once", async () => {
    // 1. The sweep asks the owner (email approved as it will be at go-live).
    expect(await sweepAddressRequests(Date.parse("2026-10-28T01:00:00.000Z"), { approved: { email: true } })).toEqual({ sent: 1, reminded: 0 });
    expect(sends()).toEqual([["address_request", REQUEST_KEY, "sent"]]);
    expect(calls.map((c) => c.idem)).toEqual([REQUEST_KEY]);

    // 2. Meanwhile the automatic router can't send Save my spot: the job is waiting for the address.
    const held = await maybeAutoRouteLeadEmail(J);
    expect(held).toMatchObject({ sent: false, reason: ADDRESS_REQUEST_BLOCK_REASON });
    expect(calls.length).toBe(1);

    // 3. The owner picks their address. The save re-routes the job, and Save my spot goes (the request email is not
    //    counted as a first response).
    expect(await saveOwnerAddress({ data: { token: TOKEN, placeId: "vic" } })).toEqual({ ok: true });
    expect(T.properties![0]).toMatchObject({ address_line: "12 Wattle St", suburb: "Brighton", postcode: "3186" });
    expect(calls.map((c) => c.idem)).toEqual([REQUEST_KEY, SAVE_SPOT_KEY]);
    expect(calls[1]!.to).toBe("sam.sample@example.test");
    expect(sends()).toEqual([["address_request", REQUEST_KEY, "sent"], [LAUNCH_CAMPAIGN, SAVE_SPOT_KEY, "sent"]]);

    // 4. Nothing goes twice: another save or router run sends nothing new.
    expect(await saveOwnerAddress({ data: { token: TOKEN, placeId: "vic" } })).toEqual({ ok: true });
    await maybeAutoRouteLeadEmail(J);
    expect(calls.length).toBe(2);
  });

  test("a real first response (any other email) still blocks the automatic Save my spot", async () => {
    T.customer_email_sends!.push({ id: "prior", job_id: J, purpose: "insulation_video_request", idempotency_key: "older", status: "sent", created_at: "2026-10-27T01:00:00Z" });
    const { initialResponseHistoryBlocker } = await import("../src/lib/initial-response-history.server");
    expect(await initialResponseHistoryBlocker(J)).toBe("Confirmed first response already sent");
    T.customer_email_sends = [{ id: "ask", job_id: J, purpose: "address_request", idempotency_key: REQUEST_KEY, status: "sent", created_at: "2026-10-27T01:00:00Z" },
      { id: "rem", job_id: J, purpose: "address_request_reminder", idempotency_key: "r", status: "delivered_unrecorded", created_at: "2026-10-28T01:00:00Z" }];
    expect(await initialResponseHistoryBlocker(J)).toBeNull();
  });
});
