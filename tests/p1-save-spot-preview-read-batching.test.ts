// P1-R1-S111 regression suite — Save My Spot "Preview matching customers".
//
// Covers the owner-reported defect (every row "Mandatory records could not be read.") and the two
// follow-on correctness defects: a database READ FAILURE being reported as a mandatory-rule EXCLUSION,
// and filter mismatches being counted as mandatory exclusions.
//
// SAFETY: in-memory Supabase mock only. No network, no provider call, no real database, no migration,
// no COM-04 change, no send. Deterministic fixtures. Covers required cases A-I.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
const writes: string[] = [];
/** Every `.in(column, values)` the code issues, recorded so batch size can be asserted. */
const inCalls: { table: string; column: string; count: number }[] = [];
/** Mandatory tables whose Nth request should fail (1-based), to simulate a partial batch failure. */
const failRequestOf: Record<string, number> = {};
const requestNo: Record<string, number> = {};

function from(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let values: unknown = null;
  const f: [string, string, unknown][] = [];
  const match = (r: Row) =>
    f.every(([k, kind, v]) => {
      if (kind === "eq") return r[k] === v;
      if (kind === "in") return (v as unknown[]).includes(r[k]);
      if (kind === "is") return (r[k] ?? null) === v;
      return (r[k] ?? null) !== v;
    });
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "select") {
      const n = (requestNo[table] = (requestNo[table] ?? 0) + 1);
      if (failRequestOf[table] && n === failRequestOf[table]) {
        return { data: null, error: { message: `simulated gateway rejection on ${table} request ${n}` } };
      }
    }
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
    return { data: rows().filter(match), error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; },
    in: (k: string, v: unknown[]) => { f.push([k, "in", v]); inCalls.push({ table, column: k, count: v.length }); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    not: (k: string) => { f.push([k, "not", null]); return q; },
    neq: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, range: () => q, or: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; },
    update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) },
}));

const server = await import("../src/lib/save-spot-rules.server");
const core = await import("../src/lib/save-spot-rules.core");

const NOW = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const BATCH = server.MANDATORY_BATCH_SIZE;

/** A job that passes every preview-level mandatory check. */
function goodJob(id: string, over: Row = {}) {
  return {
    id,
    job_number: `HIV-${id.slice(-4)}`,
    source: "base44",
    channel: "hivic_sourced",
    stage: "preliminary_estimate_ready",
    created_at: NOW(),
    eligibility_outcome: "likely_eligible",
    eligibility_decision_source: "system",
    eligibility_review_required: false,
    estimated_area_m2: 120,
    estimated_area_unknown: false,
    deleted_at: null,
    owners: { full_name: "Sam Sample", email: "sam.sample@example.test" },
    properties: { postcode: "3000", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } },
    ...over,
  };
}

/** n jobs, all matching the default (no) filters, all consent-granted, all covered. */
function seedJobs(n: number) {
  T["jobs"] = Array.from({ length: n }, (_, i) => goodJob(`job-${String(i).padStart(4, "0")}`));
  T["owner_contact_consents"] = T["jobs"].map((j) => ({ job_id: j.id, consent_status: "granted", created_at: NOW() }));
  T["customer_email_optouts"] = [];
  T["customer_email_sends"] = [];
  T["post_intake_work"] = [];
  T["veu_location_variables"] = [{ postcode: "3000" }];
}

function setRules(rules: unknown, enabled = true) {
  T["workflow_settings"][0]["save_my_spot_auto_rules"] = {
    version: core.AUTOMATIC_RULES_VERSION,
    enabled,
    activatedAt: ago(3_600_000),
    updatedAt: NOW(),
    updatedBy: "test",
    rules,
  };
}

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  writes.length = 0;
  inCalls.length = 0;
  for (const k of Object.keys(failRequestOf)) delete failRequestOf[k];
  for (const k of Object.keys(requestNo)) delete requestNo[k];
  T["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, save_my_spot_real_send_enabled: true }];
  T["customer_delivery_settings"] = [{ id: 1, enabled: true }];
  setRules(core.defaultFilters());
  seedJobs(4);
});

const maxIdsPerRequest = () => inCalls.reduce((m, c) => Math.max(m, c.count), 0);
const idsFor = (column: string) => inCalls.filter((c) => c.column === column).map((c) => c.count);
const idsForTable = (table: string, column = "job_id") => inCalls.filter((c) => c.table === table && c.column === column).map((c) => c.count);

