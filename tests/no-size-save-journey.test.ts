// No-ceiling-size Save my spot journey (Jo, 10 Oct 2026): email -> secure link -> explicit save -> persisted -> success
// -> reload/repeat, plus failure and invalid links. Synthetic TEST fixture, in-memory database, fake delivery adapters.
import { test, expect, mock, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let failSaveWrites = false;
const writes: string[] = [];
const match = (r: Row, f: [string, string, unknown][]) => f.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "is" ? (r[k] ?? null) === v : op === "in" ? (v as unknown[]).includes(r[k]) : true);
function from(table: string) {
  const f: [string, string, unknown][] = [];
  let op: "select" | "update" | "upsert" | "insert" = "select", payload: Row | null = null, opts: { ignoreDuplicates?: boolean } = {};
  const run = () => {
    const rows = (db[table] ??= []);
    if (op === "select") return { data: rows.filter((r) => match(r, f)), error: null };
    writes.push(`${op}:${table}`);
    if (failSaveWrites && table === "lead_campaign_responses") return { data: null, error: { message: "db down" } };
    if (op === "insert") { rows.push({ ...payload }); return { data: [payload], error: null }; }
    if (op === "upsert") {
      if (rows.some((r) => r["job_id"] === payload!["job_id"])) return { data: opts.ignoreDuplicates ? [] : null, error: null };
      rows.push({ opted_out_at: null, ...payload }); return { data: [payload], error: null };
    }
    const hit = rows.filter((r) => match(r, f)); hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null };
  };
  const c: Record<string, unknown> = {
    select: () => c, order: () => c, limit: () => c,
    eq: (k: string, v: unknown) => { f.push(["eq", k, v]); return c; },
    is: (k: string, v: unknown) => { f.push(["is", k, v]); return c; },
    in: (k: string, v: unknown) => { f.push(["in", k, v]); return c; },
    update: (p: Row) => { op = "update"; payload = p; return c; },
    upsert: (p: Row, o: { ignoreDuplicates?: boolean }) => { op = "upsert"; payload = p; opts = o; return c; },
    insert: (p: Row) => { op = "insert"; payload = p; return c; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return c;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const events: string[] = [], stages: string[] = [], delivered: string[] = [];
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _m: string, meta: Row) => { events.push(type); db["workflow_events"]!.push({ job_id: J, event_type: type, details: meta }); }, transition: async (_j: string, to: string) => { stages.push(to); }, requireAdmin: async () => {} }));
mock.module("../src/lib/estimatelink.server", () => ({ resolvePublicEstimate: async () => ({ ok: true }) }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=x", recordUnsubscribe: async () => {} }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (_c: unknown, to: string) => { delivered.push(to); return { status: "fake", detail: "fake adapter" }; } }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
const fetchCalls: string[] = [];
globalThis.fetch = (async (u: unknown) => { fetchCalls.push(String(u)); return new Response("{}"); }) as typeof fetch;

const { campaignPage, saveCampaignSpot } = await import("../src/lib/launch-campaign.server");
const { renderStep3SaveSpotNoSize, renderStep3SaveSpot, STEP3_SAVESPOT_SAMPLE } = await import("../src/lib/step3-emails");

const J = "00000000-0000-4000-8000-00000000c150";
const TOKEN = "T".repeat(43);
const URL_BASE = `https://estimate.homeinsulationvictoria.com.au/estimate/${TOKEN}`;
const scenario = { by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } };
beforeEach(() => {
  failSaveWrites = false; writes.length = 0; events.length = 0; stages.length = 0; delivered.length = 0; fetchCalls.length = 0;
  db = {
    customer_estimate_links: [{ id: "l1", job_id: J, status: "active", expires_at: new Date(Date.now() + 86400000).toISOString(), token: TOKEN, purpose: "step3_estimate" }],
    jobs: [{ id: J, source: "qa_test", stage: "preliminary_estimate_ready", eligibility_outcome: "likely_eligible", eligibility_review_required: false, estimated_area_m2: null, estimated_area_unknown: true, owners: { full_name: "Test Owner", email: "qa.nosize@hivic-test.example", phone: null }, properties: { address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3336", enrichment: { base44: { raw: { answers: { existing_insulation: "no" } } } } } }],
    owner_contact_consents: [{ job_id: J, consent_status: "granted" }],
    customer_email_optouts: [], lead_campaign_responses: [], workflow_events: [], job_communications: [], customer_delivery_settings: [],
    indicative_estimates: [{ id: "e150", job_id: J, status: "current", area_m2: 150, area_source: "typical_default", insulation_declared: "none", scenarios: [scenario], snapshot: null }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, id: "s1", version: 2 }],
  };
});

const { areaM2: _a, areaIsTypical: _t, ...facts } = STEP3_SAVESPOT_SAMPLE;
const email = renderStep3SaveSpotNoSize({ ...facts, estimateUrl: URL_BASE, campaignUrl: `${URL_BASE}/campaign`, estimatedTotal: 3716.24, veuDiscount: 1481.76, grossTotal: 5198 });

test("no-size email = normal Save your spot plus only the labelled 150 m² assumption", () => {
  const normal = renderStep3SaveSpot({ ...STEP3_SAVESPOT_SAMPLE, estimateUrl: URL_BASE, campaignUrl: `${URL_BASE}/campaign`, estimatedTotal: 3716.24, veuDiscount: 1481.76, grossTotal: 5198 });
  expect(email.subject).toBe(normal.subject);
  const extra = email.plainText.split("\n").filter((l) => !normal.plainText.split("\n").includes(l));
  expect(extra).toEqual(["Ceiling: 150 m² (typical-home assumption)", "You didn’t provide a ceiling size, so we’ve used an average size of 150 m² for this preliminary estimate. Your final price will depend on the measured ceiling area."]);
  for (const out of [email.html, email.plainText]) {
    expect(out).toContain("You didn’t provide a ceiling size, so we’ve used an average size of 150 m² for this preliminary estimate.");
    expect(out).toContain("$1,482"); expect(out).toContain("$3,716");
    expect(out).toContain("No payment required. No obligation to proceed with installation.");
    expect(out).toContain("calculator");
  }
  expect(email.html).toContain(`href="${URL_BASE}/campaign"`);
  expect(email.html).toContain("Save my spot →");
  expect(email.plainText).toContain(`Save my spot: ${URL_BASE}/campaign`);
});


test("opening the secure page does not save; the typical estimate shows as assumed", async () => {
  const page = JSON.parse((await campaignPage(TOKEN, false))!);
  expect(page.pricing).toMatchObject({ areaM2: 150, total: 3716.24, discount: 1481.76, areaAssumed: true });
  expect(page.response).toBeNull();
  expect(writes).toEqual([]);
});

test("explicit save persists once with timestamp/version; repeat and reload keep the saved state; no delivery or booking", async () => {
  expect(await saveCampaignSpot(TOKEN)).toEqual({ ok: true });
  const r = db["lead_campaign_responses"]!;
  expect(r.length).toBe(1);
  expect(typeof r[0]!["spot_saved_at"]).toBe("string");
  expect(r[0]).toMatchObject({ saved_estimate_id: "e150", saved_total: 3716.24, saved_veu_discount: 1481.76, saved_area_m2: 150, saved_insulation: "none" });
  const saved = db["workflow_events"]!.find((e) => e["event_type"] === "campaign_spot_saved")!;
  expect(saved["details"]).toMatchObject({ campaign: "existing_leads_launch_v1", area_assumed: true });
  const first = r[0]!["spot_saved_at"];
  expect(await saveCampaignSpot(TOKEN)).toEqual({ ok: true });
  expect(db["lead_campaign_responses"]!.length).toBe(1);
  expect(db["lead_campaign_responses"]![0]!["spot_saved_at"]).toBe(first);
  expect(events.filter((e) => e === "campaign_spot_saved").length).toBe(1);
  const reload = JSON.parse((await campaignPage(TOKEN, false))!);
  expect(reload.response.spot_saved_at).toBe(first);
  expect(db["jobs"]![0]!["estimated_area_m2"]).toBeNull();
  expect(stages).not.toContain("ready_check_scheduled");
  expect(db["job_communications"]!.every((m) => m["delivery_status"] === "queued" && m["sent_at"] === null)).toBe(true);
  expect(fetchCalls).toEqual([]);
  expect(delivered.every((to) => to.endsWith("@hivic-test.example"))).toBe(true);
});

test("a failed save never reports success", async () => {
  failSaveWrites = true;
  await expect(saveCampaignSpot(TOKEN)).rejects.toThrow("We couldn't save your place");
  expect(db["lead_campaign_responses"]!.length).toBe(0);
});

test("invalid, unknown and expired links fail safely", async () => {
  expect(await campaignPage("bad", false)).toBeNull();
  await expect(saveCampaignSpot("U".repeat(43))).rejects.toThrow("no longer available");
  db["customer_estimate_links"]![0]!["expires_at"] = new Date(Date.now() - 1000).toISOString();
  await expect(saveCampaignSpot(TOKEN)).rejects.toThrow("no longer available");
  expect(db["lead_campaign_responses"]!.length).toBe(0);
});

test("stale typical estimate (owner size now known) is not shown or saved", async () => {
  Object.assign(db["jobs"]![0]!, { estimated_area_m2: 120, estimated_area_unknown: false });
  expect(JSON.parse((await campaignPage(TOKEN, false))!).pricing).toBeNull();
  await expect(saveCampaignSpot(TOKEN)).rejects.toThrow("being updated");
  expect(db["lead_campaign_responses"]!.length).toBe(0);
});

test("normal saved confirmation shown only from the persisted saved state", () => {
  const s = readFileSync("src/routes/estimate_.$token.campaign.tsx", "utf8");
  expect(s).toContain(">Spot saved.</h1>");
  expect(s).toContain(": data.response?.spot_saved_at ? ");
});

test("real no-size sends stay held", () => expect(readFileSync("src/lib/hot-leads-send.server.ts", "utf8")).toContain("NO_SIZE_REAL_SEND_HELD"));
