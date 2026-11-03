// Portal speed step 1, Task 4: Choose installer › To release reads in few sequential rounds ("waves") and returns the same
// value as before — rows, order, areas — and `installerFacts` / `installerOfferFacts` (also used by the Send bar, area
// batches and the Ready Check pop-up) return the same facts. REAL server modules against an in-memory database
// (tests/helpers/memory-postgrest.ts). Run on its own (bun shares mock.module across files in one process).
import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};

// ---- Wave counter: every read waits for the next timer tick; reads issued before that tick share a wave. ----
let wave = 0;
let log: { table: string; wave: number }[] = [];
let pending: (() => void)[] = [];
let scheduled = false;
function flush() { scheduled = false; wave++; const p = pending; pending = []; for (const f of p) f(); }
function from(table: string) {
  const q = memoryPostgrest(tables).from(table);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => new Promise((resolve) => {
    log.push({ table, wave });
    pending.push(() => resolve(q.run()));
    if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  }).then(res, rej);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));

const { loadInstallerWaitingList, installerFacts } = await import("../src/lib/installer-waiting.server");
const { installerOfferFacts } = await import("../src/lib/readycheck-booking.server");
const { noticeEventDetails, COLLECTION_NOTICE_EVENT, COLLECTION_NOTICE_SHA256, COLLECTION_NOTICE_VERSION } = await import("../src/lib/esc-collection-notice.core");
// Modules the loader imports on first use: loaded now so a first module load never splits a wave.
await Promise.all([
  import("../src/lib/readycheck-booking.server"), import("../src/lib/esc-collection-notice.server"), import("../src/lib/spot-release.server"),
  import("../src/lib/spot-release.core"), import("../src/lib/saved-spot-facts.server"), import("../src/lib/sweep-batch.server"),
  import("../src/lib/enquiry.core"), import("../src/lib/eligibility.core"), import("../src/lib/worker-compliance.core"),
  import("../src/lib/worker-role.core"), import("../src/lib/readycheck-booking.core"), import("@/data/vic-postcode-centroids.json"),
]);

async function measured<T>(run: () => Promise<T>) {
  wave = 0; log = []; pending = []; scheduled = false;
  const out = await run();
  return { out, waves: log.length ? Math.max(...log.map((l) => l.wave)) + 1 : 0, log };
}
const wavesOf = (l: typeof log) => [...new Set(l.map((x) => x.wave))].sort((a, b) => a - b).map((w) => `${w + 1}: ${l.filter((x) => x.wave === w).map((x) => x.table).join(", ")}`).join("\n");

