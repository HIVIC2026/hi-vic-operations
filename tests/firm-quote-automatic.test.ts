// S20-R01: AUTOMATIC replies to new website enquiries at their official eligibility decision, with the shared master
// switch (customer_comms_enabled) and therefore the scheduled backlog worker left OFF. Runs the REAL automatic router
// (maybeAutoRouteLeadEmail – what post-intake and an Office eligibility decision call), the REAL senders (Save my spot /
// Group B sendOne, the ineligible sender), the REAL new-enquiry gate and the REAL backlog worker against an in-memory admin
// DB (customer_email_sends.idempotency_key UNIQUE) and a STUBBED email service (the Resend connector gateway).
// Test recipient: jet.zhezhang@gmail.com (authorised by Jet for test emails); no email leaves this process.
import { beforeEach, afterAll, setSystemTime, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
let seq = 0;
let failSentWrite = false;
let failAllOutcomeWrites = false;
let unavailableCounts = false;
let beforeFinalSend: (() => void) | null = null;
let mediaReadHook: ((read: number) => void) | null = null;
let mediaReads = 0;
const historyReads: { table: string; head: boolean; exact: boolean }[] = [];
const writes: string[] = [];

// P1-R3-S103: automatic Save-my-spot SELECTION must be explicitly enabled (with no extra filters,
// i.e. no additional restriction) for the automatic route to reach the sender. It defaults to
// DISABLED and fails closed; missing / invalid / unreadable configurations are proven in
// tests/p1-r3-s103-office-automatic-sending-rules.test.ts.
const S103_AUTO_RULES = { version: 1, enabled: true, activatedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "test",
  rules: { eligibility: { enabled: false, outcomes: [] }, insulation: { enabled: false, values: [] },
    ceilingArea: { enabled: false, minM2: null, maxM2: null, includeUnknownArea: false },
    postcode: { enabled: false, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null },
    jobStatus: { enabled: false, stages: [] }, enquiryDate: { enabled: false, window: "last_3_days", fromDate: null, toDate: null } } };
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let values: unknown = null; let returning = false;
  const f: [string, string, unknown][] = [];
  let head = false, exact = false, rowLimit = Infinity;
  const orders: { key: string; ascending: boolean }[] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => kind === "eq" ? r[k] === v : kind === "neq" ? r[k] !== v : kind === "gte" ? String(r[k]) >= String(v) : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : kind === "like" ? String(r[k] ?? "").startsWith(String(v).replace(/%$/, "")) : true);
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
      if (table === "customer_email_sends" && (failAllOutcomeWrites || (failSentWrite && (values as Row).status === "sent"))) return { data: null, error: { message: "db write failed" } };
      const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row);
      return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    const hit = rows().filter(match);
    for (const o of [...orders].reverse()) hit.sort((a, b) => String(a[o.key] ?? '').localeCompare(String(b[o.key] ?? '')) * (o.ascending ? 1 : -1));
    if (exact && ['customer_email_sends', 'job_communications'].includes(table)) historyReads.push({ table, head, exact });
    return { data: head ? null : hit.slice(0, Math.min(rowLimit, 1000)), error: null, count: exact && !unavailableCounts ? hit.length : null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_columns?: string, options?: { count?: string; head?: boolean }) => { if (op !== 'select') returning = true; head = options?.head === true; exact = options?.count === 'exact'; return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    like: (k: string, pat: string) => { f.push([k, "like", pat]); return q; },
    neq: (k: string, v: unknown) => { f.push([k, 'neq', v]); return q; }, not: () => q, gte: (k: string, v: unknown) => { f.push([k, 'gte', v]); return q; },
    order: (key: string, options?: { ascending?: boolean }) => { orders.push({ key, ascending: options?.ascending !== false }); return q; }, limit: (n: number) => { rowLimit = n; return q; }, range: () => q, or: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
let rpcImpl: ((name: string, args: Row) => { data: unknown; error: unknown }) | null = null;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async (name: string, args: Row) => rpcImpl ? rpcImpl(name, args) : ({ data: null, error: null }) } }));
const events: { type: string; details: Row }[] = [];
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Row) => { events.push({ type, details }); }, requireAdmin: async () => {}, transition: async () => {} }));
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"u".repeat(32)}`;
const realSafety = await import("../src/lib/emailsafety.server");
let unsubIssued = 0; // "Create sending links" issues the owner's unsubscribe link only after every guard passed
mock.module("../src/lib/emailsafety.server", () => ({ ...realSafety, unsubscribeUrlForJob: async () => { unsubIssued++; beforeFinalSend?.(); beforeFinalSend = null; return UNSUB; } }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => `https://homeinsulationvictoria.com.au/homeowner?ref=${"r".repeat(43)}` }));
let media: { received: boolean; uncertain: boolean; pendingSync?: boolean } = { received: false, uncertain: false };
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => { mediaReads++; mediaReadHook?.(mediaReads); return media; } }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => ({}) })); // estimate/link refresh is not under test
const realComms = await import("../src/lib/comms.server");
const comms: Row[] = [];
// The recorded row also lands in the in-memory job_communications table, as the real insert would.
let failComms = false;
mock.module("../src/lib/comms.server", () => ({ ...realComms, recordCommunication: async (x: Row) => {
  if (failComms) throw new Error("communication write failed");
  comms.push(x);
  (T.job_communications ??= []).push({ id: `comm-${comms.length}`, job_id: x.jobId, source_event: x.sourceEvent, source_reference: x.sourceReference, direction: x.direction, channel: x.channel, visibility: x.visibility, delivery_status: x.deliveryStatus ?? "sent", sent_at: new Date().toISOString(), created_at: new Date().toISOString() });
  return `comm-${comms.length}`;
} }));

