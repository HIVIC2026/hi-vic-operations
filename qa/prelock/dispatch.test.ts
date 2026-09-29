// PRE-LOCK QA (2026-09-29) — behavioural tests of the estimate / ineligible / follow-up dispatch paths.
// Everything external is mocked: in-memory database, delivery provider (fake fetch), time. No network, no sends.
// `test.failing` = contract requirement the CURRENT code does NOT meet (confirmed defect). It passes while the defect exists.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "crypto";
import { fakeDb, id, type Tables } from "./fakedb";

let active = true;
let db: ReturnType<typeof fakeDb> | null = null;
const realClient = { ...(await import("../../src/integrations/supabase/client.server")) };
const proxyAdmin = { from: (n: string) => (active && db ? db.from(n) : (realClient.supabaseAdmin as any).from(n)), rpc: (n: string, a: any) => (active && db ? db.rpc(n, a) : (realClient.supabaseAdmin as any).rpc(n, a)) };
mock.module("@/integrations/supabase/client.server", () => ({ ...realClient, supabaseAdmin: proxyAdmin }));

// Controlled gates.
const S = { comms: false, consent: true, mode: "likely" as string, estimate: null as any, commFail: false, adapter: null as any };
const realComms = { ...(await import("../../src/lib/comms.server")) };
mock.module("../../src/lib/comms.server", () => ({
  ...realComms,
  customerCommsEnabled: async () => (active ? S.comms : realComms.customerCommsEnabled()),
  hasCurrentOwnerContactConsent: async (j: string) => (active ? S.consent : realComms.hasCurrentOwnerContactConsent(j)),
  recordCommunication: async (c: any) => { if (!active) return realComms.recordCommunication(c); if (S.commFail) throw new Error("db write failed after provider accepted"); return id(); },
}));
const realEst = { ...(await import("../../src/lib/estimate.server")) };
mock.module("../../src/lib/estimate.server", () => ({ ...realEst, refreshIndicativeEstimate: async (j: string) => (active ? { mode: S.mode, estimate: S.estimate } : realEst.refreshIndicativeEstimate(j)), customerView: (v: any) => (active ? { visible: v.mode === "likely" || v.mode === "onsite", mode: v.mode } : realEst.customerView(v)) }));
const realDel = { ...(await import("../../src/lib/delivery.server")) };
mock.module("../../src/lib/delivery.server", () => ({ ...realDel, configuredDeliveryAdapter: async () => (active ? S.adapter : realDel.configuredDeliveryAdapter()) }));
afterAll(() => { active = false; db = null; });

const F = await import("../../src/lib/followups.server");
const { bridgeAdapter, bridgeBody } = await import("../../src/lib/delivery.core");
const { computeEstimate } = await import("../../src/lib/estimate.core");
const { lookupLocation } = await import("../../src/lib/activity48.core");

const SECRET = "q".repeat(40);
let calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
let fetchMode: "ok" | "500" = "ok";
const fakeFetch = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> }); return fetchMode === "ok" ? new Response(JSON.stringify({ message_id: `m${calls.length}` }), { status: 200 }) : new Response("x", { status: 500 }); }) as unknown as typeof fetch;
const settings = { id: "s", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70, veec_value_source_label: "x", veec_value_source_url: "https://x", veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200, spec_version: "v25", spec_source_url: "https://x" };
const estimateFor = (m2: number, ins: "none" | "present" = "none") => ({ id: `est-${m2}`, ...computeEstimate({ m2, source: "owner_estimate", basis: "declared", id: null, label: "Your estimate" }, lookupLocation("3336")!, ins, settings as any) });