// ---- Data ----
const NOW = new Date("2026-11-03T00:00:00.000Z");
const I1 = "00000000-0000-4000-8000-0000000000a1", I2 = "00000000-0000-4000-8000-0000000000a2", I3 = "00000000-0000-4000-8000-0000000000a3";
const I4 = "00000000-0000-4000-8000-0000000000a4", R1 = "00000000-0000-4000-8000-0000000000e1";
const FUTURE = "2027-06-30", PAST = "2026-09-30";

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  const biz = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, trading_name: null, business_type: "eec_installer", capabilities: ["installer"], onboarding_status: "approved", is_active: true,
    service_postcodes: ["3178", "3150"], service_regions: null, coverage_verified_at: "2026-10-01T00:00:00.000Z", accepting_new_jobs: true,
    receives_hivic_leads: true, free_measureups_for_hivic_quote_leads: true, onboarding_notes: null, rec_number: null, covers_all_victoria: false, ...extra,
  });
  const worker = (id: string, businessId: string, email: string | null, extra: Record<string, unknown> = {}) => ({
    id, business_id: businessId, email, full_legal_name: `Worker ${id}`, removed_at: null, trade_role: "installer", approval_status: "approved",
    mobile: null, profile_id: null, worker_role: null, ...extra,
  });
  const ack = (businessId: string, workerId: string | null, email: string | null, at: string) =>
    ({ id: `ev-${workerId ?? email}`, event_type: COLLECTION_NOTICE_EVENT, details: noticeEventDetails({ businessId, workerId, workerEmail: email, byName: "W", source: "my_business", now: new Date(at) }).details });
  const job = (id: string, prop: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, job_number: `HV-${id}`, stage: "ready_check_ready_to_schedule", source: null, channel: "hivic_sourced", created_at: `2026-10-0${id.charCodeAt(0) - 96}T00:00:00.000Z`,
    estimated_area_m2: null, deleted_at: null, qa_archived_at: null, life_support: false, property_id: `p-${id}`, owner_id: `o-${id}`, ...extra,
    _prop: prop,
  });
  const jobs = [
    job("a", { address_line: "12 Smith Street", suburb: "Rowville", postcode: "3178", enrichment: { base44: { declared: { property_type: "house" } } } }, { life_support: true }),
    job("b", { suburb: "Rowville", postcode: "3178", enrichment: { base44: { raw: { answers: { property_type: "unit", top_floor: "yes", existing_insulation: "none" } } } } }),
    job("c", { address_line: "4 Jones Road", suburb: "Glen Waverley", postcode: "3150" }, { estimated_area_m2: 140 }),
    job("d", { suburb: "Nowhere", postcode: "2600" }),
    job("e", { suburb: "Rowville", postcode: "3178" }), // has an installer → not on the list
    job("f", { address_line: "9 Park Lane", suburb: "Glen Waverley", postcode: "3150" }), // offer declined → came back
    job("g", { address_line: "1 High Street", suburb: "Ringwood", postcode: "3134" }), // released, waiting for the owner
    job("h", { suburb: "Melbourne", postcode: "3000" }, { source: "qa_test" }), // TEST job
    job("i", { suburb: "Rowville", postcode: "3178" }, { stage: "quote_sent" }), // wrong stage
  ];
  Object.assign(tables, {
    businesses: [
      biz(I1, "Good Installs"),
      biz(I2, "Lapsed Docs Installs", { business_type: "installer", service_postcodes: ["3150", "3134"] }),
      biz(I3, "Test Installs", { service_postcodes: ["3000"], onboarding_notes: "[TEST PARTNER] practice" }),
      biz(I4, "Sleepy Installs", { is_active: false }),
      biz(R1, "Spark Co", { business_type: "rec", capabilities: ["electrician"], rec_number: "REC1", service_postcodes: ["3178", "3134"] }),
    ],
    business_credentials: [
      { business_id: I1, kind: "public_liability_insurance", label: "Public liability", expires_at: FUTURE, critical: true, verification: "verified" },
      { business_id: I2, kind: "public_liability_insurance", label: "Public liability", expires_at: PAST, critical: false, verification: "verified" },
      { business_id: I3, kind: "public_liability_insurance", label: "Public liability", expires_at: FUTURE, critical: true, verification: "verified" },
      { business_id: R1, kind: "public_liability_insurance", label: "Public liability", expires_at: FUTURE, critical: true, verification: "verified" },
    ],
    electrician_rates: [{ id: "rate1", business_id: R1, service_type: "piesa", rate_inc_gst: 200, status: "active", effective_from: "2026-01-01", effective_to: null }],
    partner_workers: [
      worker("w1", I1, "Ann@I1.example"), // Full, acknowledged (event, by email)
      worker("w2", I1, "bob@i1.example"), // Full, not acknowledged → blocked
      worker("w3", I1, null), // Full by worker id, acknowledged by worker id
      worker("w4", I2, "cat@i2.example"), // Full, acknowledged at onboarding
      worker("w5", I3, "dan@i3.example"), // latest level is not Full
      worker("w6", I3, "eve@i3.example", { removed_at: "2026-10-01T00:00:00.000Z" }), // removed
      worker("w7", I4, "fay@i4.example"),
      worker("x1", R1, "sam@r1.example", { trade_role: "electrician" }),
    ],
    admin_config_events: [ack(I1, "w1", "ann@i1.example", "2026-10-10T00:00:00.000Z"), ack(I1, "w3", null, "2026-10-11T00:00:00.000Z"), ack(I3, "w5", "dan@i3.example", "2026-10-12T00:00:00.000Z")],
    partner_activations: [{ application_id: "app2", business_id: I2 }],
    rec_onboarding_applications: [{ id: "app2", data: { installers: [{ email: "CAT@i2.example", esc_notice_ack: { at: "2026-09-01T00:00:00.000Z", by_name: "Cat", notice_version: COLLECTION_NOTICE_VERSION, notice_sha256: COLLECTION_NOTICE_SHA256 } }] } }],
    partner_worker_certifications: [
      { id: "c1", worker_id: "w1", worker_email: "ann@i1.example", status: "verified", recorded_at: "2026-09-01T00:00:00.000Z" },
      { id: "c2", worker_id: null, worker_email: "bob@i1.example", status: "verified", recorded_at: "2026-09-02T00:00:00.000Z" },
      { id: "c3", worker_id: "w3", worker_email: "nobody@example", status: "verified", recorded_at: "2026-09-03T00:00:00.000Z" },
      { id: "c4", worker_id: null, worker_email: "cat@i2.example", status: "verified", recorded_at: "2026-09-04T00:00:00.000Z" },
      { id: "c5old", worker_id: "w5", worker_email: "dan@i3.example", status: "verified", recorded_at: "2026-08-01T00:00:00.000Z" },
      { id: "c5", worker_id: "w5", worker_email: "dan@i3.example", status: "verified", recorded_at: "2026-09-05T00:00:00.000Z" },
      { id: "c7", worker_id: "w7", worker_email: "fay@i4.example", status: "verified", recorded_at: "2026-09-06T00:00:00.000Z" },
    ],
    worker_certification_levels: [
      { certification_id: "c1", level: "full", expires_on: FUTURE, recorded_at: "2026-09-01T00:00:00.000Z" },
      { certification_id: "c2", level: "full", expires_on: FUTURE, recorded_at: "2026-09-02T00:00:00.000Z" },
      { certification_id: "c3", level: "full", expires_on: FUTURE, recorded_at: "2026-09-03T00:00:00.000Z" },
      { certification_id: "c4", level: "full", expires_on: FUTURE, recorded_at: "2026-09-04T00:00:00.000Z" },
      { certification_id: "c5old", level: "full", expires_on: FUTURE, recorded_at: "2026-08-01T00:00:00.000Z" },
      { certification_id: "c5", level: "full", expires_on: FUTURE, recorded_at: "2026-09-05T00:00:00.000Z" },
      { certification_id: "c5", level: "trainee", expires_on: FUTURE, recorded_at: "2026-10-05T00:00:00.000Z" },
      { certification_id: "c7", level: "full", expires_on: FUTURE, recorded_at: "2026-09-06T00:00:00.000Z" },
    ],
    jobs: jobs.map(({ _prop, ...j }) => j),
    owners: jobs.map((j) => ({ id: j.owner_id, full_name: `Owner ${j.id.toUpperCase()}` })),
    properties: jobs.map((j) => ({ id: j.property_id, address_line: null, suburb: "", postcode: "", enrichment: null, ...j._prop })),
    job_assignments: [{ job_id: "e", role: "installer", active: true }, { job_id: "a", role: "installer", active: false }],
    partner_offers: [{ job_id: "f", status: "declined", offered_at: "2026-10-20T00:00:00.000Z", business_id: I2, kind: "ready_check" }],
    lead_campaign_responses: [
      { job_id: "a", spot_saved_at: "2026-10-20T00:00:00.000Z", opted_out_at: null, saved_total: 900, saved_area_m2: 200, saved_insulation: "none", desk_check_status: null, desk_check_reason: null },
      { job_id: "b", spot_saved_at: "2026-10-21T00:00:00.000Z", opted_out_at: null, saved_total: null, saved_area_m2: null, saved_insulation: "present", desk_check_status: "looks_eligible", desk_check_reason: "Thin/loose-fill insulation only" },
      { job_id: "c", spot_saved_at: null, opted_out_at: null, saved_total: null, saved_area_m2: null, saved_insulation: "present", desk_check_status: null, desk_check_reason: null },
      { job_id: "g", spot_saved_at: "2026-10-18T00:00:00.000Z", opted_out_at: null, saved_total: 1200, saved_area_m2: 150, saved_insulation: "none", desk_check_status: null, desk_check_reason: null },
    ],
    ceiling_measurements: [{ job_id: "c", measured_area_m2: 133, is_current: true }, { job_id: "a", measured_area_m2: 999, is_current: false }],
    indicative_estimates: [{ id: "est-c", job_id: "c", area_m2: 140, insulation_declared: "none", scenarios: [], created_at: "2026-10-02T00:00:00.000Z", status: "current" }],
    workflow_events: [
      { id: "q1", job_id: "a", event_type: "quick_taps_answered", created_at: "2026-10-26T00:00:00.000Z", details: { answers: { hatch: "yes", roof: "sloped" } } },
      { id: "r1", job_id: "g", event_type: "spot_released", created_at: "2026-11-01T00:00:00.000Z", details: { release_seq: 1, business_id: I2, business_name: "Lapsed Docs Installs", released_by: "jo" } },
    ],
    property_facts: [
      { property_id: "p-a", fact_key: "coordinates", value: [145.2416, -37.9244], is_current: true },
      { property_id: "p-a", fact_key: "solar_summary", value: { roof_ground_area_m2: 200.4 }, is_current: true },
      { property_id: "p-c", fact_key: "coordinates", value: [145.1688, -37.9144], is_current: true },
      { property_id: "p-f", fact_key: "coordinates", value: [145.17, -37.91], is_current: true },
    ],
  });
}

