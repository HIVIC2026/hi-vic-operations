// A2 complete route (external review 25 Oct 2026, §6 "Run both complete routes"; Jo approved the fix pass):
// a website enquiry (our lead) from the calculator through Save my spot, Jo's area batch Send (A48 batch 2), the owner's
// quick taps, the day-3 close, Jo's "Send to installer", the installer's run day (Portal books), the owner's confirm,
// the A2 Ready Check form, the quote and acceptance,
// against an isolated PGlite database holding every portal table, through the REAL server modules. Only the external
// providers are faked (Mitti, Resend, Twilio, Xero, Stripe — behind `fetch`, tests/helpers/journey-harness.ts). The
// steps after the $349 payment (electrician, PIESA, fixes, install day, completion, payouts) run the same server code
// as the A1 route and are proven in tests/journey-a1-complete-route-db.test.ts.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { fakeProviders, journeyAdmin, journeyDb, loadPendingFunctions, serverFnStandIn, fillAudit, stripePaidWebhook, type MittiItem } from "./helpers/journey-harness";

const BIZ = "30000000-0000-4000-8000-0000000000a2", INST = "40000000-0000-4000-8000-0000000000a2";
const OTHER_BIZ = "30000000-0000-4000-8000-0000000000b2", OTHER = "40000000-0000-4000-8000-0000000000b2";
const OFFICE = "40000000-0000-4000-8000-0000000000f2";
const TPL_A1 = "template_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", TPL_A2 = "template_a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2";
const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", TPL_A4 = "template_a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4", TPL_A5 = "template_a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
// Both on the TEST send allowlist (test-send.core); the owner's differs from the trades' (owner-verify links by email).
const OWNER_EMAIL = "jolowexo@hotmail.com", TRADE_EMAIL = "jo@actpropertyinspections.com.au", OWNER_PHONE = "0477 511 901";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000", XERO_API_KEY_1: "test-xero", STRIPE_SECRET_KEY: "sk_test_journey", STRIPE_TEST_SECRET_KEY: "sk_test_journey", STRIPE_WEBHOOK_SECRET: "whsec_journey", STRIPE_PAYMENTS_ENABLED: "true" })) process.env[k] = v;

const tplItem = (item_id: string, label: string, type = "textsingle"): MittiItem => ({ item_id, label, type });
const providers = fakeProviders({ mittiTemplates: {
  [TPL_A1]: { items: [tplItem("i_addr", "Site address", "address"), tplItem("i_owner", "Owner name"), tplItem("i_phone", "Homeowner phone"), tplItem("i_email", "Homeowner email"), tplItem("i_when", "Assessment date/time", "datetime")] },
  [TPL_A2]: { items: [tplItem("i_addr", "Site address", "address"), tplItem("i_owner", "Owner name"), tplItem("i_phone", "Homeowner phone"), tplItem("i_email", "Homeowner email"), tplItem("i_when", "Assessment date/time", "datetime")] },
} });
globalThis.fetch = providers.fetchImpl as typeof fetch;

const j = await journeyDb();
await loadPendingFunctions(j);
const { admin, asUser, storage } = journeyAdmin(j);
providers.storageFiles.map = storage;
const q = j.q;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// Mitti is faked at the network boundary here (providers.mitti). The trades' TEST address is also the TEST Mitti assignee,
// which the running portal sends to its persistent simulator (mitti_sim_audits) instead; this harness keeps those calls on
// the faked Mitti so the A2/A3 forms can be filled and read back like real ones. Nothing else about the route changes.
const realRoute = await import("../src/lib/mitti-test-route.core");
mock.module("../src/lib/mitti-test-route.core", () => ({ ...realRoute, isTestMittiEmail: () => false }));
const pending: Promise<unknown>[] = [];
const backgroundErrors: string[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { backgroundErrors.push(e.message); })); return "wait_until"; } }));
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