let tables: Tables;
function job(opts: { email?: string; linkExpires?: number; linkStatus?: string; linkCreated?: string } = {}) {
  const jobId = id();
  tables.jobs!.push({ id: jobId, owner_id: "o-" + jobId, stage: "new_enquiry", source: "base44", created_at: new Date().toISOString(), owners: { email: opts.email ?? "fixture.owner@homeowner-fixture.com.au" } });
  const linkId = id();
  tables.customer_estimate_links!.push({ id: linkId, job_id: jobId, token: "T".repeat(43), purpose: "step3_estimate", status: opts.linkStatus ?? "active", expires_at: new Date(Date.now() + (opts.linkExpires ?? 30 * 86_400_000)).toISOString(), created_at: opts.linkCreated ?? new Date().toISOString() });
  return { jobId, linkId };
}
beforeEach(() => {
  tables = { jobs: [], customer_estimate_links: [], customer_email_sends: [], customer_followups: [], engagement_tracking_tokens: [], customer_engagement_events: [], customer_referral_tokens: [], customer_referral_events: [], workflow_events: [], customer_email_optouts: [], owner_contact_consents: [], customer_delivery_settings: [{ id: 1, jobs_created_after: "2026-01-01T00:00:00Z" }] };
  db = fakeDb(tables, {
    claim_customer_followups: ({ _limit }: any) => { const due = tables.customer_followups!.filter((f) => Date.parse(f.due_at) <= Date.now() && f.status === "pending").slice(0, _limit); for (const f of due) { f.status = "queued"; f.attempts++; } return due.map((f) => ({ ...f })); },
  });
  Object.assign(S, { comms: true, consent: true, mode: "likely", estimate: estimateFor(150), commFail: false, adapter: bridgeAdapter({ url: "https://bridge.fixture.invalid/send", secret: SECRET }, fakeFetch) });
  calls = []; fetchMode = "ok";
});

describe("C1 send gates (all must deny; provider must not be called)", () => {
  const cases: Array<[string, () => void]> = [
    ["global switch OFF", () => { S.comms = false; }],
    ["adapter disabled", () => { S.adapter = null; }],
    ["missing / withdrawn consent (latest row not granted)", () => { S.consent = false; }],
    ["Gate 1 review", () => { S.mode = "withheld_review"; }],
    ["Gate 1 ineligible", () => { S.mode = "none_ineligible"; }],
  ];
  for (const [name, set] of cases) test(name, async () => { const { jobId } = job(); set(); const r = await F.sendInitialEstimateEmail(jobId, null); expect(r.sent).toBe(false); expect(calls.length).toBe(0); });
  test("expired link", async () => { const { jobId } = job({ linkExpires: -1000 }); expect((await F.sendInitialEstimateEmail(jobId, null)).sent).toBe(false); expect(calls.length).toBe(0); });
  test("revoked link", async () => { const { jobId } = job({ linkStatus: "revoked" }); expect((await F.sendInitialEstimateEmail(jobId, null)).sent).toBe(false); expect(calls.length).toBe(0); });
  test("control: all gates open => exactly one provider call", async () => { const { jobId } = job(); expect((await F.sendInitialEstimateEmail(jobId, null)).sent).toBe(true); expect(calls.length).toBe(1); });
});

describe("C2 amounts: email equals landing-page values (same computeEstimate primary/standard)", () => {
  const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
  const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
  for (const m2 of [100, 125, 150, 200, 175]) test(`${m2} m² no insulation`, async () => {
    S.estimate = estimateFor(m2); const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null);
    const b = JSON.parse(calls[0]!.body); const st = S.estimate.primary.by_access.standard;
    expect(b.html).toContain(money(st.estimated_customer_total)); expect(b.html).toContain(money(S.estimate.applied_discount));
    expect(money(st.estimated_customer_total)).toBe(dollars(st.estimated_customer_total)); // page uses dollars()
    expect(S.estimate.scenarios.length).toBe(1);
  });
  test("existing insulation: page shows removal contingency; email total = can-remain scenario", async () => {
    S.estimate = estimateFor(150, "present"); const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null);
    expect(S.estimate.scenarios.map((s: any) => s.key)).toEqual(["can_remain", "full_removal"]);
    expect(JSON.parse(calls[0]!.body).html).toContain(money(S.estimate.primary.by_access.standard.estimated_customer_total));
  });
  test("existing insulation: email mentions that removal could change the price", async () => {
    S.estimate = estimateFor(150, "present"); const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null);
    expect(JSON.parse(calls[0]!.body).text).toMatch(/removal/i);
  });
});

