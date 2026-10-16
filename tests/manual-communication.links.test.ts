// STEP 32 (A1): side-effect-free preview + approved-template fidelity, with the REAL token helpers
// (emailsafety.server, referral.server, preview-links.server) over an in-memory fake that records every write.
// - Opening a preview creates no unsubscribe/referral token, send record or communication.
// - Only the explicit "Create sending links" step (mode manual_copy / issueLinks) issues the lead's missing tokens.
// - A real send still issues a valid unsubscribe link, and what Office copies is byte-identical to what the portal sends.
import { beforeEach, describe, expect, mock, test } from "bun:test";

const JOB = "00000000-0000-4000-8000-0000000000c1", TOKEN = "E".repeat(43);
let writes: { table: string; op: string }[] = [];
let tables: Record<string, Record<string, unknown> | undefined> = {};
function query(table: string) {
  let pending: Record<string, unknown> | null = null;
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "neq", "is", "not"]) q[m] = () => q;
  q["insert"] = (row: Record<string, unknown>) => { writes.push({ table, op: "insert" }); pending = { id: `${table}-row`, status: "active", ...row }; tables[table] = { ...(tables[table] ?? {}), ...pending }; return q; };
  for (const m of ["update", "upsert", "delete"]) q[m] = () => { writes.push({ table, op: m }); return q; };
  q["maybeSingle"] = async () => ({ data: tables[table] ?? null, error: null });
  q["single"] = async () => ({ data: pending ?? tables[table] ?? null, error: null });
  q["then"] = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, bad);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) } }));
const realComms = await import("../src/lib/comms.server");
let recorded = 0;
mock.module("../src/lib/comms.server", () => ({ ...realComms, customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true, recordCommunication: async () => { recorded++; return "comm-1"; } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async () => {} }));
const realEstimate = await import("../src/lib/estimate.core");
mock.module("../src/lib/estimate.core", () => ({ ...realEstimate, discountIsWholeVeecs: () => true }));
let sentPayloads: { subject: string; html: string; text: string }[] = [];
globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => { sentPayloads.push(JSON.parse(String(init?.body ?? "{}"))); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }) as unknown as typeof fetch;
process.env["RESEND_API_KEY"] = "test-key"; process.env["LOVABLE_API_KEY"] = "test-gateway"; process.env["HIVIC_COM04_ENV"] = "production"; // S102: production send path with a stubbed provider

const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
const { prepareIneligibleEmailForOffice, sendPreliminaryIneligibleEmail } = await import("../src/lib/followups.server");
const { PREVIEW_LINK_TOKEN } = await import("../src/lib/preview-links.server");
const TOKEN_TABLES = new Set(["customer_email_optouts", "customer_referral_tokens", "customer_referral_events"]);
const SEND_TABLES = ["customer_email_sends", "job_communications", "lead_campaign_responses", "owners", "jobs", "properties"];

function likelyLead() {
  tables = {
    jobs: { id: JOB, job_number: "HV-9201", source: "base44", stage: "preliminary_estimate_ready", created_at: "2026-10-10T00:00:00Z", eligibility_outcome: "likely_eligible", estimated_area_m2: 120, estimated_area_unknown: false, deleted_at: null, owners: { full_name: "Sam Owner", email: "sam@home.test.au" }, properties: { address_line: "1 Test Street", suburb: "Testville", postcode: "3000" } },
    customer_estimate_links: { id: "link-1", token: TOKEN },
    indicative_estimates: { id: "est-1", area_m2: 120, area_source: "owner_estimate", insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: 1890, applied_discount: 2100, pre_discount_total: 3990 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 3292 } } }] } },
    retail_estimator_settings: { indicative_veec_value: 70 },
    workflow_settings: { id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: true },
  };
}
beforeEach(() => { writes = []; recorded = 0; sentPayloads = []; likelyLead(); });