// ---- seed: two approved TEST installer businesses (one released to, one never contacted), office, HIV settings --------
for (const [id, user, name, mail] of [[BIZ, INST, "TEST Journey A2 Insulation", TRADE_EMAIL], [OTHER_BIZ, OTHER, "TEST Journey Other Insulation", "other@hivic-test.example"]] as const) {
  await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, mitti_account_invited, accepting_new_jobs, base_suburb, coverage_radius_km, phone, signer_mobile, email, service_postcodes, coverage_verified_at)
    values ($1,$2,$2,'11 222 333 444','eec_installer','{installer}',true,'approved',now(),'[TEST PARTNER] journey A2',true,true,'Frankston',60,'0477 511 901','0477 511 901',$3,'{3199}',now())`, [id, name, mail]);
  await q(`insert into profiles (id, full_name, email, phone) values ($1,$2,$3,'0477 511 901')`, [user, `${name} boss`, mail]);
  await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [id, user]);
  await q(`insert into user_roles (user_id, role) values ($1,'installer')`, [user]);
  // Onboarding answers: takes our leads and agreed to free Ready Checks; insurance and installer certificate verified.
  await q(`update businesses set receives_hivic_leads=true, free_measureups_for_hivic_quote_leads=true where id=$1`, [id]);
  const far = new Date(Date.now() + 365 * 86_400_000).toISOString();
  for (const [kind, label] of [["public_liability_insurance", "Public liability"], ["installer_certification", "Installer certification"]])
    await q(`insert into business_credentials (business_id, kind, label, number, expires_at, critical, verification, verified_at) values ($1,$2,$3,'TEST-1',$4,true,'verified',now())`, [id, kind, label, far]);
}
await q(`insert into profiles (id, full_name, email) values ($1,'Ollie Office','office@hivic-test.example')`, [OFFICE]);
await q(`insert into user_roles (user_id, role) values ($1,'admin')`, [OFFICE]);
await q(`insert into workflow_settings (id, mitti_ready_check_template_id, mitti_ready_check_priced_template_id, mitti_piesa_template_id, mitti_piisa_template_id, mitti_fixes_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst, payment_option_gate_enabled, ready_check_booking_enabled, piesa_install_window_days)
  values (1,$1,$2,$3,$4,$5,true,true,349,true,true,30)`, [TPL_A2, TPL_A1, TPL_A3, TPL_A5, TPL_A4]);
// The owner price settings (all NOT NULL in the live table): $30/m² R5 installed, standard access ×1.
await q(`insert into retail_estimator_settings (is_current, ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier)
  values (true, 349, 349, 95, 200, 30, 10, 1, 1.1, 1.25)`);
await q("insert into pricing_settings (version, ap_fee_ex_gst) values (1, 317.27)");
{ const { lookupLocation } = await import("../src/lib/activity48.core"); const l = lookupLocation("3199")!; await q("insert into veu_location_variables (postcode, metropolitan_or_regional, reticulated_gas, climate_region, climate_zone, source_version) values ($1,$2,$3,$4,$5,$6)", [l.postcode, l.metropolitan_or_regional, l.reticulated_gas, l.climate_region, l.climate_zone, l.source_version]); }

// The released installer's own onboarding record (done once when the business joined): the boss is the lead installer
// with an office-verified Full EEC CII (linked as the office "verify EEC" path does), a verified White Card and the ESC
// collection notice acknowledged on their own login.
{
  const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const [w] = await q<{ id: string }>(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, profile_id, account_status, approval_status, approved_at, certification)
    values ($1,'installer','Ivy A2 Installer',$2,'0477 511 901',$3,'active','approved',now(),$4) returning id`, [BIZ, TRADE_EMAIL, INST, JSON.stringify({ white_card: { path: "journey/white-card.png", uploaded_at: new Date().toISOString(), verified_at: new Date().toISOString(), verified_by: OFFICE } })]);
  const [c] = await q<{ id: string }>(`insert into partner_worker_certifications (worker_id, worker_email, status, evidence_note, evidence_source, recorded_by, certificate_number) values ($1,$2,'verified','journey onboarding','office',$3,'CII-2222') returning id`, [w!.id, TRADE_EMAIL, OFFICE]);
  await q(`insert into worker_certification_levels (certification_id, expires_on, level, recorded_by, worker_email) values ($1,$2,'full',$3,$4)`, [c!.id, far, OFFICE, TRADE_EMAIL]);
  await q(`update partner_workers set certification = certification || jsonb_build_object('verification_id', $2::text) where id=$1`, [w!.id, c!.id]);
  await (await import("../src/lib/trade-view.functions")).acknowledgeTradeCollectionNotice({ context: { userId: INST, supabase: asUser(INST), claims: {} } });
  // The installer's agreed rates (onboarding): R5 batts supply and install per m². FINDING (documented, not changed): the
  // office's Choose installer list and Release do not check for an active rate card — without one the A2 Ready Check
  // completes, the job shows "measured estimate ready" and no quote can be drafted ("no active installer rate card").
  const [rc] = await q<{ id: string }>(`insert into rate_cards (business_id, kind, name, version, is_active, effective_from) values ($1,'installer','TEST A2 installer rates',1,true,current_date - 1) returning id`, [BIZ]);
  await q(`insert into rate_card_items (rate_card_id, category, code, description, unit, unit_price_ex_gst, r_value, sort) values ($1,'insulation','R5_BATTS','R5.0 ceiling batts – supply and install','m2',18.18,5,1)`, [rc!.id]);
}

const events = (jobId: string, type: string) => q<{ summary: string; details: Record<string, unknown>; created_at: Date }>("select summary, details, created_at from workflow_events where job_id=$1 and event_type=$2 order by created_at", [jobId, type]);
const stageOf = async (jobId: string) => (await q<{ stage: string }>("select stage from jobs where id=$1", [jobId]))[0]!.stage;
const comms = (jobId: string) => q<{ channel: string; source_event: string; delivery_status: string; recipients: string[] }>("select channel, source_event, delivery_status, recipients from job_communications where job_id=$1 order by created_at", [jobId]);
const recent = async (jobId: string, n = 12) => (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit $2", [jobId, n])).map((e) => `${e.event_type}: ${e.summary}`);
const debug = (...a: unknown[]) => { if (process.env["JOURNEY_DEBUG"]) console.log(...a); };
const META = { ip: "127.0.0.1", userAgent: "journey-test" };
const officeCtx = { userId: OFFICE, supabase: asUser(OFFICE), claims: {} };
const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };

