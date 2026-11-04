// A1 complete route (external review 25 Oct 2026, §6 "Run both complete routes"; Jo approved the fix pass):
// an installer's OWN customer from Add a job to payouts, against an isolated PGlite database holding every portal table,
// through the REAL server modules. Only the external providers are faked (Mitti, Resend, Twilio, Xero, Stripe — all
// behind `fetch`, see tests/helpers/journey-harness.ts). At every step the persisted rows are read back: the job's
// stage, its workflow_events, the sends recorded with their idempotency keys, and that the next step is refused when
// tried too early.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeProviders, journeyAdmin, journeyDb, loadPendingFunctions, serverFnStandIn, fillAudit, stripePaidWebhook, type MittiItem } from "./helpers/journey-harness";

// ---- fixed TEST data ----------------------------------------------------------------------------------------------
const BIZ = "30000000-0000-4000-8000-0000000000a1", INST = "40000000-0000-4000-8000-0000000000a1";
const REC = "30000000-0000-4000-8000-0000000000e1", ELEC = "40000000-0000-4000-8000-0000000000e1";
const TEAM_ELEC = "50000000-0000-4000-8000-00000000e1ec"; // join ruling (4 Nov 2026): the installer's own Team electrician, picked at Add a job
const OFFICE = "40000000-0000-4000-8000-0000000000f1";
const TPL_A1 = "template_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", TPL_A2 = "template_a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2";
const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", TPL_A4 = "template_a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4", TPL_A5 = "template_a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
// Jo's own allow-listed TEST inbox and mobile (test-send.core TEST_ALLOWLIST) — nothing leaves the fake providers anyway.
// Both addresses are on the TEST send allowlist (test-send.core). The owner's is different from the trades' so the
// owner's verified identity (owner-verify.server links by verified email) is never a trade's own login.
const OWNER_EMAIL = "jolowexo@hotmail.com", TRADE_EMAIL = "jo@actpropertyinspections.com.au", OWNER_PHONE = "0477 511 901";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000", XERO_API_KEY: "test-xero", XERO_API_KEY_1: "test-xero", STRIPE_SECRET_KEY: "sk_test_journey", STRIPE_TEST_SECRET_KEY: "sk_test_journey", STRIPE_WEBHOOK_SECRET: "whsec_journey", STRIPE_TEST_WEBHOOK_SECRET: "whsec_journey", STRIPE_PAYMENTS_ENABLED: "true", HIVIC_COM04_TEST_RECIPIENTS: `${OWNER_EMAIL},${TRADE_EMAIL}`, ONBOARDING_FP_SECRET: "journey-swms-link-secret" })) process.env[k] = v;

const tplItem = (item_id: string, label: string, type = "textsingle"): MittiItem => ({ item_id, label, type });
const providers = fakeProviders({ mittiTemplates: {
  [TPL_A1]: { items: [tplItem("i_addr", "Site address", "address"), tplItem("i_owner", "Owner name"), tplItem("i_phone", "Homeowner phone"), tplItem("i_email", "Homeowner email"), tplItem("i_when", "Assessment date/time", "datetime")] },
  [TPL_A2]: { items: [tplItem("i_addr", "Site address", "address"), tplItem("i_owner", "Owner name"), tplItem("i_phone", "Homeowner phone"), tplItem("i_email", "Homeowner email"), tplItem("i_when", "Assessment date/time", "datetime")] },
} });
globalThis.fetch = providers.fetchImpl as typeof fetch;

const j = await journeyDb();
const fns = await loadPendingFunctions(j);
const { admin, asUser, storage } = journeyAdmin(j);
providers.storageFiles.map = storage;
const q = j.q;
await j.db.exec(readFileSync("drizzle/migrations/0183_date_free_esc_consent.sql","utf8"));

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// The running portal's persistent Mitti simulator (mitti-test-route.core: TEST people → `mitti_sim_audits`) is itself a
// test double; this journey exercises the real Mitti HTTP boundary against the fake provider behind `fetch` instead, so
// the TEST assignee is NOT re-routed here (the "sim_" id / stored-audit rules stay as they are).
const realTestRoute = await import("../src/lib/mitti-test-route.core");
mock.module("../src/lib/mitti-test-route.core", () => ({ ...realTestRoute, isTestMittiEmail: () => false, testMittiRoute: (method: string, path: string, body: unknown, stored?: (id: string) => boolean) => { const a = realTestRoute.auditIdOfPath(path); return a && (realTestRoute.isSimId(a) || stored?.(a)) ? `simulated audit ${a}` : null; } }));
// Background work is awaited by the test (the deployed Worker keeps it alive with waitUntil).
const pending: Promise<unknown>[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { backgroundErrors.push(e.message); })); return "wait_until"; } }));
const backgroundErrors: string[] = [];
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