describe("C3 idempotency / concurrency / ambiguous success", () => {
  test("duplicate retry after confirmed send => no second delivery", async () => { const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null); await F.sendInitialEstimateEmail(jobId, null); expect(calls.length).toBe(1); });
  test("same-key concurrent sends => one delivery", async () => { const { jobId } = job(); await Promise.all([F.sendInitialEstimateEmail(jobId, null), F.sendInitialEstimateEmail(jobId, null), F.sendInitialEstimateEmail(jobId, null)]); expect(calls.length).toBe(1); });
  test("provider 500 => failed row, retry allowed (unambiguous failure)", async () => { const { jobId } = job(); fetchMode = "500"; await F.sendInitialEstimateEmail(jobId, null); expect(tables.customer_email_sends![0]!.status).toBe("failed"); fetchMode = "ok"; await F.sendInitialEstimateEmail(jobId, null); expect(calls.length).toBe(2); });
  test("provider accepted, then DB write fails => must NOT be blindly redelivered", async () => {
    const { jobId } = job(); S.commFail = true; await F.sendInitialEstimateEmail(jobId, null); S.commFail = false; await F.sendInitialEstimateEmail(jobId, null);
    expect(calls.length).toBe(1);
  });
  test("state recorded for provider success+DB failure is 'delivered_unrecorded' (never retried)", async () => { const { jobId } = job(); S.commFail = true; await F.sendInitialEstimateEmail(jobId, null); expect(tables.customer_email_sends![0]!.status).toBe("delivered_unrecorded"); });
  test("stale 'sending' row (>10 min, outcome unknown) must not be re-sent blindly", async () => {
    const { jobId, linkId } = job(); tables.customer_email_sends!.push({ id: id(), job_id: jobId, estimate_link_id: linkId, purpose: "step3_estimate", idempotency_key: `step3_estimate:${linkId}:est-150`, status: "sending", created_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    await F.sendInitialEstimateEmail(jobId, null); expect(calls.length).toBe(0);
  });
  test("no 'delivered'/'accepted' state is ever written (only sending/sent/failed)", async () => { const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null); expect(new Set(tables.customer_email_sends!.map((s) => s.status))).toEqual(new Set(["sent"])); });
});

describe("C4 backlog release when sending is unlocked later", () => {
  test("links prepared while comms were OFF (e.g. QA @example.com jobs) are not all released on unlock", async () => {
    for (let i = 0; i < 3; i++) job({ email: `qa-${i}@example.com`, linkCreated: new Date(Date.now() - 20 * 86_400_000).toISOString() });
    const r = await F.processPendingInitialEstimateEmails(20);
    expect(r.sent).toBe(0);
  });
  test("scan does nothing while comms OFF or adapter null", async () => { job(); S.comms = false; expect((await F.processPendingInitialEstimateEmails()).scanned).toBe(0); S.comms = true; S.adapter = null; expect((await F.processPendingInitialEstimateEmails()).scanned).toBe(0); expect(calls.length).toBe(0); });
});