let JOB = "", BATCH = "", RUN = "";
afterAll(async () => { await j.db.close(); });
const ownerToken = async () => (await q<{ token: string }>("select token from customer_estimate_links where job_id=$1 and purpose='step3_estimate' and status='active'", [JOB]))[0]!.token;
let kept: { token: string; session: string } | null = null;
const ownerSession = async () => {
  if (kept) return kept;
  const ol = await import("../src/lib/owner-link.functions");
  const token = await ownerToken();
  const asked = await ol.requestOwnerCodeFn({ data: { token, channel: "email" } }) as { testCode: string | null };
  expect(asked.testCode).toMatch(/^\d{6}$/);
  const { session } = await ol.verifyOwnerCodeFn({ data: { token, code: asked.testCode } }) as { session: string };
  kept = { token, session };
  return kept;
};

describe("A2 step 1 — the website enquiry arrives (TEST job, our lead)", () => {
  test("calculator enquiry → one job, owner, consent, estimate and the owner's secure link; the same enquiry again attaches", async () => {
    const { upsertEnquiry } = await import("../src/lib/enquiry.server");
    const input = { external_enquiry_id: "qa-journey-a2", full_name: "Harriet Journey", email: OWNER_EMAIL, phone: OWNER_PHONE, address_line: "2 Journey Street", suburb: "Frankston", postcode: "3199", state: "VIC", occupancy: "owner_occupied",
      estimated_area_m2: 120, life_support: false, life_support_status: "no", declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no",
      contact_consent: true, contact_consent_version: "journey-test", contact_consented_at: new Date().toISOString(), age_confirmed: true, base44_answers: { existing_insulation: "none", property_type: "house" } };
    const res = await upsertEnquiry(input as never, "qa_test", OFFICE);
    JOB = res.job_id;
    const { data: jo } = await admin.from("jobs").select("owner_id").eq("id", JOB).single();
    await (await import("../src/lib/intake.server")).recordContactConsent(JOB, (jo as { owner_id: string }).owner_id, { contact_consent: true, contact_consent_version: "journey-test", contact_consented_at: new Date().toISOString(), external_enquiry_id: "qa-journey-a2" } as never);
    await (await import("../src/lib/eligibility.server")).autoDecideEligibility(JOB);
    await (await import("../src/lib/autoadvance.server")).autoAdvanceJob(JOB, OFFICE, "journey intake");
    const link = await (await import("../src/lib/estimatelink.server")).syncStep3(JOB, OFFICE);
    await settle();
    debug("ENQUIRY", res, link, await stageOf(JOB), await recent(JOB));
    expect(["issued", "reused"]).toContain(link.status);
    const [job] = await q<Record<string, unknown>>("select source, channel, stage from jobs where id=$1", [JOB]);
    expect(job).toMatchObject({ source: "qa_test" });
    // The same owner sends the calculator again (Base44 sends the whole questionnaire each time). Decision 400 (Jo 26 Oct
    // 2026): a repeat with a blank or missing insulation answer keeps the earlier answer (insulation-answer-keep.core,
    // tests/decision-400-insulation-answer-keep.test.ts); a new real answer still updates.
    const again = await upsertEnquiry({ ...input, external_enquiry_id: "qa-journey-a2-repeat", estimated_area_m2: 130 } as never, "qa_test", OFFICE);
    expect(again.job_id).toBe(JOB);
    expect(await q("select id from jobs")).toHaveLength(1);
  });
});

/** Business days from `from` days ahead, as YYYY-MM-DD in Melbourne. */
const melb = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(d);

