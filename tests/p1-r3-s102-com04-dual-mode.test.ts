// P1-R3-S102: COM-04 dual-mode (manual + automatic) Save-my-spot remediation — focused tests.
//
// Owner clarification PART 1 (test-recipient boundary) + PART 5 (focused coverage). Extends, and does
// NOT repeat, the happy-path / uncertain / duplicate scenarios already proven in
// tests/save-spot-uncertain-delivery.test.ts (which seeds BOTH switches ON and drives the real
// sendSaveMySpot + maybeAutoRouteLeadEmail with a stubbed provider).
//
// No network, no real provider, no real email/SMS, no switch changed, no migration applied, no
// production access, fictional data only.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
let failWsSelect = false; // simulate migration-0205 column absent => workflow_settings select errors
let failVeU = false; // simulate veu_location_variables read error => coverage fails closed

function from(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let values: unknown = null;
  let returning = false;
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => (kind === "eq" ? r[k] === v : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : true));
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "select" && table === "workflow_settings" && failWsSelect) return { data: null, error: { message: 'column "save_my_spot_real_send_enabled" does not exist', code: "42703" } };
    if (op === "select" && table === "veu_location_variables" && failVeU) return { data: null, error: { message: "veu read failed" } };
    if (op === "insert") {
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      for (const r of list) if (table === "customer_email_sends" && rows().some((x) => x.idempotency_key === r.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      const added = list.map((r) => ({ id: `${table}-${Math.random()}`, created_at: new Date().toISOString(), ...(table === "customer_email_sends" ? { status: "sending", error: null, sent_at: null } : {}), ...r }));
      rows().push(...added);
      return { data: added, error: null };
    }
    if (op === "update") {
      const hit = rows().filter(match);
      for (const r of hit) Object.assign(r, values as Row);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows().filter(match), error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => { if (op !== "select") returning = true; return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; },
    in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    neq: () => q, not: () => q, gte: () => q, order: () => q, limit: () => q, range: () => q, or: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; },
    update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async () => {}, requireAdmin: async () => {}, transition: async () => {} }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"u".repeat(32)}`, suppressionFor: async () => null }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) }));
const realComms = await import("../src/lib/comms.server");
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async () => "comm-1" }));

const { realSendingOn, sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
const { testRecipientBoundary, commsEnvironment, parseTestRecipientAllowlist, allowlistIsInvalid, isReservedTestRecipient, COMMS_ENV_VAR, TEST_RECIPIENT_ENV } = await import("../src/lib/comms-test-recipient.core");
const { emailSuppression, reservationAllowed } = await import("../src/lib/emailsafety.core");
const { serviceCoverageEstablished } = await import("../src/lib/service-coverage.server");
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");

let fetchCalls = 0;
const origFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = 0;
  failVeU = false;
  failWsSelect = false;
  for (const k of Object.keys(T)) delete T[k]; // isolate in-memory tables per test
  globalThis.fetch = (async () => { fetchCalls++; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = origFetch; delete process.env[COMMS_ENV_VAR]; delete process.env[TEST_RECIPIENT_ENV]; });

const J = "job-s102-1";
const seedJob = (email: string, source = "website") => {
  T["jobs"] = [{ id: J, job_number: "HIV-S102", source, stage: "new_enquiry", created_at: new Date().toISOString(), eligibility_outcome: "likely_eligible", estimated_area_m2: 180, estimated_area_unknown: false, owners: { full_name: "Real Customer", email }, properties: { address_line: "1 Test St", suburb: "Melbourne", postcode: "3000" } }];
};
// P1-R3-S103: automatic Save-my-spot SELECTION must be explicitly enabled (with no extra filters,
// i.e. no additional restriction) for the automatic route to reach the sender. It defaults to
// DISABLED and fails closed; the missing/invalid/unreadable cases are proven in
// tests/p1-r3-s103-office-automatic-sending-rules.test.ts.
const s103AutoRules = { version: 1, enabled: true, activatedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "test",
      rules: { eligibility: { enabled: false, outcomes: [] }, insulation: { enabled: false, values: [] },
        ceilingArea: { enabled: false, minM2: null, maxM2: null, includeUnknownArea: false },
        postcode: { enabled: false, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null },
        jobStatus: { enabled: false, stages: [] }, enquiryDate: { enabled: false, window: "last_3_days", fromDate: null, toDate: null } } };
const switches = (master: boolean, secondary: boolean) => { T["workflow_settings"] = [{ id: 1, customer_comms_enabled: master, save_my_spot_real_send_enabled: secondary, save_my_spot_auto_rules: s103AutoRules }]; };

// ---------------- PART 1: test-recipient boundary ----------------
describe("testRecipientBoundary — environment separation (PART 1.6)", () => {
  test("production (HIVIC_COM04_ENV=production) => boundary inactive regardless of allow-list", () => {
    expect(testRecipientBoundary("real.customer@example.com.au", "website", { env: "production", allowlist: "" })).toEqual({ status: "inactive", restricted: false });
    expect(testRecipientBoundary("real.customer@example.com.au", "website", { env: "PRODUCTION", allowlist: "jo@allow.test" }).status).toBe("inactive");
  });
  test("unset env is NON-production (fail closed), never treated as production", () => {
    expect(commsEnvironment(undefined)).toBe("nonproduction");
    expect(commsEnvironment("")).toBe("nonproduction");
    expect(testRecipientBoundary("real.customer@example.com.au", "website", { env: undefined, allowlist: "" }).status).toBe("blocked");
  });
});

describe("testRecipientBoundary — fail-closed allow-list (PART 1.1)", () => {
  test("missing allow-list => blocked (a real customer is NEVER allowed because the var is absent)", () => {
    const d = testRecipientBoundary("real.customer@example.com.au", "website", { env: "nonproduction", allowlist: undefined });
    expect(d.status).toBe("blocked");
    expect(d.status === "blocked" && d.reason).toContain("missing or empty");
  });
  test("empty allow-list => blocked", () => {
    expect(testRecipientBoundary("real.customer@example.com.au", "website", { env: "nonproduction", allowlist: "  ,, " }).status).toBe("blocked");
  });
  test("invalid allow-list (bad address) => blocked for a real recipient", () => {
    expect(testRecipientBoundary("real.customer@example.com.au", "website", { env: "nonproduction", allowlist: "not-an-email" }).status).toBe("blocked");
    expect(allowlistIsInvalid(parseTestRecipientAllowlist("not-an-email"))).toBe(true);
    expect(allowlistIsInvalid(parseTestRecipientAllowlist("a@b.com, bad"))).toBe(true);
    expect(allowlistIsInvalid(parseTestRecipientAllowlist("a@b.com"))).toBe(false);
  });
});

describe("testRecipientBoundary — recipient decisions (PART 1.2/1.3)", () => {
  const al = "jo@hivic-uat.com"; // a real-shaped, approved test mailbox (NOT a test-shaped address)
  test("allow-listed recipient => allowed", () => {
    expect(testRecipientBoundary("jo@allow.test", "website", { env: "nonproduction", allowlist: al }).status).toBe("allowed");
  });
  test("non-allow-listed recipient => blocked", () => {
    const d = testRecipientBoundary("real.customer@example.com.au", "website", { env: "nonproduction", allowlist: al });
    expect(d.status).toBe("blocked");
    expect(d.status === "blocked" && d.reason).toContain("not on the approved test-recipient list");
  });
  test("test-shaped recipient (example.com) => allowed even without being explicitly listed", () => {
    expect(testRecipientBoundary("someone@example.com", "website", { env: "nonproduction", allowlist: al }).status).toBe("allowed");
  });
  test("does NOT bypass the allow-list merely because source=qa_test (PART 1.3)", () => {
    // The core validates the recipient it is given regardless of source; qa_test redirection to Jo is
    // handled at the wiring layer (TEST sender), not by a source-based bypass here.
    expect(testRecipientBoundary("real.customer@example.com.au", "qa_test", { env: "nonproduction", allowlist: al }).status).toBe("blocked");
    expect(testRecipientBoundary("jo@allow.test", "qa_test", { env: "nonproduction", allowlist: al }).status).toBe("allowed");
  });
  test("empty recipient => blocked", () => {
    expect(testRecipientBoundary("   ", "website", { env: "nonproduction", allowlist: al }).status).toBe("blocked");
  });
});

// ---------------- PART 2/5-B: realSendingOn fail-closed (COM-04 dual switch) ----------------
describe("realSendingOn() fail-closed (PART 5-B 16-19)", () => {
  test("both switches ON => allowed", async () => { switches(true, true); expect(await realSendingOn()).toBe(true); });
  test("master OFF => refused", async () => { switches(false, true); expect(await realSendingOn()).toBe(false); });
  test("secondary OFF => refused", async () => { switches(true, false); expect(await realSendingOn()).toBe(false); });
  test("migration-0205 column missing (select error) => refused (fail closed)", async () => { failWsSelect = true; expect(await realSendingOn()).toBe(false); failWsSelect = false; });
  test("no settings row (read error path) => refused", async () => { T["workflow_settings"] = []; expect(await realSendingOn()).toBe(false); });
});

// ---------------- PART 5-B 20-26: real send paths stay gated, ZERO provider calls ----------------
describe("sendSaveMySpot (Office manual, Resend path) — recipient + switch gating", () => {
  test("secondary switch OFF => blocked, ZERO provider calls", async () => {
    seedJob("real.customer@example.com.au"); switches(true, false); process.env[TEST_RECIPIENT_ENV] = "jo@allow.test";
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.outcome).toBe("blocked");
    expect(res.detail.toLowerCase()).toContain("switched off");
    expect(fetchCalls).toBe(0);
  });
  test("non-production + missing allow-list => blocked, ZERO provider calls (PART 1.1)", async () => {
    seedJob("real.customer@example.com.au"); switches(true, true); delete process.env[TEST_RECIPIENT_ENV];
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.outcome).toBe("blocked");
    expect(res.detail).toContain("test boundary");
    expect(fetchCalls).toBe(0);
  });
  test("non-production + non-allow-listed recipient => blocked, ZERO provider calls", async () => {
    seedJob("real.customer@example.com.au"); switches(true, true); process.env[TEST_RECIPIENT_ENV] = "jo@allow.test";
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.outcome).toBe("blocked");
    expect(res.detail).toContain("test-recipient list");
    expect(fetchCalls).toBe(0);
  });
  test("non-production + allow-listed real recipient passes the boundary (provider reached only if all gates pass)", async () => {
    seedJob("jo@hivic-uat.com"); switches(true, true); process.env[TEST_RECIPIENT_ENV] = "jo@hivic-uat.com";
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.detail ?? "").not.toContain("test boundary");
    expect(res.detail ?? "").not.toContain("test-recipient list");
  });
  test("non-production + test-shaped recipient allowed WITHOUT an allow-list (synthetic flow not broken; still never a real customer)", async () => {
    seedJob("sam.sample@example.test"); switches(true, true); delete process.env[TEST_RECIPIENT_ENV];
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.detail ?? "").not.toContain("test boundary");
    expect(res.detail ?? "").not.toContain("test-recipient list");
    expect(fetchCalls).toBe(0); // no provider configured in this harness
  });
  test("production mode => boundary inactive; recipient is not refused by the boundary", async () => {
    seedJob("real.customer@example.com.au"); switches(true, true); process.env[COMMS_ENV_VAR] = "production"; delete process.env[TEST_RECIPIENT_ENV];
    const [res] = await sendSaveMySpot([J], "office-1");
    expect(res.detail ?? "").not.toContain("test boundary");
    // With no estimate/link seeded it is skipped downstream — but never blocked by the boundary, and
    // (no provider configured) never fetched.
    expect(fetchCalls).toBe(0);
  });
});

// ---------------- PART 5-C 27-30: automatic path stays gated ----------------
test("audit 23 Oct: there is no second automatic Save my spot sender", async () => {
  const m = (await import("../src/lib/hot-leads-send.server")) as Record<string, unknown>;
  expect(m.maybeAutoSendSaveSpot).toBeUndefined();
});

// ---------------- PART 5-A filter evidence (pure rules reused by the sender) ----------------
describe("automatic-send filters — pure rules the sender already applies (PART 5-A 4/6/7/8)", () => {
  const base = { purpose: "step3_estimate" as const, bounced: false, jobSource: "website", jobCreatedAt: new Date().toISOString(), jobsCreatedAfter: new Date(Date.now() - 86_400_000).toISOString() };
  test("Filter 4 contact permission: opted-out / bounced / wrong-stage suppressed", () => {
    expect(emailSuppression({ ...base, optedOut: true, stage: "new_enquiry", recipient: "a@b.com" })).toBe("unsubscribed");
    expect(emailSuppression({ ...base, optedOut: false, bounced: true, stage: "new_enquiry", recipient: "a@b.com" })).toBe("bounced");
    expect(emailSuppression({ ...base, optedOut: false, stage: "complete", recipient: "a@b.com" })).toBe("job_progressed_or_closed");
    expect(emailSuppression({ ...base, optedOut: false, stage: "new_enquiry", recipient: "a@b.com" })).toBeNull();
  });
  test("Filter 6 delivery history: only a clean failure may be retried; sent/in-flight/uncertain block duplicates", () => {
    expect(reservationAllowed(null)).toBe(true);
    expect(reservationAllowed({ status: "failed" })).toBe(true);
    expect(reservationAllowed({ status: "sent" })).toBe(false);
    expect(reservationAllowed({ status: "sending" })).toBe(false);
    expect(reservationAllowed({ status: "delivered_unrecorded" })).toBe(false); // uncertain => never auto-retried
  });
});

// ---------------- PART 2 (final correction): NARROW synthetic check ----------------
describe("test-recipient boundary — ONLY reserved test domains bypass (owner PART 2)", () => {
  test("isReservedTestRecipient: RFC-reserved domains only", () => {
    expect(isReservedTestRecipient("a@example.com")).toBe(true);
    expect(isReservedTestRecipient("a@sub.example.org")).toBe(true);
    expect(isReservedTestRecipient("a@example.net")).toBe(true);
    expect(isReservedTestRecipient("a@something.test")).toBe(true);
    expect(isReservedTestRecipient("a@host.invalid")).toBe(true);
    expect(isReservedTestRecipient("a@localhost")).toBe(true);
  });
  test("NOT treated as synthetic merely for qa / +qa / disposable mailbox", () => {
    expect(isReservedTestRecipient("qa.user@realcompany.com")).toBe(false);
    expect(isReservedTestRecipient("someone+qa@realcompany.com")).toBe(false);
    expect(isReservedTestRecipient("someone@mailinator.com")).toBe(false);
    expect(isReservedTestRecipient("real.customer@example.com.au")).toBe(false); // .com.au is NOT example.com
  });
  test("boundary blocks qa/+qa/mailinator in non-production WITHOUT an allow-list (real-looking)", () => {
    for (const to of ["qa.user@realcompany.com", "someone+qa@realcompany.com", "someone@mailinator.com"]) {
      expect(testRecipientBoundary(to, "website", { env: "nonproduction", allowlist: "" }).status).toBe("blocked");
    }
  });
  test("boundary allows qa/+qa/mailinator only when explicitly allow-listed", () => {
    const al = "qa.user@realcompany.com,someone@mailinator.com";
    expect(testRecipientBoundary("qa.user@realcompany.com", "website", { env: "nonproduction", allowlist: al }).status).toBe("allowed");
    expect(testRecipientBoundary("someone@mailinator.com", "website", { env: "nonproduction", allowlist: al }).status).toBe("allowed");
  });
});

// ---------------- PART 2 (final correction): service-area coverage gate ----------------
const seedOfferSpotJob = (postcode: string | null) => {
  T["jobs"] = [{ id: J, job_number: "HIV-S102", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: new Date().toISOString(), eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 120, estimated_area_unknown: false, owners: { full_name: "Sam Sample", email: "sam.sample@example.test" }, properties: { postcode, address_line: "1 Test St", suburb: "Testville", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } } }];
};

describe("serviceCoverageEstablished (positive coverage only; fail closed)", () => {
  test("recognised VEU Victorian postcode => established", async () => {
    seedOfferSpotJob("3000"); T["veu_location_variables"] = [{ postcode: "3000" }];
    expect(await serviceCoverageEstablished(J)).toBe(true);
  });
  test("unknown postcode (not in VEU table) => NOT established", async () => {
    seedOfferSpotJob("9999"); T["veu_location_variables"] = [{ postcode: "3000" }];
    expect(await serviceCoverageEstablished(J)).toBe(false);
  });
  test("missing postcode => NOT established", async () => {
    seedOfferSpotJob(null); T["veu_location_variables"] = [{ postcode: "3000" }];
    expect(await serviceCoverageEstablished(J)).toBe(false);
  });
  test("VEU read error => NOT established (fail closed)", async () => {
    seedOfferSpotJob("3000"); failVeU = true;
    expect(await serviceCoverageEstablished(J)).toBe(false);
    failVeU = false;
  });
});

describe("automatic Save-my-spot (offer_spot) enforces the coverage gate — the LIVE path", () => {
  test("offer_spot route WITHOUT established coverage => NOT sent (left for Office manual review), ZERO provider calls", async () => {
    seedOfferSpotJob("3000"); switches(true, true); process.env[TEST_RECIPIENT_ENV] = "jo@hivic-uat.com"; // veu NOT seeded => unknown coverage
    const res = await maybeAutoRouteLeadEmail(J);
    expect(res.route).toBe("none");
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("service_area_not_established");
    expect(fetchCalls).toBe(0);
  });
  test("offer_spot route WITH established coverage => proceeds past the gate (not blocked by coverage)", async () => {
    seedOfferSpotJob("3000"); switches(true, true); T["veu_location_variables"] = [{ postcode: "3000" }]; // coverage established
    const res = await maybeAutoRouteLeadEmail(J);
    expect(res.route).toBe("offer_spot"); // reached the send stage
    expect(res.reason).not.toBe("service_area_not_established");
    expect(fetchCalls).toBe(0); // no provider configured here; downstream gates (no link) stop it safely
  });
  test("missing postcode => coverage gate blocks the automatic send, ZERO provider calls", async () => {
    seedOfferSpotJob(null); switches(true, true); T["veu_location_variables"] = [{ postcode: "3000" }];
    const res = await maybeAutoRouteLeadEmail(J);
    expect(res.reason).toBe("service_area_not_established");
    expect(fetchCalls).toBe(0);
  });
});