// ============================================================ A. SMALL DATASET
describe("A. small dataset — existing behaviour remains correct", () => {
  test("matching, fully-covered enquiries are reported ready for the final sender checks", async () => {
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.scanned).toBe(4);
    expect(p.counts.eligible).toBe(4);
    expect(p.counts.mandatoryExcluded).toBe(0);
    expect(p.counts.ruleExcluded).toBe(0);
    expect(p.counts.recordsUnavailable).toBe(0);
    expect(p.recordsUnavailable).toBe(false);
    expect(p.recordsError).toBeNull();
    expect(p.rows[0]?.verdict).toBe("eligible");
    expect(p.rows[0]?.reason).toContain("final sending checks");
  });

  test("one id list per source, well under the batch limit", async () => {
    await server.previewAutomaticSaveSpotMatching();
    expect(idsFor("postcode").length).toBe(1);
    // four job-id sources (consents, opt-outs, sends, intake work), one request each at 4 ids
    expect(idsFor("job_id").length).toBe(4);
    expect(Math.max(...idsFor("job_id"))).toBe(4);
    expect(maxIdsPerRequest()).toBeLessThanOrEqual(BATCH);
  });
});

// ============================================================ B. 150 ENQUIRIES
describe("B. 150 enquiries — within the configured batch limit", () => {
  test("150 ids stay in a single request and every batch result is used", async () => {
    seedJobs(150);
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(maxIdsPerRequest()).toBeLessThanOrEqual(BATCH);
    expect(p.scanned).toBe(150);
    expect(p.counts.eligible).toBe(150);
  });
});

// ============================================================ C. 500 ENQUIRIES
describe("C. 500 enquiries — bounded, complete and correctly combined", () => {
  test("no job-id or postcode request carries more than 150 ids", async () => {
    seedJobs(500);
    await server.previewAutomaticSaveSpotMatching();
    expect(Math.max(...idsFor("job_id"))).toBeLessThanOrEqual(BATCH);
    expect(Math.max(...idsFor("postcode"))).toBeLessThanOrEqual(BATCH);
    // 500 ids => 4 requests of 150/150/150/50 for EVERY source, interleaved by the 5 parallel reads.
    for (const table of ["owner_contact_consents", "customer_email_optouts", "customer_email_sends", "post_intake_work"]) {
      expect(idsForTable(table)).toEqual([150, 150, 150, 50]);
    }
    // one distinct postcode => a single bounded request
    expect(idsForTable("veu_location_variables", "postcode")).toEqual([1]);
    // the status list on post_intake_work is a fixed 3-value list, also bounded
    expect(idsForTable("post_intake_work", "status")).toEqual([3, 3, 3, 3]);
    expect(Math.max(...inCalls.map((c) => c.count))).toBeLessThanOrEqual(BATCH);
  });

  test("all batches are processed and results are combined across batch boundaries", async () => {
    seedJobs(500);
    // Only the LAST job has consent — proves request 4 of the consent source was read, not just request 1.
    T["owner_contact_consents"] = [{ job_id: "job-0499", consent_status: "granted", created_at: NOW() }];
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.scanned).toBe(500);
    expect(p.counts.mandatoryExcluded).toBe(499);
    expect(p.counts.eligible).toBe(1);
    expect(p.counts.recordsUnavailable).toBe(0);
    expect(p.rows.find((r) => r.jobId === "job-0000")?.verdict).toBe("mandatory_excluded");
    // job-0499 sits in the LAST consent batch and lands on the last page
    const last = await server.previewAutomaticSaveSpotMatching(20);
    expect(last.page).toBe(20);
    expect(last.rows.find((r) => r.jobId === "job-0499")?.verdict).toBe("eligible");
  });

  test("a filter only some rows match is applied across all batches", async () => {
    seedJobs(500);
    setRules({ ...core.defaultFilters(), jobStatus: { enabled: true, stages: ["new_enquiry"] } });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.counts.matching).toBe(0);
    expect(p.counts.ruleExcluded).toBe(500);
    expect(p.counts.mandatoryExcluded).toBe(0); // <-- the reported defect: 500 exclusions, 0 matches
  });
});

