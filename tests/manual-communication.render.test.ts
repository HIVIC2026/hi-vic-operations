// STEP 17 (A1 manual communication): the REAL render paths Office copies from.
// - Save my spot preview mode (reused as-is) renders subject + full plain-text body and writes nothing.
// - The Office ineligible copy is byte-identical to what the real sender delivers, and itself never reserves,
//   delivers or records anything.
import { beforeEach, describe, expect, mock, test } from "bun:test";

const JOB = "00000000-0000-4000-8000-0000000000b1", TOKEN = "B".repeat(43);
const REF = `https://homeinsulationvictoria.com.au/homeowner?ref=${"A".repeat(43)}`;
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"C".repeat(43)}`;
let writes: { table: string; op: string }[] = [];
let tables: Record<string, unknown> = {};
function query(table: string) {
  let inserted = false;
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "neq", "is", "not"]) q[m] = () => q;
  for (const m of ["insert", "update", "upsert", "delete"]) q[m] = () => { writes.push({ table, op: m }); inserted = m === "insert"; return q; };
  q["maybeSingle"] = async () => ({ data: tables[table] ?? null, error: null });
  q["single"] = async () => ({ data: inserted ? { id: "row-1" } : tables[table] ?? null, error: null });
  q["then"] = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, bad);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));
globalThis.fetch = (async () => { throw new Error("network call attempted"); }) as unknown as typeof fetch;

const realComms = await import("../src/lib/comms.server");
let recorded = 0;
mock.module("../src/lib/comms.server", () => ({ ...realComms, customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true, recordCommunication: async () => { recorded++; return "comm-1"; } }));
const realSafety = await import("../src/lib/emailsafety.server");
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, suppressionFor: async () => null, unsubscribeUrlForJob: async () => UNSUB }));
const realReferral = await import("../src/lib/referral.server");
mock.module("../src/lib/referral.server", () => ({ ...realReferral, referralUrlForJob: async () => REF }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async () => {} }));
const realEstimate = await import("../src/lib/estimate.core");
mock.module("../src/lib/estimate.core", () => ({ ...realEstimate, discountIsWholeVeecs: () => true }));

process.env["HIVIC_COM04_ENV"] = "production"; // S102: production send path with a stubbed/forbidden provider
const { sendSaveMySpot } = await import("../src/lib/hot-leads-send.server");
const { prepareIneligibleEmailForOffice, sendPreliminaryIneligibleEmail } = await import("../src/lib/followups.server");

beforeEach(() => { writes = []; recorded = 0; });

describe("Save my spot preview (what Office copies for a likely-eligible lead)", () => {
  beforeEach(() => {
    tables = {
      jobs: { id: JOB, job_number: "HV-9101", source: "base44", stage: "preliminary_estimate_ready", created_at: "2026-10-10T00:00:00Z", eligibility_outcome: "likely_eligible", estimated_area_m2: 120, estimated_area_unknown: false, owners: { full_name: "Sam Owner", email: "Sam@Home.test.au" }, properties: { address_line: "1 Test Street", suburb: "Testville", postcode: "3000" } },
      customer_estimate_links: { id: "link-1", token: TOKEN },
      indicative_estimates: { id: "est-1", area_m2: 120, area_source: "owner_estimate", insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: 1890, applied_discount: 2100, pre_discount_total: 3990 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 3292 } } }] } },
      retail_estimator_settings: { indicative_veec_value: 70 },
      workflow_settings: { id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: true },
    };
  });
  test("renders recipient, subject, full plain-text body and HTML with the owner's own secure link – and writes nothing", async () => {
    const [r] = await sendSaveMySpot([JOB], "actor-1", { mode: "preview" });
    expect(r?.detail).toBe("Preview only — not sent");
    expect(r?.preview?.to).toBe("sam@home.test.au");
    expect(r?.preview?.subject.length).toBeGreaterThan(5);
    expect(r?.preview?.plainText.length).toBeGreaterThan(200);
    expect(r?.preview?.plainText).toContain(TOKEN);
    expect(r?.preview?.html).toContain(TOKEN);
    // No unsubscribe/referral link exists yet: placeholders, linksReady=false, and nothing created (STEP 32).
    expect(r?.preview?.linksReady).toBe(false);
    expect(r?.preview?.plainText).toContain("PREVIEW_ONLY_link_issued_before_sending");
    expect(writes).toEqual([]);
    expect(recorded).toBe(0);
  });
  test("a recorded manual send stops the real Save my spot sender (no reservation, no provider call)", async () => {
    tables["job_communications"] = { id: "manual-1" };
    const [r] = await sendSaveMySpot([JOB], "actor-1");
    expect(r).toMatchObject({ outcome: "skipped", detail: "The office already sent this email by hand (recorded manual send)." });
    expect(writes).toEqual([]);
    expect(recorded).toBe(0);
  });
  test("Group B (existing insulation declared) is refused by the same path", async () => {
    tables["indicative_estimates"] = { ...(tables["indicative_estimates"] as object), insulation_declared: "present" };
    tables["jobs"] = { ...(tables["jobs"] as object), eligibility_outcome: "needs_onsite_confirmation" };
    const [r] = await sendSaveMySpot([JOB], "actor-1", { mode: "preview" });
    expect(r?.outcome).toBe("blocked");
    expect(r?.preview).toBeUndefined();
    expect(writes).toEqual([]);
  });
});

describe("Ineligible result: Office copy vs real sender", () => {
  beforeEach(() => {
    tables = {
      jobs: { source: "base44", eligibility_outcome: "does_not_appear_eligible", eligibility_reason: "The home was built less than 5 years ago.", eligibility_decision_source: "system", eligibility_review_required: false, external_enquiry_id: "B44-77", owners: { email: "owner@home.test.au" } },
    };
  });
  test("the Office copy is byte-identical to what the sender delivers (existing links, read-only preview)", async () => {
    tables["customer_email_optouts"] = { token: "C".repeat(43) };
    tables["customer_referral_tokens"] = { token: "A".repeat(43) };
    const office = await prepareIneligibleEmailForOffice(JOB);
    expect(office).toMatchObject({ ok: true, linksReady: true });
    expect(writes).toEqual([]);
    expect(recorded).toBe(0);
    let delivered: { to: string; subject: string; html: string; text: string } | null = null;
    const adapter = { provider: "fake", deliver: async (m: { to: string; subject: string; html: string; text: string }) => { delivered = m; return { providerMessageId: "p1" }; } };
    const sent = await sendPreliminaryIneligibleEmail(JOB, null, adapter as never);
    expect(sent.sent).toBe(true);
    const d = delivered as unknown as { to: string; subject: string; html: string; text: string };
    if (!office.ok) throw new Error("expected ok");
    expect({ to: office.to, subject: office.subject, html: office.html, text: office.plainText }).toEqual({ to: d.to, subject: d.subject, html: d.html, text: d.text });
  });
  test("the 'Create sending links' copy is byte-identical to what the sender delivers", async () => {
    const office = await prepareIneligibleEmailForOffice(JOB, { issueLinks: true });
    let delivered: { to: string; subject: string; html: string; text: string } | null = null;
    const adapter = { provider: "fake", deliver: async (m: { to: string; subject: string; html: string; text: string }) => { delivered = m; return { providerMessageId: "p1" }; } };
    await sendPreliminaryIneligibleEmail(JOB, null, adapter as never);
    const d = delivered as unknown as { to: string; subject: string; html: string; text: string };
    if (!office.ok) throw new Error("expected ok");
    expect(office.linksReady).toBe(true);
    expect({ subject: office.subject, html: office.html, text: office.plainText }).toEqual({ subject: d.subject, html: d.html, text: d.text });
  });
  test("preview without existing links shows placeholders, is not copy-ready and writes nothing", async () => {
    const office = await prepareIneligibleEmailForOffice(JOB);
    if (!office.ok) throw new Error("expected ok");
    expect(office.linksReady).toBe(false);
    expect(office.html).toContain("PREVIEW_ONLY_link_issued_before_sending");
    expect(writes).toEqual([]); expect(recorded).toBe(0);
  });
  test("a recorded manual send stops the real ineligible sender", async () => {
    tables["job_communications"] = { id: "manual-2" };
    let calls = 0;
    const adapter = { provider: "fake", deliver: async () => { calls++; return { providerMessageId: "p2" }; } };
    expect(await sendPreliminaryIneligibleEmail(JOB, null, adapter as never)).toEqual({ sent: false, reason: "manual_send_recorded" });
    expect(calls).toBe(0); expect(writes).toEqual([]); expect(recorded).toBe(0);
  });
  test("office copy refuses a non-ineligible or held result without writing", async () => {
    tables["jobs"] = { ...(tables["jobs"] as object), eligibility_review_required: true };
    expect(await prepareIneligibleEmailForOffice(JOB)).toEqual({ ok: false, reason: "eligibility_review_required" });
    tables["jobs"] = { ...(tables["jobs"] as object), eligibility_review_required: false, eligibility_outcome: "likely_eligible" };
    expect(await prepareIneligibleEmailForOffice(JOB)).toEqual({ ok: false, reason: "official_not_ineligible" });
    expect(writes).toEqual([]);
  });
});