describe("A2 step 2 — Save my spot (decision 388), Jo's area batch Send and the owner's quick taps (A48 batch 2)", () => {
  test("the owner saves their spot on the link (double tap = one spot)", async () => {
    const lc = await import("../src/lib/launch-campaign.functions");
    const token = await ownerToken();
    const page = await lc.getLaunchCampaignPage({ data: { token }, context: { ...META, assessmentTestMode: true } });
    expect(page).toBeTruthy();
    await lc.saveMySpot({ data: { token }, context: META });
    await lc.saveMySpot({ data: { token }, context: META });
    await settle();
    debug("SPOT", await q("select spot_saved_at from lead_campaign_responses where job_id=$1", [JOB]), await recent(JOB), (await comms(JOB)).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`));
    expect(await q("select id from lead_campaign_responses where job_id=$1 and spot_saved_at is not null", [JOB])).toHaveLength(1);
  });
  test("the retired one-by-one Release is refused for a website owner (they go in area batches)", async () => {
    const sr = await import("../src/lib/spot-release.functions");
    await expect(sr.releaseSpotFn({ data: { jobId: JOB, businessId: BIZ }, context: officeCtx })).rejects.toThrow(/area batches/);
    expect(await events(JOB, "spot_released")).toHaveLength(0);
  });
  test("Jo sends the area batch to one installer: the owner gets the quick taps text once; the installer is NOT contacted yet", async () => {
    const ab = await import("../src/lib/area-batch.functions");
    // An office user is required.
    await expect(ab.sendAreaBatchFn({ data: { jobIds: [JOB], businessId: BIZ }, context: instCtx })).rejects.toThrow();
    const r = await ab.sendAreaBatchFn({ data: { jobIds: [JOB], businessId: BIZ }, context: officeCtx });
    await settle();
    debug("BATCH-SEND", r, await recent(JOB), (await comms(JOB)).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`));
    expect(r).toMatchObject({ homes: 1, held: 0 });
    BATCH = r.batchId;
    expect((await events(JOB, "area_batch_sent")).map((e) => e.details["installer_business_id"])).toEqual([BIZ]);
    expect(await q("select id from partner_offers where job_id=$1", [JOB])).toHaveLength(0);
    expect((await comms(JOB)).filter((c) => /quick_taps:/.test(c.source_event)).map((c) => c.channel)).toEqual(["sms"]);
    // Send again (a second batch, another installer) while the owner hasn't answered is refused; nothing is sent twice.
    await expect(ab.sendAreaBatchFn({ data: { jobIds: [JOB], businessId: OTHER_BIZ }, context: officeCtx })).rejects.toThrow(/already in a batch/);
    expect((await comms(JOB)).filter((c) => /quick_taps/.test(c.source_event))).toHaveLength(1);
  });
  test("the owner confirms their name + address and answers the quick taps on the link → a pass, the share consent recorded; a second save changes nothing", async () => {
    const qt = await import("../src/lib/quick-taps.functions");
    const token = await ownerToken();
    const view = await qt.ownerQuickTapsStateFn({ data: { token }, context: META }) as { kind: string; name: string | null; address: string | null };
    debug("TAPS-VIEW", JSON.stringify(view));
    expect(view).toMatchObject({ kind: "ask", name: "Harriet Journey" });
    expect(view.address).toContain("2 Journey Street");
    // Tap 1 / Tap 2: "Yes" to the name and address on file (they're sent back as the confirmed answers), then the 4 questions.
    const answers = { name: view.name, address: view.address, hatch: "yes", roof: "sloped", five_years: "no", go: "yes" } as const;
    const done = await qt.ownerQuickTapsSaveFn({ data: { token, answers }, context: META });
    const again = await qt.ownerQuickTapsSaveFn({ data: { token, answers: { ...answers, go: "no_thanks" } }, context: META });
    await settle();
    debug("TAPS-DONE", done, again, await recent(JOB));
    expect(done).toEqual({ kind: "done", outcome: "pass" });
    expect(again).toEqual({ kind: "done", outcome: "pass" });
    expect((await events(JOB, "quick_taps_answered")).map((e) => [e.details["outcome"], e.details["consent_share"]])).toEqual([["pass", true]]);
    expect(await q("select id from owner_gate_signatures where job_id=$1 and doc_key='trade_contact_share'", [JOB])).toHaveLength(1);
    expect(await stageOf(JOB)).not.toBe("cancelled");
  });
  test("day 3: the 15-minute tick closes the batch; the owner who said yes waits for Jo's OK (nothing goes to the installer)", async () => {
    const abs = await import("../src/lib/area-batch.server");
    const ab = await import("../src/lib/area-batch.functions");
    expect((await abs.sweepAreaBatches(new Date(Date.now() + 47 * 3_600_000).toISOString())).closed).toBe(0);
    const r = await abs.sweepAreaBatches(new Date(Date.now() + 73 * 3_600_000).toISOString());
    await abs.sweepAreaBatches(new Date(Date.now() + 74 * 3_600_000).toISOString());
    await settle();
    debug("BATCH-CLOSE", r, await recent(JOB));
    expect(r).toMatchObject({ closed: 1, failed: 0 });
    expect((await events(JOB, "area_batch_closed")).map((e) => [e.details["batch_id"], e.details["pass_job_ids"]])).toEqual([[BATCH, [JOB]]]);
    const ready = await ab.getBatchesReadyToSend({ data: { includeTest: true }, context: officeCtx }) as { batchId: string; installer: { id: string }; homes: { jobId: string }[] }[];
    expect(ready.map((b) => [b.batchId, b.installer.id, b.homes.map((h) => h.jobId)])).toEqual([[BATCH, BIZ, [JOB]]]);
    expect(await q("select id from partner_offers where job_id=$1", [JOB])).toHaveLength(0);
    expect(await events(JOB, "run_offered")).toHaveLength(0);
  });
  test("Jo taps \"Send to installer\": ONE run for the installer she picked, the installer texted once; a second tap is refused", async () => {
    const ir = await import("../src/lib/installer-run.functions");
    await expect(ir.offerRunFn({ data: { batchId: BATCH }, context: instCtx })).rejects.toThrow();
    const r = await ir.offerRunFn({ data: { batchId: BATCH }, context: officeCtx }) as { runId: string; homes: number; text: { status: string } };
    await settle();
    debug("RUN-OFFER", r, await recent(JOB));
    expect(r).toMatchObject({ homes: 1, text: { status: "sent" } });
    RUN = r.runId;
    expect((await events(JOB, "run_offered")).map((e) => [e.details["run_id"], e.details["business_id"]])).toEqual([[RUN, BIZ]]);
    await expect(ir.offerRunFn({ data: { batchId: BATCH }, context: officeCtx })).rejects.toThrow(/already been sent/);
    expect(await events(JOB, "run_offered")).toHaveLength(1);
    // Off Jo's list once sent.
    const ab = await import("../src/lib/area-batch.functions");
    expect(await ab.getBatchesReadyToSend({ data: { includeTest: true }, context: officeCtx })).toEqual([]);
  });
});