// ---- seed: one TEST installer business (approved), its owner-member, HIV settings ------------------------------------
await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, mitti_account_invited, accepting_new_jobs, base_suburb, coverage_radius_km, phone, signer_mobile, email)
  values ($1,'TEST Journey Insulation','TEST Journey Insulation','11 222 333 444','eec_installer','{installer}',true,'approved',now(),'[TEST PARTNER] journey A1',true,true,'Frankston',60,'0477 511 901','0477 511 901',$2)`, [BIZ, TRADE_EMAIL]);
// Join ruling (4 Nov 2026): every installer runs the in-house model (go-live step "move every installer to in_house") with its
// own Team electrician; who-books "either" = the installer office or the electrician's link, whoever goes first (Part 5/6).
// Electrical upgrades (decisions 34/36, Jo 2 Nov 2026): the installer's electrician quotes, books and invoices them with the
// owner directly — partner-billed, no HIV fixes quote.
await q("update businesses set in_house = true, piesa_booked_by = 'either', rectification_billed_by = 'partner', address = '2 Journey Road, Frankston VIC 3199' where id = $1", [BIZ]);
await q(`insert into profiles (id, full_name, email, phone) values ($1,'Ivy Installer',$2,'0477 511 901'), ($3,'Ollie Office','office@hivic-test.example',null)`, [INST, TRADE_EMAIL, OFFICE]);
await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [BIZ, INST]);
await q(`insert into user_roles (user_id, role) values ($1,'installer'), ($2,'admin')`, [INST, OFFICE]);
// Join ruling (4 Nov 2026): Add a job's electrician is a verified electrician on the installer's OWN Team (office-verified licence + REC).
await q(`insert into partner_workers (id, business_id, trade_role, full_legal_name, email, mobile, licence_number, rec_number, licence_expires_on, licence_verified_at, account_status, approval_status, approved_at)
  values ($1,$2,'electrician','Will Casdorff',$4,'0477 511 901','A67890','REC-67890',$3,now(),'active','approved',now())`, [TEAM_ELEC, BIZ, new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10), TRADE_EMAIL]);
// Jo 4 Nov 2026: the owner's PIESA line on an installer's own job = that installer's PIESA rate (rate card, ex GST): $317.27 ex = $349.00 inc.
{ const [rc] = await q<{ id: string }>(`insert into rate_cards (business_id, kind, name, version, is_active, effective_from) values ($1,'installer','TEST Journey installer rates',1,true,current_date - 1) returning id`, [BIZ]);
  await q(`insert into rate_card_items (rate_card_id, category, code, description, unit, unit_price_ex_gst, sort) values ($1,'electrical','PIESA','Pre Insulation Electrical Safety Assessment','flat',317.27,9)`, [rc!.id]); }
await q(`insert into workflow_settings (id, mitti_ready_check_template_id, mitti_ready_check_priced_template_id, mitti_piesa_template_id, mitti_piisa_template_id, mitti_fixes_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst, payment_option_gate_enabled, ready_check_booking_enabled, piesa_install_window_days)
  values (1,$1,$2,$3,$4,$5,true,true,349,true,true,30)`, [TPL_A2, TPL_A1, TPL_A3, TPL_A5, TPL_A4]);
// Jo 30 Oct 2026 "Pause all trade messages" ships ON (column default): the office switches it off at go-live, as here.
await q("update workflow_settings set trade_messages_paused = false where id = 1");
await q(`insert into retail_estimator_settings (is_current, ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst) values (true, 349, 349, 95, 200)`);
// Pricing settings as the migration chain leaves them (0000 seed, 0058 AP fee $349 inc GST = 317.27 ex GST).
await q("insert into pricing_settings (version, ap_fee_ex_gst) values (1, 317.27)");
{ const { lookupLocation } = await import("../src/lib/activity48.core"); const l = lookupLocation("3199")!; await q("insert into veu_location_variables (postcode, metropolitan_or_regional, reticulated_gas, climate_region, climate_zone, source_version) values ($1,$2,$3,$4,$5,$6)", [l.postcode, l.metropolitan_or_regional, l.reticulated_gas, l.climate_region, l.climate_zone, l.source_version]); }

const events = (jobId: string, type: string) => q<{ summary: string; details: Record<string, unknown>; created_at: Date }>("select summary, details, created_at from workflow_events where job_id=$1 and event_type=$2 order by created_at", [jobId, type]);
const stageOf = async (jobId: string) => (await q<{ stage: string }>("select stage from jobs where id=$1", [jobId]))[0]!.stage;
const stagePath = async (jobId: string) => (await q<{ to_stage: string }>("select to_stage from workflow_events where job_id=$1 and event_type='stage_changed' order by created_at", [jobId])).map((r) => r.to_stage);
const comms = (jobId: string) => q<{ channel: string; source_event: string; delivery_status: string; recipients: string[] }>("select channel, source_event, delivery_status, recipients from job_communications where job_id=$1 order by created_at", [jobId]);

const ans = (label: string, text: string): MittiItem => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "textsingle", responses: { text } });
const pick = (label: string, ...labels: string[]): MittiItem => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "question", responses: { selected: labels.map((l) => ({ label: l })) } });

let JOB = "";
afterAll(async () => { await j.db.close(); });

describe("A1 journey — step 0: harness", () => {
  test("every pending SQL function the journey relies on compiled", () => {
    for (const f of ["accept_install_day", "approve_rectification_with_window", "accept_partner_offer", "accept_partner_offer_slot", "issue_owner_link_code", "commit_in_house_visit", "allocate_team_electrician", "add_installer_job"]) expect(fns.loaded).toContain(f);
  });
});

describe("A1 step 1 — Add a job (decisions 34/115/282/289)", () => {
  test("basics + permission → one job, owner, property, consent, electrician choice, Mitti A1 form created once", async () => {
    const os = await import("../src/lib/onsite-ready-check.server");
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, { full_name: "Helen Journey", address_line: "1 Journey Street", suburb: "Frankston", postcode: "3199", phone: OWNER_PHONE, email: OWNER_EMAIL, contact_permission: true, consent_by: "installer", address_verified: true } as never, null, undefined, { leadOrigin: "owner_contacted", electricianWorkerId: TEAM_ELEC });
    JOB = r.jobId;
    await settle();
    expect(backgroundErrors).toEqual([]);
    const [job] = await q<Record<string, unknown>>("select stage, channel, source, originating_installer_business_id, job_number from jobs where id=$1", [JOB]);
    expect(job).toMatchObject({ channel: "installer_sourced", source: "qa_test", originating_installer_business_id: BIZ });
    expect(String(job!["job_number"])).toMatch(/^HV-\d+$/);
    expect(await q("select consent_status from owner_contact_consents where job_id=$1", [JOB])).toEqual([{ consent_status: "granted" }]);
    // Join ruling: the Team electrician picked IS the installer's own electrician — recorded once, naming them; payer "own".
    expect((await events(JOB, "electrician_choice_set")).map((e) => [e.details["choice"], e.details["worker_id"], e.details["usual_name"]])).toEqual([["usual", TEAM_ELEC, "Will Casdorff"]]);
    expect(await q("select electrician_choice from jobs where id=$1", [JOB])).toEqual([{ electrician_choice: "preferred" }]);
    // In-house (Parts 6/7 + join ruling): the Team electrician is put on the job at Add a job — one electrician assignment with
    // no login (user_id null), one allocation event, and their no-login job link minted (hash only; the text waits on
    // ELECTRICIAN_LINK_TEXT_APPROVED, so nothing is sent to anyone here).
    expect(await q("select role, business_id, user_id from job_assignments where job_id=$1 and active order by role", [JOB])).toEqual([{ role: "electrician", business_id: BIZ, user_id: null }, { role: "installer", business_id: BIZ, user_id: INST }]);
    expect((await events(JOB, "in_house_electrician_allocated")).map((e) => e.details["worker_id"])).toEqual([TEAM_ELEC]);
    expect(await q("select worker_id, revoked_at from worker_job_links where job_id=$1", [JOB])).toEqual([{ worker_id: TEAM_ELEC, revoked_at: null }]);
    expect(providers.texts).toHaveLength(0);
    expect([...providers.mitti.audits.values()].map((a) => a.template_id)).toEqual([TPL_A1]);
    expect(await q("select external_id from ceiling_measurements where job_id=$1 and is_current and external_source='mitti'", [JOB])).toEqual([{ external_id: "audit_1" }]);
    expect(await stageOf(JOB)).toBe("ready_check_ready_to_schedule");
  });
});

/** The installer's finished A1 Ready Check (no price — decision 278: the boss prices on the portal). 120 m², no existing insulation. */
function completeA1(auditId: string) {
  const a = providers.mitti.audits.get(auditId)!;
  // Decisions 263/264 (Part 8 records checklist): the before video of every ceiling area is taken at the Ready Check.
  const at = new Date().toISOString();
  providers.mitti.media.set("a1-before-video-1", { bytes: new Uint8Array([0]), type: "video/mp4" });
  const beforeVideo: MittiItem = { item_id: "a_before_video_1", label: "Take a video of this ceiling area. Turn a light on, say the area's name, then film slowly all the way round.", type: "media", media: [{ media_id: "a1-before-video-1", captured_at: at, location: { lat: -38.1446, lng: 145.1225 }, date_created: at }] } as MittiItem;
  a.items = [...a.items.filter((i) => !i.item_id.startsWith("a_")),
    pick("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"), pick("Life support equipment at property?", "No"), pick("Property type", "House"),
    pick("How easy is the ceiling access?", "Easy"), pick("How many separate ceiling areas are there?", "1"),
    { item_id: "a_area1", label: "Ceiling area 1", type: "section", children: [
      ans("Enter the measured ceiling area (m²)", "120"), pick("Is there existing insulation?", "No"), pick("How was this ceiling area measured?", "Laser in the ceiling space"),
      pick("Recessed downlights in this area?", "No"), pick("Hazards in this area?", "No"), beforeVideo,
    ] },
    pick("Was the ceiling or roof built or replaced in the last 5 years?", "No"), pick("What insulation product will you be using on this job?", "Bradford Gold R5"),
    pick("Are any extras needed beyond the standard install and removal?", "No"),
  ];
  a.completed = true; a["modified_at"] = new Date().toISOString();
}

describe("A1 step 2 — Ready Check Complete in Mitti, the boss enters the price, the quote goes out by itself", () => {
  test("Complete with no price: measurements recorded, eligible, NO quote, the boss is texted the price link once, office told once", async () => {
    completeA1("audit_1");
    const ms = await import("../src/lib/mitti.server");
    const r = await ms.syncMittiAssessment(JOB, null);
    await settle();
    expect(r.completed).toBe(true);
    if (process.env["JOURNEY_DEBUG"]) { console.log(JSON.stringify(r), await q("select id, status, is_current, measured_area_m2, external_id from ceiling_measurements where job_id=$1", [JOB]), (await q("select event_type, details from workflow_events where job_id=$1 and event_type in ($2,$3) order by created_at", [JOB, "mitti_measureup_synced", "ready_check_basics"])).map((x) => JSON.stringify(x))); }
    expect((await q<Record<string, unknown>>("select status, measured_area_m2 from ceiling_measurements where job_id=$1 and is_current", [JOB]))[0]).toMatchObject({ status: "complete", measured_area_m2: 120 });
    expect(await events(JOB, "ready_check_form_eligible")).toHaveLength(1);
    expect(await q("select id from quotes where job_id=$1", [JOB])).toHaveLength(0);
    expect(await events(JOB, "boss_price_link_sent")).toHaveLength(1);
    const held = await events(JOB, "quote_auto_send_held");
    expect(held.map((h) => h.details["reasons"])).toEqual([["Price not entered by the business owner"]]);
    // The 15-minute tick over the same completed form repeats nothing.
    await (await import("../src/lib/mitti-complete.server")).sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true }); await settle();
    expect(await events(JOB, "boss_price_link_sent")).toHaveLength(1);
    expect(await events(JOB, "quote_auto_send_held")).toHaveLength(1);
  });
  test("the boss enters $2,500 on 'Your price' → draft prepared from the portal price; with the send switch as shipped it waits on Quotes to check", async () => {
    const ps = await import("../src/lib/installer-price-set.server");
    await ps.setInstallerPrice(JOB, INST, { priceIncGst: 2500, included: ["Ceiling insulation - supply & install"] });
    await settle();
    const draft = await q<Record<string, unknown>>("select id, status, release_state, sent_at, option_code, subtotal_inc_gst, customer_total_inc_gst, veec_discount_inc_gst from quotes where job_id=$1", [JOB]);
    expect(draft).toHaveLength(1);
    expect(draft[0]).toMatchObject({ status: "draft", release_state: "held", sent_at: null, option_code: "INSTALLER_A1", subtotal_inc_gst: 3198 });
    const lines = await q<{ code: string; line_total_inc_gst: number }>("select code, line_total_inc_gst from quote_items where quote_id=$1 order by sort", [draft[0]!["id"]]);
    // Decision 431 + Jo 4 Nov 2026: the installer's price, the $349 fee, then the PIESA at the installer's OWN rate ($317.27 ex = $349 inc).
    expect(lines).toEqual([{ code: "INSTALLER_PRICE", line_total_inc_gst: 2500 }, { code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }]);
    // AUTO_QUOTE_SEND_ENABLED = false (Jo 24 Oct: "manual for the first few weeks") — nothing reached the owner yet.
    const { AUTO_QUOTE_SEND_ENABLED } = await import("../src/lib/auto-quote-send.core");
    expect(AUTO_QUOTE_SEND_ENABLED).toBe(false);
    expect((await comms(JOB)).filter((x) => x.source_event.includes("quote_ready"))).toHaveLength(0);
    // The owner cannot accept a quote that was never released: there is no issued quote to answer.
    expect(await q("select id from quotes where job_id=$1 and status='issued'", [JOB])).toHaveLength(0);
  });
  test("go-live (decision 159: auto quote send on): the 15-minute tick releases it — issued, secure link, owner email + text once", async () => {
    await (await import("../src/lib/mitti-complete.server")).sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true });
    await settle();
    const qs = await q<Record<string, unknown>>("select id, status, release_state, sent_at, option_code, subtotal_inc_gst, customer_total_inc_gst, veec_discount_inc_gst from quotes where job_id=$1", [JOB]);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ status: "issued", release_state: "released", option_code: "INSTALLER_A1" });
    expect(qs[0]!["sent_at"]).not.toBeNull();
    expect(await events(JOB, "quote_sent_automatically")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("measured_estimate_ready");
    const c = (await comms(JOB)).filter((x) => x.source_event.includes("quote_ready"));
    expect(c.map((x) => [x.channel, x.source_event, x.delivery_status])).toEqual([["email", `jo_tradie:quote_ready:${qs[0]!["id"]}`, "sent"], ["sms", `jo_tradie:quote_ready:${qs[0]!["id"]}`, "sent"]]);
    expect(await q("select status from customer_estimate_links where job_id=$1 and purpose='step3_estimate'", [JOB])).toEqual([{ status: "active" }]);
    // The 15-minute tick afterwards sends nothing again.
    await (await import("../src/lib/mitti-complete.server")).sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true });
    await settle();
    expect((await comms(JOB)).filter((x) => x.source_event.includes("quote_ready"))).toHaveLength(2);
  });
});

// ---- the owner on their secure My job link (the real server functions behind the buttons) ----
const ownerToken = async (jobId: string) => (await q<{ token: string }>("select token from customer_estimate_links where job_id=$1 and purpose='step3_estimate' and status='active'", [jobId]))[0]!.token;
// The owner verifies once and keeps the session on their device (codes are limited per hour, owner-verify.server).
const ownerSessions = new Map<string, { token: string; session: string }>();
const ownerSessionFor = async (jobId: string) => {
  const token = await ownerToken(jobId);
  const kept = ownerSessions.get(token);
  if (kept) return kept;
  const ol = await import("../src/lib/owner-link.functions");
  const asked = await ol.requestOwnerCodeFn({ data: { token, channel: "email" } }) as { testCode: string | null };
  expect(asked.testCode).toMatch(/^\d{6}$/); // TEST jobs never send the code; it comes back for the test
  const { session } = await ol.verifyOwnerCodeFn({ data: { token, code: asked.testCode } }) as { session: string };
  ownerSessions.set(token, { token, session });
  return { token, session };
};
const META = { ip: "127.0.0.1", userAgent: "journey-test" };
const SIGNING = { authorityType: "owner" as const, tick1: true, tick2: true, typedName: "Helen Journey", assistance: "none" as const };

describe("A1 step 3 — the owner signs and accepts on the secure link", () => {
  test("accepting before the paperwork is signed is refused; nothing is accepted", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const [qq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and status='issued'", [JOB]);
    let refused = "";
    try { await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META }); } catch (e) { refused = (e as Error).message; }
    if (process.env["JOURNEY_DEBUG"]) console.log("REFUSED", refused);
    expect(refused).toBe("Customer agreement is not ready: add the current VEU consumer information and consumer rights.");
    expect(await q("select status from quotes where id=$1", [qq!.id])).toEqual([{ status: "issued" }]);
    expect(await q("select id from customer_agreements where job_id=$1", [JOB])).toHaveLength(0);
  });
  test("office one-off setup (Compliance templates + Settings › Owner documents) through the office server functions", async () => {
    const pf = await import("../src/lib/portal.functions");
    const officeCtx = { userId: OFFICE, supabase: admin, claims: {} };
    for (const [key, body] of [["consumer_rights", "TEST VEU consumer information and consumer rights (journey fixture text, office-loaded)."], ["customer_agreement", "TEST customer agreement wording (journey fixture text, office-loaded)."]] as const) {
      await pf.addComplianceTemplate({ data: { template_key: key, version: "journey-1", body }, context: officeCtx });
      const [t] = await q<{ id: string }>("select id from compliance_templates where template_key=$1 and version='journey-1'", [key]);
      await pf.approveComplianceTemplate({ data: { id: t!.id }, context: officeCtx });
    }
    expect(await q("select template_key from compliance_templates where approved and is_active order by template_key")).toEqual([{ template_key: "consumer_rights" }, { template_key: "customer_agreement" }]);
    // Finding (not changed here): the Gate B owner documents in code are not approved in a fresh database. A TEST job can
    // sign them (recorded as DRAFT); a real owner is refused until Jo approves each version in Settings › Owner documents.
    const cat = await (await import("../src/lib/owner-gates.server")).paperworkCatalogue() as { key: string; gate: string; version: string | null; status: string; managedIn: string }[];
    expect(cat.filter((d) => d.gate === "B" && d.managedIn === "Here" && d.status !== "Approved").map((d) => d.key).sort()).toEqual(["landlord_consent", "payment_terms", "quote_acceptance", "tenancy_details", "visit_permission"]);
  });
  test("Gate B paperwork signed on the link, then the quote is accepted with the signed agreement; installer told once; invoice raised", async () => {
    const {ESC_CONSENT_TEMPLATE_VERSION}=await import("../src/lib/consent.core");
    await q("insert into compliance_templates(template_key,version,body,approved,is_active) values('esc_consent',$1,'Official consent fixture',true,true)",[ESC_CONSENT_TEMPLATE_VERSION]);
    const ol = await import("../src/lib/owner-link.functions");
    const ogf = await import("../src/lib/owner-gates.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const signedKeys: string[] = [];
    for (let i = 0; i < 15; i++) {
      const p = await ogf.ownerPaperworkFn({ data: { token } }) as { todo: { key: string; gate: string }[] };
      const next = p.todo.find((t) => t.gate === "A" || t.gate === "B");
      if (!next) break;
      await ogf.ownerSignPaperworkFn({ data: { token, session, key: next.key, signatoryName: "Helen Journey", ticked: true, answers: { role: "owner", life_support: "no" } }, context: META });
      signedKeys.push(next.key);
    }
    expect(signedKeys).toEqual(["quote_acceptance", "payment_terms"]);
    expect(await q("select doc_key, doc_draft, method from owner_gate_signatures where job_id=$1 order by signed_at", [JOB])).toEqual(signedKeys.map((doc_key) => ({ doc_key, doc_draft: true, method: "link_code" })));
    const [qq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and status='issued'", [JOB]);
    // A stale version on the owner's screen is refused (exact-version acceptance).
    await expect(ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version + 1, signing: SIGNING }, context: META })).rejects.toThrow(/updated since/);
    const r = await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META });
    await settle();
    expect(r).toEqual({ ok: true });
    expect(await q("select status from quotes where id=$1", [qq!.id])).toEqual([{ status: "accepted" }]);
    expect(await q("select id from customer_agreements where job_id=$1 and quote_id=$2 and status='signed'", [JOB, qq!.id])).toHaveLength(1);
    expect(await events(JOB, "QUOTE_ACCEPTED")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("measured_quote_accepted");
    if (process.env["JOURNEY_DEBUG"]) console.log("ACCEPT", await q("select id, kind, total_inc_gst, deposit_amount, status, xero_invoice_id, xero_invoice_number, last_sync_error from invoices where job_id=$1", [JOB]), (await comms(JOB)).map((c) => c.source_event), providers.log.filter((l) => l.provider === "xero").map((l) => `${l.method} ${l.path}`), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    // Same accepted version is a no-op; nothing doubles.
    expect(await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META })).toEqual({ ok: true, outcome: "already accepted" });
    expect(await q("select id from customer_agreements where job_id=$1", [JOB])).toHaveLength(1);
  });
});


// ---- the in-house model (join ruling, 4 Nov 2026): every installer runs in-house with its own Team electrician. The
// installer office books the safety check for that electrician (Part 6); no HIV electrician, no REC offer, no
// startPiesaAllocation on an installer's own job. ----
const sentSince = (from: number) => ({ emails: providers.emails.slice(from).map((e) => ({ to: e.to, subject: e.subject, text: e.text })), texts: providers.texts.slice(from) });
const DBG = (label: string, ...rest: unknown[]) => { if (process.env["JOURNEY_DEBUG"]) console.log(label, ...rest); };
const recent = async (jobId: string, n = 12) => (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit $2", [jobId, n])).map((e) => `${e.event_type}: ${e.summary}`);

describe("A1 step 4 — the $349 safety check, paid by card (decisions 139/144/302)", () => {
  test("before paying, the installer cannot book the safety check for their electrician (payment gate); no REC offer exists on an own job", async () => {
    const tv = await import("../src/lib/trade-view.server");
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await tv.inHouseBookVisit(INST, { jobId: JOB, kind: "assessment", start, workerId: TEAM_ELEC });
    DBG("PIESA-BEFORE-PAY", JSON.stringify(r), await stageOf(JOB));
    expect(r.ok).toBe(false);
    expect((r as { blockers: string[] }).blockers[0]).toBeTruthy();
    expect(await q("select id from bookings where job_id=$1 and kind='assessment'", [JOB])).toHaveLength(0);
    expect(await q("select id from partner_offers where job_id=$1", [JOB])).toHaveLength(0);
  });
  test("owner presses Pay by card → one Stripe Checkout for exactly the quote's PIESA line; Stripe's signed webhook records it once", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken(JOB);
    const r = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string; blocker?: string };
    DBG("CHECKOUT", r);
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const again = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string };
    expect(again.url).toBe(r.url); // double tap = the same Stripe session (idempotency key job+step+amount)
    expect(providers.stripe.sessions).toHaveLength(1);
    const s = providers.stripe.sessions[0]!;
    expect(s.form["line_items[0][price_data][unit_amount]"]).toBe("34900");
    expect(s.form["metadata[step]"]).toBe("safety_check");
    expect(s.idempotencyKey).toBe(`hivic-checkout-${JOB}-${s.form["metadata[invoice_id]"]}-safety_check-34900`);
    const st = await import("../src/lib/stripe.server");
    // A forged webhook (wrong secret) changes nothing.
    const forged = await stripePaidWebhook(s, "whsec_wrong");
    expect(await st.handleStripeWebhook(forged.body, forged.signature)).toEqual({ status: 400, outcome: "bad_signature" });
    const wh = await stripePaidWebhook(s, process.env["STRIPE_WEBHOOK_SECRET"]!);
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "recorded" });
    await settle();
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "duplicate" }); // Stripe retry
    const paid = await events(JOB, "owner_payment_recorded");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.details).toMatchObject({ amount_cents: 34900, source: "card", step: "safety_check" });
    expect((await q<{ total_paid: number }>("select total_paid from invoices where job_id=$1", [JOB]))[0]!.total_paid).toBe(349);
    DBG("AFTER-PAY", await stageOf(JOB), (await comms(JOB)).map((c) => c.source_event), await recent(JOB, 10), sentSince(0).emails.map((e) => e.subject));
  });
});

describe("A1 step 5 — the installer office books the safety check for its Team electrician (Part 6 in-house booking; join ruling)", () => {
  test("the safety check is booked in-house: booking, stage, A3 form, owner \"You're booked\" email, electrician's PIESA booked email — once each", async () => {
    const tv = await import("../src/lib/trade-view.server");
    const pc = await import("../src/lib/piesa-times.core");
    const day = pc.allowedPiesaTimeDays()[2]!;
    const start = new Date(`${day}T10:00:00+11:00`).toISOString();
    // The Team electrician was put on the job at Add a job (step 1); pressing Book again for the same person changes nothing.
    const ih = await import("../src/lib/in-house-electrician.server");
    expect(await ih.allocateElectrician(JOB, INST, TEAM_ELEC)).toEqual({ ok: true, name: "Will Casdorff" });
    expect(await events(JOB, "in_house_electrician_allocated")).toHaveLength(1);
    expect(await q("select worker_id from worker_job_links where job_id=$1 and revoked_at is null", [JOB])).toEqual([{ worker_id: TEAM_ELEC }]);
    // J4 G4 (join ruling, 4 Nov 2026): the TEST business books its TEST jobs from its Job page like any other (the
    // member-scoped wrapper `inHouseBookVisit` → saveInHouseVisit: validateBooking + the atomic commit_in_house_visit RPC +
    // the saved work). Any other business still never sees a TEST job there.
    expect((await tv.inHouseBookingAccess(INST, JOB)).allowed).toBe(true);
    const forms = await import("./helpers/journey-forms");
    const def = forms.completedA3({ inspectionDate: "2026-10-28", capturedAt: new Date().toISOString(), priceIncGst: 600, mediaPrefix: "a3" });
    // The live A3's portal-prefilled items (Jo 25 Oct 2026: the five B3 electrician details are pre-filled, never typed).
    const A3_PREFILLED = ["Job Reference ID", "Address including postcode", "Owner name", "Electrician licence number", "Electrician full name", "Electrical contractor (REC) business name", "REC registration number", "Electrician phone"];
    providers.templates[TPL_A3] = forms.templateOf([...A3_PREFILLED.map((l) => forms.text(l, "")), ...def.items]);
    const n0 = providers.emails.length, t0 = providers.texts.length;
    const r = await tv.inHouseBookVisit(INST, { jobId: JOB, kind: "assessment", start, workerId: TEAM_ELEC });
    expect(r).toMatchObject({ ok: true });
    expect((r as { bookingId?: string }).bookingId).toBeTruthy();
    // The saved-work follow-through runs after the response (the 15-minute tick recovers it): A3 form, electrician email, owner notice.
    await settle();
    await (await import("../src/lib/in-house-saved-work.server")).sweepInHouseSavedWork();
    await settle();
    expect(backgroundErrors).toEqual([]);
    const bk = await q<{ status: string; scheduled_start: Date; contractor_id: string | null; business_id: string }>("select status, scheduled_start, contractor_id, business_id from bookings where job_id=$1 and kind='assessment'", [JOB]);
    expect(bk).toHaveLength(1);
    expect(bk[0]).toMatchObject({ status: "confirmed", contractor_id: null, business_id: BIZ }); // no-login electrician: the person is the allocation event's worker
    expect(bk[0]!.scheduled_start.toISOString()).toBe(start);
    expect(await stageOf(JOB)).toBe("piesa_scheduled");
    expect((await q<{ details: { status: string } }>("select details from workflow_events where job_id=$1 and event_type='in_house_saved_work'", [JOB])).map((e) => e.details.status)).toEqual(["done"]);
    // Decision 398: booking the PIESA creates the electrician's A3 form in Mitti, handed to the TEST assignee, once.
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A3)).toHaveLength(1);
    expect(await q("select mitti_template_id from assessments where job_id=$1 and external_mitti_id is not null", [JOB])).toEqual([{ mitti_template_id: TPL_A3 }]);
    expect(await events(JOB, "piesa_autoform_failed")).toHaveLength(0);
    // The owner's "You're booked" PIESA email (in-house, same key per booking + person): who is coming and the installer
    // office number to change it — never a price or what the electrician is paid.
    const sent = providers.emails.slice(n0);
    const ownerBooked = sent.filter((e) => /You're booked/.test(e.subject));
    expect(ownerBooked.map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(ownerBooked[0]!.text).toContain("Will Casdorff");
    expect(ownerBooked[0]!.text).toContain("Call TEST Journey Insulation on 0477 511 901");
    expect(ownerBooked[0]!.text).not.toMatch(/\$\s?\d/);
    // J4 G4: the owner's "You're booked" TEXT on a TEST job goes through the test sender (allow-listed TEST mobile), once —
    // live owners get it through the one real sender; no "blocked: use the test sender" row any more.
    const ownerTexts = providers.texts.slice(t0).filter((t) => /booked/i.test(t.body));
    expect(ownerTexts.map((t) => t.to)).toEqual(["+61477511901"]);
    expect(ownerTexts[0]!.body).not.toMatch(/\$\s?\d/);
    expect(await q("select status from sms_messages where job_id=$1 and message_type='in_house_booked_owner'", [JOB])).toEqual([]);
    // The electrician's "PIESA booked" email (pre-approval wording while PIESA_BOOKED_EMAIL_APPROVED is off): day, address,
    // owner phone — no price, no HIV PIESA rate, no pay line.
    const elecBooked = sent.filter((e) => /PIESA\) booked/.test(e.subject));
    // TEST job: the test sender redirects it to the TEST inbox with the original recipient (the electrician) marked.
    expect(elecBooked.map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(elecBooked[0]!.text).toContain(`would have gone to: ${TRADE_EMAIL}`);
    expect(elecBooked[0]!.text).toContain("1 Journey Street, Frankston, 3199");
    expect(elecBooked[0]!.text).not.toMatch(/\$\s?\d|rate|pay|paid|fixes|HIV\b/i);
    expect((await q<{ details: { status: string } }>("select details from workflow_events where job_id=$1 and event_type='in_house_electrician_booking_notice'", [JOB])).map((e) => e.details.status)).toEqual(["sent"]);
    // Nothing in this step carries a pay threat or an office-internal line to a trade.
    for (const e of sent) expect(e.text).not.toMatch(/won't be paid|will not be paid|no pay|withheld/i);
    // The tick again: no second email, no second form.
    await (await import("../src/lib/in-house-booking.server")).sweepOwnerBookedNotices();
    await (await import("../src/lib/in-house-saved-work.server")).sweepInHouseSavedWork();
    await settle();
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A3)).toHaveLength(1);
  });
  test("the electrician's no-login /e/ link shows the booked safety check day and the owner's contact — no prices, no login", async () => {
    const el = await import("../src/lib/electrician-link.server");
    // The link texted at allocation is held (ELECTRICIAN_LINK_TEXT_APPROVED off) and only its hash is stored, so the test
    // mints the electrician a link the same way a re-send would (one live link per person and job: the older one is revoked).
    const minted = await el.mintElectricianLink(JOB, TEAM_ELEC, INST);
    ELEC_TOKEN = minted.token;
    expect(minted.url).toMatch(/\/e\/[A-Za-z0-9_-]+$/);
    const view = await el.electricianLinkView(ELEC_TOKEN);
    DBG("ELEC-VIEW", JSON.stringify(view));
    expect(view.view.step).toBe("piesa_day");
    expect(view.view.button).toBe("Open safety check form");
    // J4 G2 (join ruling, 4 Nov 2026): booking the safety check for the Team electrician released the owner's contact to that
    // assignment (`contact_releases`, visit piesa — the same audited rule as an accepted offer, Jo 21 Oct), so the link
    // shows the owner's name, phone and address.
    expect(await q("select visit_kind, revoked_at from contact_releases cr join job_assignments ja on ja.id = cr.assignment_id where cr.job_id=$1 and ja.role='electrician'", [JOB])).toEqual([{ visit_kind: "piesa", revoked_at: null }]);
    expect(view.owner).toMatchObject({ name: "Helen Journey", phone: OWNER_PHONE });
    expect(view.address).toContain("1 Journey Street");
    expect(JSON.stringify(view)).not.toMatch(/\$\s?\d|price|rate|log ?in|password/i);
  });
});
let ELEC_TOKEN = "";
let SENT_AT_PIESA_RESULT = 0;

describe("A1 step 6 — the electrician's A3 in Mitti: electrical upgrades needed (decisions 178/305/324/354; Parts 4/6)", () => {
  test("A3 Complete in Mitti: synced with its evidence, the prefilled B3 block passes the official rules, the job waits on Complete PIESA", async () => {
    const forms = await import("./helpers/journey-forms");
    const [{ external_mitti_id: auditId }] = await q<{ external_mitti_id: string }>("select external_mitti_id from assessments where job_id=$1", [JOB]);
    const a3 = providers.mitti.audits.get(auditId)!;
    // Jo 25 Oct 2026 (A3 items 23–27 "portal fills this in"): the electrician's B3 block was prefilled at creation from the
    // office-verified Team record — the no-login electrician never types their licence.
    const pre = (label: string) => (a3.items.find((i) => i.label === label)?.responses as { text?: string } | undefined)?.text;
    expect([pre("Electrician full name"), pre("Electrician licence number"), pre("Electrical contractor (REC) business name"), pre("REC registration number"), pre("Electrician phone")]).toEqual(["Will Casdorff", "A67890", "TEST Journey Insulation", "REC-67890", "0477 511 901"]);
    const def = forms.completedA3({ inspectionDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()), capturedAt: new Date().toISOString(), priceIncGst: 600, mediaPrefix: "a3" });
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(a3, def.items);
    // J4 G1 (join ruling, 4 Nov 2026): a form that is complete in Mitti but NOT yet signed by the electrician does not
    // complete the PIESA by itself — the office sees one "not completed by itself" row saying the signature is missing.
    const unsignedItems = def.items.filter((i) => i.label !== "Electrician signature");
    a3.items = a3.items.filter((i) => i.label !== "Electrician signature"); // the template copy carried the fixture's signature slot
    fillAudit(a3, unsignedItems);
    const n0 = providers.emails.length;
    const ms = await import("../src/lib/mitti.server");
    const out0 = await ms.syncPendingMitti(null);
    await settle();
    expect(out0).toEqual([{ jobId: JOB, ok: true, message: "synced" }]);
    const { PIESA_AUTO_SIGNATURE_MISSING } = await import("../src/lib/piesa-auto-complete.server");
    expect((await events(JOB, "piesa_auto_complete_held")).map((e) => e.details["reason"])).toEqual([PIESA_AUTO_SIGNATURE_MISSING]);
    expect(await q("select id from piesa_records where job_id=$1", [JOB])).toHaveLength(0);
    expect(await stageOf(JOB)).toBe("piesa_scheduled");
    // A second sync of the same unsigned form adds no second row.
    await ms.syncPendingMitti(null); await settle();
    expect(await events(JOB, "piesa_auto_complete_held")).toHaveLength(1);
    // Now the electrician signs the A3.
    fillAudit(a3, def.items);
    const out = await ms.syncPendingMitti(null);
    await settle();
    expect(out).toEqual([{ jobId: JOB, ok: true, message: "synced" }]);
    expect((await q<Record<string, unknown>>("select status, mitti_completed, piesa_outcome from assessments where job_id=$1", [JOB]))[0]).toMatchObject({ status: "complete", mitti_completed: true, piesa_outcome: "fail" });
    expect(await (await import("../src/lib/piesa-rules-notice.server")).piesaRulesFor(JOB)).toMatchObject({ rules: [] });
    expect(await events(JOB, "piesa_rules_failed")).toHaveLength(0);
    expect(await events(JOB, "piesa_evidence_saved")).toHaveLength(1);
    // The signed, complete A3 completed the PIESA by itself (G1) and cleared the office row.
    expect(await events(JOB, "piesa_auto_complete_recovered")).toHaveLength(1);
    SENT_AT_PIESA_RESULT = n0;
  });
  test("Complete PIESA (upgrades needed) by the synced A3: PIESA record, official PIESA filed by the no-login electrician, partner-billed upgrades route, owner copy, deposit opens", async () => {
    // J4 G1 (join ruling, 4 Nov 2026): no screen presses Complete PIESA on an in-house job — the synced, signed A3 did it
    // (previous test). Everything below is what that completion recorded and sent.
    const n0 = SENT_AT_PIESA_RESULT;
    expect(await q("select kind, outcome, is_current from piesa_records where job_id=$1", [JOB])).toEqual([{ kind: "initial", outcome: "fail", is_current: true }]);
    // No-login electrician: the record's sign-off is held against the installer account running the job; the official copy
    // below is the electrician's.
    expect(await q("select signed_off_by from piesa_records where job_id=$1", [JOB])).toEqual([{ signed_off_by: INST }]);
    expect((await events(JOB, "electrical_assessment_complete")).map((e) => e.details["completed_by"])).toEqual(["synced A3 (in-house)"]);
    // Decision 350: the official PIESA is filed from the A3, attributed to the Team electrician (no login: the worker is the signer).
    expect(await events(JOB, "official_piesa_issued")).toHaveLength(1);
    expect(await events(JOB, "official_piesa_held")).toHaveLength(0);
    expect(await q("select form_key, signer_role, signer_user_id, signer_name from official_form_signed_copies where job_id=$1 and status='current'", [JOB])).toEqual([{ form_key: "piesa", signer_role: "electrician", signer_user_id: TEAM_ELEC, signer_name: "Will Casdorff" }]);
    // The safety check visit is done (the electrician's pay line reads a completed visit).
    expect(await q("select status from bookings where job_id=$1 and kind='assessment'", [JOB])).toEqual([{ status: "completed" }]);
    // Jo 2 Nov 2026 (decisions 34/36): the installer's electrician quotes, books and invoices the upgrades directly — the job
    // goes straight to the upgrades day (no HIV fixes quote, no fixes payment step).
    expect((await stagePath(JOB)).slice(-2)).toEqual(["piesa_complete", "rectification_scheduling"]);
    expect(await q("select id from quotes where job_id=$1 and kind='rectification'", [JOB])).toHaveLength(0);
    // J4 G3 (join ruling, 4 Nov 2026): the result found upgrades still to come, so the owner NEVER gets the "all clear"
    // copy. Their copy is the upgrades-needed email (Part 4, UPGRADES_NEEDED_EMAIL_APPROVED) — off today, so the owner's
    // copy is HELD with a recorded reason (one per copy), not sent with the wrong words. Nothing to the owner here.
    const sent = providers.emails.slice(n0);
    expect(sent.filter((e) => /Signed electrical safety check \(PIESA\)|all clear/i.test(`${e.subject}\n${e.text}`))).toHaveLength(0);
    expect(await q("select recipient from piesa_deliveries where job_id=$1", [JOB])).toEqual([]);
    const { UPGRADES_HOLD_REASON } = await import("../src/lib/piesa-delivery.server");
    expect((await events(JOB, "piesa_copy_email_not_sent")).map((e) => [e.details["recipient"], e.details["reason"]])).toEqual([["owner", "upgrades_needed_wording_unapproved"]]);
    expect((await events(JOB, "piesa_copy_email_not_sent"))[0]!.summary).toContain(UPGRADES_HOLD_REASON);
    // The tick again: still held, recorded once.
    await (await import("../src/lib/piesa-delivery.server")).sweepPiesaCopyDeliveries(); await settle();
    expect(await events(JOB, "piesa_copy_email_not_sent")).toHaveLength(1);
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
    // Nothing to the owner names what the electrician is paid; nothing to the installer names HIV's PIESA price.
    for (const e of sent) expect(e.text).not.toMatch(/\$\s?\d/);
    // Jo 2 Nov (answer 21): the 10% deposit opens straight after the result, upgrades or not — the request is recorded
    // (held until the invoice/clearance checks pass on the tick), never a second $349 ask.
    expect(await events(JOB, "install_deposit_request_pending")).toHaveLength(1);
    // The next sync of the same completed form changes nothing (and the office's fallback Complete says it is done).
    await (await import("../src/lib/mitti.server")).syncPendingMitti(null); await settle();
    expect(await q("select id from piesa_records where job_id=$1", [JOB])).toHaveLength(1);
    const pf = await import("../src/lib/portal.functions");
    await expect(pf.completeAssessment({ data: { jobId: JOB }, context: { userId: OFFICE, supabase: asUser(OFFICE), claims: {} } })).rejects.toThrow(/already complete/);
    expect(await events(JOB, "official_piesa_issued")).toHaveLength(1);
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
    // The electrician's link moves on: "When are you doing the upgrades?" (who-books "either" → they can enter the day).
    const el = await import("../src/lib/electrician-link.server");
    const view = await el.electricianLinkView(ELEC_TOKEN);
    expect(view.view).toMatchObject({ step: "set_upgrades_day", title: "When are you doing the upgrades?", canBook: true });
  });
});

describe("A1 step 7 — the upgrades day from the electrician's link, the A4 form, Part C and the certificate (decisions 293/330; Part 6)", () => {
  test("the electrician enters the upgrades day on their link → upgrades booked, the A4 form made once; a second entry of the same day is a retry", async () => {
    const el = await import("../src/lib/electrician-link.server");
    const fd = await import("../src/lib/fixes-day.core");
    providers.templates[TPL_A4] = { items: fd.FIXES_DAY_QUESTIONS.map((x, i) => ({ item_id: `a4_${i + 1}`, label: x.label, type: x.type === "yes_no" ? "question" : x.type === "photo" ? "media" : x.type === "signature" ? "signature" : x.type === "date" ? "datetime" : "textsingle" })) };
    const day = businessDays(1, 3)[0]!;
    const start = new Date(`${day}T10:00:00+11:00`).toISOString();
    const n0 = providers.emails.length;
    // A time in the past is refused; nothing is booked.
    expect((await el.bookFromElectricianLink(ELEC_TOKEN, "rectification", new Date(Date.now() - 3_600_000).toISOString())).ok).toBe(false);
    expect(await q("select id from bookings where job_id=$1 and kind='rectification'", [JOB])).toHaveLength(0);
    expect(await el.bookFromElectricianLink(ELEC_TOKEN, "rectification", start)).toEqual({ ok: true, start });
    await settle();
    expect(await q("select status from bookings where job_id=$1 and kind='rectification'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(await stageOf(JOB)).toBe("rectification_booked");
    expect((await events(JOB, "electrician_link_booked")).map((e) => e.details["kind"])).toEqual(["rectification"]);
    // Decision 293: booking the upgrades day creates the electrician's A4 "Electrical fixes" form once, prefilled.
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A4)).toHaveLength(1);
    expect(await events(JOB, "fixes_form_created")).toHaveLength(1);
    // Partner-billed upgrades: no owner payment step, nothing sent to the owner for the upgrades day here.
    expect(providers.emails.slice(n0)).toHaveLength(0);
    expect(await el.bookFromElectricianLink(ELEC_TOKEN, "rectification", start)).toEqual({ ok: true, start }); // same day again = retry
    expect(await q("select id from bookings where job_id=$1 and kind='rectification' and status='confirmed'", [JOB])).toHaveLength(1);
    expect((await el.electricianLinkView(ELEC_TOKEN)).view).toMatchObject({ step: "upgrades_day", button: "Open upgrades form" });
  });
  test("the electrician completes the A4 (certificate, date, file, geotagged photo, signed) → Part C, PIESA re-issued as a pass, clear to install, deposit asked once, link All done", async () => {
    const forms = await import("./helpers/journey-forms");
    const fd = await import("../src/lib/fixes-day.core");
    const a4 = [...providers.mitti.audits.values()].find((a) => a.template_id === TPL_A4)!;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const def = forms.completedA4({ q: fd.FIXES_DAY_Q as unknown as Record<string, string>, coesNumber: "COES-778899", certDate: today, capturedAt: new Date().toISOString(), mediaPrefix: "a4", electrician: "Will Casdorff" });
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(a4, def.items);
    const n0 = providers.emails.length;
    const out = await (await import("../src/lib/fixes-day.server")).sweepFixesForms();
    await settle();
    expect(out).toMatchObject({ done: 1, failed: 0 });
    expect(await events(JOB, "fixes_form_completed")).toHaveLength(1);
    expect(await q("select kind, outcome from piesa_records where job_id=$1 and is_current", [JOB])).toEqual([{ kind: "post_rectification", outcome: "pass" }]);
    expect(await events(JOB, "official_piesa_regenerated")).toHaveLength(1);
    expect(await q("select signer_user_id, signer_name from official_form_signed_copies where job_id=$1 and status='current'", [JOB])).toEqual([{ signer_user_id: TEAM_ELEC, signer_name: "Will Casdorff" }]);
    expect(await stageOf(JOB)).toBe("installation_scheduling");
    expect(await q("select status from bookings where job_id=$1 and kind='rectification'", [JOB])).toEqual([{ status: "completed" }]);
    // The certificate is on file (the A4's), so the install gate and the electrician's link both see it.
    expect((await (await import("../src/lib/coes-check.server")).currentCoes(JOB)).ref).not.toBeNull();
    expect((await (await import("../src/lib/electrician-link.server")).electricianLinkView(ELEC_TOKEN)).view.step).toBe("all_done");
    // Sends at this step: the owner's updated PIESA copy + certificate copy, the electrician's copy, and ONE 10% deposit
    // request (Jo 2 Nov answer 21; the request recorded at the PIESA result goes now that the invoice/clearance checks pass).
    const sent = providers.emails.slice(n0);
    DBG("A4-SENT", sent.map((e) => [e.to, e.subject]));
    expect(sent.filter((e) => /10% install deposit/.test(e.subject)).map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(await events(JOB, "install_deposit_requested")).toHaveLength(1);
    // J4 G3: after Part C the owner's copy is the item-44 "upgrades are done" words (never "all clear"), with the PDF; recorded once.
    const ownerCopy = sent.filter((e) => e.to[0] === OWNER_EMAIL && /Your electrical upgrades are done — updated safety check attached/.test(e.subject));
    expect(ownerCopy).toHaveLength(1);
    expect(ownerCopy[0]!.attachments).toBe(1);
    expect(ownerCopy[0]!.text).toContain("Electrical upgrades: Completed · certificate COES-778899");
    expect(ownerCopy[0]!.text).not.toMatch(/all clear|repair/i);
    expect(sent.filter((e) => /Signed electrical safety check \(PIESA\)/.test(e.subject) && !/would have gone to/.test(e.text))).toHaveLength(0);
    expect((await q<{ recipient: string }>("select recipient from piesa_deliveries where job_id=$1 order by recipient", [JOB])).map((x) => x.recipient)).toEqual(["owner"]);
    expect(await events(JOB, "coes_owner_copy_delivered")).toHaveLength(1);
    expect(await events(JOB, "electrician_piesa_copy_sent")).toHaveLength(1);
    // Trade copies never show the owner's price; owner copies never show what the electrician is paid.
    for (const e of sent.filter((e) => /would have gone to: jo@act/.test(e.text))) expect(e.text).not.toMatch(/\$\s?\d/);
    for (const e of sent) expect(e.text).not.toMatch(/won't be paid|will not be paid|withheld/i);
    // The sweep again (next tick): the completed A4 is not processed twice and nothing is sent twice.
    await (await import("../src/lib/fixes-day.server")).sweepFixesForms();
    await settle();
    expect(await events(JOB, "fixes_form_completed")).toHaveLength(1);
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
  });
});

/** Business days from `from` days ahead, as YYYY-MM-DD in Melbourne. */
function businessDays(count: number, fromDaysAhead = 2): string[] {
  const out: string[] = [];
  for (let d = fromDaysAhead; out.length < count && d < 40; d++) {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + d * 86_400_000));
    const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    if (wd > 0 && wd < 6) out.push(ymd);
  }
  return out;
}

describe("A1 step 8 — the owner confirms the safety check and pays the 10% deposit by card (decisions 139/296/306; Jo 2 Nov answer 21)", () => {
  test("the PIESA declaration request rode on the PIESA copy (no second ask); the owner confirms on the link alone; an unticked confirm is refused", async () => {
    const pc = await import("../src/lib/piesa-owner-confirm-send.server");
    const n0 = providers.emails.length, t0 = providers.texts.length;
    await pc.sweepOwnerPiesaConfirmations(); await settle();
    await pc.sweepOwnerPiesaConfirmations(); await settle();
    // Part 4: the owner declaration travels with the combined PIESA copy — the tick sends no separate O71 / text.
    expect((await q<{ summary: string }>("select summary from workflow_events where job_id=$1 and event_type='piesa_owner_confirm_reminder'", [JOB])).map((e) => e.summary)).toEqual(["Combined PIESA copy and owner declaration email delivered"]);
    expect(providers.emails.slice(n0)).toHaveLength(0);
    expect(providers.texts.slice(t0)).toHaveLength(0);
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken(JOB);
    const page = await ol.ownerPiesaConfirmFn({ data: { token } }) as { outcomeKind: string; electricianLine: string };
    expect(page.outcomeKind).toBe("repair_needed");
    expect(JSON.stringify(page)).not.toMatch(/\$\s?\d/); // the owner's page never shows what the electrician is paid
    await expect(ol.ownerSignPiesaConfirmFn({ data: { token, signatoryName: "Helen Journey", signatureName: "Helen Journey", authorityType: "owner", confirmed: false }, context: META })).rejects.toThrow();
    await ol.ownerSignPiesaConfirmFn({ data: { token, signatoryName: "Helen Journey", signatureName: "Helen Journey", authorityType: "owner", confirmed: true }, context: META });
    await settle();
    expect(await events(JOB, "piesa_owner_confirmed")).toHaveLength(1);
    expect((await events(JOB, "piesa_owner_confirmed"))[0]!.details).toMatchObject({ name: "Helen Journey", authority: "owner" });
  });
  test("Pay by card → one Stripe Checkout for exactly 10% of the install price; recorded once → \"Deposit received\" to the owner, \"deposit paid\" to the installer office", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken(JOB);
    const r = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string; blocker?: string };
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const s = providers.stripe.sessions.at(-1)!;
    expect(s.form["metadata[step]"]).toBe("install_deposit");
    expect(s.form["line_items[0][price_data][unit_amount]"]).toBe("13290"); // 10% of (1678 − 349)
    const n0 = providers.emails.length, t0 = providers.texts.length;
    const wh = await stripePaidWebhook(s, process.env["STRIPE_WEBHOOK_SECRET"]!);
    const st = await import("../src/lib/stripe.server");
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "recorded" });
    await settle();
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "duplicate" });
    expect((await events(JOB, "owner_payment_recorded")).map((e) => e.details["step"])).toEqual(["safety_check", "install_deposit"]);
    expect(await events(JOB, "install_deposit_received")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("installation_scheduling");
    const sent = providers.emails.slice(n0);
    expect(sent.map((e) => [e.to, e.subject])).toEqual([[[OWNER_EMAIL], "[TEST] Deposit received"], [[OWNER_EMAIL], "[TEST] HV-3300: deposit paid"]]);
    expect(sent[0]!.text).toContain("TEST Journey Insulation will call you to book your install day");
    expect(sent[1]!.text).toContain(`would have gone to: ${TRADE_EMAIL}`);
    expect(sent[1]!.text).not.toMatch(/\$\s?\d/); // the installer office is told the deposit is in, never the owner's amounts
    expect(providers.texts.slice(t0)).toHaveLength(0);
  });
});

let LEAD = "";
const LEAD_EMAIL = "ivy.lead@hivic-test.example"; // one email per business worker; the Lead gets texts, the office gets the emails
const installDay = () => businessDays(1, 5)[0]!;
describe("A1 step 9 — the installer office books the install day with a Lead Installer; safety plan links; the Lead confirm email; the 6:30 text (Part 7)", () => {
  test("owner ESC consent (confirm-and-pay ticks) and the office ESC setup; the install is booked in-house with the Lead Installer → A5 form, ESC notice prepared, owner \"You're booked\" email, the Lead's own safety plan link texted", async () => {
    // The installer's own onboarding record (done once when the business joined, not part of this job): the Lead Installer's
    // worker row with an office-verified EEC CII (full), White Card and ESC registration (Part 7: Lead Installers never log in).
    const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const [w] = await q<{ id: string }>(`insert into partner_workers (business_id, trade_role, worker_role, full_legal_name, email, mobile, profile_id, account_status, approval_status, approved_at, certification, esc_registered, esc_registered_at)
      values ($1,'installer','lead','Ivy Installer',$2,'0477 511 901',$3,'active','approved',now(),$4,true,now()) returning id`, [BIZ, LEAD_EMAIL, INST, JSON.stringify({ white_card: { path: "journey/white-card.png", uploaded_at: new Date().toISOString(), verified_at: new Date().toISOString(), verified_by: OFFICE } })]);
    LEAD = w!.id;
    const [c] = await q<{ id: string }>(`insert into partner_worker_certifications (worker_id, worker_email, status, evidence_note, evidence_source, recorded_by, certificate_number) values ($1,$2,'verified','journey onboarding','office',$3,'CII-1234') returning id`, [LEAD, LEAD_EMAIL, OFFICE]);
    await q(`insert into worker_certification_levels (certification_id, expires_on, level, recorded_by, worker_email) values ($1,$2,'full',$3,$4)`, [c!.id, far, OFFICE, LEAD_EMAIL]);
    await q(`update partner_workers set certification = certification || jsonb_build_object('verification_id', $2::text) where id=$1`, [LEAD, c!.id]);
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    await tvf.acknowledgeTradeCollectionNotice({ context: instCtx });
    // Office one-off setup: the approved ESC consent wording and ESC notification fields (Settings).
    const pf = await import("../src/lib/portal.functions");
    const officeCtx = { userId: OFFICE, supabase: admin, claims: {} };
    const { VEEC_FORM_VERSION } = await import("../src/lib/veec-assignment-form.core");
    for (const [key, version, body] of [["esc_consent", "journey-esc-1", "TEST ESC information-sharing consent (journey fixture text, office-loaded)."], ["installer_declaration", "journey-decl-1", "TEST Activity 48 installer declaration (journey fixture text, office-loaded)."], ["consumer_declaration", VEEC_FORM_VERSION, "Official ESC VEEC assignment form v1.1 (journey fixture, office-approved in Compliance Setup)."]] as const) {
      await pf.addComplianceTemplate({ data: { template_key: key, version, body }, context: officeCtx });
      const [t] = await q<{ id: string }>("select id from compliance_templates where template_key=$1 and version=$2", [key, version]);
      await pf.approveComplianceTemplate({ data: { id: t!.id }, context: officeCtx });
    }
    await pf.addEscConfig({ data: { version: "journey-esc-config-1", fields: [], source_note: "TEST journey ESC notification fields" }, context: officeCtx });
    const [cfg] = await q<{ id: string }>("select id from esc_notification_config where version='journey-esc-config-1'");
    await pf.approveEscConfig({ data: { id: cfg!.id }, context: officeCtx });
    // The owner signs the ESC consent on their link (the four Section 2 ticks); the AP part signs itself (decision 370).
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    await ol.ownerSignConsentFn({ data: { token, session, signatoryName: "Helen Journey", authorityType: "owner", signatureName: "Helen Journey", accept: true, declarations: { owner_or_authorised: true, details_accurate: true, consent_ap_sends: true, consent_commission_shares: true } }, context: META });
    await settle();
    const cs = await import("../src/lib/consent.server");
    expect((await cs.currentConsent(JOB))?.status).toBe("valid");
    expect(await events(JOB, "consent_ap_signed_auto")).toHaveLength(1);
    // The installer office books the install day with the Lead Installer (the same writer as the PIESA, step 5).
    const forms = await import("./helpers/journey-forms");
    const idc = await import("../src/lib/install-day.core");
    const a5Tpl = forms.installDayTemplate(idc.INSTALL_DAY_QUESTIONS);
    // Part 8 (2 Nov paste): the Lead Installer's VEEC Part B tick + signature on the A5's last page.
    a5Tpl.items.push({ item_id: "a5_partb_tick", label: idc.INSTALL_DAY_NOV2_Q.partBTick, type: "checkbox" } as MittiItem, { item_id: "a5_partb_sig", label: idc.INSTALL_DAY_NOV2_Q.partBSignature, type: "signature" } as MittiItem);
    providers.templates[TPL_A5] = a5Tpl;
    const start = new Date(`${installDay()}T08:00:00+11:00`).toISOString();
    const n0 = providers.emails.length, t0 = providers.texts.length;
    const tv = await import("../src/lib/trade-view.server");
    // A Lead who is not ESC-registered / not a Lead cannot be booked (the Team electrician is not an installer).
    expect((await tv.inHouseBookVisit(INST, { jobId: JOB, kind: "installation", start, workerId: TEAM_ELEC })).ok).toBe(false);
    expect(await q("select id from bookings where job_id=$1 and kind='installation'", [JOB])).toHaveLength(0);
    // J4 G4: the TEST business books its install from the Job page (the member-scoped wrapper), like a live business.
    const r = await tv.inHouseBookVisit(INST, { jobId: JOB, kind: "installation", start, workerId: LEAD });
    expect(r).toMatchObject({ ok: true });
    await settle();
    await (await import("../src/lib/in-house-saved-work.server")).sweepInHouseSavedWork();
    await settle();
    expect(backgroundErrors).toEqual([]);
    expect((await q<{ details: { status: string } }>("select details from workflow_events where job_id=$1 and event_type='in_house_saved_work' order by created_at", [JOB])).map((e) => e.details.status)).toEqual(["done", "done"]);
    expect(await q("select status from bookings where job_id=$1 and kind='installation'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(await stageOf(JOB)).toBe("installation_booked");
    expect(await events(JOB, "piisa_crew_selected")).toHaveLength(1);
    // The A5 install form is made once, prefilled; the ESC notice is prepared (ready) for the office to submit.
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A5)).toHaveLength(1);
    expect((await q<{ status: string }>("select status from esc_notifications where job_id=$1 and status not in ('stale','cancelled')", [JOB])).map((x) => x.status)).toEqual(["ready"]);
    // The owner's "You're booked" install email: who is coming and the installer office number; the deposit is paid so no money line.
    const sent = providers.emails.slice(n0);
    const booked = sent.filter((e) => /You're booked — install/.test(e.subject));
    expect(booked.map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(booked[0]!.text).toContain("Ivy Installer (Lead Installer)");
    expect(booked[0]!.text).not.toMatch(/\$\s?\d/);
    // Decision 377 / Part 7: the Lead's OWN safety plan (SWMS) sign link is texted to the Lead's mobile at booking (TEST → test-send), once.
    const swmsTexts = providers.texts.slice(t0).filter((t) => /\/sp\//.test(t.body));
    expect(swmsTexts.map((t) => t.to)).toEqual(["+61477511901"]);
    expect((await events(JOB, "swms_sign_link_texted")).map((e) => [e.details["name"], e.details["step"]])).toEqual([["Ivy Installer", "booked"]]);
    const sw = await (await import("../src/lib/swms.server")).loadSwms(JOB);
    expect(sw.plan.signers.map((x) => [x.name, x.role])).toEqual([["Ivy Installer", "lead"]]);
    expect(sw.status.complete).toBe(false);
    // J4 G4: the owner's "You're booked — install" text on this TEST job goes through the test sender, once (no price).
    const ownerInstallTexts = providers.texts.slice(t0).filter((t) => !/\/sp\//.test(t.body));
    expect(ownerInstallTexts).toHaveLength(1);
    expect(ownerInstallTexts[0]!.to).toBe("+61477511901");
    for (const t of providers.texts.slice(t0)) expect(t.body).not.toMatch(/\$\s?\d|won't be paid|will not be paid|no pay|withheld/i);
    // The 15-minute tick again: nothing repeats.
    await (await import("../src/lib/in-house-saved-work.server")).sweepInHouseSavedWork();
    await (await import("../src/lib/in-house-booking.server")).sweepOwnerBookedNotices();
    await settle();
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
    expect(providers.texts.slice(t0)).toHaveLength(swmsTexts.length + ownerInstallTexts.length);
  });
  test("9am two days before: ONE \"Confirm or change your Lead Installer by 5pm today\" email to the installer office; the Lead locks at 5pm", async () => {
    const lc = await import("../src/lib/lead-installer-confirm.server");
    const twoDaysBefore = new Date(`${installDay()}T09:05:00+11:00`); twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
    const n0 = providers.emails.length;
    expect(await lc.sweepLeadInstallerConfirm(twoDaysBefore)).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(await lc.sweepLeadInstallerConfirm(twoDaysBefore)).toEqual({ checked: 1, sent: 0, held: 0 });
    const sent = providers.emails.slice(n0);
    expect(sent.map((e) => [e.to, e.subject])).toEqual([[[OWNER_EMAIL], "[TEST] HV-3300: Confirm or change your Lead Installer by 5pm today"]]);
    expect(sent[0]!.text).toContain(`would have gone to: ${TRADE_EMAIL}`);
    expect(sent[0]!.text).toContain("Lead Installer: Ivy Installer");
    expect(sent[0]!.text).not.toMatch(/\$\s?\d/);
    expect((await lc.leadInstallerLockState(JOB, twoDaysBefore)).locked).toBe(false);
    const after5pm = new Date(twoDaysBefore); after5pm.setHours(after5pm.getHours() + 8);
    expect((await lc.leadInstallerLockState(JOB, after5pm)).locked).toBe(true);
    // Locked: the install can't be moved or given another Lead through the in-house writer.
    await expect((await import("../src/lib/lead-installer-confirm.server")).assertLeadInstallerUnlocked(JOB, { newStart: new Date(`${installDay()}T09:00:00+11:00`).toISOString(), newLeadId: LEAD }, after5pm)).rejects.toThrow();
  });
  test("6:30am on the day: the jobs text goes ONLY to workers who have not signed the safety plan — the Lead gets it with their sign link; after signing on the link, nothing more", async () => {
    const dm = await import("../src/lib/daily-mitti-text.server");
    await q("update workflow_settings set daily_mitti_text_enabled = true where id = 1");
    const morning = new Date(`${installDay()}T06:35:00+11:00`);
    const t0 = providers.texts.length;
    expect(await dm.sweepDailyMittiTexts(morning)).toEqual({ daily: 1, updates: 0, skippedTrades: 0 });
    const texts = providers.texts.slice(t0);
    expect(texts.map((t) => t.to)).toEqual(["+61477511901"]);
    expect(texts[0]!.body).toContain("Your jobs today: 1) 8am, 1 Journey Street Frankston");
    expect(texts[0]!.body).toContain("Sign the safety plan first: ");
    expect(texts[0]!.body).not.toMatch(/\$\s?\d|won't be paid|no pay/i);
    // The Lead opens the sign link from the text and signs their line (no login).
    const sl = await import("../src/lib/swms-link.server");
    const link = /https:\/\/\S+\/sp\/(\S+)/.exec(texts[0]!.body)![1]!;
    const page = await sl.swmsLinkView(link);
    expect(page.lead).toMatchObject({ signedCount: 0, total: 1 });
    await sl.swmsLinkSign(link, "Ivy Installer");
    const sw = await (await import("../src/lib/swms.server")).loadSwms(JOB);
    expect(sw.status.complete).toBe(true);
    expect(sw.signatures.map((x) => x.typedName ?? (x as { typed_name?: string }).typed_name)).toEqual(["Ivy Installer"]);
    // Signed: no unsigned signer is left for the morning text, and the tick again sends nothing.
    expect(await dm.collectDay(installDay())).toEqual([]);
    expect(await dm.sweepDailyMittiTexts(new Date(morning.getTime() + 15 * 60_000))).toEqual({ daily: 0, updates: 0, skippedTrades: 0 });
    expect(providers.texts.slice(t0)).toHaveLength(1);
  });
});

describe("A1 step 10 — the day before and install day: ESC notice, PIESA copies, pre-start check, Install tomorrow text, the A5 form → the installation is recorded (decisions 213/262/328/396; Part 7)", () => {
  test("the office records the ESC notice; the PIESA copies go once the install is booked; 2pm GO check passes; 4pm \"Install tomorrow\" text to the Lead only", async () => {
    const ps = await import("../src/lib/prestart.server");
    const it = await import("../src/lib/installer-texts.server");
    const [b] = await q<{ scheduled_start: Date }>("select scheduled_start from bookings where job_id=$1 and kind='installation' and status='confirmed'", [JOB]);
    const twoPmBefore = new Date(b!.scheduled_start.getTime() - 18 * 3_600_000); // 2pm the day before (Part 9 Task 6 GO slot)
    const fourPmBefore = new Date(b!.scheduled_start.getTime() - 16 * 3_600_000 + 5 * 60_000);
    const t0 = providers.texts.length, n0 = providers.emails.length;
    // The office submits the notice in the ESC Registry and records the reference.
    const pf = await import("../src/lib/portal.functions");
    const officeCtx = { userId: OFFICE, supabase: admin, claims: {} };
    const [n] = await q<{ id: string }>("select id from esc_notifications where job_id=$1 and status not in ('stale','cancelled') order by created_at desc limit 1", [JOB]);
    await pf.recordEscSubmissionFn({ data: { notificationId: n!.id, reference: "ESC-JOURNEY-0001", sentAt: new Date().toISOString(), method: "manual_portal", confirmed: true }, context: officeCtx });
    expect(await q("select status, submission_reference from esc_notifications where id=$1", [n!.id])).toEqual([{ status: "sent", submission_reference: "ESC-JOURNEY-0001" }]);
    // The office records the pre-install consumer documents (Activity 48 record) given to the owner.
    await pf.recordComplianceItem({ data: { jobId: JOB, key: "pre_install_consumer_docs", occurredAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()), reference: "Emailed with the quote", notes: null }, context: officeCtx });
    // Decision 111: the signed PIESA goes to the installer once the install day is booked — once; the owner already has theirs.
    const pd = await import("../src/lib/piesa-delivery.server");
    await pd.sweepPiesaCopyDeliveries(); await settle();
    await pd.sweepPiesaCopyDeliveries(); await settle();
    expect((await q<{ recipient: string }>("select recipient from piesa_deliveries where job_id=$1 and recipient='installer'", [JOB]))).toHaveLength(1);
    const installerCopy = providers.emails.slice(n0).filter((e) => /Signed electrical safety check/.test(e.subject));
    expect(installerCopy).toHaveLength(1);
    expect(installerCopy[0]!.text).toContain(`would have gone to: ${TRADE_EMAIL}`);
    expect(installerCopy[0]!.text).not.toMatch(/\$\s?\d/); // never HIV's PIESA price or the owner's quote
    // J4 G3: the trade copy after the upgrades says so (item 44 trade variant) and, the install being booked, has no "call the owner and book" line.
    expect(installerCopy[0]!.text).toContain("Electrical upgrades needed: Completed · CES COES-778899");
    expect(installerCopy[0]!.text).not.toContain("Next: call the owner and book the install");
    // 2pm the day before: the GO check runs and passes (CII, White Card, SWMS signed, deposit paid, PIESA confirmed).
    expect(await ps.sweepPrestart(twoPmBefore)).toEqual({ ran: 1, failed: 0 });
    expect(await ps.prestartGate(JOB, twoPmBefore)).toEqual({ locked: false, reasons: [] });
    // 4pm the day before (#47, Part 7 Task 5): ONE "Install tomorrow" text to the Lead Installer with the safety plan + Mitti form links.
    expect(await it.sweepInstallerTexts(fourPmBefore)).toEqual({ installTomorrow: 1, swmsSignLinks: 0 });
    expect(await it.sweepInstallerTexts(new Date(fourPmBefore.getTime() + 15 * 60_000))).toEqual({ installTomorrow: 0, swmsSignLinks: 0 });
    const texts = providers.texts.slice(t0);
    expect(texts.map((t) => t.to)).toEqual(["+61477511901"]);
    expect(texts[0]!.body).toMatch(/tomorrow/i);
    expect(texts[0]!.body).toContain("/sp/");
    expect(texts[0]!.body).toContain("safetyculture.com/inspection/");
    expect(texts[0]!.body).not.toMatch(/\$\s?\d|won't be paid|no pay/i);
    // The A5 install form was made at booking (Part 6/7: all forms immediately) — one, with the PIESA's life support / solar answers.
    const a5s = [...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A5);
    expect(a5s).toHaveLength(1);
    const id = await import("../src/lib/install-day.core");
    const picked = (label: string) => ((a5s[0]!.items.find((i) => i.label === label)?.responses as { selected?: { label: string }[] } | undefined)?.selected ?? []).map((x) => x.label);
    expect(picked(id.INSTALL_DAY_Q.lifeSupport)).toEqual(["No"]);
    expect(picked(id.INSTALL_DAY_Q.solar)).toEqual(["No"]);
  });
  test("install day: a half-done A5 records nothing; the ruler photos per area are required; the office reviews the product labels; then the installation is recorded once", async () => {
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    const r0 = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    expect(r0.state).toBe("not_complete");
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
    const forms = await import("./helpers/journey-forms");
    const id = await import("../src/lib/install-day.core");
    const ie = await import("../src/lib/install-evidence.server");
    const zones = await ie.jobUpgradeZones(JOB);
    const [b] = await q<{ scheduled_start: Date }>("select scheduled_start from bookings where job_id=$1 and kind='installation' and status='confirmed'", [JOB]);
    const capturedAt = new Date(b!.scheduled_start.getTime() + 2 * 3_600_000).toISOString();
    const a5 = [...providers.mitti.audits.values()].find((a) => a.template_id === TPL_A5)!;
    // Decision 396: first the form WITHOUT the ruler photos — "not finished", naming the area; nothing is recorded.
    const def = forms.completedA5({ q: id.INSTALL_DAY_Q as unknown as Record<string, string>, capturedAt, mediaPrefix: "a5", lead: "Ivy Installer", areas: Math.max(1, zones.length) });
    for (const m of def.mediaIds) providers.mitti.media.set(m, { bytes: forms.PNG_1X1, type: "image/png" });
    for (const m of def.videoIds) providers.mitti.media.set(m, { bytes: forms.PNG_1X1, type: "video/mp4" });
    fillAudit(a5, def.items);
    const ie396 = await import("../src/lib/install-evidence.core");
    const r1 = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    await settle();
    expect(r1.state).toBe("not_finished");
    expect(r1.missing).toContain(ie396.RULER_SECTION_MISSING);
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
    // Then the A5 with the ruler photo section: one copy per Ready Check area, both photos geotagged and timed.
    const withRuler = forms.completedA5({ q: id.INSTALL_DAY_Q as unknown as Record<string, string>, capturedAt, mediaPrefix: "a5", lead: "Ivy Installer", areas: Math.max(1, zones.length), ruler: id.INSTALL_DAY_RULER_Q });
    for (const m of withRuler.mediaIds) providers.mitti.media.set(m, { bytes: forms.PNG_1X1, type: "image/png" });
    // Part 8: the Lead Installer's VEEC Part B tick + signature on the A5's last page (required before the form counts as finished).
    const signedAt = new Date(b!.scheduled_start.getTime() + 6 * 3_600_000).toISOString();
    providers.mitti.media.set(forms.mediaId("a5-partb-signature"), { bytes: forms.PNG_1X1, type: "image/png" });
    const idc = await import("../src/lib/install-day.core");
    fillAudit(a5, [...withRuler.items.filter((i) => i.label === ""), { item_id: "a5_partb_tick", label: idc.INSTALL_DAY_NOV2_Q.partBTick, type: "checkbox", responses: { value: true } } as MittiItem, forms.signature(idc.INSTALL_DAY_NOV2_Q.partBSignature, forms.mediaId("a5-partb-signature"), signedAt, "Ivy Installer")]);
    const r2 = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    await settle();
    DBG("A5-DONE", zones.length, JSON.stringify(r2), await stageOf(JOB), await recent(JOB, 12));
    // Product labels are a human office review (piisa-products.core): until then nothing is recorded.
    expect(r2.missing).toEqual(["The product label evidence needs current office review."]);
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
    const [req] = await q<{ id: string }>("select id from evidence_requirements where job_id=$1 and category='product_evidence'", [JOB]);
    const pf = await import("../src/lib/portal.functions");
    await pf.verifyEvidence({ data: { requirementId: req!.id, status: "verified", actualProducts: [{ brand: "Bradford", model: "Gold Ceiling Batt R5.0", rValue: 5 }], installedAreaM2: 120 }, context: { userId: OFFICE, supabase: admin, claims: {} } });
    await settle();
    const n0 = providers.emails.length;
    const r3 = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    await settle();
    DBG("A5-HELD", (await events(JOB, "install_complete_auto_held")).map((e) => e.summary));
    DBG("A5-AFTER-REVIEW", JSON.stringify(r3), await stageOf(JOB), await recent(JOB, 12), JSON.stringify(sentSince(n0)).slice(0, 1500));
    expect(r3.state).toBe("all_filled_in");
    expect(await q("select id from evidence_requirements where job_id=$1 and gate='installation' and label like 'Install day:%'", [JOB])).toHaveLength(0);
    const rulerDocs = await q<{ title: string }>("select title from documents where job_id=$1 and kind='install_ruler_photo' order by title", [JOB]);
    expect(rulerDocs.length).toBe(2 * Math.max(1, zones.length));
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).not.toBeNull();
    expect(await events(JOB, "INSTALLATION_COMPLETED")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("evidence_outstanding");
    // Checking again records nothing new.
    await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx });
    await settle();
    expect(await events(JOB, "INSTALLATION_COMPLETED")).toHaveLength(1);
  });
});

describe("A1 step 11 — All done: the rebate form (VEEC Part B from the A5, AP Part A by itself, the owner's Section 4), the final balance, payouts (decisions 109/169/271/318/355)", () => {
  test("install recorded → ONE All done email + rebate-signing text to the owner, the final invoice email; the Lead's VEEC Part B on the A5 is applied once", async () => {
    // Sends at install completion (step 10): the approved All done email (O44, day 0 of the VEEC asks), the text, the final invoice.
    const done = providers.emails.filter((e) => /All done, Helen/.test(e.subject));
    expect(done).toHaveLength(1);
    expect(done[0]!.to).toEqual([OWNER_EMAIL]);
    expect(providers.emails.filter((e) => /final invoice/i.test(e.subject))).toHaveLength(1);
    expect(providers.texts.filter((t) => /sign your rebate form/.test(t.body))).toHaveLength(1);
    expect(await events(JOB, "veec_sign_reminder")).toHaveLength(1);
    for (const e of done) expect(e.text).not.toMatch(/electrician.*\$|paid|payout/i);
    // Part 8: the Lead's VEEC Part B (tick + signature on the A5) was applied to the VEEC assignment, prepared from the install facts, once.
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    DBG("PART-B", (await events(JOB, "veec_part_b_mitti_held")).map((e) => e.summary), await q("select record_kind, status, installer_signed_at is not null as installer_signed from customer_assignments where job_id=$1", [JOB]));
    expect(await q("select record_kind, status, installer_signed_at is not null as installer_signed from customer_assignments where job_id=$1", [JOB])).toEqual([{ record_kind: "final_veec_assignment", status: "awaiting_ap_signature", installer_signed: true }]);
    expect(await events(JOB, "veec_part_b_signed_mitti")).toHaveLength(1);
    await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx });
    await settle();
    expect(await events(JOB, "veec_part_b_signed_mitti")).toHaveLength(1);
    expect(await events(JOB, "INSTALLATION_COMPLETED")).toHaveLength(1);
  });
  test("AP Part A signs itself on the tick (decision 271: PIESA copies, ESC notice, consent, warranty copy all on file); the owner signs Section 4 on the link; VEEC ready", async () => {
    const va = await import("../src/lib/veec-ap-auto.server");
    const cp = await import("../src/lib/completion-pack.server");
    // Decision 276 / G1: the completion pack (O47) with the product warranty goes once the install is complete and the invoice
    // is paid — not yet; the AP signature waits for the warranty copy. The owner pays the balance (bank transfer, in Xero).
    expect(await cp.sweepCompletionPacks()).toMatchObject({ sent: 0 });
    const [inv] = await q<{ id: string; xero_invoice_id: string; total_inc_gst: number; total_paid: number }>("select id, xero_invoice_id, total_inc_gst, total_paid from invoices where job_id=$1 and kind='installation'", [JOB]);
    expect(Number(inv!.total_paid)).toBe(481.9); // $349 + 10% of (1678 − 349)
    const due = Math.round((Number(inv!.total_inc_gst) - Number(inv!.total_paid)) * 100) / 100;
    providers.xero.payments.push({ PaymentID: "xero-pay-balance-1", Invoice: { InvoiceID: inv!.xero_invoice_id }, Amount: due, Date: "/Date(1761696000000+0000)/", Status: "AUTHORISED", Reference: "HV balance bank transfer" });
    const x = await import("../src/lib/xero.server");
    const n0 = providers.emails.length;
    await x.syncInvoiceFromXero(inv!.id, null); await settle();
    await x.syncInvoiceFromXero(inv!.id, null); await settle();
    expect(await events(JOB, "balance_paid")).toHaveLength(1);
    expect((await q<{ total_paid: number; status: string }>("select total_paid, status from invoices where id=$1", [inv!.id]))[0]).toMatchObject({ total_paid: 1678, status: "fully_paid" });
    const pack = await cp.sweepCompletionPacks(); await settle();
    DBG("PACK", pack, providers.emails.slice(n0).map((e) => [e.to, e.subject, e.attachments]));
    expect(pack).toMatchObject({ sent: 1 });
    expect(await events(JOB, "warranty_copy_provided")).toHaveLength(1);
    expect(providers.emails.slice(n0).filter((e) => /would have gone to: jo@act/.test(e.text))).toHaveLength(0); // nothing to the installer here
    // The 15-minute tick signs Part A automatically — once.
    DBG("AP-HOLD", await va.apAutoHoldReasons(JOB));
    expect(await va.sweepAutoApSignatures()).toEqual({ checked: 1, signed: 1, held: 0 });
    expect(await events(JOB, "veec_ap_signed_auto")).toHaveLength(1);
    expect(await va.sweepAutoApSignatures()).toEqual({ checked: 0, signed: 0, held: 0 });
    // The owner signs Section 4 Part B on the All done screen (secure link alone).
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const page = await ol.ownerVeecAssignmentFn({ data: { token } }) as Record<string, unknown>;
    DBG("VEEC-PAGE", JSON.stringify(page).slice(0, 500));
    await ol.ownerSignVeecAssignmentFn({ data: { token, session, signatoryName: "Helen Journey", authorityType: "owner", signatureName: "Helen Journey", over18: true, confirmsSection2: true }, context: META });
    await settle();
    expect(await q("select status from customer_assignments where job_id=$1 and record_kind='final_veec_assignment'", [JOB])).toEqual([{ status: "effective_complete" }]);
    expect((await events(JOB, "FINAL_ASSIGNMENT_SIGNED")).map((e) => e.summary)).toEqual(["VEEC assignment form signed by AP representative (Section 3 Part A)", "VEEC assignment form signed by owner (Section 4 Part B)"]);
    expect(await events(JOB, "VEEC_ASSIGNMENT_EFFECTIVE")).toHaveLength(1);
    expect(await events(JOB, "veec_copy_email_sent")).toHaveLength(1); // the owner's signed copy, once
    // Signing again changes nothing.
    await expect(ol.ownerSignVeecAssignmentFn({ data: { token, session, signatoryName: "Helen Journey", authorityType: "owner", signatureName: "Helen Journey", over18: true, confirmsSection2: true }, context: META })).rejects.toThrow();
  });
  test("payouts: the Team electrician is paid the installer's OWN PIESA rate (= the owner's PIESA line, $349); the installer's Money page shows both rows; nothing says what HIV charges", async () => {
    const tv = await import("../src/lib/trade-view.server");
    const pg = await import("../src/lib/trade-payout-gate.server");
    const held = { assessment: await pg.payoutBlockersFor(JOB, "assessment"), rectification: await pg.payoutBlockersFor(JOB, "rectification"), installation: await pg.payoutBlockersFor(JOB, "installation") };
    DBG("GATES", JSON.stringify(held));
    expect(held.assessment).toEqual([]);
    expect(held.installation).toEqual([]);
    const money = await tv.tradeMoney(INST) as { rows: { kind: string; what: string; amount: number | null; held: string[]; state: { kind: string } }[]; screen: { rows: { title: string; rule: string }[] } };
    DBG("MONEY", JSON.stringify(money).slice(0, 2500));
    const piesaRow = money.rows.find((r) => r.kind === "assessment")!;
    // Jo 4 Nov 2026 ruling: own-customer PIESA payout = whatever THAT installer charges (their rate card: $317.27 ex = $349 inc), the same amount as the owner's line.
    expect(piesaRow.amount).toBe(349);
    expect(piesaRow.what).toContain("TEST Journey Insulation");
    expect((await q<{ line_total_inc_gst: number }>("select line_total_inc_gst from quote_items qi join quotes qt on qt.id = qi.quote_id where qt.job_id=$1 and qi.code='PIESA'", [JOB]))[0]!.line_total_inc_gst).toBe(349);
    expect(money.rows.map((r) => r.kind).sort()).toEqual(["assessment", "installation"]);
    const text = JSON.stringify(money);
    expect(text).not.toMatch(/1,?678|1,?520|margin|HIV keeps|our price/i); // never the owner's quote, the rebate or HIV's margin
    // Decision 410: the safety check row waits for the office's Approve of the A3, never for the owner's payment; then it is "coming".
    expect(piesaRow.state.kind).toBe("checking");
    const fa = await import("../src/lib/electrician-form-approval.server");
    expect((await fa.recordElectricianFormApproval(JOB, "assessment", null)).already).toBe(false);
    expect((await fa.recordElectricianFormApproval(JOB, "assessment", null)).already).toBe(true);
    const after = (await tv.tradeMoney(INST)) as { rows: { kind: string; state: { kind: string } }[] };
    expect(after.rows.find((r) => r.kind === "assessment")!.state.kind).toBe("coming");
    // No REC offer, no HIV electrician, no startPiesaAllocation ever touched this own job.
    expect(await q("select id from partner_offers where job_id=$1", [JOB])).toHaveLength(0);
    expect(await q("select business_id from job_assignments where job_id=$1 and role='electrician'", [JOB])).toEqual([{ business_id: BIZ }]);
  });
});

// ---- The other A3 branch, on a second own job of the same installer: the safety check is CLEAR — straight to install. ----
describe("A1 branch B — a second own job whose safety check is all clear: no upgrades day, no A4, straight to the install (Part 6 'No upgrades → straight to done')", () => {
  let JOB_B = "";
  test("Add a job → Ready Check → price → quote → owner accepts and pays $349 → the office books the PIESA for the Team electrician (same path as A)", async () => {
    const os = await import("../src/lib/onsite-ready-check.server");
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, { full_name: "Ben Clearway", address_line: "7 Clear Court", suburb: "Frankston", postcode: "3199", phone: OWNER_PHONE, email: OWNER_EMAIL, contact_permission: true, consent_by: "installer", address_verified: true } as never, null, undefined, { leadOrigin: "owner_contacted", electricianWorkerId: TEAM_ELEC });
    JOB_B = r.jobId;
    await settle();
    expect(await q("select role, business_id, user_id from job_assignments where job_id=$1 and active order by role", [JOB_B])).toEqual([{ role: "electrician", business_id: BIZ, user_id: null }, { role: "installer", business_id: BIZ, user_id: INST }]);
    const [{ external_id: a1 }] = await q<{ external_id: string }>("select external_id from ceiling_measurements where job_id=$1 and is_current and external_source='mitti'", [JOB_B]);
    completeA1(a1);
    const ms = await import("../src/lib/mitti.server");
    expect((await ms.syncMittiAssessment(JOB_B, null)).completed).toBe(true);
    await settle();
    await (await import("../src/lib/installer-price-set.server")).setInstallerPrice(JOB_B, INST, { priceIncGst: 2200, included: ["Ceiling insulation - supply & install"] });
    await settle();
    await (await import("../src/lib/mitti-complete.server")).sweepCompletedMittiReadyChecks({ enabled: true, sendEnabled: true });
    await settle();
    expect(await q("select status, option_code from quotes where job_id=$1", [JOB_B])).toEqual([{ status: "issued", option_code: "INSTALLER_A1" }]);
    expect((await q<{ code: string; line_total_inc_gst: number }>("select code, line_total_inc_gst from quote_items qi join quotes qt on qt.id = qi.quote_id where qt.job_id=$1 and code='PIESA'", [JOB_B]))[0]!.line_total_inc_gst).toBe(349);
    // The owner signs Gate B and accepts on the link, then pays the $349 by card.
    const ol = await import("../src/lib/owner-link.functions");
    const ogf = await import("../src/lib/owner-gates.functions");
    const { token, session } = await ownerSessionFor(JOB_B);
    for (let i = 0; i < 6; i++) {
      const p = await ogf.ownerPaperworkFn({ data: { token } }) as { todo: { key: string; gate: string }[] };
      const next = p.todo.find((t) => t.gate === "A" || t.gate === "B");
      if (!next) break;
      await ogf.ownerSignPaperworkFn({ data: { token, session, key: next.key, signatoryName: "Ben Clearway", ticked: true, answers: { role: "owner", life_support: "no" } }, context: META });
    }
    const [qq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and status='issued'", [JOB_B]);
    expect(await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: { ...SIGNING, typedName: "Ben Clearway" } }, context: META })).toEqual({ ok: true });
    await settle();
    const r2 = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string };
    expect(r2.url).toBeTruthy();
    const sess = providers.stripe.sessions.at(-1)!;
    expect(sess.form["metadata[job_id]"]).toBe(JOB_B);
    expect(sess.form["line_items[0][price_data][unit_amount]"]).toBe("34900");
    const wh = await stripePaidWebhook(sess, process.env["STRIPE_WEBHOOK_SECRET"]!);
    expect((await (await import("../src/lib/stripe.server")).handleStripeWebhook(wh.body, wh.signature)).outcome).toBe("recorded");
    await settle();
    expect(await stageOf(JOB_B)).toBe("piesa_and_install_window_pending");
    // The office books the safety check with the Team electrician.
    const pc = await import("../src/lib/piesa-times.core");
    const start = new Date(`${pc.allowedPiesaTimeDays()[3]!}T09:00:00+11:00`).toISOString();
    const n0 = providers.emails.length;
    expect(await (await import("../src/lib/trade-view.server")).inHouseBookVisit(INST, { jobId: JOB_B, kind: "assessment", start, workerId: TEAM_ELEC })).toMatchObject({ ok: true });
    await settle();
    await (await import("../src/lib/in-house-saved-work.server")).sweepInHouseSavedWork();
    await settle();
    expect(await stageOf(JOB_B)).toBe("piesa_scheduled");
    expect(await q("select mitti_template_id from assessments where job_id=$1 and external_mitti_id is not null", [JOB_B])).toEqual([{ mitti_template_id: TPL_A3 }]);
    expect(providers.emails.slice(n0).filter((e) => /You're booked/.test(e.subject)).map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(providers.emails.slice(n0).filter((e) => /PIESA\) booked/.test(e.subject))).toHaveLength(1);
  });
  test("the A3 says no repair work → Complete PIESA → clear to install at once: no A4 form, no upgrades day, the link is All done, the deposit is asked, the installer's next step is the install", async () => {
    const forms = await import("./helpers/journey-forms");
    const [{ external_mitti_id: auditId }] = await q<{ external_mitti_id: string }>("select external_mitti_id from assessments where job_id=$1", [JOB_B]);
    const def = forms.completedA3Pass({ inspectionDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()), capturedAt: new Date().toISOString(), mediaPrefix: "a3b" });
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(providers.mitti.audits.get(auditId)!, def.items);
    const n0 = providers.emails.length;
    // J4 G1: the signed, complete A3 completes the PIESA by itself on this in-house job (no Complete button anywhere).
    const out = await (await import("../src/lib/mitti.server")).syncPendingMitti(null);
    await settle();
    expect(out.find((x) => x.jobId === JOB_B)).toMatchObject({ ok: true, message: "synced" });
    expect((await q<Record<string, unknown>>("select status, mitti_completed, piesa_outcome from assessments where job_id=$1", [JOB_B]))[0]).toMatchObject({ status: "complete", mitti_completed: true, piesa_outcome: "pass" });
    expect(await events(JOB_B, "piesa_auto_complete_held")).toHaveLength(0);
    expect(await q("select kind, outcome from piesa_records where job_id=$1 and is_current", [JOB_B])).toEqual([{ kind: "initial", outcome: "pass" }]);
    expect(await events(JOB_B, "official_piesa_issued")).toHaveLength(1);
    expect((await stagePath(JOB_B)).slice(-2)).toEqual(["piesa_complete", "installation_scheduling"]);
    expect(await q("select id from bookings where job_id=$1 and kind='rectification'", [JOB_B])).toHaveLength(0);
    expect(await events(JOB_B, "fixes_form_created")).toHaveLength(0);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A4)).toHaveLength(1); // job A's only
    // The electrician: nothing more to do. The owner: the PIESA copy and the 10% deposit ask, once each.
    const el = await import("../src/lib/electrician-link.server");
    const linkB = await el.mintElectricianLink(JOB_B, TEAM_ELEC, INST);
    expect((await el.electricianLinkView(linkB.token)).view.step).toBe("all_done");
    const sent = providers.emails.slice(n0);
    expect(sent.filter((e) => /Signed electrical safety check \(PIESA\)/.test(e.subject)).map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(sent.filter((e) => /10% install deposit/.test(e.subject)).map((e) => e.to)).toEqual([[OWNER_EMAIL]]);
    expect(await events(JOB_B, "install_deposit_requested")).toHaveLength(1);
    for (const e of sent) expect(e.text).not.toMatch(/won't be paid|will not be paid|withheld/i);
    // The installer's Next step box: waiting on the deposit, then "Book the install" (Part 5 rules on the same facts).
    const { nextStepBox } = await import("../src/lib/next-step-box.core");
    const facts = { stage: await stageOf(JOB_B), quote: "accepted", acceptedAt: new Date().toISOString(), whoBooks: "either", electricianName: "Will Casdorff", ownerFirst: "Ben", ownerName: "Ben Clearway", ownerPhone: OWNER_PHONE, access: null, readyCheck: { start: null, done: true }, piesa: { start: null, outcome: "pass", upgradesDone: false, certificateIn: false }, depositPaidAt: null, install: { start: null, swmsSigned: 0, swmsTotal: 0 }, installDone: false, pay: null, now: new Date() } as never;
    expect(nextStepBox(facts).kind).toBe("waiting_deposit");
    expect(nextStepBox({ ...(facts as object), depositPaidAt: new Date().toISOString() } as never).kind).toBe("book_install");
    // The next sync changes nothing; the office's fallback Complete says it is done; the sweep sends nothing twice.
    await (await import("../src/lib/mitti.server")).syncPendingMitti(null); await settle();
    expect(await events(JOB_B, "official_piesa_issued")).toHaveLength(1);
    const pf = await import("../src/lib/portal.functions");
    await expect(pf.completeAssessment({ data: { jobId: JOB_B }, context: { userId: OFFICE, supabase: asUser(OFFICE), claims: {} } })).rejects.toThrow(/already complete/);
    await (await import("../src/lib/piesa-delivery.server")).sweepPiesaCopyDeliveries(); await settle();
    expect(providers.emails.slice(n0)).toHaveLength(sent.length);
  });
});
