// STEP 56: Save my spot uncertain-delivery idempotency. The REAL sender (Office sendSaveMySpot, the REAL automatic router
// maybeAutoRouteLeadEmail used by post-intake and Gate 1, the existing-insulation follow-up), the REAL Office resolution,
// the REAL Leads loader and the REAL A1 manual preparation run against an in-memory
// admin DB (customer_email_sends.idempotency_key UNIQUE, like Postgres) and a stubbed fetch. No network, no provider,
// no real email, fictional data only. Each provider outcome is checked for its customer_email_sends status and for
// whether ANY later trigger (automatic or Office) makes another provider call.
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
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, unsubscribeUrlForJob: async () => UNSUB }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => null }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) })); // estimate/link refresh is not under test
const realComms = await import("../src/lib/comms.server");
const comms: Row[] = [];
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async (x: Row) => { comms.push(x); return "comm-1"; } }));

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

const S = await import("../src/lib/hot-leads-send.server");
const { resolveUncertainSaveSpot } = await import("../src/lib/save-spot-delivery.server");
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { prepareManualEmail } = await import("../src/lib/manual-communication.server");
const { MANUAL_SENT_EVENT, manualSendReference, SYSTEM_ALREADY_SENT } = await import("../src/lib/manual-communication.core");
const { UNCERTAIN_SEND_DETAIL, STALE_SENDING_MS } = await import("../src/lib/save-spot-delivery.core");
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");

const J = "a0000000-0000-4000-8000-0000000005a1";
const KEY = `${LAUNCH_CAMPAIGN}:save_my_spot:${J}`;
const sendRow = () => (T.customer_email_sends ?? []).find((r) => r.idempotency_key === KEY) ?? null;
const auto = () => maybeAutoRouteLeadEmail(J);                      // the real automatic trigger (post-intake / Gate 1)
const office = async () => (await S.sendSaveMySpot([J], "office-1"))[0]!; // Office send button
/** What the Leads list shows for the current attempt, as the Office dialog submits it. */
const seen = () => { const r = sendRow()!; return { sendId: String(r.id), attemptAt: String(r.created_at) }; };
const resolve = (resolution: "delivered" | "not_delivered", note: string, view = seen()) => resolveUncertainSaveSpot(J, "office-1", { ...view, resolution, note });

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  mode = "ok"; failSentWrite = false; calls.length = 0; events.length = 0; comms.length = 0; writes.length = 0;
  Object.assign(T, {
    jobs: [{ id: J, job_number: "HV-9561", source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: "2026-10-01T00:00:00Z", deleted_at: null,
      eligibility_outcome: "likely_eligible", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 120, estimated_area_unknown: false,
      owners: { full_name: "Sam Sample", email: "sam.sample@example.test" }, properties: { address_line: "1 Fixture Street", suburb: "Testville", postcode: "3000", enrichment: { base44: { raw: { answers: { existing_insulation: "none" } } } } } }],
    customer_estimate_links: [{ id: "l1", job_id: J, token: "T".repeat(43), purpose: "step3_estimate", status: "active" }],
    indicative_estimates: [{ id: "e1", job_id: J, status: "current", area_m2: 120, area_source: "owner_estimate", insulation_declared: "none", scenarios: [{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } }], snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] } }],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74 }],
    owner_contact_consents: [{ job_id: J, consent_status: "granted", created_at: "2026-10-01T00:00:00Z" }],
    workflow_settings: [{ id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: true }],
    customer_email_optouts: [], lead_campaign_responses: [], job_communications: [], customer_email_sends: [], ceiling_measurements: [], property_area_estimates: [], customer_referral_tokens: [], post_intake_work: [],
  });
});