const ALL = [I1, I2, I3, I4, R1];
async function offerFacts(ids: string[]) {
  const f = await installerOfferFacts(ids.map((id) => ({ ...tables["businesses"]!.find((b) => b["id"] === id)!, id })));
  return Object.fromEntries(ids.map((id) => [id, { credentialsOk: f.credentialsOk({ ...tables["businesses"]!.find((b) => b["id"] === id)!, id } as never), fullCertified: f.fullCertified(id), installerGap: f.installerGap(id), credentialsGap: f.credentialsGap({ ...tables["businesses"]!.find((b) => b["id"] === id)!, id } as never) }]));
}

beforeAll(async () => {
  setSystemTime(NOW);
  seed();
  await loadInstallerWaitingList({ includeTest: true }); // warm the module cache
});
afterAll(() => { setSystemTime(); });

describe("Choose installer › To release speed (Task 4)", () => {
  test("same value as before: list rows, order and areas; installerFacts and installerOfferFacts for every caller", async () => {
    seed();
    const out: Record<string, unknown> = {};
    out["list, TEST included"] = (await measured(() => loadInstallerWaitingList({ includeTest: true }))).out;
    out["list, real only"] = (await measured(() => loadInstallerWaitingList({ includeTest: false }))).out;
    out["list, TEST jobs/partners only"] = (await measured(() => loadInstallerWaitingList({ includeTest: true }, ["h", "a"], [I3]))).out;
    out["installerFacts()"] = (await measured(() => installerFacts())).out;
    out["installerFacts([I1, I2])"] = (await measured(() => installerFacts([I1, I2]))).out;
    out["installerFacts([])"] = (await measured(() => installerFacts([]))).out;
    out["installerOfferFacts(all)"] = await offerFacts(ALL);
    out["installerOfferFacts([I3])"] = await offerFacts([I3]);
    expect(out).toMatchSnapshot();
  });

  test("the fixture exercises the facts (not all-true / all-zero)", async () => {
    seed();
    const f = await offerFacts(ALL);
    expect(f[I1]!.fullCertified).toBe(2); // w1 (email ack) + w3 (id ack); w2 not acknowledged
    expect(f[I2]!.fullCertified).toBe(1); // onboarding ack
    expect(f[I2]!.credentialsOk).toBe(false); // public liability lapsed
    expect(f[I3]!.fullCertified).toBe(0); // latest level is not Full
    const { rows } = await loadInstallerWaitingList({ includeTest: false });
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "f", "g"]);
    expect(rows.find((r) => r.id === "a")!.coverage.installer).toBe(true);
    expect(rows.find((r) => r.id === "g")!.coverage.installer).toBe(false);
  });

  test("the To release list loads in at most 3 sequential waves of reads", async () => {
    seed();
    const r = await measured(() => loadInstallerWaitingList({ includeTest: true }));
    if (r.waves > 3) console.log(`To release waves = ${r.waves}\n${wavesOf(r.log)}`);
    expect(r.waves).toBeLessThanOrEqual(3);
  });

  test("installerFacts (Send bar, area batches) loads in at most 3 sequential waves", async () => {
    seed();
    const r = await measured(() => installerFacts());
    if (r.waves > 3) console.log(`installerFacts waves = ${r.waves}\n${wavesOf(r.log)}`);
    expect(r.waves).toBeLessThanOrEqual(3);
  });
});
