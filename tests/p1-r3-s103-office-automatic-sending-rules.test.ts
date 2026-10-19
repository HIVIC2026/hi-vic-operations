// P1-R3-S103: Office-configurable automatic Save-my-spot sending rules — focused tests.
//
// SCOPE: pure validation/matching, the fail-closed server gate, the read-only Office preview, and the
// live `maybeAutoRouteLeadEmail → offer_spot → sendSaveMySpot` integration.
//
// SAFETY: no real provider call (globalThis.fetch is stubbed and counted), no production access, no
// migration applied, no COM-04 switch changed by this file, fictional data only. Every send assertion
// is "ZERO provider calls".
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
const writes: string[] = [];
let failRulesColumn = false; // simulate migration-0206 not applied => the new column select errors
let failVeU = false; // simulate an unreadable VEU coverage table (S102 gate)
let isAdmin = true; // server-side authorisation result from the is_admin RPC

function from(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let values: unknown = null;
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => (kind === "eq" ? r[k] === v : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : kind === "not" ? (r[k] ?? null) !== v : true));
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "select" && table === "workflow_settings" && failRulesColumn) return { data: null, error: { message: 'column "save_my_spot_auto_rules" does not exist', code: "42703" } };
    if (op === "select" && table === "veu_location_variables" && failVeU) return { data: null, error: { message: "veu read failed" } };
    if (op === "insert") {
      writes.push(`insert:${table}`);
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      const added = list.map((r) => ({ id: `${table}-${Math.random()}`, created_at: new Date().toISOString(), status: "sending", ...r }));
      rows().push(...added);
      return { data: added, error: null };
    }
    if (op === "update") {
      writes.push(`update:${table}`);
      const hit = rows().filter(match);
      for (const r of hit) Object.assign(r, values as Row);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    const all = rows().filter(match);
    return { data: all, error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; },
    in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    not: (k: string) => { f.push([k, "not", null]); return q; },
    neq: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, range: () => q, or: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; },
    update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? (r.data ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}