describe("provider success", () => {
  test("accepted -> sent with provider id; recorded once; every later trigger skips without a provider call", async () => {
    expect((await office()).outcome).toBe("sent");
    expect(sendRow()).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "re_1", error: null });
    expect(typeof sendRow()!.sent_at).toBe("string");
    expect(calls.length).toBe(1);
    expect(calls[0]!).toMatchObject({ url: "https://connector-gateway.lovable.dev/resend/emails", idem: KEY, signal: true });
    expect(comms.length).toBe(1);
    await auto(); expect((await office()).outcome).toBe("skipped");
    expect(calls.length).toBe(1);
  });
});

describe("confirmed provider rejection", () => {
  for (const m of ["422", "429"] as const) test(`HTTP ${m} -> failed (a definite refusal), no 'unknown' event`, async () => {
    mode = m;
    expect((await office()).outcome).toBe("failed");
    expect(sendRow()).toMatchObject({ status: "failed" });
    expect(String(sendRow()!.error)).toContain(`Email service error ${m}`);
    expect(events.some((e) => e.type === "save_my_spot_outcome_unknown")).toBe(false);
  });
  test("email not connected -> failed without any provider call", async () => {
    const saved = process.env["RESEND_API_KEY"]; delete process.env["RESEND_API_KEY"];
    try { expect((await office()).outcome).toBe("failed"); } finally { process.env["RESEND_API_KEY"] = saved; }
    expect(sendRow()).toMatchObject({ status: "failed", error: "Email is not connected" });
    expect(calls.length).toBe(0);
  });
});

describe("retry after confirmed failure", () => {
  test("a refused send may be sent again by the next trigger, exactly once", async () => {
    mode = "422"; await office();
    mode = "ok"; await auto();
    expect(sendRow()).toMatchObject({ status: "sent" });
    expect(calls.length).toBe(2);
    await auto(); await office();
    expect(calls.length).toBe(2);
  });
  test("two triggers racing on the same failed row: only one re-reserves it and calls the provider", async () => {
    mode = "422"; await office();
    mode = "ok";
    const [a, b] = await Promise.all([office(), office(), auto()]);
    expect(calls.length).toBe(2);
    expect([a!, b!].filter((r) => r.outcome === "sent").length).toBeLessThanOrEqual(1);
    expect([a!, b!].some((r) => r.outcome === "skipped" && r.detail === "Already being sent.")).toBe(true);
    expect(sendRow()).toMatchObject({ status: "sent" });
  });
});

describe("timeout after possible acceptance", () => {
  test("timeout -> delivered_unrecorded (sent_unknown), outcome 'uncertain', Office-visible event", async () => {
    mode = "timeout";
    const r = await office();
    expect(r).toMatchObject({ outcome: "uncertain", detail: UNCERTAIN_SEND_DETAIL });
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded", provider: "resend", sent_at: null });
    expect(String(sendRow()!.error)).toStartWith("sent_unknown: No clear answer from the email service (timed out)");
    expect(events.filter((e) => e.type === "save_my_spot_outcome_unknown").length).toBe(1);
    expect(comms.length).toBe(0); // not recorded as a sent communication: we don't know it was sent
  });
  test("a provider that never answers is aborted by the real 20 s timeout and recorded as unknown (not failed)", async () => {
    mode = "hang";
    const t0 = Date.now();
    expect((await office()).outcome).toBe("uncertain");
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(19_000); expect(took).toBeLessThan(26_000);
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
  }, 30_000);
  for (const m of ["502", "409"] as const) test(`HTTP ${m} (gateway/provider error or idempotency conflict) -> unknown, not failed`, async () => {
    mode = m;
    expect((await office()).outcome).toBe("uncertain");
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
  });
  test("accepted but the 'sent' write fails -> never 'failed'; recorded as unknown and not retried", async () => {
    failSentWrite = true;
    expect((await office()).outcome).toBe("uncertain");
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded", provider_message_id: "re_1" });
    expect(String(sendRow()!.error)).toStartWith("sent_unknown: Accepted by the email service (id re_1) but the result could not be recorded:");
    failSentWrite = false; await auto(); await office();
    expect(calls.length).toBe(1);
  });
});

