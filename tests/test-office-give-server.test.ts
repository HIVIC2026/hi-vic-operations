// Jo 5 Nov 2026: the TEST office login may give a TEST (qa_test) job to a TEST partner from Choose installer, so the
// nightly automatic TEST journey can get past the job page. The server allows it only when EVERY job is qa_test AND the
// business is a TEST partner; the real office path still never lists or gives qa_test jobs.
// Runs the real in-house-batch.server with the real owner will-call and installer Give email senders over an in-memory
// database; every real sender is a spy that must never be reached by a TEST give.
import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import * as rules from "../src/lib/in-house-batch.core";
import * as displayName from "../src/lib/display-name.core";
import * as inHouse from "../src/lib/in-house.core";
import * as willCall from "../src/lib/owner-will-call.core";
import * as workflow from "../src/lib/workflow";
import * as quoteHold from "../src/lib/quote-hold.core";
import * as giveCore from "../src/lib/in-house-give-email.core";
import * as layout from "../src/lib/partner-email.core";
import * as testCore from "../src/lib/test-send.core";
import { stableUuid } from "../src/lib/mitti-create-claim.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "../src/lib/quick-taps.core";
import * as photoQuote from "../src/lib/photo-quote.core";
import * as photoNotice from "../src/lib/owner-photo-quote-notice.core";
import * as sweepBatch from "../src/lib/sweep-batch.core";