// ============================================================ D. PARTIAL BATCH FAILURE
describe("D. partial batch failure — fail closed, visible, never a false 'ready'", () => {
  test("one failing consent request makes the whole preview undetermined", async () => {
    seedJobs(500);
    failRequestOf["owner_contact_consents"] = 2;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.recordsUnavailable).toBe(true);
    expect(p.recordsError).toContain("owner contact consents");
    expect(p.recordsError).toContain("1 of 4 batches failed");
    expect(p.counts.recordsUnavailable).toBe(500);
    expect(p.counts.eligible).toBe(0);
    expect(p.counts.mandatoryExcluded).toBe(0);
    expect(p.rows.every((r) => r.verdict === "records_unavailable")).toBe(true);
    expect(p.rows[0]?.reason).toContain("could not be read");
  });

  test("a failing coverage request is reported by name and still blocks any ready verdict", async () => {
    seedJobs(400);
    failRequestOf["veu_location_variables"] = 1;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.recordsUnavailable).toBe(true);
    expect(p.recordsError).toContain("VEU service coverage");
    expect(p.counts.eligible).toBe(0);
    expect(p.counts.recordsUnavailable).toBe(400);
  });

  test("every mandatory source is covered by the failure handling", async () => {
    for (const table of ["owner_contact_consents", "customer_email_optouts", "customer_email_sends", "post_intake_work", "veu_location_variables"]) {
      for (const k of Object.keys(failRequestOf)) delete failRequestOf[k];
      for (const k of Object.keys(requestNo)) delete requestNo[k];
      seedJobs(300);
      failRequestOf[table] = 1;
      const p = await server.previewAutomaticSaveSpotMatching();
      expect(p.recordsUnavailable).toBe(true);
      expect(p.recordsError).toContain(table === "veu_location_variables" ? "VEU service coverage" : table);
      expect(p.counts.eligible).toBe(0);
    }
  });

  test("filter mismatch stays classifiable while mandatory records are unavailable", async () => {
    // The configurable filters come from job data that WAS read, so these stay accurate.
    seedJobs(200);
    T["jobs"][0] = goodJob("job-0000", { estimated_area_m2: 9999 });
    setRules({ ...core.defaultFilters(), ceilingArea: { enabled: true, minM2: 100, maxM2: 200, includeUnknownArea: false } });
    failRequestOf["owner_contact_consents"] = 1;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.recordsUnavailable).toBe(true);
    expect(p.counts.ruleExcluded).toBe(1);
    expect(p.counts.recordsUnavailable).toBe(199);
    // The documented invariants still hold with a read failure present.
    expect(p.counts.matching).toBe(199);
    expect(p.counts.matching).toBe(p.counts.eligible + p.counts.mandatoryExcluded + p.counts.recordsUnavailable);
    expect(p.scanned).toBe(p.counts.matching + p.counts.ruleExcluded + p.counts.needsOfficeReview);
  });
});

// ============================================================ E. FILTER MISMATCH
describe("E. filter mismatch is never a mandatory exclusion", () => {
  test("an area filter excludes non-matching enquiries from the mandatory counts", async () => {
    setRules({ ...core.defaultFilters(), ceilingArea: { enabled: true, minM2: 100, maxM2: 200, includeUnknownArea: false } });
    T["jobs"] = [goodJob("job-a"), goodJob("job-b", { estimated_area_m2: 500 }), goodJob("job-c", { estimated_area_m2: 50 })];
    T["owner_contact_consents"] = [];
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.counts.ruleExcluded).toBe(2);
    expect(p.counts.matching).toBe(1);
    expect(p.counts.mandatoryExcluded).toBe(1); // only the matching one, and only because consent is missing
    expect(p.rows.find((r) => r.jobId === "job-b")?.verdict).toBe("rule_excluded");
    expect(p.rows.find((r) => r.jobId === "job-b")?.reason).not.toContain("consent");
  });

  test("the summary counts agree with the row-level outcomes", async () => {
    const p = await server.previewAutomaticSaveSpotMatching();
    const onPage = p.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    }, {});
    for (const [verdict, n] of Object.entries(onPage)) {
      expect(p.counts[verdict as keyof typeof p.counts]).toBe(n);
    }
  });
});

