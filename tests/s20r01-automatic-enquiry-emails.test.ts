// S20-R01: AUTOMATIC replies to new website enquiries at their official eligibility decision, with the shared master
// switch (customer_comms_enabled) and therefore the scheduled backlog worker left OFF. Runs the REAL automatic router
// (maybeAutoRouteLeadEmail – what post-intake and an Office eligibility decision call), the REAL senders (Save my spot /
// Group B sendOne, the ineligible sender), the REAL new-enquiry gate and the REAL backlog worker against an in-memory admin
// DB (customer_email_sends.idempotency_key UNIQUE) and a STUBBED email service (the Resend connector gateway).
// Test recipient: jet.zhezhang@gmail.com (authorised by Jet for test emails); no email leaves this process.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
let seq = 0;
let failSentWrite = false;
const writes: string[] = [];
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let values: unknown = null; let returning = false;
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => kind === "eq" ? r[k] === v : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : kind === "like" ? String(r[k] ?? "").startsWith(String(v).replace(/%$/, "")) : true);
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
      if (failSentWrite && table === "customer_email_sends" && (values as Row).status === "sent") return { data: null, error: { message: "db write failed" } };
      const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows().filter(match), error: null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => { if (op !== "select") returning = true; return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    like: (k: string, pat: string) => { f.push([k, "like", pat]); return q; },
    neq: () => q, not: () => q, gte: () => q, order: () => q, limit: () => q, range: () => q, or: () => q,
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
let unsubIssued = 0; // "Create sending links" issues the owner's unsubscribe link only after every guard passed
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, unsubscribeUrlForJob: async () => { unsubIssued++; return UNSUB; } }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => `https://homeinsulationvictoria.com.au/homeowner?ref=${"r".repeat(43)}` }));
let media: { received: boolean; uncertain: boolean } = { received: false, uncertain: false };
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => media }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) })); // estimate/link refresh is not under test
const realComms = await import("../src/lib/comms.server");
const comms: Row[] = [];
// The recorded row also lands in the in-memory job_communications table, as the real insert would.
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async (x: Row) => {
  comms.push(x);
  (T.job_communications ??= []).push({ id: `comm-${comms.length}`, job_id: x.jobId, source_event: x.sourceEvent, source_reference: x.sourceReference, created_at: new Date().toISOString() });
  return `comm-${comms.length}`;
} }));

// ---------- stubbed email service (the connector gateway) ----------
type Mode = "ok" | "422" | "429" | "409" | "502" | "timeout" | "disconnect" | "hang";
let mode: Mode = "ok";
const calls: { url: string; body: Row; idem: string; signal: boolean }[] = [];
globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url: String(u), body: JSON.parse(String(init?.body ?? "{}")), idem: headers["Idempotency-Key"] ?? "", signal: !!init?.signal });
  if (mode === "ok") return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
  if (mode === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (mode === "disconnect") throw new TypeError("fetch failed");
  if (mode === "hang") return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason ?? new DOMException("timeout", "TimeoutError"))));
  return new Response(JSON.stringify({ message: `fake ${mode}` }), { status: Number(mode) });
}) as typeof fetch;
process.env["RESEND_API_KEY"] = "local-test-not-real";
process.env["LOVABLE_API_KEY"] = "local-test-not-real";

const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { processPendingInitialEstimateEmails, sendPreliminaryIneligibleEmail } = await import("../src/lib/followups.server");
const C = await import("../src/lib/enquiry-auto-reply.core");
const { GROUP_B_GLOBALS_OFF } = await import("../src/lib/hot-leads-send.server");

const TO = "jet.zhezhang@gmail.com";
const L = "a0000000-0000-4000-8000-0000000030a1"; // likely eligible, no existing insulation, owner gave a size → Save my spot
const B = "a0000000-0000-4000-8000-0000000030b1"; // needs on-site confirmation, existing insulation → Request insulation details
const I = "a0000000-0000-4000-8000-0000000030c1"; // does not appear eligible → Ineligible result
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000, DAY = 86_400_000;
const job = (id: string, n: string, outcome: string, insulation: string, createdAt: string) => ({
  id, job_number: n, source: "base44", channel: "hivic_sourced", stage: outcome === "does_not_appear_eligible" ? "eligibility_review" : "preliminary_estimate_ready",
  created_at: createdAt, deleted_at: null, eligibility_outcome: outcome, eligibility_reason: outcome === "does_not_appear_eligible" ? "Ceiling already has R2.5 or more" : null,
  eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 120, estimated_area_unknown: false, external_enquiry_id: `ENQ-${n}`,
  owners: { full_name: "Jet Tester", email: TO }, properties: { address_line: "1 Fixture Street", suburb: "Testville", postcode: "3000", enrichment: { base44: { raw: { answers: { existing_insulation: insulation } } } } },
});
const est = (id: string, jobId: string, insulation: string) => ({ id, job_id: jobId, status: "current", area_m2: 120, area_source: "owner_estimate", insulation_declared: insulation,
  scenarios: [{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } }], snapshot: null });