describe("network disconnect with unknown outcome", () => {
  test("dropped connection -> delivered_unrecorded", async () => {
    mode = "disconnect";
    expect((await office()).outcome).toBe("uncertain");
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
    expect(String(sendRow()!.error)).toContain("connection lost");
  });
});

describe("no retry after uncertain outcome", () => {
  for (const m of ["timeout", "disconnect", "502"] as const) test(`after ${m}: automatic triggers and the Office send button make no provider call`, async () => {
    mode = m; await office();
    mode = "ok";
    for (let i = 0; i < 3; i++) await auto();
    const again = await office();
    expect(again).toMatchObject({ outcome: "skipped", detail: "Already sent to this home." });
    expect(calls.length).toBe(1);
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
  });
});

describe("duplicate automatic trigger", () => {
  test("two concurrent automatic triggers on a fresh lead -> one reservation, one provider call", async () => {
    await Promise.all([auto(), auto(), auto()]);
    expect(calls.length).toBe(1);
    expect((T.customer_email_sends ?? []).length).toBe(1);
    expect(sendRow()).toMatchObject({ status: "sent" });
  });
  test("an automatic trigger while the first send is still in flight is skipped", async () => {
    mode = "hang";
    const first = office();
    await new Promise((r) => setTimeout(r, 20));
    mode = "ok";
    expect((await office()).outcome).toBe("skipped");
    await auto();
    expect(calls.length).toBe(1);
    await first; // 20 s timeout -> unknown
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
  }, 30_000);
});