describe("C5 Base44 bridge contract (mocked HTTP)", () => {
  test("estimate: purpose, Idempotency-Key, HMAC over exact body", async () => {
    const { jobId, linkId } = job(); await F.sendInitialEstimateEmail(jobId, null);
    const c = calls[0]!; const b = JSON.parse(c.body);
    expect(b.purpose).toBe("step3_estimate"); expect(b.idempotency_key).toBe(`step3_estimate:${linkId}:est-150`);
    expect(c.headers["Idempotency-Key"]).toBe(b.idempotency_key); expect(c.headers["x-hivic-signature"]).toBe(createHmac("sha256", SECRET).update(c.body).digest("hex"));
    expect(Object.keys(b).sort()).toEqual(["html", "idempotency_key", "purpose", "subject", "text", "to"]);
    expect(c.body).toBe(bridgeBody({ to: b.to, subject: b.subject, html: b.html, text: b.text, idempotencyKey: b.idempotency_key, purpose: b.purpose }));
  });
  test("ineligible: only signed Base44 does_not_appear_eligible; key per job; once; no follow-ups", async () => {
    const { jobId } = job(); tables.workflow_events!.push({ job_id: jobId, event_type: "preliminary_eligibility_recorded", details: { preliminary_outcome: "does_not_appear_eligible", preliminary_reasons: "This activity covers residential ceiling insulation." }, created_at: new Date().toISOString() });
    expect((await F.sendPreliminaryIneligibleEmail(jobId)).sent).toBe(true);
    expect((await F.sendPreliminaryIneligibleEmail(jobId)).sent).toBe(false);
    const b = JSON.parse(calls[0]!.body); expect(calls.length).toBe(1); expect(b.purpose).toBe("preliminary_ineligible"); expect(b.idempotency_key).toBe(`preliminary_ineligible:${jobId}`);
    expect(calls[0]!.headers["x-hivic-signature"]).toBe(createHmac("sha256", SECRET).update(calls[0]!.body).digest("hex"));
    expect(b.html).toContain("homeinsulationvictoria.com.au/homeowner?ref="); expect(tables.customer_followups!.length).toBe(0);
  });
  test("ineligible: comms OFF / no consent / no adapter / likely preliminary => blocked", async () => {
    const { jobId } = job(); tables.workflow_events!.push({ job_id: jobId, event_type: "preliminary_eligibility_recorded", details: { preliminary_outcome: "does_not_appear_eligible" }, created_at: new Date().toISOString() });
    S.comms = false; expect((await F.sendPreliminaryIneligibleEmail(jobId)).reason).toBe("comms_disabled"); S.comms = true;
    S.consent = false; expect((await F.sendPreliminaryIneligibleEmail(jobId)).reason).toBe("no_consent"); S.consent = true;
    S.adapter = null; expect((await F.sendPreliminaryIneligibleEmail(jobId)).reason).toBe("provider_not_configured");
    const j2 = job(); expect((await F.sendPreliminaryIneligibleEmail(j2.jobId)).reason).toBe("not_preliminary_ineligible"); expect(calls.length).toBe(0);
  });
});

describe("C6 follow-ups with fake time", () => {
  const DAY = 86_400_000;
  async function sentJob(events: Array<{ event_type: string; offsetMs: number }> = []) {
    const { jobId, linkId } = job(); await F.sendInitialEstimateEmail(jobId, null);
    const sentAt = Date.parse(tables.customer_engagement_events!.find((e) => e.event_type === "email_sent")?.occurred_at ?? new Date().toISOString());
    for (const e of events) tables.customer_engagement_events!.push({ id: id(), job_id: jobId, event_type: e.event_type, occurred_at: new Date(sentAt + e.offsetMs).toISOString(), metadata: {} });
    return { jobId, linkId, sentAt };
  }
  const realNow = Date.now;
  const at = (ms: number) => { Date.now = () => ms; };
  afterAll(() => { Date.now = realNow; });
  test("initial email queues exactly 3d + 7d rows; does not depend on opens", async () => { const { jobId } = await sentJob(); const f = tables.customer_followups!.filter((x) => x.job_id === jobId); expect(f.map((x) => x.slot).sort()).toEqual(["3d", "7d"]); });
  test("Day 3 unopened branch", async () => { const { sentAt } = await sentJob(); calls = []; at(sentAt + 3 * DAY + 1000); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(JSON.parse(calls[0]!.body).purpose).toBe("estimate_unopened_3d"); });
  test("Day 3 engaged (click) branch", async () => { const { sentAt } = await sentJob([{ event_type: "email_clicked", offsetMs: DAY }]); calls = []; at(sentAt + 3 * DAY + 1000); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(JSON.parse(calls[0]!.body).purpose).toBe("estimate_engaged_no_booking_3d"); });
  test("Day 7 reminder after Day 3", async () => { const { sentAt } = await sentJob(); at(sentAt + 7 * DAY + 1000); calls = []; try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(calls.map((c) => JSON.parse(c.body).purpose).sort()).toEqual(["estimate_second_reminder_7d", "estimate_unopened_3d"]); });
  test("booking completed => both suppressed, no delivery", async () => { const { sentAt } = await sentJob([{ event_type: "booking_completed", offsetMs: DAY }]); calls = []; at(sentAt + 8 * DAY); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(calls.length).toBe(0); });
  for (const ev of ["email_bounced", "complaint", "opted_out", "payment_received", "quote_declined"]) {
    test(`${ev} => pending reminders suppressed`, async () => { const { sentAt } = await sentJob([{ event_type: ev, offsetMs: DAY }]); calls = []; at(sentAt + 3 * DAY + 1000); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(calls.length).toBe(0); });
  }
  test("row manually suppressed AFTER being claimed is re-read before delivery", async () => {
    const { sentAt } = await sentJob(); calls = []; at(sentAt + 3 * DAY + 1000);
    const orig = db!.rpc; db!.rpc = async (n: string, a: any) => { const r = await orig(n, a); for (const f of tables.customer_followups!) if (f.status === "queued") f.status = "suppressed"; return r; };
    try { await F.processDueFollowups(); } finally { Date.now = realNow; db!.rpc = orig; }
    expect(calls.length).toBe(0);
  });
  test("reminder >7 days late => suppressed expired_unsent", async () => { const { sentAt } = await sentJob(); calls = []; at(sentAt + 15 * DAY); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(calls.length).toBe(0); });
  test("comms switched OFF before Day 3 => blocked, stays pending, no delivery", async () => { const { sentAt } = await sentJob(); calls = []; S.comms = false; at(sentAt + 3 * DAY + 1000); try { await F.processDueFollowups(); } finally { Date.now = realNow; } expect(calls.length).toBe(0); expect(tables.customer_followups!.some((f) => f.status === "pending" && f.blocked_reason === "comms_disabled")).toBe(true); });
});