const sends = () => T.customer_email_sends ?? [];
const sentRow = (key: string) => sends().find((s) => s.idempotency_key === key) ?? null;
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");
const KEYS = { L: `${LAUNCH_CAMPAIGN}:save_my_spot:${L}`, B: `${LAUNCH_CAMPAIGN}:insulation_details:${B}`, I: `preliminary_ineligible:${I}` };
/** Automatic enquiry emails ON with a start time (the go-live moment), master switch untouched (OFF). */
const autoOn = (startsAt = ago(2 * HOUR)) => { T.customer_delivery_settings = [{ id: 1, enabled: true, jobs_created_after: startsAt, provider: "base44_bridge", endpoint_url: null, hmac_secret: null }]; };

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  mode = "ok"; failSentWrite = false; calls.length = 0; events.length = 0; comms.length = 0; writes.length = 0; media = { received: false, uncertain: false }; unsubIssued = 0;
  Object.assign(T, {
    jobs: [job(L, "HV-3001", "likely_eligible", "none", ago(HOUR)), job(B, "HV-3002", "needs_onsite_confirmation", "Yes - some batts", ago(HOUR)), job(I, "HV-3003", "does_not_appear_eligible", "Yes", ago(HOUR))],
    customer_estimate_links: [
      { id: "ll", job_id: L, token: "L".repeat(43), purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z" },
      { id: "lb", job_id: B, token: "B".repeat(43), purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z" },
    ],
    indicative_estimates: [est("el", L, "none"), est("eb", B, "present")],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74 }],
    owner_contact_consents: [L, B, I].map((j) => ({ job_id: j, consent_status: "granted", created_at: ago(HOUR) })),
    workflow_settings: [{ id: 1, customer_comms_enabled: false }], // the shared master switch stays OFF throughout
    customer_delivery_settings: [{ id: 1, enabled: false, jobs_created_after: null, provider: "base44_bridge", endpoint_url: null, hmac_secret: null }],
    customer_email_optouts: [], lead_campaign_responses: [], job_communications: [], customer_email_sends: [], ceiling_measurements: [], property_area_estimates: [],
    customer_referral_tokens: [], post_intake_work: [], customer_engagement_events: [],
  });
});

describe("decision → email mapping (the existing single post-Gate-1 router)", () => {
  test("likely + no insulation → Save my spot; existing insulation → insulation details; not eligible → ineligible", async () => {
    autoOn();
    expect((await maybeAutoRouteLeadEmail(L)).route).toBe("offer_spot");
    expect((await maybeAutoRouteLeadEmail(B)).route).toBe("request_insulation");
    expect((await maybeAutoRouteLeadEmail(I)).route).toBe("ineligible");
  });
  test("a decision still under office review sends nothing", async () => {
    autoOn();
    T.jobs![2]!.eligibility_review_required = true;
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ route: "none", sent: false });
    expect(calls.length).toBe(0);
  });
});

describe("automatic enquiry emails OFF (production today: master switch off)", () => {
  test("nothing sends while the master switch is OFF — Save my spot, Group B and ineligible all blocked, no provider call", async () => {
    // Option A / COM-04: Save my spot is no longer a master-off exemption; it needs BOTH switches.
    expect(await maybeAutoRouteLeadEmail(L)).toMatchObject({ route: "offer_spot", sent: false, reason: "Sending is switched off." });
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ route: "request_insulation", sent: false, reason: GROUP_B_GLOBALS_OFF });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ route: "ineligible", sent: false, reason: C.AUTO_REPLY_OFF });
    expect(calls.length).toBe(0); // no provider call for any outcome while the master switch is off
  });
  test("missing Save-my-spot switch fails closed even with the master switch ON", async () => {
    autoOn(); // automatic enquiry emails on (delivery enabled + start time)
    T.workflow_settings = [{ id: 1, customer_comms_enabled: true, save_my_spot_real_send_enabled: false }];
    expect(await maybeAutoRouteLeadEmail(L)).toMatchObject({ route: "offer_spot", sent: false, reason: "Sending is switched off." });
    expect(calls.length).toBe(0); // both switches are required for real Save-my-spot sending
  });
  test("both switches ON authorizes real Save-my-spot sending (COM-04 Option A positive path)", async () => {
    autoOn();
    T.workflow_settings = [{ id: 1, customer_comms_enabled: true, save_my_spot_real_send_enabled: true }];
    expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(true);
    expect(calls.map((c) => c.idem)).toEqual([KEYS.L]); // exactly one provider call under the Save-my-spot key
    expect(sentRow(KEYS.L)).toMatchObject({ status: "sent", provider: "resend" });
  });
});