describe("Office review and reconciliation", () => {
  test("'not delivered' -> failed; the next trigger sends exactly once more", async () => {
    mode = "timeout"; await office();
    await expect(resolve("not_delivered", "")).rejects.toThrow("Say what you checked");
    expect(await resolve("not_delivered", "Resend shows no email to this address")).toEqual({ ok: true, status: "failed", auditLogged: true });
    expect(String(sendRow()!.error)).toStartWith("office_confirmed_not_delivered: Resend shows no email to this address (was delivered_unrecorded: sent_unknown:");
    expect(events.find((e) => e.type === "save_my_spot_outcome_resolved")!.details).toMatchObject({ resolution: "not_delivered", previous_status: "delivered_unrecorded", new_status: "failed" });
    expect(calls.length).toBe(1); // resolving never sends
    mode = "ok"; await auto(); await auto(); await office();
    expect(calls.length).toBe(2);
    expect(sendRow()).toMatchObject({ status: "sent" });
  });
  test("'delivered' -> sent (final); never sent again; can't be resolved twice", async () => {
    mode = "disconnect"; await office();
    const attempt = String(sendRow()!.created_at);
    expect(await resolve("delivered", "Resend shows delivered 12 Oct 10:41")).toEqual({ ok: true, status: "sent", auditLogged: true });
    expect(sendRow()!.sent_at).toBe(attempt); // owner-contacted time = the attempt time (exact delivery time unknown)
    mode = "ok"; await auto(); await office();
    expect(calls.length).toBe(1);
    await expect(resolve("not_delivered", "changed my mind")).rejects.toThrow("There is no unresolved Save my spot email");
  });
  test("a send still in progress can't be resolved; a stale 'sending' left by a stopped process can", async () => {
    T.customer_email_sends!.push({ id: "s-old", job_id: J, purpose: LAUNCH_CAMPAIGN, idempotency_key: KEY, status: "sending", error: null, created_at: new Date().toISOString() });
    await expect(resolve("not_delivered", "checked Resend")).rejects.toThrow("still being sent");
    expect((await office()).outcome).toBe("skipped"); // a reservation in progress blocks sends
    sendRow()!.created_at = new Date(Date.now() - STALE_SENDING_MS - 1000).toISOString();
    expect((await resolve("not_delivered", "Resend shows nothing")).status).toBe("failed");
    expect(calls.length).toBe(0);
  });
  test("resolution is conditional on the status the Office saw (a concurrent change wins, nothing is overwritten)", async () => {
    mode = "timeout"; await office();
    const view = seen();
    const rs = await Promise.allSettled([
      resolveUncertainSaveSpot(J, "office-1", { ...view, resolution: "delivered", note: "Resend shows delivered" }),
      resolveUncertainSaveSpot(J, "office-2", { ...view, resolution: "not_delivered", note: "Resend shows nothing" }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(events.filter((e) => e.type === "save_my_spot_outcome_resolved").length).toBe(1);
  });
  test("a decision about an earlier attempt can never resolve a newer one", async () => {
    mode = "timeout"; await office();
    const officeAView = seen();                                   // Office A opens the dialog for attempt 1
    await resolve("not_delivered", "Resend shows nothing");       // Office B resolves attempt 1
    await new Promise((r) => setTimeout(r, 5));
    await auto();                                                 // attempt 2 also times out
    expect(calls.length).toBe(2);
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
    await expect(resolve("not_delivered", "Resend shows nothing (attempt 1)", officeAView)).rejects.toThrow("changed while you were checking");
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
    mode = "ok"; await auto(); await office();
    expect(calls.length).toBe(2);
  });
  test("a send id from another lead or another email purpose is refused", async () => {
    mode = "timeout"; await office();
    await expect(resolveUncertainSaveSpot("a0000000-0000-4000-8000-0000000005ff", "office-1", { ...seen(), resolution: "not_delivered", note: "Resend shows nothing" })).rejects.toThrow("no unresolved");
    expect(sendRow()).toMatchObject({ status: "delivered_unrecorded" });
    T.customer_email_sends!.push({ id: "ineligible-1", job_id: J, purpose: "preliminary_ineligible", idempotency_key: `ineligible:${J}`, status: "delivered_unrecorded", error: null, created_at: "2026-10-12T00:00:00.000Z" });
    await expect(resolveUncertainSaveSpot(J, "office-1", { sendId: "ineligible-1", attemptAt: "2026-10-12T00:00:00.000Z", resolution: "not_delivered", note: "Resend shows nothing" })).rejects.toThrow("no unresolved");
    expect(T.customer_email_sends!.find((r) => r.id === "ineligible-1")).toMatchObject({ status: "delivered_unrecorded" });
  });
  test("a very late result from a stalled attempt never lands on a newer attempt", async () => {
    mode = "hang";
    const stalled = office();                                     // attempt 1: no answer yet
    await new Promise((r) => setTimeout(r, 20));
    sendRow()!.created_at = new Date(Date.now() - STALE_SENDING_MS - 1000).toISOString(); // looks stopped to the Office
    // (the sender kept its own reservation time; simulate the Office resolving the stale reservation, then a new attempt)
    await resolve("not_delivered", "Resend shows nothing");
    mode = "ok"; await auto();                                    // attempt 2 accepted
    expect(sendRow()).toMatchObject({ status: "sent", provider_message_id: "re_2" });
    await stalled;                                                // attempt 1 times out after 20 s
    expect(sendRow()).toMatchObject({ status: "sent", provider_message_id: "re_2" }); // untouched
    expect(calls.length).toBe(2);
  }, 30_000);
});

describe("manual communication interaction (A1)", () => {
  test("while the outcome is unknown, Office can't prepare a hand-send copy; after 'not delivered' it can", async () => {
    mode = "timeout"; await office();
    expect(await prepareManualEmail(J, "office-1")).toMatchObject({ ok: false, reason: SYSTEM_ALREADY_SENT });
    await resolve("not_delivered", "Resend shows nothing");
    const p = await prepareManualEmail(J, "office-1");
    expect(p.ok).toBe(true);
    expect(calls.length).toBe(1); // preparing never sends
    expect(sendRow()).toMatchObject({ status: "failed" }); // and never reserves
  });
  test("a recorded 'Sent manually' blocks the portal even after a confirmed failure", async () => {
    mode = "timeout"; await office();
    await resolve("not_delivered", "Resend shows nothing");
    T.job_communications!.push({ id: "m1", job_id: J, source_event: MANUAL_SENT_EVENT, source_reference: manualSendReference("save_my_spot") });
    mode = "ok";
    expect((await office())).toMatchObject({ outcome: "skipped", detail: "The office already sent this email by hand (recorded manual send)." });
    await auto();
    expect(calls.length).toBe(1);
    expect(sendRow()).toMatchObject({ status: "failed" });
  });
  test("a recorded 'Sent manually' before any portal send: no reservation and no provider call", async () => {
    T.job_communications!.push({ id: "m1", job_id: J, source_event: MANUAL_SENT_EVENT, source_reference: manualSendReference("save_my_spot") });
    await auto(); await office();
    expect(calls.length).toBe(0);
    expect(sendRow()).toBeNull();
  });
});

describe("global communications disabled (customer_comms_enabled = false)", () => {
  test("follow-up and Group B senders are blocked before any reservation or provider call", async () => {
    expect((await S.sendExistingInsulationSaveSpot(J, "office-1")).outcome).toBe("blocked");
    expect((await S.sendAutomaticInsulationDetails(J)).outcome).toBe("blocked");
    expect(calls.length).toBe(0);
    expect(T.customer_email_sends).toEqual([]);
  });
  test("the Save my spot initial campaign is blocked when the global switch is off (COM-04 fail-closed); nothing changes the switch", async () => {
    // COM-04 requires BOTH switches ON: save_my_spot_real_send_enabled AND customer_comms_enabled.
    // With the global switch off the initial campaign is blocked before any reservation or provider call.
    T.workflow_settings = [{ id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: false }];
    mode = "timeout";
    const r = await auto();
    expect(r.sent).toBe(false);
    expect(String(r.reason)).toContain("switched off");
    expect(calls.length).toBe(0);
    expect(T.customer_email_sends).toEqual([]);
    expect(T.workflow_settings).toEqual([{ id: 1, save_my_spot_real_send_enabled: true, customer_comms_enabled: false }]);
    expect(writes.some((w) => w.endsWith(":workflow_settings"))).toBe(false);
  });
});

describe("Office review on the Leads list", () => {
  test("an unknown outcome is an exception with its own reason and resolve data; once resolved it leaves the exceptions", async () => {
    const { loadEnquiryGroups } = await import("../src/lib/enquiry-groups.server");
    const { uncertainAttentionReason } = await import("../src/lib/save-spot-delivery.core");
    mode = "timeout"; await office();
    const before = (await loadEnquiryGroups()).rows.find((r) => r.id === J)!;
    expect(before).toMatchObject({ status: "needs_attention", attentionReason: uncertainAttentionReason("save_my_spot") });
    expect(before.attentionReason).toStartWith("Save my spot email: outcome unknown");
    expect(String(before.emailOutcomeUnknown!.detail)).toStartWith("sent_unknown:");
    expect(before.emailOutcomeUnknown).toMatchObject({ sendId: sendRow()!.id, at: sendRow()!.created_at, kind: "save_my_spot" });
    await resolve("delivered", "Resend shows delivered");
    const after = (await loadEnquiryGroups()).rows.find((r) => r.id === J)!;
    expect(after.emailOutcomeUnknown).toBeNull();
    expect(after.status).toBe("offered_spot");
  });
  test("a lead whose owner already saved their spot keeps 'Spot saved' but still shows the unknown email for review", async () => {
    const { loadEnquiryGroups } = await import("../src/lib/enquiry-groups.server");
    mode = "timeout"; await office();
    T.lead_campaign_responses!.push({ job_id: J, spot_saved_at: "2026-10-12T00:00:00Z", opted_out_at: null });
    const row = (await loadEnquiryGroups()).rows.find((r) => r.id === J)!;
    expect(row.status).toBe("spot_saved");
    expect(row.emailOutcomeUnknown).not.toBeNull();
  });
});