// The campaign read-model is isolated; the router and delivery sender remain the real implementation.
mock.module('../src/lib/launch-campaign.server', () => ({
  campaignLink: async (token: string) => {
    const link = T.customer_estimate_links?.find(r => r.token === token);
    const job = T.jobs?.find(r => r.id === link?.job_id);
    const review = [...(T.customer_engagement_events ?? [])].filter(r => r.job_id === job?.id && r.event_type === 'intake_media_reviewed' && r.source === 'office').sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))[0];
    return job ? { job, link, group: 'onsite', criteriaPassed: true, ownerQualified: true, mediaReview: (review?.metadata as Row)?.outcome ?? null } : null;
  },
  campaignPermission: (c: { criteriaPassed: boolean }, desk: string | null) => c.criteriaPassed && !['not_eligible', 'needs_onsite_check'].includes(desk ?? ''),
}));

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
process.env["HIVIC_COM04_ENV"] = "production"; // S102: these cases exercise the production send path (real recipient, stubbed provider)

const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { processPendingInitialEstimateEmails, sendPreliminaryIneligibleEmail } = await import("../src/lib/followups.server");
const C = await import("../src/lib/enquiry-auto-reply.core");
const { GROUP_B_GLOBALS_OFF, sendExistingInsulationSaveSpot, sendMorePhotosRequest } = await import("../src/lib/hot-leads-send.server");

setSystemTime(new Date("2026-11-06T06:00:00Z"));
afterAll(() => setSystemTime());
const TO = "synthetic@example.test";
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
  scenarios: [{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1481.76, pre_discount_total: 5198 } } }],
  // P1-S77: a real current estimate carries its itemised snapshot (estimate.server.ts); Jo's templates need it.
  snapshot: { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] } });
const sends = () => T.customer_email_sends ?? [];
const sentRow = (key: string) => sends().find((s) => s.idempotency_key === key) ?? null;
const { LAUNCH_CAMPAIGN } = await import("../src/lib/launch-campaign.core");
const KEYS = { L: `${LAUNCH_CAMPAIGN}:save_my_spot:${L}`, B: `${LAUNCH_CAMPAIGN}:insulation_details:${B}`, I: `preliminary_ineligible:${I}` };
/** Automatic enquiry emails ON with a start time (the go-live moment), master switch untouched (OFF). */
const autoOn = (startsAt = ago(2 * HOUR)) => { T.customer_delivery_settings = [{ id: 1, enabled: true, jobs_created_after: startsAt, provider: "base44_bridge", endpoint_url: null, hmac_secret: null }]; };

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  failAllOutcomeWrites = false; failComms = false; rpcImpl = null; unavailableCounts = false; beforeFinalSend = null; mediaReadHook = null; mediaReads = 0; historyReads.length = 0;
  mode = "ok"; failSentWrite = false; calls.length = 0; events.length = 0; comms.length = 0; writes.length = 0; media = { received: false, uncertain: false }; unsubIssued = 0;
  Object.assign(T, {
    jobs: [job(L, "HV-3001", "likely_eligible", "none", ago(HOUR)), job(B, "HV-3002", "needs_onsite_confirmation", "Yes - some batts", ago(HOUR)), job(I, "HV-3003", "does_not_appear_eligible", "Yes", ago(HOUR))],
    customer_estimate_links: [
      { id: "ll", job_id: L, token: "L".repeat(43), purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z" },
      { id: "lb", job_id: B, token: "B".repeat(43), purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z" },
    ],
    veu_location_variables: [{ postcode: "3000" }], // S102: establish service coverage for the automatic offer_spot send
    indicative_estimates: [est("el", L, "none"), est("eb", B, "present")],
    retail_estimator_settings: [{ is_current: true, indicative_veec_value: 61.74 }],
    owner_contact_consents: [L, B, I].map((j) => ({ job_id: j, consent_status: "granted", created_at: ago(HOUR) })),
    workflow_settings: [{ id: 1, customer_comms_enabled: false, save_my_spot_auto_rules: S103_AUTO_RULES }], // the shared master switch stays OFF throughout
    customer_delivery_settings: [{ id: 1, enabled: false, jobs_created_after: null, provider: "base44_bridge", endpoint_url: null, hmac_secret: null }],
    customer_email_optouts: [], lead_campaign_responses: [], job_communications: [], customer_email_sends: [], ceiling_measurements: [], property_area_estimates: [],
    customer_referral_tokens: [], post_intake_work: [], customer_engagement_events: [],
  });
});