describe("automatic enquiry emails ON – new enquiry (master off: S20-R01 auto-reply path)", () => {
  test("insulation + ineligible each send ONCE via the master-off path; Save my spot stays gated (Option A)", async () => {
    autoOn(); // master switch stays OFF; this scenario exercises the S20-R01 new-enquiry path only
    expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false); // Save my spot now needs BOTH switches (COM-04)
    expect((await maybeAutoRouteLeadEmail(B)).sent).toBe(true);
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(Array(2).fill("https://connector-gateway.lovable.dev/resend/emails"));
    expect(calls.map((c) => c.idem)).toEqual([KEYS.B, KEYS.I]);
    for (const c of calls) { expect(c.body.to).toEqual([TO]); expect(String(c.body.subject).length).toBeGreaterThan(5); expect(String(c.body.html)).toContain("unsubscribe"); expect(c.signal).toBe(true); }
    expect(sentRow(KEYS.B)).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "re_1" });
    expect(sentRow(KEYS.I)).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "re_2" });
    expect(comms.map((c) => c.providerMessageId)).toEqual(["re_1", "re_2"]); // one customer-visible communication record per email
    expect(comms.every((c) => c.provider === "resend" && JSON.stringify(c.recipients) === JSON.stringify([TO]))).toBe(true);
  });
  test("a repeated decision (Office re-decides, post-intake retries) never sends a second email", async () => {
    autoOn();
    for (const j of [L, B, I]) await maybeAutoRouteLeadEmail(j); // L gated (Option A); B + I send once
    for (const j of [L, B, I]) expect((await maybeAutoRouteLeadEmail(j)).sent).toBe(false);
    expect(calls.length).toBe(2); // exactly one provider call each for B and I; Save my spot gated while master off
  });
  test("the email service refuses (422): recorded failed; unknown outcome (timeout): delivered_unrecorded and never retried", async () => {
    autoOn();
    mode = "422";
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(false);
    expect(sentRow(KEYS.I)).toMatchObject({ status: "failed" });
    mode = "timeout";
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(false); // the one allowed retry of a definite refusal
    expect(sentRow(KEYS.I)).toMatchObject({ status: "delivered_unrecorded" });
    expect(String(sentRow(KEYS.I)!.error)).toMatch(/^sent_unknown: (?!sent_unknown)/); // one marker, readable detail
    mode = "ok";
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(false); // unknown outcome is never retried automatically
    expect(calls.length).toBe(2);
  });
  test("two decisions at the same moment after a refusal re-reserve the failed ineligible email only once", async () => {
    autoOn();
    mode = "422";
    await maybeAutoRouteLeadEmail(I);
    expect(sentRow(KEYS.I)).toMatchObject({ status: "failed" });
    mode = "ok";
    const both = await Promise.all([maybeAutoRouteLeadEmail(I), maybeAutoRouteLeadEmail(I)]);
    expect(both.filter((r) => r.sent).length).toBe(1);
    expect(calls.length).toBe(2); // the refused attempt + exactly one resend
    expect(sentRow(KEYS.I)).toMatchObject({ status: "sent" });
  });
  test("ineligible uses the Save my spot email service even when a Base44 bridge is configured", async () => {
    autoOn();
    Object.assign(T.customer_delivery_settings![0]!, { endpoint_url: "https://bridge.base44.example.net/deliver", hmac_secret: "s".repeat(40) });
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["https://connector-gateway.lovable.dev/resend/emails"]);
    expect(sentRow(KEYS.I)).toMatchObject({ status: "sent", provider: "resend" });
  });
});

describe("what the automatic ineligible email says", () => {
  test("a system Gate 1 decision keeps its reason; an Office decision never emails the Office's free-text note", async () => {
    autoOn();
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(true);
    expect(String(calls[0]!.body.text)).toContain("Ceiling already has R2.5 or more");
    for (const k of Object.keys(T)) if (k === "customer_email_sends") T[k] = [];
    Object.assign(T.jobs![2]!, { eligibility_decision_source: "admin", eligibility_reason: "INTERNAL NOTE owner was difficult on the phone, see HV-1234" });
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(true);
    const mail = `${calls[1]!.body.text} ${calls[1]!.body.html}`;
    expect(mail).not.toContain("INTERNAL NOTE");
    expect(mail).toContain("doesn’t meet the current requirements");
  });
});