// ============================================================ F. GENUINE MANDATORY EXCLUSION
describe("F. genuine mandatory exclusions stay classified correctly", () => {
  const oneMatching = (over: Row = {}, tables: Record<string, Row[]> = {}) => {
    T["jobs"] = [goodJob("job-x", over)];
    for (const [k, v] of Object.entries(tables)) T[k] = v;
    // consent-granted by default so each test exercises the ONE rule it is about
    if (!tables["owner_contact_consents"]) T["owner_contact_consents"] = [{ job_id: "job-x", consent_status: "granted", created_at: NOW() }];
  };

  test("opt-out", async () => {
    oneMatching({}, { customer_email_optouts: [{ job_id: "job-x", opted_out_at: NOW() }] });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.verdict).toBe("mandatory_excluded");
    expect(p.rows[0]?.reason).toContain("opted out");
  });

  test("duplicate: an existing Save my spot send", async () => {
    oneMatching({}, { customer_email_sends: [{ job_id: "job-x", status: "sent", purpose: "existing_leads_launch_v1" }] });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.reason).toContain("already exists");
  });

  test("coverage: a postcode absent from the VEU table", async () => {
    oneMatching({ properties: { postcode: "9999", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } } });
    T["veu_location_variables"] = [{ postcode: "3000" }];
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.verdict).toBe("mandatory_excluded");
    expect(p.rows[0]?.reason).toBe("service_area_not_established");
  });

  test("lifecycle: a cancelled job", async () => {
    oneMatching({ stage: "cancelled" });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.verdict).toBe("mandatory_excluded");
    expect(p.rows[0]?.reason).toContain("outside automatic Save my spot sending");
  });

  test("COM-04 off", async () => {
    T["workflow_settings"][0]["customer_comms_enabled"] = false;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.verdict).toBe("mandatory_excluded");
    expect(p.rows[0]?.reason).toContain("switched off");
  });

  test("missing consent", async () => {
    oneMatching({}, { owner_contact_consents: [] });
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.reason).toContain("consent");
  });

  test("an unreadable mandatory source is NOT an exclusion — it is records_unavailable", async () => {
    failRequestOf["customer_email_optouts"] = 1;
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.rows[0]?.verdict).toBe("records_unavailable");
    expect(p.rows[0]?.reason).not.toContain("opted out");
  });
});

// ============================================================ G. NORMAL ELIGIBLE PREVIEW
describe("G. a normal eligible preview", () => {
  test("reaches 'matches selection rules, final sender checks pending'", async () => {
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.recordsUnavailable).toBe(false);
    expect(p.counts.eligible).toBe(4);
    expect(p.counts.matching).toBe(4);
    expect(p.rows[0]?.verdict).toBe("eligible");
    expect(p.rows[0]?.reason).toContain("final sending checks");
    expect(p.rows[0]?.reason).toContain("only");
  });
});

// ============================================================ H. AUTOMATIC SELECTION OFF
describe("H. automatic selection OFF", () => {
  test("is reported as a mandatory exclusion and the preview stays read-only", async () => {
    setRules(core.defaultFilters(), false);
    const p = await server.previewAutomaticSaveSpotMatching();
    expect(p.automaticSelectionEnabled).toBe(false);
    expect(p.counts.eligible).toBe(0);
    expect(p.counts.mandatoryExcluded).toBe(4);
    expect(p.rows[0]?.reason).toContain("Automatic Save my spot selection is off");
    expect(writes).toEqual([]);
  });
});

// ============================================================ I. READ-ONLY GUARANTEE
describe("I. read-only guarantee", () => {
  test("no writes, no send rows, no status change — including on a 500-row scan", async () => {
    seedJobs(500);
    await server.previewAutomaticSaveSpotMatching();
    expect(writes).toEqual([]);
    expect(T["customer_email_sends"]).toEqual([]);
    expect(T["jobs"].every((j) => j["stage"] === "preliminary_estimate_ready")).toBe(true);
  });

  test("a failing batch is reported without writing anything", async () => {
    seedJobs(500);
    failRequestOf["owner_contact_consents"] = 3;
    await server.previewAutomaticSaveSpotMatching();
    expect(writes).toEqual([]);
  });
});

// ============================================================ BATCHING PRIMITIVE
describe("readInBatches", () => {
  test("batches at the configured size and combines successful results", async () => {
    const seen: number[] = [];
    const r = await server.readInBatches<{ v: number }>(Array.from({ length: 350 }, (_, i) => `id-${i}`), async (batch) => {
      seen.push(batch.length);
      return { data: batch.map(() => ({ v: 1 })), error: null };
    });
    expect(seen).toEqual([150, 150, 50]);
    expect(r.batches).toBe(3);
    expect(r.failedBatches).toBe(0);
    expect(r.rows.length).toBe(350);
    expect(r.error).toBeNull();
  });

  test("keeps successful rows, counts the failed batch and surfaces its message", async () => {
    const r = await server.readInBatches<{ v: number }>(Array.from({ length: 400 }, (_, i) => `id-${i}`), async (batch) => {
      if (batch[0] === "id-150") return { data: null, error: { message: "boom" } };
      return { data: batch.map(() => ({ v: 1 })), error: null };
    });
    expect(r.batches).toBe(3);
    expect(r.failedBatches).toBe(1);
    expect(r.rows.length).toBe(250); // request 1 (150) + request 3 (100); request 2 dropped, not faked
    expect(r.error).toBe("boom");
  });

  test("the batch size matches the project's existing convention", () => {
    expect(server.MANDATORY_BATCH_SIZE).toBe(150);
  });
});