describe("A2 step 3 — the installer picks the run day (Portal books); the owner confirms their window → booked, the A2 form is made once", () => {
  test("only the run's business sees it; the installer picks a day → the owner gets a window; the owner confirms → Ready Check scheduled", async () => {
    const ir = await import("../src/lib/installer-run.functions");
    // Another installer business can't see or answer the run.
    await expect(ir.getTradeRun({ data: { runId: RUN }, context: { userId: OTHER, supabase: asUser(OTHER), claims: {} } })).rejects.toThrow();
    const page = await ir.getTradeRun({ data: { runId: RUN }, context: instCtx }) as { status: string; homes: { jobId: string; ownerName: string | null }[]; days: string[]; team: { userId: string }[] };
    debug("RUN-PAGE", JSON.stringify(page));
    expect(page.status).toBe("offered");
    expect(page.homes.map((h) => [h.jobId, h.ownerName])).toEqual([[JOB, "Harriet Journey"]]);
    expect(page.team.map((m) => m.userId)).toContain(INST);
    await expect(ir.chooseTradeRunDay({ data: { runId: RUN, day: page.days[0]!, start: "09:00", secondDay: null }, context: { userId: OTHER, supabase: asUser(OTHER), claims: {} } })).rejects.toThrow();
    const chosen = await ir.chooseTradeRunDay({ data: { runId: RUN, day: page.days[0]!, start: "09:00", secondDay: null, personId: INST }, context: instCtx }) as { slots: { jobId: string; day: string; start: string }[] };
    await settle();
    debug("RUN-DAY", chosen, await recent(JOB));
    expect(chosen.slots).toEqual([{ jobId: JOB, day: page.days[0]!, start: "09:00", end: "10:00" }]);
    expect(await events(JOB, "run_slot_proposed")).toHaveLength(1);
    // The same pick again is refused (the run is answered); nothing more is written.
    await expect(ir.chooseTradeRunDay({ data: { runId: RUN, day: page.days[1]!, start: "09:00", secondDay: null }, context: instCtx })).rejects.toThrow();
    expect(await events(JOB, "run_slot_proposed")).toHaveLength(1);

    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSession();
    const card = await ol.ownerRunSlotFn({ data: { token } }) as { kind: string; installer?: string };
    debug("OWNER-RUN", JSON.stringify(card));
    expect(card).toMatchObject({ kind: "proposed" });
    await ol.ownerConfirmRunSlotFn({ data: { token, session }, context: META });
    await settle();
    await ol.ownerConfirmRunSlotFn({ data: { token, session }, context: META }); // a second tap books nothing more
    await settle();
    debug("RC-BOOKED", await stageOf(JOB), await q("select status, scheduled_start from bookings where job_id=$1", [JOB]), [...providers.mitti.audits.values()].map((a) => a.template_id), await recent(JOB, 14), (await comms(JOB)).slice(-6).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`));
    expect(await stageOf(JOB)).toBe("ready_check_scheduled");
    expect(await q("select status from bookings where job_id=$1 and kind='ready_check'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(await q("select user_id, business_id from job_assignments where job_id=$1 and role='installer' and active", [JOB])).toEqual([{ user_id: INST, business_id: BIZ }]);
    expect(await events(JOB, "run_slot_confirmed")).toHaveLength(1);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A2)).toHaveLength(1);
    expect(await ol.ownerRunSlotFn({ data: { token } })).toMatchObject({ kind: "confirmed" });
    void melb;
  });
});

const ans = (label: string, text: string): MittiItem => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "textsingle", responses: { text } });
const pick = (label: string, ...labels: string[]): MittiItem => ({ item_id: `a_${label.replace(/\W+/g, "_").toLowerCase()}`, label, type: "question", responses: { selected: labels.map((l) => ({ label: l })) } });

describe("A2 step 4 — the installer completes the A2 Ready Check in Mitti → the owner quote is drafted for the office", () => {
  test("Complete A2: measurements recorded, a draft quote from the installer's rates held for the office (nothing reaches the owner)", async () => {
    const a = [...providers.mitti.audits.values()].find((x) => x.template_id === TPL_A2)!;
    fillAudit(a, [
      pick("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"), pick("Life support equipment at property?", "No"),
      pick("How easy is the ceiling access?", "Easy"), pick("How many separate ceiling areas are there?", "1"),
      { item_id: "a_area1", label: "Ceiling area 1", type: "section", children: [
        ans("Enter the measured ceiling area (m²)", "120"), pick("Is there existing insulation?", "No"), pick("How was this ceiling area measured?", "Laser in the ceiling space"),
        pick("Recessed downlights in this area?", "No"), pick("Hazards in this area?", "No"),
      ] },
      pick("Was the ceiling or roof built or replaced in the last 5 years?", "No"), pick("What insulation product will you be using on this job?", "Bradford Gold R5"),
      pick("Are any extras needed beyond the standard install and removal?", "No"),
    ]);
    const ms = await import("../src/lib/mitti.server");
    const r = await ms.syncMittiAssessment(JOB, null);
    await settle();
    debug("A2-SYNC", JSON.stringify(r), await stageOf(JOB), await q("select id, status, release_state, option_code, subtotal_inc_gst, customer_total_inc_gst, veec_discount_inc_gst from quotes where job_id=$1", [JOB]), await recent(JOB, 14));
    expect(r.completed).toBe(true);
    const qs = await q<Record<string, unknown>>("select status, release_state, sent_at from quotes where job_id=$1 and kind='installation'", [JOB]);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ status: "draft", sent_at: null });
    expect((await comms(JOB)).filter((c) => /quote_ready/.test(c.source_event))).toHaveLength(0);
  });
});

const SIGNING = { signatoryName: "Harriet Journey", authorityType: "owner", signatureName: "Harriet Journey", over18: true, readConsumerInfo: true, acceptAgreement: true, assistance: "none", declarations:{owner_or_authorised:true,details_accurate:true,consent_ap_sends:true,consent_commission_shares:true} };

describe("A2 step 5 — the office checks and sends the quote; the owner signs and accepts; the $349 safety check is paid", () => {
  test("only the office can send the held quote; Send issues it once and the owner gets it by email + text", async () => {
    const iq = await import("../src/lib/installer-quote.functions");
    const [qq] = await q<{ id: string }>("select id from quotes where job_id=$1 and kind='installation'", [JOB]);
    await expect(iq.sendInstallerQuote({ data: { jobId: JOB, quoteId: qq!.id }, context: instCtx })).rejects.toThrow();
    await iq.sendInstallerQuote({ data: { jobId: JOB, quoteId: qq!.id }, context: officeCtx });
    await settle();
    debug("SENT", await q("select status, release_state, sent_at from quotes where id=$1", [qq!.id]), await stageOf(JOB), (await comms(JOB)).slice(-4).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`), await recent(JOB, 8));
    expect(await q("select status, release_state from quotes where id=$1", [qq!.id])).toEqual([{ status: "issued", release_state: "released" }]);
    // Send again (double click): nothing is sent twice.
    await iq.sendInstallerQuote({ data: { jobId: JOB, quoteId: qq!.id }, context: officeCtx }).catch(() => undefined);
    await settle();
    const sent = (await comms(JOB)).filter((c) => /quote_ready/.test(c.source_event));
    expect(sent.map((c) => c.channel).sort()).toEqual(["email", "sms"]);
  });
  test("office one-off setup, owner paperwork and acceptance on the link (stale version refused, double accept refused)", async () => {
    const pf = await import("../src/lib/portal.functions");
    for (const [key, body] of [["consumer_rights", "TEST VEU consumer information and consumer rights (journey fixture text, office-loaded)."], ["customer_agreement", "TEST customer agreement wording (journey fixture text, office-loaded)."]] as const) {
      await pf.addComplianceTemplate({ data: { template_key: key, version: "journey-1", body }, context: officeCtx });
      const [t] = await q<{ id: string }>("select id from compliance_templates where template_key=$1 and version='journey-1'", [key]);
      await pf.approveComplianceTemplate({ data: { id: t!.id }, context: officeCtx });
    }
    const ol = await import("../src/lib/owner-link.functions");
    const ogf = await import("../src/lib/owner-gates.functions");
    const { token, session } = await ownerSession();
    const signed: string[] = [];
    for (let i = 0; i < 15; i++) {
      const p = await ogf.ownerPaperworkFn({ data: { token } }) as { todo: { key: string; gate: string }[] };
      const next = p.todo.find((t) => t.gate === "A" || t.gate === "B");
      if (!next) break;
      await ogf.ownerSignPaperworkFn({ data: { token, session, key: next.key, signatoryName: "Harriet Journey", ticked: true, answers: { role: "owner", life_support: "no" } }, context: META });
      signed.push(next.key);
    }
    debug("SIGNED", signed);
    const [qq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and status='issued'", [JOB]);
    await expect(ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version + 1, signing: SIGNING }, context: META })).rejects.toThrow(/updated since/);
    await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META });
    await settle();
    expect(await ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META })).toEqual({ ok: true, outcome: "already accepted" });
    debug("ACCEPTED", await stageOf(JOB), await q("select status from quotes where id=$1", [qq!.id]), await recent(JOB, 12));
    expect(await q("select status from quotes where id=$1", [qq!.id])).toEqual([{ status: "accepted" }]);
    expect(await q("select id from customer_agreements where job_id=$1", [JOB])).toHaveLength(1);
    expect(await events(JOB, "QUOTE_ACCEPTED")).toHaveLength(1);
  });
  test("$349 by card: Stripe checkout once per amount, forged webhook refused, the paid webhook recorded once", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken();
    const r = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string };
    const r2 = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string };
    expect(r.url).toBeTruthy();
    expect(r2.url).toBe(r.url);
    const s = providers.stripe.sessions.at(-1)!;
    expect(s.form["line_items[0][price_data][unit_amount]"]).toBe("34900");
    expect(s.idempotencyKey).toMatch(/^hivic-checkout-/);
    const st = await import("../src/lib/stripe.server");
    const forged = await stripePaidWebhook(s, "whsec_wrong");
    expect(await st.handleStripeWebhook(forged.body, forged.signature)).toEqual({ status: 400, outcome: "bad_signature" });
    const wh = await stripePaidWebhook(s, process.env["STRIPE_WEBHOOK_SECRET"]!);
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "recorded" });
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "duplicate" }); // Stripe retry
    await settle();
    debug("PAID", await stageOf(JOB), await recent(JOB, 10));
    expect((await events(JOB, "owner_payment_recorded")).map((e) => e.summary)).toEqual(["Card payment of $349.00 received (Stripe, safety check)"]);
    expect(await events(JOB, "deposit_paid")).toHaveLength(1);
    expect(providers.stripe.sessions).toHaveLength(1); // two clicks, one Stripe session (same idempotency key)
  });
});