describe("historical enquiries and safety rules", () => {
  test("an enquiry received before the start time is never emailed automatically (Group B, ineligible)", async () => {
    autoOn(ago(30 * 60_000)); // started 30 min ago; the enquiries arrived 1 h ago
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_HISTORICAL });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_HISTORICAL });
    expect(calls.length).toBe(0);
  });
  test("an enquiry older than 14 days is never emailed automatically, even if the start time is moved back", async () => {
    autoOn(ago(60 * DAY));
    for (const j of T.jobs!) j.created_at = ago(15 * DAY);
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_TOO_OLD });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_TOO_OLD });
    expect(calls.length).toBe(0);
  });
  test("no start time set → nothing (fails closed)", async () => {
    T.customer_delivery_settings = [{ id: 1, enabled: true, jobs_created_after: null }];
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_NO_START });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_NO_START });
    expect(calls.length).toBe(0);
  });
  test("recipient validation: test/example address → not sent", async () => {
    autoOn();
    for (const j of T.jobs!) (j.owners as Row).email = "owner@example.com";
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_BAD_RECIPIENT });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_BAD_RECIPIENT });
    expect(calls.length).toBe(0);
  });
  test("bounced / unsubscribed / no consent → not sent", async () => {
    autoOn();
    T.customer_engagement_events = [{ id: "e1", job_id: B, event_type: "email_bounced" }];
    T.customer_email_optouts = [{ job_id: I, opted_out_at: ago(HOUR) }];
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_SUPPRESSED });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_SUPPRESSED });
    T.customer_engagement_events = []; T.customer_email_optouts = [];
    T.owner_contact_consents = [B, I].map((j) => ({ job_id: j, consent_status: "withdrawn", created_at: ago(HOUR / 2) }));
    expect((await maybeAutoRouteLeadEmail(B)).sent).toBe(false);
    expect((await maybeAutoRouteLeadEmail(I)).sent).toBe(false);
    expect(calls.length).toBe(0);
  });
  test("a deleted enquiry is never emailed automatically", async () => {
    autoOn();
    for (const j of T.jobs!) j.deleted_at = ago(HOUR / 2);
    expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_DELETED });
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_DELETED });
    expect(calls.length).toBe(0);
  });
  test("Office already sent the ineligible email by hand → the automatic one is skipped", async () => {
    autoOn();
    T.job_communications = [{ id: "m1", job_id: I, source_event: "manual_office_communication:sent_manually", source_reference: "template:ineligible_result", created_at: ago(HOUR / 2) }];
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: "manual_send_recorded" });
    expect(calls.length).toBe(0);
  });
  test("kill switch: turning automatic enquiry emails off stops the very next send", async () => {
    autoOn();
    expect((await maybeAutoRouteLeadEmail(B)).sent).toBe(true);
    T.customer_delivery_settings![0]!.enabled = false;
    expect(await maybeAutoRouteLeadEmail(I)).toMatchObject({ sent: false, reason: C.AUTO_REPLY_OFF });
    expect(calls.length).toBe(1);
  });
  test("calling the ineligible sender with the new-enquiry flag but a failing gate sends nothing (the flag alone never permits)", async () => {
    autoOn(ago(30 * 60_000)); // historical
    const adapter = { provider: "fake", deliver: async () => { throw new Error("must not deliver"); } };
    expect(await sendPreliminaryIneligibleEmail(I, null, adapter as never, { newEnquiryAutoReply: true })).toMatchObject({ sent: false, reason: "comms_disabled" });
  });
});

describe("the scheduled backlog worker stays OFF", () => {
  test("with the master switch off it sends nothing, even with automatic enquiry emails on and a delivery adapter", async () => {
    autoOn(ago(60 * DAY));
    let delivered = 0;
    const adapter = { provider: "fake", deliver: async () => { delivered++; return { providerMessageId: "x" }; } };
    expect(await processPendingInitialEstimateEmails(20, adapter as never)).toEqual({ scanned: 0, sent: 0, blocked: 0 });
    expect(await processPendingInitialEstimateEmails(20)).toEqual({ scanned: 0, sent: 0, blocked: 0 });
    expect(delivered).toBe(0);
    expect(calls.length).toBe(0);
  });
});