function firmSetup(id=L){
  autoOn();
  Object.assign(T.workflow_settings[0],{customer_comms_enabled:true,save_my_spot_real_send_enabled:true,firm_quote_flow_live_at:ago(2*HOUR)});
  T.retail_estimator_settings[0].removal_inc_gst_per_m2=12;
  T.documents=[{job_id:id,kind:'intake_media',mime_type:'image/jpeg',storage_path:`${id}/intake/roof.jpg`}];
  media={received:true,uncertain:false};
}
test('null switch preserves automatic legacy email bytes, purpose, key and result',async()=>{
  firmSetup();T.workflow_settings[0].firm_quote_flow_live_at=null;
  const {renderJoOutcomeEmail}=await import('../src/lib/jo-outcome-email.core');
  const {withUnsubscribe}=await import('../src/lib/emailsafety.core');
  const url=`https://estimate.homeinsulationvictoria.com.au/estimate/${'L'.repeat(43)}`;
  const expected=renderJoOutcomeEmail({outcome:'likely_eligible',insulation:'none',ceilingSizeKnown:true,deskCheckStatus:null,recipient:{firstName:'Jet',propertyAddress:'1 Fixture Street, Testville 3000',enquiryReference:'HV-3001'},figures:{veuRebate:1481.76,customerTotal:3716.24,totalBeforeRebate:5198,installation:4500,piesaFee:349,apFee:349,ceilingAreaM2:120,areaEstimated:false,removalUpTo:null},links:{saveMySpotUrl:`${url}/campaign`,uploadMediaUrl:`${url}/video`,reviewResultUrl:url,calculatorUrl:`${url}/calculator`}});
  if(!expected)throw new Error('Legacy mail fixture must render');
  const mail=withUnsubscribe(expected,UNSUB);
  expect(await maybeAutoRouteLeadEmail(L)).toEqual({route:'offer_spot',sent:true,reason:'Sent'});
  expect(calls[0]?.body).toMatchObject({subject:mail.subject,html:mail.html,text:mail.plainText});
  expect(calls[0]?.idem).toBe(KEYS.L);expect(sends()[0]?.purpose).toBe(LAUNCH_CAMPAIGN);
});
test('firm automatic first response gets new subject and purpose without spot-offered event',async()=>{
  firmSetup();
  expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(true);
  expect(calls[0]?.body.subject).toBe('Jet, your preliminary estimate: $3,716 after a $1,482 rebate');
  expect(calls[0]?.idem).toBe(`firm_quote_preliminary:${L}`);
  expect(sends()[0]?.purpose).toBe('firm_quote_preliminary');
  expect(String(calls[0]?.body.text)).toContain(`/estimate/${'L'.repeat(43)}/firm-quote`);
  expect(events.some(e=>e.type==='save_my_spot_email_sent'||e.type==='spot_offered')).toBe(false);
  expect(T.lead_campaign_responses).toEqual([]);
  expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(1);
});
test('firm existing-insulation automatic path uses caller removal rate',async()=>{
  firmSetup(B);
  expect(await maybeAutoRouteLeadEmail(B)).toMatchObject({sent:true});
  expect(calls[0]?.body.subject).toBe('Jet, your preliminary estimate: $3,716 after a $1,482 rebate');
  expect(String(calls[0]?.body.text)).toContain('$12/m²');
  expect(sends()[0]?.purpose).toBe('firm_quote_preliminary');
});
test('firm automatic response remains blocked with master off',async()=>{firmSetup();T.workflow_settings[0].customer_comms_enabled=false;expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(0)});
test('firm automatic response rechecks consent after preparation',async()=>{firmSetup();beforeFinalSend=()=>{T.owner_contact_consents[0].consent_status='withdrawn'};expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(0)});
test('firm automatic response rechecks activation/media before provider',async()=>{firmSetup();beforeFinalSend=()=>{T.documents=[]};expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(0)});
test('firm automatic response does not send during Melbourne quiet hours',async()=>{firmSetup();setSystemTime(new Date('2026-11-06T09:00:00Z'));try{expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(0)}finally{setSystemTime(new Date('2026-11-06T06:00:00Z'))}});
test('firm automatic response requires removal setting without default',async()=>{firmSetup();delete T.retail_estimator_settings[0].removal_inc_gst_per_m2;expect((await maybeAutoRouteLeadEmail(L)).sent).toBe(false);expect(calls).toHaveLength(0)});