const REC = "30000000-0000-4000-8000-0000000000e2", ELEC = "40000000-0000-4000-8000-0000000000e2";

describe("A2 step 6 — the electrician's safety check (PIESA) with NO repair work → Complete PIESA → cleared for install", () => {
  test("automatic electrician offer (decision 246) → 3 times → the owner ticks the 30-day box and takes one → PIESA booked", async () => {
    const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, accepting_new_jobs, rec_number, service_postcodes, coverage_verified_at, phone, email, base_suburb, coverage_radius_km)
      values ($1,'TEST Journey A2 Sparks','TEST Journey A2 Sparks','22 333 444 555','rec','{electrician}',true,'approved',now(),'[TEST PARTNER] journey REC',true,'REC-22222','{3199}',now(),'0477 511 901',$2,'Frankston',60)`, [REC, TRADE_EMAIL]);
    await q(`insert into profiles (id, full_name, email, phone) values ($1,'Eddie A2 Electrician',$2,'0477 511 901')`, [ELEC, TRADE_EMAIL]);
    await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [REC, ELEC]);
    await q(`insert into user_roles (user_id, role) values ($1,'electrician')`, [ELEC]);
    await q(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, licence_number, licence_expires_on, profile_id, account_status, approval_status, approved_at)
      values ($1,'electrician','Eddie A2 Electrician',$2,'0477 511 901','A22222',$3,$4,'active','approved',now())`, [REC, TRADE_EMAIL, far, ELEC]);
    for (const [kind, label] of [["public_liability_insurance", "Public liability"], ["electrical_licence", "Electrical licence"], ["rec_registration", "REC registration"]])
      await q(`insert into business_credentials (business_id, kind, label, number, expires_at, critical, verification, verified_at) values ($1,$2,$3,'TEST-1',$4,true,'verified',now())`, [REC, kind, label, far]);
    for (const [service, rate] of [["piesa", 220], ["rectification_visit", 180]] as const)
      await q(`insert into electrician_rates (business_id, service_type, rate_inc_gst, status, effective_from, gst_included) values ($1,$2,$3,'active',current_date - 1,true)`, [REC, service, rate]);
    await q("update workflow_settings set auto_electrician_offers = true where id = 1");
    const ao = await import("../src/lib/auto-offer.server");
    const r = await ao.autoOfferForJob(JOB, "piesa");
    await settle();
    debug("A2-AUTO-OFFER", r, await stageOf(JOB));
    expect(r).toMatchObject({ step: "offer", businessId: REC });
    const tv = await import("../src/lib/trade-view.server");
    const pc = await import("../src/lib/piesa-times.core");
    const [offer] = await q<{ id: string }>("select id from partner_offers where job_id=$1 and kind='piesa' and status='pending'", [JOB]);
    await tv.tradeOfferPiesaTimes(offer!.id, ELEC, pc.allowedPiesaTimeDays().slice(1, 4).map((day) => ({ day, time: "10:00" })));
    await settle();
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSession();
    const [p] = await q<{ id: string }>("select id from appointment_proposals where job_id=$1 and kind='assessment' and status='proposed' order by starts_at limit 1", [JOB]);
    await expect(ol.ownerTakePiesaTimeLinkFn({ data: { token, session, proposalId: p!.id }, context: META })).rejects.toThrow();
    // Decision 398: booking the PIESA creates the electrician's A3 form in Mitti automatically (the A3 template is set up in Mitti).
    const forms = await import("./helpers/journey-forms");
    const def = forms.completedA3Pass({ inspectionDate: melb(new Date()), capturedAt: new Date().toISOString(), mediaPrefix: "a2-a3" });
    providers.templates[TPL_A3] = forms.templateOf([forms.text("Job Reference ID", ""), forms.text("Address including postcode", ""), forms.text("Owner name", ""), ...def.items]);
    await ol.ownerTakePiesaTimeLinkFn({ data: { token, session, proposalId: p!.id, understandsThirtyDays: true }, context: META });
    await settle();
    expect(await stageOf(JOB)).toBe("piesa_scheduled");
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A3)).toHaveLength(1);
    expect(await q("select id from workflow_events where job_id=$1 and event_type='piesa_autoform_failed'", [JOB])).toHaveLength(0);
  });
  test("the A3 says no repair work: the PIESA result is a pass and Complete PIESA needs no tick (C4)", async () => {
    const forms = await import("./helpers/journey-forms");
    const today = melb(new Date());
    const def = forms.completedA3Pass({ inspectionDate: today, capturedAt: new Date().toISOString(), mediaPrefix: "a2-a3" });
    providers.templates[TPL_A3] = forms.templateOf([forms.text("Job Reference ID", ""), forms.text("Address including postcode", ""), forms.text("Owner name", ""), ...def.items]);
    const pf = await import("../src/lib/portal.functions");
    // The office button (backup) reuses the form made at booking — never a second one.
    const c = await pf.createMittiAssessment({ data: { jobId: JOB }, context: officeCtx }) as { auditId: string; reused: boolean };
    expect(c.reused).toBe(true);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A3)).toHaveLength(1);
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(providers.mitti.audits.get(c.auditId)!, def.items);
    await (await import("../src/lib/mitti.server")).syncPendingMitti(null);
    await settle();
    const [a] = await q<{ piesa_outcome: string; no_rectification_confirmed: boolean | null; mitti_completed: boolean }>("select piesa_outcome, no_rectification_confirmed, mitti_completed from assessments where job_id=$1", [JOB]);
    debug("A2-A3", a, await recent(JOB, 10));
    expect(a).toMatchObject({ piesa_outcome: "pass", mitti_completed: true });
    expect(a!.no_rectification_confirmed).not.toBe(true);
    const elecCtx = { userId: ELEC, supabase: asUser(ELEC), claims: {} };
    // C4: a live A3 pass with no fixes items needs no tick (the portal tick is gone). Set it directly as journey.server.ts does; Complete PIESA must work either way.
    await admin.from("assessments").update({ no_rectification_confirmed: true }).eq("job_id", JOB);
    await pf.completeAssessment({ data: { jobId: JOB }, context: elecCtx });
    await settle();
    debug("A2-PIESA-DONE", await stageOf(JOB), await recent(JOB, 14), (await comms(JOB)).slice(-6).map((x) => `${x.channel}:${x.source_event}:${x.delivery_status}`));
    expect(await q("select kind, outcome, is_current from piesa_records where job_id=$1", [JOB])).toEqual([{ kind: "initial", outcome: "pass", is_current: true }]);
    expect(await events(JOB, "official_piesa_issued")).toHaveLength(1);
  });
});