describe("C8 email type vs eligibility", () => {
  test("clean likely_eligible job does NOT get the 'ONSITE CONFIRMATION NEEDED' badge", async () => { S.mode = "likely"; const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null); expect(JSON.parse(calls[0]!.body).text).not.toContain("ONSITE CONFIRMATION NEEDED"); });
  test("onsite jobs get confirmation copy while likely jobs do not", async () => { S.mode = "likely"; const a = job(); await F.sendInitialEstimateEmail(a.jobId, null); S.mode = "onsite"; const b = job(); await F.sendInitialEstimateEmail(b.jobId, null); expect(JSON.parse(calls[0]!.body).text).not.toContain("WHAT WE NEED TO CONFIRM"); expect(JSON.parse(calls[1]!.body).text).toContain("WHAT WE NEED TO CONFIRM"); });
});

describe("C7 unsubscribe / opt-out", () => {
  test("every customer email carries a visible unsubscribe link", async () => { const { jobId } = job(); await F.sendInitialEstimateEmail(jobId, null); expect(JSON.parse(calls[0]!.body).html).toMatch(/unsubscribe/i); });
  test("an unsubscribe route exists", async () => { const fs = await import("fs"); expect(fs.readdirSync("src/routes", { recursive: true }).map(String).some((p) => /unsubscribe|opt-?out/i.test(p))).toBe(true); });
});