const load = (file: string, deps: Record<string, unknown>) => {
  const api: any = {};
  new Function("exports", "require", ts.transpile(readFileSync(file, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => {
    if (!(p in deps)) throw Error(`Unmocked ${p}`);
    return deps[p];
  });
  return api;
};

const NOW = new Date();
function fixture() {
  const job = (id: string, source: string, n: string) => ({ id, job_number: n, property_id: "p", owner_id: `o-${id}`, stage: "preliminary_estimate_ready", source, channel: "hivic_sourced", originating_installer_business_id: null, deleted_at: null });
  const yes = (jobId: string) => ({ id: `e-${jobId}`, job_id: jobId, event_type: QUICK_TAPS_ANSWERED_EVENT, details: { outcome: "pass", consent_share: true, go_label: "yes", batch_id: `qb-${jobId}` }, created_at: NOW.toISOString() });
  const consent = (jobId: string) => ({ id: `c-${jobId}`, job_id: jobId, consent_status: "granted", consented_at: NOW.toISOString(), snapshot: {}, source: "quick_taps_reconsent", consent_key: `quick_taps_reconsent:qb-${jobId}:${jobId}` });
  const biz = (id: string, name: string, email: string, notes: string | null) => ({ id, name, trading_name: name, email, onboarding_notes: notes, in_house: true, is_active: true, service_postcodes: ["3199"], covers_all_victoria: false, coverage_lat: null, coverage_lng: null, coverage_radius_km: null });
  const rows: Record<string, any[]> = {
    jobs: [job("t1", "qa_test", "HV-T1"), job("t2", "qa_test", "HV-T2"), job("r1", "base44", "HV-1")],
    owners: [{ id: "o-t1", full_name: "Tess Test", phone: "0400 000 001", email: "owner1@hivic-test.example" }, { id: "o-t2", full_name: "Tom Test", phone: null, email: "owner2@hivic-test.example" }, { id: "o-r1", full_name: "Real Owner", phone: "0400 000 002", email: "real@example.com" }],
    businesses: [biz("tb", "[TEST PARTNER] Bravo", "bravo@hivic-test.example", "[TEST PARTNER] journey"), biz("rb", "Rapid Insulation", "office@rapid.example", null)],
    properties: [{ id: "p", postcode: "3199", address_line: "1 Test St", suburb: "Testville" }],
    property_facts: [], job_assignments: [], customer_email_optouts: [], customer_email_sends: [], bookings: [],
    lead_campaign_responses: ["t1", "t2", "r1"].map(j => ({ id: `l-${j}`, job_id: j, spot_saved_at: "2026-11-01", saved_insulation: null })),
    workflow_events: [...["t1", "t2", "r1"].map(yes), ...[["t1", "tb"], ["t2", "tb"], ["r1", "rb"]].map(([jobId, biz]) => ({ id: `a-${jobId}`, job_id: jobId, event_type: "area_batch_sent", details: { batch_id: `qb-${jobId}`, installer_business_id: biz }, created_at: NOW.toISOString() }))],
    owner_contact_consents: ["t1", "t2", "r1"].map(consent),
    partner_workers: [{ id: "w1", business_id: "tb", profile_id: "ti", trade_role: "installer", approval_status: "approved", removed_at: null, email: "inst@hivic-test.example", licence_expires_on: null, created_at: "2026-10-01" },
      { id: "w2", business_id: "rb", profile_id: "ri", trade_role: "installer", approval_status: "approved", removed_at: null, email: "inst@rapid.example", licence_expires_on: null, created_at: "2026-10-01" }],
    business_members: [{ id: "m1", business_id: "tb", user_id: "ti", active: true }, { id: "m2", business_id: "rb", user_id: "ri", active: true }],
  };
  const mem = memoryPostgrest(rows);
  const rpcCalls: any[] = [];
  const real: string[] = [];
  const tests: any[] = [];
  const admin: any = {
    from: (table: string) => { const q = mem.from(table); const eq = q.eq; q.eq = (c: string, v: unknown) => (c === "details" && typeof v === "string" ? q.contains(c, JSON.parse(v)) : eq(c, v)); return q; },
    rpc: async (name: string, input: any) => { rpcCalls.push({ name, input }); return { data: { sent: true }, error: null }; },
  };
  const client = { "@/integrations/supabase/client.server": { supabaseAdmin: admin } };
  // Real senders, with both approval switches forced ON so only the TEST routing can keep them quiet.
  const partnerCall = load("src/lib/in-house-batch-email.server.ts", {
    ...client, "./owner-will-call.core": { ...willCall, OWNER_WILL_CALL_APPROVED: true }, "./workflow": workflow, "./quote-hold.core": quoteHold, "./display-name.core": displayName,
    "./owner-photo-quote-notice.core": photoNotice, "./photo-quote.core": photoQuote, "./sweep-batch.core": sweepBatch,
    "./owner-contact.server": { businessContactForJob: async () => ({ name: "Bravo", tradingName: "Bravo", phone: "0400 000 009", email: "bravo@hivic-test.example" }) },
    "./comms.server": { assertCustomerDeliveryAllowed: async () => undefined },
    "./owner-email-send.server": { sendGuardedOwnerEmail: async () => { real.push("sendGuardedOwnerEmail"); return "sent"; } },
    "./sms.server": { sendRealSms: async () => { real.push("sendRealSms"); return { status: "sent" }; } },
    "./workflow.server": { logEvent: async () => undefined },
  });
  const notices = load("src/lib/in-house-booking-notices.server.ts", { ...client, "./in-house-booking.core": {}, "./partner-email.core": layout, "./mitti-create-claim.core": { stableUuid } });
  const giveEmail = load("src/lib/in-house-give-email.server.ts", {
    ...client, "./in-house-give-email.core": { ...giveCore, IN_HOUSE_GIVE_EMAIL_APPROVED: true }, "./display-name.core": displayName, "./test-send.core": testCore,
    "./in-house-booking-notices.server": notices,
    "./trade-pause.server": { tradeMessagesPausedNow: async () => null },
    "./office-email.server": { sendOfficeEmail: async () => { real.push("sendOfficeEmail"); return { status: "sent" }; } },
    "./test-send.server": { sendTestEmail: async (ctx: any, to: string, subject: string) => { tests.push({ ctx, to, subject }); return { channel: "email", to, status: "sent", detail: "ok" }; } },
  });
  const api = load("src/lib/in-house-batch.server.ts", {
    ...client, "./in-house-batch.core": rules, "./quick-taps.core": { QUICK_TAPS_ANSWERED_EVENT },
    "./in-house-batch-email.server": partnerCall, "./in-house-give-email.server": giveEmail,
    "./owner-said.core": { ownerSaidRows: () => [] },
    "./installer-paid-electricians.server": { inHouseFactsFor: async () => ({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1, mittiAccountInvited: true }) },
    "./in-house.core": inHouse, "./display-name.core": displayName,
    "./sweep-batch.core": sweepBatch, "./photo-quote.core": photoQuote,
    // Detached like production's runAfterResponse; the sender is the real one, so any real send would still hit a spy.
    "./background.server": { runAfterResponse: (task: () => Promise<unknown>) => { void task().catch(() => undefined); return "dev_detached"; } },
  });
  return { api, rows, rpcCalls, real, tests };
}
const scope = (jobIds: string[], businessIds = ["tb"]) => ({ testOffice: { jobIds, businessIds } });

test("TEST office gives a qa_test job to a TEST partner: allowed, the normal give runs, the Give email goes to test-send and no real sender is called", async () => {
  const f = fixture();
  const r = await f.api.sendInHouseBatch({ businessId: "tb", jobIds: ["t1"], actorId: "qa-office" }, scope(["t1"]));
  expect(r).toEqual({ sent: ["t1"], refused: [], installerEmail: { status: "test_sent" } });
  // The normal give: the same atomic allocation RPC, bound to the TEST office actor and the TEST partner's installer.
  expect(f.rpcCalls).toHaveLength(1);
  expect(f.rpcCalls[0]).toMatchObject({ name: "allocate_in_house_batch_job", input: { _business: "tb", _job: "t1", _actor: "qa-office", _installer: "ti", _electrician: null } });
  // The Give email is claimed once (its normal record) and delivered only through test-send.
  expect(f.tests).toHaveLength(1);
  expect(f.tests[0].ctx.partnerIsTest).toBe(true);
  expect(f.rows["workflow_events"]!.filter(e => e.event_type === "in_house_office_email_claimed").map(e => ({ job: e.job_id, key: e.details.key, status: e.details.status })))
    .toEqual([{ job: "t1", key: giveCore.inHouseGiveEmailKey(f.rpcCalls[0].input._batch), status: "sent" }]);
  // Owner will-call (approval forced on) never reaches the real email or SMS sender for a TEST job; nor does the office email.
  expect(f.real).toEqual([]);
  expect(f.rows["customer_email_sends"]).toEqual([]);
});

test("TEST office + a real (non-qa_test) job → refused with a plain message, nothing allocated or sent", async () => {
  const f = fixture();
  await expect(f.api.sendInHouseBatch({ businessId: "tb", jobIds: ["r1"], actorId: "qa-office" }, scope(["r1"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  // A mixed request is refused whole: EVERY job must be a TEST job.
  await expect(f.api.sendInHouseBatch({ businessId: "tb", jobIds: ["t1", "r1"], actorId: "qa-office" }, scope(["t1", "r1"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  // A TEST job outside the checked scope is refused too.
  await expect(f.api.sendInHouseBatch({ businessId: "tb", jobIds: ["t1", "t2"], actorId: "qa-office" }, scope(["t1"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  expect(f.rpcCalls).toEqual([]); expect(f.real).toEqual([]); expect(f.tests).toEqual([]);
});

test("TEST office + a real business → refused, even when the business is in the passed scope", async () => {
  const f = fixture();
  await expect(f.api.sendInHouseBatch({ businessId: "rb", jobIds: ["t1"], actorId: "qa-office" }, scope(["t1"], ["rb"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  await expect(f.api.sendInHouseBatch({ businessId: "rb", jobIds: ["t1"], actorId: "qa-office" }, scope(["t1"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  // A [TEST PARTNER] mark without the reserved TEST email domain is not a TEST business.
  f.rows["businesses"]!.find(b => b.id === "tb")!.email = "bravo@gmail.com";
  await expect(f.api.sendInHouseBatch({ businessId: "tb", jobIds: ["t1"], actorId: "qa-office" }, scope(["t1"]))).rejects.toThrow(rules.TEST_GIVE_REFUSED);
  expect(f.rpcCalls).toEqual([]); expect(f.real).toEqual([]);
});

test("TEST office Choose installer read lists ONLY the scoped qa_test jobs and TEST businesses", async () => {
  const f = fixture();
  const screen = await f.api.loadInHouseBatches({ now: NOW, testOffice: { jobIds: ["t1", "t2", "r1"], businessIds: ["tb", "rb"] } });
  expect(screen.jobs.map((j: { id: string }) => j.id).sort()).toEqual(["t1", "t2"]);
  expect(screen.partners.map((p: { id: string }) => p.id)).toEqual(["tb"]);
  expect(await f.api.inHouseGiveForJob("t1", scope(["t1"]))).toMatchObject({ businessId: "tb" });
  expect(await f.api.inHouseGiveForJob("r1", scope(["r1"]))).toBeNull();
  // Empty scope → nothing at all.
  expect((await f.api.loadInHouseBatches({ testOffice: { jobIds: [], businessIds: ["tb"] } })).jobs).toEqual([]);
});

test("TEST jobs keep the owner phone-consent hold (no TEST shortcut)", async () => {
  const f = fixture();
  f.rows["owner_contact_consents"] = f.rows["owner_contact_consents"]!.filter(c => c.job_id !== "t2");
  f.rows["workflow_events"]!.find(e => e.job_id === "t2")!.details.batch_id = "other";
  const screen = await f.api.loadInHouseBatches({ now: NOW, testOffice: { jobIds: ["t1", "t2"], businessIds: ["tb"] } });
  expect(screen.waitingForCallConsent).toEqual(["t2"]);
  expect(screen.jobs.map((j: { id: string }) => j.id)).toEqual(["t1"]);
});

test("real admin path unchanged: its list still excludes qa_test jobs and TEST jobs are never given", async () => {
  const f = fixture();
  const screen = await f.api.loadInHouseBatches({ now: NOW });
  expect(screen.jobs.map((j: { id: string }) => j.id)).toEqual(["r1"]);
  expect(await f.api.inHouseGiveForJob("t1")).toBeNull();
  const r = await f.api.sendInHouseBatch({ businessId: "rb", jobIds: ["t1"], actorId: "admin" });
  expect(r.sent).toEqual([]);
  expect(f.rpcCalls).toEqual([]);
});