describe("A2 step 7 — the owner confirms the safety check, then the install day is agreed and booked (decisions 296/325)", () => {
  test("install days can't be taken before the owner confirms the PIESA; after confirming, the owner takes one of the installer's 3 days → installation booked", async () => {
    const af = await import("../src/lib/allocation.functions");
    const st = await af.getInstallerInstallDays({ data: { jobId: JOB }, context: instCtx }) as { turn: string; days: string[] };
    debug("A2-INSTALL-STATE", st.turn, st.days.slice(0, 4));
    expect(st.turn).toBe("installer_to_offer");
    await af.installerOfferInstallDays({ data: { jobId: JOB, days: st.days.slice(1, 4).map((day) => ({ day, time: "08:00" })) }, context: instCtx });
    await settle();
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSession();
    const offered = await q<{ id: string }>("select id from appointment_proposals where job_id=$1 and install_day and status='proposed' order by starts_at", [JOB]);
    expect(offered).toHaveLength(3);
    let early = "";
    try { await ol.ownerTakeInstallDayFn({ data: { token, session, proposalId: offered[0]!.id }, context: META }); } catch (e) { early = (e as Error).message; }
    debug("A2-EARLY-TAKE", early, await q("select status from bookings where job_id=$1 and kind='installation'", [JOB]));
    expect(early).not.toBe("");
    expect(await q("select id from bookings where job_id=$1 and kind='installation' and status='confirmed'", [JOB])).toHaveLength(0);
    // The 15-minute tick asks the owner to confirm the PIESA once; the owner confirms on the link.
    const pc = await import("../src/lib/piesa-owner-confirm-send.server");
    await pc.sweepOwnerPiesaConfirmations();
    await settle();
    await ol.ownerSignPiesaConfirmFn({ data: { token, signatoryName: "Harriet Journey", signatureName: "Harriet Journey", authorityType: "owner", confirmed: true }, context: META });
    await settle();
    expect(await events(JOB, "piesa_owner_confirmed")).toHaveLength(1);
    // The early refusal left the installer's 3 days open (night-run fix: it used to close them all); the owner takes the first.
    const open = await q<{ id: string }>("select id from appointment_proposals where job_id=$1 and install_day and status='proposed' order by starts_at", [JOB]);
    expect(open.map((o) => o.id)).toEqual(offered.map((o) => o.id));
    expect(await events(JOB, "install_day_booking_blocked")).toHaveLength(0);
    await ol.ownerTakeInstallDayFn({ data: { token, session, proposalId: open[0]!.id }, context: META });
    await settle();
    debug("A2-INSTALL-BOOKED", await stageOf(JOB), await recent(JOB, 12));
    expect(await stageOf(JOB)).toBe("installation_booked");
    expect(await q("select status from bookings where job_id=$1 and kind='installation'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(backgroundErrors).toEqual([]);
  });
});