const fakeSupabase = { auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) }, rpc: async (fn: string) => (fn === "is_admin" ? { data: isAdmin, error: null } : { data: null, error: null }) };

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => {} }));
// `createServerFn(...)` chains are unwrapped so the raw handlers can be called directly with a fake
// context. This is what makes the server-side permission test a real behavioural test.
mock.module("@tanstack/react-start", () => {
  const chain: Record<string, unknown> = {};
  chain["middleware"] = () => chain;
  chain["inputValidator"] = (v: unknown) => { chain["_v"] = v; return chain; };
  chain["handler"] = (h: unknown) => h;
  return { createServerFn: () => chain };
});
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"u".repeat(32)}`, suppressionFor: async () => null }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) }));

const core = await import("../src/lib/save-spot-rules.core");
const server = await import("../src/lib/save-spot-rules.server");
const functions = await import("../src/lib/save-spot-rules.functions");
const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { defaultFilters, AUTOMATIC_RULES_VERSION, validateFilters, matchAutomaticRules, lifecycleExclusion, describeRules } = core;

let fetchCalls = 0;
const origFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = 0;
  failRulesColumn = false;
  failVeU = false;
  isAdmin = true;
  writes.length = 0;
  for (const k of Object.keys(T)) delete T[k];
  globalThis.fetch = (async () => { fetchCalls++; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = origFetch; });

// ---------------- helpers ----------------
const JOB = "job-s103-1";
const NOW = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const seedJob = (over: Row = {}) => {
  T["jobs"] = [{
    id: JOB, job_number: "HIV-S103", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready",
    created_at: NOW(), eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false,
    estimated_area_m2: 120, estimated_area_unknown: false, deleted_at: null,
    owners: { full_name: "Sam Sample", email: "sam.sample@example.test" },
    properties: { postcode: "3000", address_line: "1 Test St", suburb: "Testville", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } },
    ...over,
  }];
  T["veu_location_variables"] = [{ postcode: "3000" }];
};
const switches = (master = true, secondary = true) => {
  const ws = (T["workflow_settings"] ??= [{ id: 1 }]);
  Object.assign(ws[0], { customer_comms_enabled: master, save_my_spot_real_send_enabled: secondary });
};
const rulesDoc = (rules: unknown, enabled = true, activatedAt: string | null = ago(3_600_000)) => ({
  version: AUTOMATIC_RULES_VERSION, enabled, rules, updatedAt: NOW(), updatedBy: "admin-1", activatedAt,
});
const setRules = (rules: unknown, enabled = true, activatedAt: string | null = ago(3_600_000)) => {
  const ws = (T["workflow_settings"] ??= [{ id: 1, customer_comms_enabled: true, save_my_spot_real_send_enabled: true }]);
  ws[0]["save_my_spot_auto_rules"] = rulesDoc(rules, enabled, activatedAt);
};
const setRulesDoc = (doc: unknown) => {
  const ws = (T["workflow_settings"] ??= [{ id: 1, customer_comms_enabled: true, save_my_spot_real_send_enabled: true }]);
  ws[0]["save_my_spot_auto_rules"] = doc;
};
const eligible = () => { seedJob(); switches(true, true); setRules(defaultFilters()); };
const R = (over: Row = {}) => ({ ...defaultFilters(), ...over }) as never;
const errs = (input: unknown): string[] => { const v = validateFilters(input); return v.ok ? [] : v.errors; };

// ================= 1. Rule creation & validation =================
describe("rule creation and validation", () => {
  test("a blank rule set is valid and matches everything (no filters = no extra restriction)", () => {
    const v = validateFilters(defaultFilters());
    expect(v.ok).toBe(true);
    expect(describeRules(defaultFilters())).toEqual(["No extra filters — every enquiry the automatic router already allows."]);
  });
  test("a non-object configuration is rejected, never partially applied", () => {
    expect(errs(null).length).toBeGreaterThan(0);
    expect(errs("rules").length).toBeGreaterThan(0);
    expect(errs([1, 2]).length).toBeGreaterThan(0);
  });
  test("an enabled filter with no values is rejected", () => {
    expect(errs(R({ eligibility: { enabled: true, outcomes: [] } }))[0]).toContain("at least one eligibility outcome");
    expect(errs(R({ insulation: { enabled: true, values: [] } }))[0]).toContain("at least one existing-insulation");
    expect(errs(R({ jobStatus: { enabled: true, stages: [] } }))[0]).toContain("at least one job status");
  });
  test("a disabled filter may hold nothing and stays harmless", () => {
    expect(errs(R({ eligibility: { enabled: false, outcomes: [] } }))).toEqual([]);
  });
});

// ================= 2. Unknown / invalid field values =================
describe("unknown field values are errors, never silently dropped", () => {
  test("unknown eligibility outcome / insulation value / job status", () => {
    expect(errs(R({ eligibility: { enabled: true, outcomes: ["maybe_eligible"] } }))[0]).toContain('Unknown eligibility outcome "maybe_eligible"');
    expect(errs(R({ insulation: { enabled: true, values: ["some"] } }))[0]).toContain('Unknown existing-insulation value "some"');
    expect(errs(R({ jobStatus: { enabled: true, stages: ["awaiting_quote_acceptance"] } }))[0]).toContain("not a job status that can receive a Save my spot email");
  });
  test("a closed / on-hold / retired stage can never be configured", () => {
    for (const st of ["cancelled", "complete", "on_hold", "assessment_complete"]) {
      expect(errs(R({ jobStatus: { enabled: true, stages: [st] } }))[0]).toContain("not a job status that can receive a Save my spot email");
    }
  });
  test("unknown enquiry-date window", () => {
    expect(errs(R({ enquiryDate: { enabled: true, window: "last_99_days", fromDate: null, toDate: null } }))[0]).toContain("Unknown enquiry-date window");
  });
  test("non-numeric and out-of-range ceiling areas", () => {
    expect(errs(R({ ceilingArea: { enabled: true, minM2: "big", maxM2: null, includeUnknownArea: false } })).length).toBeGreaterThan(0);
    expect(errs(R({ ceilingArea: { enabled: true, minM2: -5, maxM2: null, includeUnknownArea: false } }))[0]).toContain("between 0 and 5000");
    expect(errs(R({ ceilingArea: { enabled: true, minM2: null, maxM2: 9000, includeUnknownArea: false } }))[0]).toContain("between 0 and 5000");
    expect(errs(R({ ceilingArea: { enabled: true, minM2: 200, maxM2: 100, includeUnknownArea: false } }))[0]).toContain("cannot be greater than the maximum");
  });
  test("postcodes must be 4 digits, ranges ordered, and specific/range cannot be mixed", () => {
    expect(errs(R({ postcode: { enabled: true, mode: "specific", postcodes: ["30"], rangeFrom: null, rangeTo: null } }))[0]).toContain("4-digit");
    expect(errs(R({ postcode: { enabled: true, mode: "range", postcodes: [], rangeFrom: "3999", rangeTo: "3000" } }))[0]).toContain("cannot be after the end postcode");
    expect(errs(R({ postcode: { enabled: true, mode: "range", postcodes: ["3000"], rangeFrom: "3000", rangeTo: "3999" } }))[0]).toContain("not both");
    expect(errs(R({ postcode: { enabled: true, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null } }))[0]).toContain("at least one postcode");
  });
  test("custom enquiry dates must be real and ordered", () => {
    expect(errs(R({ enquiryDate: { enabled: true, window: "custom", fromDate: "2026-10-30", toDate: "2026-10-01" } }))[0]).toContain("cannot be after the end date");
    expect(errs(R({ enquiryDate: { enabled: true, window: "custom", fromDate: "30/10/2026", toDate: null } }))[0]).toContain("real date");
  });
});

// ================= 3. Combination: AND across, OR within =================
const FACTS = { eligibilityOutcome: "likely_eligible", insulation: "none" as const, areaM2: 120, areaUnknown: false, postcode: "3000", stage: "preliminary_estimate_ready", createdAt: NOW() };

describe("filter combination — AND across categories, OR within a category", () => {
  test("OR inside one category: any ticked value matches", () => {
    const rules = validateFilters(R({ eligibility: { enabled: true, outcomes: ["likely_eligible", "needs_onsite_confirmation"] } })).value;
    expect(matchAutomaticRules(FACTS, rules, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, eligibilityOutcome: "does_not_appear_eligible" }, rules, Date.now()).eligible).toBe(false);
  });
  test("AND across categories: every enabled filter must pass", () => {
    const rules = validateFilters(R({
      eligibility: { enabled: true, outcomes: ["likely_eligible"] },
      ceilingArea: { enabled: true, minM2: 100, maxM2: 150, includeUnknownArea: false },
      postcode: { enabled: true, mode: "specific", postcodes: ["3000"], rangeFrom: null, rangeTo: null },
    })).value;
    expect(matchAutomaticRules(FACTS, rules, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 90 }, rules, Date.now()).failedCategories).toEqual(["ceilingArea"]);
    expect(matchAutomaticRules({ ...FACTS, postcode: "3121" }, rules, Date.now()).failedCategories).toEqual(["postcode"]);
    expect(matchAutomaticRules({ ...FACTS, eligibilityOutcome: "needs_onsite_confirmation" }, rules, Date.now()).failedCategories).toEqual(["eligibility"]);
  });
  test("every combination of two filters is reported, not just the first failure", () => {
    const rules = validateFilters(R({
      jobStatus: { enabled: true, stages: ["new_enquiry"] },
      postcode: { enabled: true, mode: "specific", postcodes: ["3121"], rangeFrom: null, rangeTo: null },
    })).value;
    expect(matchAutomaticRules(FACTS, rules, Date.now()).failedCategories.sort()).toEqual(["jobStatus", "postcode"]);
  });
});

// ================= 4. Ceiling-area boundaries and unknown area =================
describe("ceiling area — boundaries and explicit unknown handling", () => {
  const rules = (min: number | null, max: number | null, includeUnknown: boolean) =>
    validateFilters(R({ ceilingArea: { enabled: true, minM2: min, maxM2: max, includeUnknownArea: includeUnknown } })).value;

  test("minimum and maximum are inclusive", () => {
    const r = rules(100, 150, false);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 100 }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 150 }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 99.99 }, r, Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 150.01 }, r, Date.now()).eligible).toBe(false);
  });
  test("an unknown area is excluded by default and included only when explicitly ticked", () => {
    const unknown = { ...FACTS, areaM2: null, areaUnknown: true };
    expect(matchAutomaticRules(unknown, rules(100, 150, false), Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules(unknown, rules(100, 150, true), Date.now()).eligible).toBe(true);
  });
  test("a missing area bound accepts any recorded area", () => {
    const r = rules(null, null, false);
    expect(matchAutomaticRules({ ...FACTS, areaM2: 5000 }, r, Date.now()).eligible).toBe(true);
  });
});

// ================= 5. Postcode, enquiry date, job status, eligibility filtering =================
describe("individual filter behaviour", () => {
  test("specific postcodes match only the listed ones; an unknown postcode never matches", () => {
    const r = validateFilters(R({ postcode: { enabled: true, mode: "specific", postcodes: ["3000", "3121"], rangeFrom: null, rangeTo: null } })).value;
    expect(matchAutomaticRules({ ...FACTS, postcode: "3121" }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, postcode: "3999" }, r, Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules({ ...FACTS, postcode: null }, r, Date.now()).eligible).toBe(false);
  });
  test("a postcode range matches inclusively between the two bounds", () => {
    const r = validateFilters(R({ postcode: { enabled: true, mode: "range", postcodes: [], rangeFrom: "3000", rangeTo: "3999" } })).value;
    expect(matchAutomaticRules({ ...FACTS, postcode: "3000" }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, postcode: "3999" }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, postcode: "4123" }, r, Date.now()).eligible).toBe(false);
  });
  test("enquiry date windows: last 1 / 3 / 7 days and a custom range", () => {
    const window = (w: string, from: string | null = null, to: string | null = null) => validateFilters(R({ enquiryDate: { enabled: true, window: w, fromDate: from, toDate: to } })).value;
    const last1 = window("last_1_day");
    expect(matchAutomaticRules({ ...FACTS, createdAt: ago(60_000) }, last1, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, createdAt: ago(2 * 86_400_000) }, last1, Date.now()).eligible).toBe(false);
    const last3 = window("last_3_days");
    expect(matchAutomaticRules({ ...FACTS, createdAt: ago(2 * 86_400_000) }, last3, Date.now()).eligible).toBe(true);
    const last7 = window("last_7_days");
    expect(matchAutomaticRules({ ...FACTS, createdAt: ago(6 * 86_400_000) }, last7, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, createdAt: ago(8 * 86_400_000) }, last7, Date.now()).eligible).toBe(false);
    const custom = window("custom", "2026-10-01", "2026-10-05");
    expect(matchAutomaticRules({ ...FACTS, createdAt: "2026-10-03T09:00:00.000Z" }, custom, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, createdAt: "2026-09-30T09:00:00.000Z" }, custom, Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules({ ...FACTS, createdAt: null }, custom, Date.now()).eligible).toBe(false);
  });
  test("job status matches only the selected existing enquiry stages", () => {
    const r = validateFilters(R({ jobStatus: { enabled: true, stages: ["new_enquiry", "preliminary_estimate_ready"] } })).value;
    expect(matchAutomaticRules(FACTS, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, stage: "eligibility_review" }, r, Date.now()).eligible).toBe(false);
  });
  test("eligibility filter selects recorded outcomes only", () => {
    const r = validateFilters(R({ eligibility: { enabled: true, outcomes: ["needs_onsite_confirmation"] } })).value;
    expect(matchAutomaticRules(FACTS, r, Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules({ ...FACTS, eligibilityOutcome: "needs_onsite_confirmation" }, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, eligibilityOutcome: null }, r, Date.now()).eligible).toBe(false);
  });
  test("insulation filter ORs the owner's own answer and never infers one", () => {
    const r = validateFilters(R({ insulation: { enabled: true, values: ["none", "unknown"] } })).value;
    expect(matchAutomaticRules(FACTS, r, Date.now()).eligible).toBe(true);
    expect(matchAutomaticRules({ ...FACTS, insulation: "present" }, r, Date.now()).eligible).toBe(false);
    expect(matchAutomaticRules({ ...FACTS, insulation: null }, r, Date.now()).eligible).toBe(false);
  });
});

// ================= 6. Mandatory safety rules can never be disabled =================
describe("mandatory safety rules are not configurable", () => {
  test("closed, cancelled, on-hold and retired stages are always excluded", () => {
    for (const stage of ["cancelled", "complete", "on_hold", "assessment_complete"]) {
      expect(lifecycleExclusion(stage)).toContain("outside automatic Save my spot sending");
    }
    expect(lifecycleExclusion("preliminary_estimate_ready")).toBeNull();
    expect(lifecycleExclusion(null)).toContain("not recorded");
  });
  test("a closed job is blocked by the live gate even with no filters at all", async () => {
    seedJob({ stage: "complete" }); switches(true, true); setRules(defaultFilters());
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("lifecycle");
  });
  test("S102 service-area coverage still blocks an automatic send", async () => {
    seedJob({ properties: { postcode: "9999", enrichment: {} } }); switches(true, true); setRules(defaultFilters());
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot" });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("service_area");
    expect(v.reason).toBe("service_area_not_established");
  });
  test("an unreadable coverage table fails closed", async () => {
    eligible(); failVeU = true;
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot" })).block).toBe("service_area");
    failVeU = false;
  });
  test("a postcode filter match does NOT bypass the coverage gate", async () => {
    // The configured postcode filter matches, but coverage is still unestablished => no automatic send.
    seedJob({ properties: { postcode: "9999", enrichment: {} } }); switches(true, true);
    setRules(R({ postcode: { enabled: true, mode: "specific", postcodes: ["9999"], rangeFrom: null, rangeTo: null } }));
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot" });
    expect(v.block).toBe("service_area");
  });
  test("COM-04 switches are not re-implemented in the gate: the sender still stops the send", async () => {
    // The rules gate never authorises delivery; COM-04 stays owned by sendOne, so the automatic route
    // still reaches the sender and is refused there with the unchanged COM-04 reason.
    eligible(); switches(false, true);
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).allowed).toBe(true);
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("Sending is switched off.");
    expect(fetchCalls).toBe(0);
    switches(true, false);
    expect((await maybeAutoRouteLeadEmail(JOB)).reason).toBe("Sending is switched off.");
    expect(fetchCalls).toBe(0);
  });
  test("an enquiry that is not on the offer_spot route is never auto-selected by rules", async () => {
    eligible();
    const v = await server.automaticSaveSpotGate(JOB, { route: "request_insulation", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("not_offer_spot");
  });
});

// ================= 7. Missing / invalid / unreadable configuration =================
describe("configuration is fail-closed", () => {
  test("no configuration at all (migration 0206 not applied => column error) => no automatic send", async () => {
    seedJob(); switches(true, true); failRulesColumn = true;
    expect((await server.readAutomaticRules()).state).toBe("unreadable");
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("rules_unavailable");
    failRulesColumn = false;
  });
  test("an empty default document ({} => not configured) => no automatic send", async () => {
    seedJob(); switches(true, true); setRulesDoc({});
    expect((await server.readAutomaticRules()).state).toBe("missing");
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).block).toBe("rules_unavailable");
  });
  test("an unknown document version is invalid, never partially applied", async () => {
    seedJob(); switches(true, true);
    setRulesDoc({ ...rulesDoc(defaultFilters()), version: 99 });
    expect((await server.readAutomaticRules()).state).toBe("invalid");
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).block).toBe("rules_unavailable");
  });
  test("an invalid rule inside the document is invalid", async () => {
    seedJob(); switches(true, true);
    setRulesDoc(rulesDoc(R({ eligibility: { enabled: true, outcomes: ["nonsense"] } })));
    const read = await server.readAutomaticRules();
    expect(read.state).toBe("invalid");
    expect(read.state === "invalid" && read.reason).toContain("Unknown eligibility outcome");
  });
  test("a document with no filters row is invalid", async () => {
    seedJob(); switches(true, true);
    setRulesDoc({ version: AUTOMATIC_RULES_VERSION, enabled: true, updatedAt: NOW() });
    expect((await server.readAutomaticRules()).state).toBe("invalid");
  });
});

// ================= 8. Save / edit / resave =================
describe("saving rules", () => {
  test("a saved document records version, actor, timestamp and a fresh activation", () => {
    const c = server.prepareRulesForSave({ rules: R({ eligibility: { enabled: true, outcomes: ["likely_eligible"] } }), enabled: true, previousEnabled: false, previousActivatedAt: null, actorId: "admin-1" });
    expect(c.version).toBe(AUTOMATIC_RULES_VERSION);
    expect(c.enabled).toBe(true);
    expect(c.updatedBy).toBe("admin-1");
    expect(Date.parse(c.updatedAt ?? "")).toBeGreaterThan(0);
    expect(Date.parse(c.activatedAt ?? "")).toBeGreaterThan(0);
    expect(validateFilters(c.rules).ok).toBe(true);
  });
  test("editing while already enabled keeps the original activation (no accidental reset)", () => {
    const first = server.prepareRulesForSave({ rules: defaultFilters(), enabled: true, previousEnabled: false, previousActivatedAt: null, actorId: "admin-1" });
    const edited = server.prepareRulesForSave({ rules: R({ postcode: { enabled: true, mode: "specific", postcodes: ["3000"], rangeFrom: null, rangeTo: null } }), enabled: true, previousEnabled: true, previousActivatedAt: first.activatedAt, actorId: "admin-2" });
    expect(edited.activatedAt).toBe(first.activatedAt);
    expect(edited.updatedBy).toBe("admin-2");
  });
  test("switching off keeps the last activation as history but can never use it", async () => {
    const first = server.prepareRulesForSave({ rules: defaultFilters(), enabled: true, previousEnabled: false, previousActivatedAt: null, actorId: "admin-1" });
    const off = server.prepareRulesForSave({ rules: defaultFilters(), enabled: false, previousEnabled: true, previousActivatedAt: first.activatedAt, actorId: "admin-1" });
    expect(off.enabled).toBe(false);
    expect(off.activatedAt).toBe(first.activatedAt);
    eligible(); setRules(defaultFilters(), false, off.activatedAt);
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).block).toBe("selection_disabled");
  });
  test("an invalid rule set is rejected before anything is written", () => {
    expect(() => server.prepareRulesForSave({ rules: R({ eligibility: { enabled: true, outcomes: ["bogus"] } }), enabled: true, previousEnabled: false, previousActivatedAt: null, actorId: "admin-1" })).toThrow("Unknown eligibility outcome");
  });
  test("a saved rule set is read back and then applied by the live gate", async () => {
    eligible();
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).allowed).toBe(true);
    setRules(R({ postcode: { enabled: true, mode: "specific", postcodes: ["3121"], rangeFrom: null, rangeTo: null } }));
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("rule_mismatch");
    expect(v.failedCategories).toEqual(["postcode"]);
  });
});

// ================= 9. No historical backlog =================
describe("no historical backlog from a rule change", () => {
  test("an enquiry created before activation is not sent automatically", async () => {
    seedJob({ created_at: ago(30 * 86_400_000) }); switches(true, true); setRules(defaultFilters(), true, ago(86_400_000));
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("historical");
  });
  test("switching selection off then on again re-stamps activation and still excludes older enquiries", async () => {
    seedJob({ created_at: ago(3 * 86_400_000) }); switches(true, true); setRules(defaultFilters(), true, NOW());
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).block).toBe("historical");
  });
  test("an enquiry created after activation is selected", async () => {
    seedJob({ created_at: NOW() }); switches(true, true); setRules(defaultFilters(), true, ago(86_400_000));
    expect((await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true })).allowed).toBe(true);
  });
  test("a missing enquiry date can never be treated as newer than the activation", async () => {
    seedJob({ created_at: null }); switches(true, true);
    setRules(R({ enquiryDate: { enabled: true, window: "last_7_days", fromDate: null, toDate: null } }));
    const v = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    expect(v.allowed).toBe(false);
    expect(v.block).toBe("historical");
  });
});

// ================= 10. Office preview: read-only, consistent with the live gate =================
const seedPreviewRow = (id: string, over: Row = {}) => {
  T["jobs"].push({
    id, job_number: `HIV-${id.slice(-3)}`, source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready",
    created_at: NOW(), eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false,
    estimated_area_m2: 120, estimated_area_unknown: false, deleted_at: null,
    owners: { full_name: "Sam Sample", email: "sam.sample@example.test" },
    properties: { postcode: "3000", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } },
    ...over,
  });
};

describe("Preview matching customers", () => {
  beforeEach(() => {
    eligible();
    T["customer_delivery_settings"] = [{ id: 1, enabled: true }];
    T["owner_contact_consents"] = [{ job_id: JOB, consent_status: "granted", created_at: NOW() }];
    T["customer_email_optouts"] = [];
    T["customer_email_sends"] = [];
    T["post_intake_work"] = [];
  });

  test("reports matching / mandatory-excluded / manual-review / eligible totals", async () => {
    // A ceiling-area filter (100-200 m²) makes the difference between the four buckets visible.
    setRules(R({ ceilingArea: { enabled: true, minM2: 100, maxM2: 200, includeUnknownArea: false } }));
    seedJob(); // 120 m², consent granted => finally eligible
    seedPreviewRow("job-s103-2"); // 120 m² but no consent on record => mandatory exclusion
    seedPreviewRow("job-s103-3", { estimated_area_m2: null, estimated_area_unknown: true }); // on the route, area unknown => office review
    seedPreviewRow("job-s103-4", { estimated_area_m2: 5000 }); // definite filter mismatch
    T["owner_contact_consents"].push({ job_id: "job-s103-3", consent_status: "granted", created_at: NOW() }, { job_id: "job-s103-4", consent_status: "granted", created_at: NOW() });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.readState).toBe("ok");
    expect(p.scanned).toBe(4);
    expect(p.counts.matching).toBe(2);
    expect(p.counts.eligible).toBe(1);
    expect(p.counts.mandatoryExcluded).toBe(1);
    expect(p.counts.needsOfficeReview).toBe(1);
    expect(p.counts.ruleExcluded).toBe(1);
    expect(p.counts.eligible).toBeLessThanOrEqual(p.counts.matching);
  });

  test("has ZERO side effects: no writes, no idempotency reservation, no provider call", async () => {
    seedJob();
    await server.previewAutomaticSaveSpotMatching();
    expect(writes).toEqual([]);
    expect(fetchCalls).toBe(0);
    expect(T["customer_email_sends"]).toEqual([]);
  });

  test("agrees with the live gate on the same job", async () => {
    seedJob();
    const gate = await server.automaticSaveSpotGate(JOB, { route: "offer_spot", coverageVerified: true });
    const p = await server.previewAutomaticSaveSpotMatching();
    const row = p.rows.find((r) => r.jobId === JOB);
    expect(!!row && row.verdict === "eligible").toBe(gate.allowed);
  });

  test("automatic selection OFF is reported, not hidden", async () => {
    seedJob();
    setRules(defaultFilters(), false, ago(3_600_000));
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.automaticSelectionEnabled).toBe(false);
    expect(p.rows.find((r) => r.jobId === JOB)?.reason).toContain("Automatic Save my spot selection is off");
  });

  test("an existing Save-my-spot send is reported as a duplicate, never re-selected", async () => {
    seedJob();
    T["customer_email_sends"] = [{ job_id: JOB, status: "sent", purpose: "existing_leads_launch_v1" }];
    const p = await server.previewAutomaticSaveSpotMatching();
    const row = p.rows.find((r) => r.jobId === JOB);
    expect(row?.verdict).toBe("mandatory_excluded");
    expect(row?.reason).toContain("already exists");
    expect(writes).toEqual([]);
  });

  test("an opted-out owner is never eligible", async () => {
    seedJob();
    T["customer_email_optouts"] = [{ job_id: JOB, opted_out_at: NOW() }];
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows.find((r) => r.jobId === JOB)?.verdict).toBe("mandatory_excluded");
  });

  test("unreadable mandatory records => fail closed, nothing reported eligible", async () => {
    seedJob();
    failVeU = true;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.counts.eligible).toBe(0);
    failVeU = false;
  });

  test("the list is paginated and reports the page bounds", async () => {
    for (let i = 0; i < 30; i++) seedPreviewRow(`job-s103-p${i}`);
    for (const row of T["jobs"]) if (row.id !== JOB) T["owner_contact_consents"].push({ job_id: row.id, consent_status: "granted", created_at: NOW() });
    const p1 = await server.previewAutomaticSaveSpotMatching(1);
    expect(p1.rows.length).toBe(25);
    expect(p1.pages).toBeGreaterThan(1);
    const p2 = await server.previewAutomaticSaveSpotMatching(2);
    expect(p2.page).toBe(2);
    expect(p2.rows.some((r) => p1.rows.some((x) => x.jobId === r.jobId))).toBe(false);
  });
});

// ================= 11. Live automatic path =================
describe("live automatic path — maybeAutoRouteLeadEmail → offer_spot → sendSaveMySpot", () => {
  test("rules allow it and every mandatory gate passes => reaches the sender, ZERO provider calls", async () => {
    eligible();
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.route).toBe("offer_spot");
    expect(res.reason).not.toContain("service_area_not_established");
    expect(fetchCalls).toBe(0); // no provider configured; the sender stops safely on the missing link
  });
  test("automatic selection OFF => nothing is automatically sent, ZERO provider calls", async () => {
    eligible(); setRules(defaultFilters(), false, ago(3_600_000));
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.route).toBe("none");
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("Automatic Save my spot selection is off");
    expect(fetchCalls).toBe(0);
  });
  test("no saved configuration => nothing is automatically sent, ZERO provider calls", async () => {
    seedJob(); switches(true, true);
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.route).toBe("none");
    expect(res.sent).toBe(false);
    expect(fetchCalls).toBe(0);
  });
  test("an unreadable configuration => nothing is automatically sent, ZERO provider calls", async () => {
    eligible(); failRulesColumn = true;
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.route).toBe("none");
    expect(res.sent).toBe(false);
    expect(fetchCalls).toBe(0);
    failRulesColumn = false;
  });
  test("a rule mismatch => the customer is left for Office manual review, ZERO provider calls", async () => {
    eligible();
    setRules(R({ jobStatus: { enabled: true, stages: ["new_enquiry"] } }));
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.route).toBe("none");
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("Not in a chosen job status");
    expect(fetchCalls).toBe(0);
  });
  test("S102 coverage is still enforced ahead of the rules, ZERO provider calls", async () => {
    seedJob({ properties: { postcode: "9999", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } } });
    switches(true, true); setRules(defaultFilters());
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.reason).toBe("service_area_not_established");
    expect(fetchCalls).toBe(0);
  });
  test("the rules gate never authorises delivery on its own: COM-04 off still stops the send", async () => {
    eligible(); switches(false, false);
    const res = await maybeAutoRouteLeadEmail(JOB);
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("switched off");
    expect(fetchCalls).toBe(0);
  });
  test("Office manual sending is unaffected by these rules", async () => {
    eligible();
    setRules(R({ jobStatus: { enabled: true, stages: ["new_enquiry"] } })); // would block the automatic path
    const [res] = await sendSaveMySpot([JOB], "office-1");
    expect(res.outcome).not.toBe("blocked");
    expect(res.detail ?? "").not.toMatch(/chosen job status|automatic sending rules/i);
    expect(fetchCalls).toBe(0);
  });
});

// ================= 12. Office permissions and audit =================
describe("Office permissions and audit (server side)", () => {
  const fnSource = readFileSync("src/lib/save-spot-rules.functions.ts", "utf8");

  test("every server function requires admin server-side", () => {
    const exported = fnSource.match(/export const \w+ = createServerFn/g)?.length ?? 0;
    expect(exported).toBe(4);
    expect(fnSource.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(exported);
    expect(fnSource).not.toContain("localStorage");
  });

  test("a non-admin cannot save, load, validate or preview", async () => {
    isAdmin = false;
    const ctx = { context: { supabase: fakeSupabase, userId: "someone-else" } };
    await expect((functions.getAutomaticSaveSpotRules as unknown as (a: unknown) => Promise<unknown>)(ctx)).rejects.toThrow("Admin only.");
    await expect((functions.saveAutomaticSaveSpotRules as unknown as (a: unknown) => Promise<unknown>)(ctx)).rejects.toThrow("Admin only.");
    await expect((functions.previewAutomaticSaveSpotMatching as unknown as (a: unknown) => Promise<unknown>)(ctx)).rejects.toThrow("Admin only.");
    await expect((functions.validateAutomaticSaveSpotRules as unknown as (a: unknown) => Promise<unknown>)(ctx)).rejects.toThrow("Admin only.");
    expect(writes).toEqual([]);
    isAdmin = true;
  });

  test("an admin save is permitted and records actor, previous config and new config in admin_config_events", async () => {
    isAdmin = true;
    eligible();
    const ctx = { context: { supabase: fakeSupabase, userId: "admin-1" } };
    const save = functions.saveAutomaticSaveSpotRules as unknown as (a: { context: unknown; data: unknown }) => Promise<{ ok: boolean; enabled: boolean }>;
    const out = await save({ context: ctx.context, data: { rules: R({ postcode: { enabled: true, mode: "specific", postcodes: ["3000"], rangeFrom: null, rangeTo: null } }), enabled: true, previousEnabled: true, previousActivatedAt: ago(3_600_000) } });
    expect(out.ok).toBe(true);
    expect(out.enabled).toBe(true);
    const events = T["admin_config_events"] ?? [];
    expect(events.length).toBe(1);
    expect(events[0]["actor_id"]).toBe("admin-1");
    expect(events[0]["event_type"]).toBe("save_my_spot_auto_rules");
    const details = events[0]["details"] as { previous_config: unknown; new_config: { enabled: boolean } };
    expect(details.previous_config).toBeTruthy();
    expect(details.new_config.enabled).toBe(true);
  });

  test("saving never sends: no provider call and no idempotency reservation", async () => {
    isAdmin = true;
    eligible();
    const save = functions.saveAutomaticSaveSpotRules as unknown as (a: { context: unknown; data: unknown }) => Promise<unknown>;
    await save({ context: { supabase: fakeSupabase, userId: "admin-1" }, data: { rules: defaultFilters(), enabled: true, previousEnabled: false, previousActivatedAt: null } });
    expect(fetchCalls).toBe(0);
    expect(T["customer_email_sends"] ?? []).toEqual([]);
  });
});

// ================= 13. Proposed migration is a proposal, not applied =================
describe("storage proposal", () => {
  test("the rule document is one proposed column on the existing settings singleton", () => {
    const sql = readFileSync("docs/pending-migrations/0206_save_my_spot_auto_rules.sql", "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS save_my_spot_auto_rules jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(sql).toContain("Empty object = not configured");
    expect(readFileSync("docs/pending-migrations/README_DO_NOT_APPLY.md", "utf8")).toContain("DO NOT APPLY AUTOMATICALLY");
  });
});