describe("C9 secure link + tracking", () => {
  const L = () => import("../../src/lib/estimatelink.server");
  const E = () => import("../../src/lib/engagement.server");
  test("valid token => payload with referral URL that is NOT the estimate URL; view counted", async () => {
    const { linkId } = job(); const r: any = await (await L()).resolvePublicEstimate("T".repeat(43));
    expect(r).not.toBeNull(); expect(JSON.stringify(r)).not.toContain("T".repeat(43)); expect(r.referralShareUrl).toMatch(/^https:\/\/homeinsulationvictoria\.com\.au\/homeowner\?ref=[A-Za-z0-9_-]{43}$/);
    expect(tables.customer_estimate_links!.find((l) => l.id === linkId)!.view_count).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/fixture-owner|job_id|@example/);
  });
  test("expired / revoked / malformed / unknown => null (generic unavailable)", async () => {
    job({ linkExpires: -1 }); expect(await (await L()).resolvePublicEstimate("T".repeat(43))).toBeNull();
    tables.customer_estimate_links = []; job({ linkStatus: "revoked" }); expect(await (await L()).resolvePublicEstimate("T".repeat(43))).toBeNull();
    expect(await (await L()).resolvePublicEstimate("short")).toBeNull(); expect(await (await L()).resolvePublicEstimate("U".repeat(43))).toBeNull();
  });
  test("Gate 1 later review => link revoked on open, estimate not shown", async () => { job(); S.mode = "withheld_review"; expect(await (await L()).resolvePublicEstimate("T".repeat(43))).toBeNull(); expect(tables.customer_estimate_links![0]!.status).not.toBe("active"); });
  test("tracking write failure does not stop a valid estimate opening", async () => {
    job(); const orig = db!.from; db!.from = (n: string) => { if (n === "customer_engagement_events") throw new Error("tracking down"); return orig(n); };
    try { expect(await (await L()).resolvePublicEstimate("T".repeat(43))).not.toBeNull(); } finally { db!.from = orig; }
  });
  test("page views / calculator use never trigger a send", async () => { job(); await (await L()).resolvePublicEstimate("T".repeat(43)); await (await E()).recordCalculatorUse("T".repeat(43), 150); await (await E()).recordCalculatorUse("T".repeat(43), 175); expect(calls.length).toBe(0); expect(tables.customer_email_sends!.length).toBe(0); });
  test("pixel within 2 min flagged prefetch; later automated proxy fetch still counts as 'reliable open' (heuristic limitation)", async () => {
    const eng = await import("../../src/lib/engagement.core");
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    const s1 = eng.summarize([{ event_type: "email_sent", occurred_at: new Date(t0).toISOString() }, { event_type: "email_opened", occurred_at: new Date(t0 + 60_000).toISOString(), metadata: { prefetch_suspected: true } }]);
    expect(s1.reliableOpen).toBe(false);
    const s2 = eng.summarize([{ event_type: "email_sent", occurred_at: new Date(t0).toISOString() }, { event_type: "email_opened", occurred_at: new Date(t0 + 3 * 60_000).toISOString(), metadata: { ua_class: "gmail_proxy", prefetch_suspected: false } }]);
    expect(s2.reliableOpen).toBe(true); // a proxy fetch 3 min later is treated as a real open => changes Day 3 copy branch
    expect(eng.threeDayKind(s2)).toBe("estimate_engaged_no_booking_3d");
  });
  test("click token => 302 target is the secure path; expired link => generic unavailable", async () => {
    const { jobId, linkId } = job(); tables.engagement_tracking_tokens!.push({ id: id(), token: "C".repeat(43), kind: "click", job_id: jobId, estimate_link_id: linkId, purpose: "step3_estimate", expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString() });
    expect(await (await E()).resolveClick("C".repeat(43))).toBe(`/estimate/${"T".repeat(43)}`);
    tables.customer_estimate_links![0]!.status = "revoked"; expect(await (await E()).resolveClick("C".repeat(43))).toBe("/estimate/unavailable");
    expect(await (await E()).resolveClick("bad")).toBe("/estimate/unavailable");
  });
});

describe("C10 referral", () => {
  const R = () => import("../../src/lib/referral.server");
  test("one reusable token per job; eligible and Base44-only ineligible both get a link", async () => {
    const a = await (await R()).referralUrlForJob("job-a"); expect(await (await R()).referralUrlForJob("job-a")).toBe(a);
    const b = await (await R()).referralUrlForExternalEnquiry("HIV-FIXTURE01"); expect(b).not.toBe(a); expect(b).toMatch(/\?ref=[A-Za-z0-9_-]{43}$/);
  });
  test("duplicate referred submission counted once; click deduped per 10 min", async () => {
    let bumps: string[] = []; const orig = db!.rpc; db!.rpc = async (n: string, a: any) => { if (n === "bump_referral_counter") bumps.push(a._field); return orig(n, a); };
    try { const url = await (await R()).referralUrlForJob("job-b"); const tok = new URL(url).searchParams.get("ref")!;
      await (await R()).recordReferralSubmission(tok, "HIV-FRIEND01"); await (await R()).recordReferralSubmission(tok, "HIV-FRIEND01");
      await (await R()).trackReferralClick(tok); await (await R()).trackReferralClick(tok);
      expect(bumps).toEqual(["submission", "click"]); } finally { db!.rpc = orig; }
  });
  test("no friend PII is accepted by submission parser; nothing is sent to a friend", async () => {
    const { submissionBody } = await import("../../src/lib/referral.core");
    expect(submissionBody({ token: "A".repeat(43), external_enquiry_id: "HIV-1", friend_email: "x@example.com" })).toEqual({ token: "A".repeat(43), external_enquiry_id: "HIV-1" });
    expect(calls.length).toBe(0);
  });
});