describe("Save my spot: Prepare / Preview are side-effect free", () => {
  test("no links yet → placeholders, linksReady=false, and NOTHING written", async () => {
    const [r] = await sendSaveMySpot([JOB], "actor-1", { mode: "preview" });
    expect(r?.preview?.linksReady).toBe(false);
    expect(r?.preview?.html).toContain(PREVIEW_LINK_TOKEN);
    expect(writes).toEqual([]);
    expect(tables["customer_email_optouts"]).toBeUndefined();
    expect(tables["customer_referral_tokens"]).toBeUndefined();
    expect(recorded).toBe(0);
  });
  test("existing links are reused read-only → linksReady=true, real links, nothing written", async () => {
    tables["customer_email_optouts"] = { token: "U".repeat(43) };
    tables["customer_referral_tokens"] = { token: "R".repeat(43), status: "active" };
    const [r] = await sendSaveMySpot([JOB], "actor-1", { mode: "preview" });
    expect(r?.preview?.linksReady).toBe(true);
    expect(r?.preview?.html).toContain("U".repeat(43));
    expect(r?.preview?.html).not.toContain(PREVIEW_LINK_TOKEN);
    expect(writes).toEqual([]);
  });
  test("'Create sending links' (manual_copy) issues ONLY the lead's missing tokens – no send record, no communication", async () => {
    const [r] = await sendSaveMySpot([JOB], "actor-1", { mode: "manual_copy" });
    expect(r?.preview?.linksReady).toBe(true);
    expect(r?.preview?.html).not.toContain(PREVIEW_LINK_TOKEN);
    expect(r?.preview?.html).toContain(String(tables["customer_email_optouts"]?.["token"]));
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(TOKEN_TABLES.has(w.table)).toBe(true);
    for (const t of SEND_TABLES) expect(writes.some((w) => w.table === t)).toBe(false);
    expect(recorded).toBe(0); expect(sentPayloads).toEqual([]);
  });
});

describe("Save my spot: approved-template fidelity and real-send unsubscribe handling", () => {
  test("what Office copies is byte-identical to what the portal actually sends", async () => {
    const [copy] = await sendSaveMySpot([JOB], "actor-1", { mode: "manual_copy" });
    const [again] = await sendSaveMySpot([JOB], "actor-1", { mode: "preview" }); // links now exist → read-only preview is final
    const [sent] = await sendSaveMySpot([JOB], "actor-1");
    expect(sent?.outcome).toBe("sent");
    expect(sentPayloads.length).toBe(1);
    const p = sentPayloads[0]!;
    expect({ subject: copy?.preview?.subject, html: copy?.preview?.html, text: copy?.preview?.plainText }).toEqual({ subject: p.subject, html: p.html, text: p.text });
    expect(again?.preview).toEqual(copy?.preview);
  });
  test("a real send with no prior links still issues a valid unsubscribe link (never a placeholder)", async () => {
    const [sent] = await sendSaveMySpot([JOB], "actor-1");
    expect(sent?.outcome).toBe("sent");
    const html = sentPayloads[0]!.html;
    const unsub = String(tables["customer_email_optouts"]?.["token"]);
    expect(unsub).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(html).toContain(`unsubscribe?t=${unsub}`);
    expect(html).not.toContain(PREVIEW_LINK_TOKEN);
  });
});

describe("Ineligible: Prepare / Preview are side-effect free", () => {
  beforeEach(() => {
    tables = {
      jobs: { source: "base44", eligibility_outcome: "does_not_appear_eligible", eligibility_reason: "The home was built less than 5 years ago.", eligibility_decision_source: "system", eligibility_review_required: false, external_enquiry_id: "B44-91", stage: "eligibility_review", created_at: new Date(Date.now() - 86_400_000).toISOString(), owners: { email: "owner@home.test.au" } },
      customer_delivery_settings: { jobs_created_after: "2026-01-01T00:00:00Z" },
    };
  });
  test("default preview writes nothing; 'Create sending links' writes only token tables; real send matches it", async () => {
    const preview = await prepareIneligibleEmailForOffice(JOB);
    expect(preview).toMatchObject({ ok: true, linksReady: false });
    expect(writes).toEqual([]);
    const copy = await prepareIneligibleEmailForOffice(JOB, { issueLinks: true });
    expect(copy).toMatchObject({ ok: true, linksReady: true });
    for (const w of writes) expect(TOKEN_TABLES.has(w.table)).toBe(true);
    let delivered: { subject: string; html: string; text: string } | null = null;
    const adapter = { provider: "fake", deliver: async (m: { subject: string; html: string; text: string }) => { delivered = m; return { providerMessageId: "p1" }; } };
    expect((await sendPreliminaryIneligibleEmail(JOB, null, adapter as never)).sent).toBe(true);
    const d = delivered as unknown as { subject: string; html: string; text: string };
    if (!copy.ok) throw new Error("expected ok");
    expect({ subject: copy.subject, html: copy.html, text: copy.plainText }).toEqual({ subject: d.subject, html: d.html, text: d.text });
  });
});
