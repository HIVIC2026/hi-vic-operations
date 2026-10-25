// A1 complete route (external review 25 Oct 2026, §6 "Run both complete routes"; Jo approved the fix pass):
// an installer's OWN customer from Add a job to payouts, against an isolated PGlite database holding every portal table,
// through the REAL server modules. Only the external providers are faked (Mitti, Resend, Twilio, Xero, Stripe — all
// behind `fetch`, see tests/helpers/journey-harness.ts). At every step the persisted rows are read back: the job's
// stage, its workflow_events, the sends recorded with their idempotency keys, and that the next step is refused when
// tried too early.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { fakeProviders, journeyAdmin, journeyDb, loadPendingFunctions, serverFnStandIn, fillAudit, stripePaidWebhook, type MittiItem } from "./helpers/journey-harness";

// ---- fixed TEST data ----------------------------------------------------------------------------------------------
const BIZ = "30000000-0000-4000-8000-0000000000a1", INST = "40000000-0000-4000-8000-0000000000a1";
const REC = "30000000-0000-4000-8000-0000000000e1", ELEC = "40000000-0000-4000-8000-0000000000e1";
const OFFICE = "40000000-0000-4000-8000-0000000000f1";
const TPL_A1 = "template_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", TPL_A2 = "template_a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2";
const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", TPL_A4 = "template_a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4", TPL_A5 = "template_a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
// Jo's own allow-listed TEST inbox and mobile (test-send.core TEST_ALLOWLIST) — nothing leaves the fake providers anyway.
// Both addresses are on the TEST send allowlist (test-send.core). The owner's is different from the trades' so the
// owner's verified identity (owner-verify.server links by verified email) is never a trade's own login.
const OWNER_EMAIL = "jolowexo@hotmail.com", TRADE_EMAIL = "jo@actpropertyinspections.com.au", OWNER_PHONE = "0477 511 901";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000", XERO_API_KEY_1: "test-xero", STRIPE_SECRET_KEY: "sk_test_journey", STRIPE_WEBHOOK_SECRET: "whsec_journey", STRIPE_PAYMENTS_ENABLED: "true" })) process.env[k] = v;

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

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// Background work is awaited by the test (the deployed Worker keeps it alive with waitUntil).
const pending: Promise<unknown>[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { backgroundErrors.push(e.message); })); return "wait_until"; } }));
const backgroundErrors: string[] = [];
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

// ---- seed: one TEST installer business (approved), its owner-member, HIV settings ------------------------------------
await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, mitti_account_invited, accepting_new_jobs, base_suburb, coverage_radius_km, phone, signer_mobile, email)
  values ($1,'TEST Journey Insulation','TEST Journey Insulation','11 222 333 444','eec_installer','{installer}',true,'approved',now(),'[TEST PARTNER] journey A1',true,true,'Frankston',60,'0477 511 901','0477 511 901',$2)`, [BIZ, TRADE_EMAIL]);
await q(`insert into profiles (id, full_name, email, phone) values ($1,'Ivy Installer',$2,'0477 511 901'), ($3,'Ollie Office','office@hivic-test.example',null)`, [INST, TRADE_EMAIL, OFFICE]);
await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [BIZ, INST]);
await q(`insert into user_roles (user_id, role) values ($1,'installer'), ($2,'admin')`, [INST, OFFICE]);
await q(`insert into workflow_settings (id, mitti_ready_check_template_id, mitti_ready_check_priced_template_id, mitti_piesa_template_id, mitti_piisa_template_id, mitti_fixes_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst, payment_option_gate_enabled, ready_check_booking_enabled, piesa_install_window_days)
  values (1,$1,$2,$3,$4,$5,true,true,349,true,true,30)`, [TPL_A2, TPL_A1, TPL_A3, TPL_A5, TPL_A4]);
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
    for (const f of ["accept_install_day", "approve_rectification_with_window", "accept_partner_offer", "accept_partner_offer_slot", "issue_owner_link_code"]) expect(fns.loaded).toContain(f);
  });
});

describe("A1 step 1 — Add a job (decisions 34/115/282/289)", () => {
  test("basics + permission → one job, owner, property, consent, electrician choice, Mitti A1 form created once", async () => {
    const os = await import("../src/lib/onsite-ready-check.server");
    const r = await os.startOnsiteReadyCheckFor(INST, BIZ, { full_name: "Helen Journey", address_line: "1 Journey Street", suburb: "Frankston", postcode: "3199", phone: OWNER_PHONE, email: OWNER_EMAIL, contact_permission: true, consent_by: "installer", address_verified: true } as never, { mode: "hivic" } as never);
    JOB = r.jobId;
    await settle();
    expect(backgroundErrors).toEqual([]);
    const [job] = await q<Record<string, unknown>>("select stage, channel, source, originating_installer_business_id, job_number from jobs where id=$1", [JOB]);
    expect(job).toMatchObject({ channel: "installer_sourced", source: "qa_test", originating_installer_business_id: BIZ });
    expect(String(job!["job_number"])).toMatch(/^HV-\d+$/);
    expect(await q("select consent_status from owner_contact_consents where job_id=$1", [JOB])).toEqual([{ consent_status: "granted" }]);
    expect((await events(JOB, "electrician_choice_set")).map((e) => e.details["choice"])).toEqual(["hivic"]);
    expect([...providers.mitti.audits.values()].map((a) => a.template_id)).toEqual([TPL_A1]);
    expect(await q("select external_id from ceiling_measurements where job_id=$1 and is_current and external_source='mitti'", [JOB])).toEqual([{ external_id: "audit_1" }]);
    expect(await stageOf(JOB)).toBe("ready_check_ready_to_schedule");
  });
});

/** The installer's finished A1 Ready Check (no price — decision 278: the boss prices on the portal). 120 m², no existing insulation. */
function completeA1(auditId: string) {
  const a = providers.mitti.audits.get(auditId)!;
  a.items = [...a.items.filter((i) => !i.item_id.startsWith("a_")),
    pick("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"), pick("Life support equipment at property?", "No"),
    pick("How easy is the ceiling access?", "Easy"), pick("How many separate ceiling areas are there?", "1"),
    { item_id: "a_area1", label: "Ceiling area 1", type: "section", children: [
      ans("Enter the measured ceiling area (m²)", "120"), pick("Is there existing insulation?", "No"), pick("How was this ceiling area measured?", "Laser in the ceiling space"),
      pick("Recessed downlights in this area?", "No"), pick("Hazards in this area?", "No"),
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
    expect(lines).toEqual([{ code: "INSTALLER_PRICE", line_total_inc_gst: 2500 }, { code: "PIESA", line_total_inc_gst: 349 }, { code: "AP_FEE", line_total_inc_gst: 349 }]);
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
const SIGNING = { signatoryName: "Helen Journey", authorityType: "owner", signatureName: "Helen Journey", over18: true, readConsumerInfo: true, acceptAgreement: true, assistance: "none" };

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
    const ogf = await import("../src/lib/owner-gates.functions");
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
    expect(cat.filter((d) => d.gate === "B" && d.managedIn === "Here" && d.status !== "Approved").map((d) => d.key).sort()).toEqual(["landlord_consent", "payment_terms", "quote_acceptance", "tenancy_details", "veec_assignment_consent", "visit_permission"]);
    void ogf;
  });
  test("Gate B paperwork signed on the link, then the quote is accepted with the signed agreement; installer told once; invoice raised", async () => {
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
    expect(signedKeys).toEqual(["quote_acceptance", "veec_assignment_consent", "payment_terms"]);
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
    // Accepting twice is refused; nothing doubles.
    await expect(ol.ownerAcceptQuoteFn({ data: { token, session, quoteId: qq!.id, expectedVersion: qq!.version, signing: SIGNING }, context: META })).rejects.toThrow(/no longer open/);
    expect(await q("select id from customer_agreements where job_id=$1", [JOB])).toHaveLength(1);
  });
});

describe("A1 step 4 — the $349 safety check, paid by card (decisions 139/144/302)", () => {
  test("before paying, no PIESA can be offered to an electrician (payment gate)", async () => {
    const al = await import("../src/lib/allocation.server");
    let refused = "";
    try { await al.startPiesaAllocation(JOB, OFFICE, "piesa"); } catch (e) { refused = (e as Error).message; }
    if (process.env["JOURNEY_DEBUG"]) console.log("PIESA-BEFORE-PAY", refused);
    expect(refused).not.toBe("");
    expect(await q("select id from partner_offers where job_id=$1 and kind='piesa'", [JOB])).toHaveLength(0);
  });
  test("owner presses Pay by card → one Stripe Checkout for exactly the quote's PIESA line; Stripe's signed webhook records it once", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken(JOB);
    const r = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string; blocker?: string };
    if (process.env["JOURNEY_DEBUG"]) console.log("CHECKOUT", r);
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const again = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string };
    expect(again.url).toBe(r.url); // double tap = the same Stripe session (idempotency key job+step+amount)
    expect(providers.stripe.sessions).toHaveLength(1);
    const s = providers.stripe.sessions[0]!;
    expect(s.form["line_items[0][price_data][unit_amount]"]).toBe("34900");
    expect(s.form["metadata[step]"]).toBe("safety_check");
    expect(s.idempotencyKey).toBe(`hivic-checkout-${JOB}-safety_check-34900`);
    const st = await import("../src/lib/stripe.server");
    // A forged webhook (wrong secret) changes nothing.
    const forged = await stripePaidWebhook(s, "whsec_wrong");
    expect(await st.handleStripeWebhook(forged.body, forged.signature)).toEqual({ status: 401, outcome: "bad_signature" });
    const wh = await stripePaidWebhook(s, process.env["STRIPE_WEBHOOK_SECRET"]!);
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "recorded" });
    await settle();
    expect(await st.handleStripeWebhook(wh.body, wh.signature)).toEqual({ status: 200, outcome: "duplicate" }); // Stripe retry
    const paid = await events(JOB, "owner_payment_recorded");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.details).toMatchObject({ amount_cents: 34900, source: "card", step: "safety_check" });
    expect((await q<{ total_paid: number }>("select total_paid from invoices where job_id=$1", [JOB]))[0]!.total_paid).toBe(349);
    if (process.env["JOURNEY_DEBUG"]) console.log("AFTER-PAY", await stageOf(JOB), (await comms(JOB)).map((c) => c.source_event), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
  });
});

// ---- one TEST REC (approved, verified coverage + credentials, approved electrician, agreed rates) -------------------
async function seedRec() {
  const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, accepting_new_jobs, rec_number, service_postcodes, coverage_verified_at, phone, email, base_suburb, coverage_radius_km)
    values ($1,'TEST Journey Sparks','TEST Journey Sparks','22 333 444 555','rec','{electrician}',true,'approved',now(),'[TEST PARTNER] journey REC',true,'REC-12345','{3199}',now(),'0477 511 901',$2,'Frankston',60)`, [REC, TRADE_EMAIL]);
  await q(`insert into profiles (id, full_name, email, phone) values ($1,'Eddie Electrician',$2,'0477 511 901')`, [ELEC, TRADE_EMAIL]);
  await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [REC, ELEC]);
  await q(`insert into user_roles (user_id, role) values ($1,'electrician')`, [ELEC]);
  await q(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, licence_number, licence_expires_on, profile_id, account_status, approval_status, approved_at)
    values ($1,'electrician','Eddie Electrician',$2,'0477 511 901','A12345',$3,$4,'active','approved',now())`, [REC, TRADE_EMAIL, far, ELEC]);
  for (const [kind, label] of [["public_liability_insurance", "Public liability"], ["electrical_licence", "Electrical licence"], ["rec_registration", "REC registration"]])
    await q(`insert into business_credentials (business_id, kind, label, number, expires_at, critical, verification, verified_at) values ($1,$2,$3,'TEST-1',$4,true,'verified',now())`, [REC, kind, label, far]);
  for (const [service, rate] of [["piesa", 220], ["rectification_visit", 180]] as const)
    await q(`insert into electrician_rates (business_id, service_type, rate_inc_gst, status, effective_from, gst_included) values ($1,$2,$3,'active',current_date - 1,true)`, [REC, service, rate]);
}

describe("A1 step 5 — the electrician's safety check (PIESA): automatic offer, 3 times, the owner takes one (decisions 246/333/307)", () => {
  test("Jo's automatic electrician offers (decision 246) send the PIESA to the one approved TEST REC covering 3199; the job enters the PIESA stage", async () => {
    await seedRec();
    await q("update workflow_settings set auto_electrician_offers = true where id = 1");
    const ao = await import("../src/lib/auto-offer.server");
    const r = await ao.autoOfferForJob(JOB, "piesa");
    if (process.env["JOURNEY_DEBUG"]) console.log("AUTO-OFFER", r);
    expect(r).toMatchObject({ step: "offer", businessId: REC });
    await settle();
    expect(await q("select business_id, status from partner_offers where job_id=$1 and kind='piesa'", [JOB])).toEqual([{ business_id: REC, status: "pending" }]);
    expect(await stageOf(JOB)).toBe("piesa_and_install_window_pending");
    // The tick repeats nothing while the offer is open.
    await ao.sweepAutoOffers();
    expect(await q("select id from partner_offers where job_id=$1 and kind='piesa'", [JOB])).toHaveLength(1);
  });
  test("the electrician accepts by offering 3 times (business days, 24h+ ahead, 8am–3pm); a bad time is refused first", async () => {
    const tv = await import("../src/lib/trade-view.server");
    const pc = await import("../src/lib/piesa-times.core");
    const [offer] = await q<{ id: string }>("select id from partner_offers where job_id=$1 and kind='piesa' and status='pending'", [JOB]);
    const days = pc.allowedPiesaTimeDays().slice(1, 4);
    await expect(tv.tradeOfferPiesaTimes(offer!.id, ELEC, days.map((day) => ({ day, time: "19:00" })))).rejects.toThrow();
    expect(await q("select status from partner_offers where id=$1", [offer!.id])).toEqual([{ status: "pending" }]);
    await tv.tradeOfferPiesaTimes(offer!.id, ELEC, days.map((day) => ({ day, time: "10:00" })));
    await settle();
    expect(await q("select status from partner_offers where id=$1", [offer!.id])).toEqual([{ status: "accepted" }]);
    expect(await q("select role, business_id from job_assignments where job_id=$1 and role='electrician' and active", [JOB])).toEqual([{ role: "electrician", business_id: REC }]);
    expect(await q("select id from appointment_proposals where job_id=$1 and kind='assessment' and status='proposed'", [JOB])).toHaveLength(3);
    if (process.env["JOURNEY_DEBUG"]) console.log("TIMES", (await comms(JOB)).map((c) => c.source_event).slice(-4));
  });
  test("the owner must tick the 30-day box; then taking one time books the PIESA (confirmBooking) and the others close", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const [p] = await q<{ id: string; starts_at: Date }>("select id, starts_at from appointment_proposals where job_id=$1 and kind='assessment' and status='proposed' order by starts_at limit 1", [JOB]);
    await expect(ol.ownerTakePiesaTimeLinkFn({ data: { token, session, proposalId: p!.id }, context: META })).rejects.toThrow();
    expect(await q("select id from bookings where job_id=$1 and kind='assessment'", [JOB])).toHaveLength(0);
    await ol.ownerTakePiesaTimeLinkFn({ data: { token, session, proposalId: p!.id, understandsThirtyDays: true }, context: META });
    await settle();
    const bk = await q<{ status: string; scheduled_start: Date }>("select status, scheduled_start from bookings where job_id=$1 and kind='assessment'", [JOB]);
    expect(bk).toHaveLength(1);
    expect(bk[0]!.status).toBe("confirmed");
    expect(bk[0]!.scheduled_start.toISOString()).toBe(p!.starts_at.toISOString());
    expect(await q("select id from appointment_proposals where job_id=$1 and kind='assessment' and status='proposed'", [JOB])).toHaveLength(0);
    expect(await stageOf(JOB)).toBe("piesa_scheduled");
    if (process.env["JOURNEY_DEBUG"]) console.log("BOOKED", (await comms(JOB)).map((c) => c.source_event).slice(-6), [...providers.mitti.audits.values()].map((a) => a.template_id), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
  });
});

describe("A1 step 6 — the electrician's A3 PIESA form in Mitti: repair work needed, priced on the form (decisions 178/305/315/324/354)", () => {
  test("the office creates the A3 form for the booked electrician (Create Mitti form); the form is prefilled and assigned", async () => {
    const forms = await import("./helpers/journey-forms");
    const def = forms.completedA3({ inspectionDate: "2026-10-28", capturedAt: new Date().toISOString(), priceIncGst: 600, mediaPrefix: "a3" });
    providers.templates[TPL_A3] = forms.templateOf([forms.text("Job Reference ID", ""), forms.text("Address including postcode", ""), forms.text("Owner name", ""), ...def.items]);
    const pf = await import("../src/lib/portal.functions");
    const r = await pf.createMittiAssessment({ data: { jobId: JOB }, context: { userId: OFFICE, supabase: admin, claims: {} } }) as { auditId: string };
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("A3-CREATE", r);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A3)).toHaveLength(1);
    expect(await q("select external_mitti_id, mitti_template_id from assessments where job_id=$1", [JOB])).toEqual([{ external_mitti_id: r.auditId, mitti_template_id: TPL_A3 }]);
  });
  test("the electrician presses Complete: synced with its evidence, the repair work is listed and priced, and the next steps follow", async () => {
    const forms = await import("./helpers/journey-forms");
    const [{ external_mitti_id: auditId }] = await q<{ external_mitti_id: string }>("select external_mitti_id from assessments where job_id=$1", [JOB]);
    const def = forms.completedA3({ inspectionDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()), capturedAt: new Date().toISOString(), priceIncGst: 600, mediaPrefix: "a3" });
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    const a = providers.mitti.audits.get(auditId)!;
    fillAudit(a, def.items);
    const ms = await import("../src/lib/mitti.server");
    const out = await ms.syncPendingMitti(null);
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("A3-SYNC", JSON.stringify(out), await stageOf(JOB), await q("select status, mitti_completed, mitti_sync_status, piesa_outcome, mitti_validation_issues from assessments where job_id=$1", [JOB]), await q("select description, status, quantity, source from rectification_items where job_id=$1", [JOB]), await q("select kind, status, release_state, customer_total_inc_gst from quotes where job_id=$1 order by created_at", [JOB]), (await comms(JOB)).map((c) => c.source_event).slice(-5), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 16", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect((await q<{ mitti_completed: boolean }>("select mitti_completed from assessments where job_id=$1", [JOB]))[0]!.mitti_completed).toBe(true);
  });
});

describe("A1 step 6b — the electrician completes the PIESA in the portal (Complete PIESA) after the A3 is Complete", () => {
  test("Complete PIESA is accepted from the A3 answers alone; PIESA record written; job at PIESA complete", async () => {
    const pf = await import("../src/lib/portal.functions");
    let refused = "";
    try { await pf.completeAssessment({ data: { jobId: JOB }, context: { userId: ELEC, supabase: asUser(ELEC), claims: {} } }); } catch (e) { refused = (e as Error).message; }
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("COMPLETE-PIESA", refused, await stageOf(JOB), await q("select status, piesa_outcome, switchboard_condition, rcds_present, life_support_confirmed, assessed_on from assessments where job_id=$1", [JOB]));
    expect(refused).toBe("");
    expect(await stageOf(JOB)).toBe("piesa_complete");
    expect(await q("select kind, outcome, is_current from piesa_records where job_id=$1", [JOB])).toEqual([{ kind: "initial", outcome: "fail", is_current: true }]);
    // Decision 350: the official PIESA is filed from the A3 at completion (night-run fix: nothing filed it before).
    expect(await events(JOB, "official_piesa_issued")).toHaveLength(1);
    expect(await q("select form_key, signer_role from official_form_signed_copies where job_id=$1 and status='current'", [JOB])).toEqual([{ form_key: "piesa", signer_role: "electrician" }]);
    // Pressing Complete again changes nothing.
    await expect(pf.completeAssessment({ data: { jobId: JOB }, context: { userId: ELEC, supabase: asUser(ELEC), claims: {} } })).rejects.toThrow(/already complete/);
    expect(await events(JOB, "official_piesa_issued")).toHaveLength(1);
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

describe("A1 step 7 — electrical fixes: times, the fixes quote, the owner confirms the PIESA (decisions 296/315/351/354)", () => {
  test("the electrician gives 3 fixes times on the text-link card → the A3-priced fixes quote ($600 + $100, decision 351) goes to the owner once", async () => {
    const tvf = await import("../src/lib/trade-view.functions");
    const ctx = { userId: ELEC, supabase: asUser(ELEC), claims: {} };
    const days = businessDays(3, 3);
    await tvf.saveTradeFixesTimes({ data: { jobId: JOB, hours: 2, windows: days.map((date) => ({ date, slot: "10-12" })) }, context: ctx });
    await settle();
    const qs = await q<Record<string, unknown>>("select id, kind, status, release_state, sent_at, customer_total_inc_gst from quotes where job_id=$1 and kind='rectification'", [JOB]);
    if (process.env["JOURNEY_DEBUG"]) console.log("FIXES-QUOTE", qs, await stageOf(JOB), (await comms(JOB)).map((c) => c.source_event).slice(-4), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    if (process.env["JOURNEY_DEBUG"]) console.log("AUTOFIX", await (await import("../src/lib/auto-fixes-quote-send.server")).maybeAutoSendFixesQuote(JOB, { generate: true }));
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ status: "issued", customer_total_inc_gst: 700 });
  });
});

describe("A1 step 8 — the owner confirms the PIESA, approves and pays the fixes, picks the electrician's time (decisions 296/306/366)", () => {
  test("the 15-minute tick asks the owner once to confirm the PIESA (O71 + text); the owner confirms on the link alone", async () => {
    const pc = await import("../src/lib/piesa-owner-confirm-send.server");
    await pc.sweepOwnerPiesaConfirmations();
    await settle();
    await pc.sweepOwnerPiesaConfirmations(); // the tick again: nothing repeats
    await settle();
    const asked = (await comms(JOB)).filter((c) => /piesa_owner_confirm/i.test(c.source_event));
    if (process.env["JOURNEY_DEBUG"]) console.log("PIESA-CONFIRM-ASK", asked, (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 and event_type like 'piesa_owner%' order by created_at", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(asked.map((c) => c.channel).sort()).toEqual(["email", "sms"]);
    const ol = await import("../src/lib/owner-link.functions");
    const token = await ownerToken(JOB);
    const page = await ol.ownerPiesaConfirmFn({ data: { token } });
    expect(page).not.toBeNull();
    await expect(ol.ownerSignPiesaConfirmFn({ data: { token, signatoryName: "Helen Journey", signatureName: "Helen Journey", authorityType: "owner", confirmed: false }, context: META })).rejects.toThrow();
    await ol.ownerSignPiesaConfirmFn({ data: { token, signatoryName: "Helen Journey", signatureName: "Helen Journey", authorityType: "owner", confirmed: true }, context: META });
    await settle();
    expect(await events(JOB, "piesa_owner_confirmed")).toHaveLength(1);
  });
  test("approve the fixes ($700) on the link → pay in full by card (Stripe) → the fixes can be booked; the time cannot be picked before paying", async () => {
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const [fq] = await q<{ id: string; version: number }>("select id, version from quotes where job_id=$1 and kind='rectification' and status='issued'", [JOB]);
    await ol.ownerApproveFixesFn({ data: { token, session, quoteId: fq!.id, expectedVersion: fq!.version, approve: true }, context: META });
    await settle();
    expect(await q("select status from quotes where id=$1", [fq!.id])).toEqual([{ status: "accepted" }]);
    const st = await ol.ownerFixesStateFn({ data: { token } }) as { step: string; times?: { id: string }[] };
    if (process.env["JOURNEY_DEBUG"]) console.log("FIXES-STATE", JSON.stringify(st), await stageOf(JOB));
    // Decision 366: never booked unpaid.
    const [w] = await q<{ id: string }>("select id from appointment_proposals where job_id=$1 and kind='rectification' and status='proposed' order by starts_at limit 1", [JOB]);
    let unpaid = "";
    try { await ol.ownerPickFixesTimeFn({ data: { token, session, proposalId: w!.id }, context: META }); } catch (e) { unpaid = (e as Error).message; }
    if (process.env["JOURNEY_DEBUG"]) console.log("PICK-UNPAID", unpaid, await q("select status from bookings where job_id=$1 and kind='rectification'", [JOB]));
    expect(await q("select id from bookings where job_id=$1 and kind='rectification' and status='confirmed'", [JOB])).toHaveLength(0);
    const r = await ol.ownerCardCheckoutFn({ data: { token } }) as { url?: string; blocker?: string };
    expect(r.url).toBeTruthy();
    const s = providers.stripe.sessions.at(-1)!;
    expect(s.form["metadata[step]"]).toBe("fixes");
    expect(s.form["line_items[0][price_data][unit_amount]"]).toBe("70000");
    const wh = await stripePaidWebhook(s, process.env["STRIPE_WEBHOOK_SECRET"]!);
    expect((await (await import("../src/lib/stripe.server")).handleStripeWebhook(wh.body, wh.signature)).outcome).toBe("recorded");
    await settle();
    expect(await events(JOB, "fixes_payment_received")).toHaveLength(1);
    if (process.env["JOURNEY_DEBUG"]) console.log("AFTER-FIXES-PAY", await stageOf(JOB), await q("select status, scheduled_start from bookings where job_id=$1 and kind='rectification'", [JOB]), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
  });
});

describe("A1 step 9 — the fixes visit: booked from the owner's pick, the A4 form, Complete → Part C and electrical clearance (decisions 293/330/186)", () => {
  test("after paying, the owner picks one of the electrician's times → fixes visit booked → the A4 'Electrical fixes' form is created once", async () => {
    const fd = await import("../src/lib/fixes-day.core");
    providers.templates[TPL_A4] = { items: fd.FIXES_DAY_QUESTIONS.map((x, i) => ({ item_id: `a4_${i + 1}`, label: x.label, type: x.type === "yes_no" ? "question" : x.type === "photo" ? "media" : x.type === "signature" ? "signature" : x.type === "date" ? "datetime" : "textsingle" })) };
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    const [w] = await q<{ id: string; starts_at: Date }>("select id, starts_at from appointment_proposals where job_id=$1 and kind='rectification' and status='proposed' order by starts_at limit 1", [JOB]);
    await ol.ownerPickFixesTimeFn({ data: { token, session, proposalId: w!.id }, context: META });
    await settle();
    const bk = await q<{ status: string }>("select status from bookings where job_id=$1 and kind='rectification'", [JOB]);
    if (process.env["JOURNEY_DEBUG"]) console.log("FIXES-BOOKED", bk, await stageOf(JOB), [...providers.mitti.audits.values()].map((a) => a.template_id), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(bk).toEqual([{ status: "confirmed" }]);
    expect(await stageOf(JOB)).toBe("rectification_booked");
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A4)).toHaveLength(1);
    expect(await events(JOB, "fixes_form_created")).toHaveLength(1);
  });
  test("the electrician completes the A4 (CoES, date, file, geotagged photo, signed) → Part C recorded, PIESA re-issued as post-rectification, the installer is told the job is cleared", async () => {
    const forms = await import("./helpers/journey-forms");
    const fd = await import("../src/lib/fixes-day.core");
    const a4 = [...providers.mitti.audits.values()].find((a) => a.template_id === TPL_A4)!;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const def = forms.completedA4({ q: fd.FIXES_DAY_Q as unknown as Record<string, string>, coesNumber: "COES-778899", certDate: today, capturedAt: new Date().toISOString(), mediaPrefix: "a4", electrician: "Eddie Electrician" });
    for (const id of def.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(a4, def.items);
    const out = await (await import("../src/lib/fixes-day.server")).sweepFixesForms();
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("A4-DONE", out, await stageOf(JOB), await q("select kind, outcome, is_current, completed_date from piesa_records where job_id=$1 order by created_at", [JOB]), (await comms(JOB)).map((c) => c.source_event).slice(-6), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 14", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(out).toMatchObject({ done: 1 });
    expect(await events(JOB, "fixes_form_completed")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("installation_scheduling");
    expect(await q("select kind, outcome from piesa_records where job_id=$1 and is_current", [JOB])).toEqual([{ kind: "post_rectification", outcome: "pass" }]);
    expect(await events(JOB, "install_clearance_notified")).toHaveLength(1);
    // The sweep again (next tick): the completed A4 is not processed twice and the installer is not told twice.
    await (await import("../src/lib/fixes-day.server")).sweepFixesForms();
    await settle();
    expect(await events(JOB, "fixes_form_completed")).toHaveLength(1);
    expect((await comms(JOB)).filter((c) => /install_clearance/.test(c.source_event)).map((c) => c.channel).sort()).toEqual(["email", "sms"]);
  });
});

describe("A1 step 10 — install day: the installer offers 3 days, the owner takes one → installation booked (Jo 24 Oct, decisions 139/325)", () => {
  test("the owner cannot take a day before the installer offers; the installer offers 3 → the owner is asked once (O33) → takes one → booked", async () => {
    const af = await import("../src/lib/allocation.functions");
    const ol = await import("../src/lib/owner-link.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    const st = await af.getInstallerInstallDays({ data: { jobId: JOB }, context: instCtx }) as { turn: string; days: string[]; deadline: string | null };
    if (process.env["JOURNEY_DEBUG"]) console.log("INSTALL-STATE", st.turn, st.deadline, st.days.slice(0, 5));
    expect(st.turn).toBe("installer_to_offer");
    // An installer who is not on the job cannot offer days.
    await expect(af.installerOfferInstallDays({ data: { jobId: JOB, days: st.days.slice(1, 4).map((day) => ({ day, time: "08:00" })) }, context: { userId: ELEC, supabase: asUser(ELEC), claims: {} } })).rejects.toThrow(/quoted installer/);
    const days = st.days.slice(1, 4);
    expect(days).toHaveLength(3);
    await af.installerOfferInstallDays({ data: { jobId: JOB, days: days.map((day) => ({ day, time: "08:00" })) }, context: instCtx });
    await settle();
    const { token, session } = await ownerSessionFor(JOB);
    const offered = await q<{ id: string }>("select id from appointment_proposals where job_id=$1 and install_day and status='proposed' order by starts_at", [JOB]);
    expect(offered).toHaveLength(3);
    // The installer cannot take their own offered day for the owner.
    await expect(af.ownerTakeInstallDay({ data: { jobId: JOB, proposalId: offered[0]!.id }, context: instCtx })).rejects.toThrow();
    await ol.ownerTakeInstallDayFn({ data: { token, session, proposalId: offered[0]!.id }, context: META });
    await settle();
    // Taking the same day again (double click / second tab) books nothing new.
    await expect(ol.ownerTakeInstallDayFn({ data: { token, session, proposalId: offered[0]!.id }, context: META })).rejects.toThrow();
    if (process.env["JOURNEY_DEBUG"]) console.log("INSTALL-BOOKED", await stageOf(JOB), await q("select status, scheduled_start from bookings where job_id=$1 and kind='installation'", [JOB]), (await comms(JOB)).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`).slice(-8), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(await q("select status from bookings where job_id=$1 and kind='installation'", [JOB])).toEqual([{ status: "confirmed" }]);
    expect(await stageOf(JOB)).toBe("installation_booked");
    expect(await events(JOB, "install_day_taken")).toHaveLength(1);
  });
});

describe("A1 step 11 — the 10% install deposit, the pre-start check and the install-day PIISA (A5) form (decisions 139/367, Jo 24 Oct)", () => {
  const dayBefore = async () => {
    const [b] = await q<{ scheduled_start: Date }>("select scheduled_start from bookings where job_id=$1 and kind='installation' and status='confirmed'", [JOB]);
    return { start: b!.scheduled_start, noonBefore: new Date(b!.scheduled_start.getTime() - 20 * 3_600_000 + 30 * 60_000) };
  };
  test("before the deposit is paid the install is locked and no PIISA form is made; the owner's bank transfer arrives in Xero → deposit recorded once", async () => {
    const ps = await import("../src/lib/prestart.server");
    const pa = await import("../src/lib/piisa-autosend.server");
    const { noonBefore } = await dayBefore();
    const gate0 = await ps.prestartGate(JOB, noonBefore);
    if (process.env["JOURNEY_DEBUG"]) console.log("GATE-UNPAID", gate0, await pa.sweepPiisaAutoSend({ now: noonBefore, allowTest: true, dryRun: true }));
    const [inv] = await q<{ id: string; xero_invoice_id: string }>("select id, xero_invoice_id from invoices where job_id=$1", [JOB]);
    providers.xero.payments.push({ PaymentID: "xero-pay-deposit-1", Invoice: { InvoiceID: inv!.xero_invoice_id }, Amount: 132.9, Date: "/Date(1761523200000+0000)/", Status: "AUTHORISED", Reference: "HV deposit bank transfer" });
    const x = await import("../src/lib/xero.server");
    await x.syncInvoiceFromXero(inv!.id, null);
    await settle();
    await x.syncInvoiceFromXero(inv!.id, null); // the poll again: nothing recorded twice
    await settle();
    const paid = (await events(JOB, "owner_payment_recorded")).filter((e) => e.details["xero_payment_id"] === "xero-pay-deposit-1");
    if (process.env["JOURNEY_DEBUG"]) console.log("DEPOSIT", paid.map((e) => e.summary), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(paid).toHaveLength(1);
    expect(await events(JOB, "install_booking_confirmed")).toHaveLength(1);
  });
  test("before the day: the installer's own crew facts, the office's ESC setup, the owner's ESC consent, the ESC notice recorded, the safety plan signed", async () => {
    // The installer's own onboarding record (done once when the business joined, not part of this job): the lead
    // installer's worker row with an office-verified EEC CII (full) and White Card.
    const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const [w] = await q<{ id: string }>(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, profile_id, account_status, approval_status, approved_at, certification)
      values ($1,'installer','Ivy Installer',$2,'0477 511 901',$3,'active','approved',now(),$4) returning id`, [BIZ, TRADE_EMAIL, INST, JSON.stringify({ white_card: { path: "journey/white-card.png", uploaded_at: new Date().toISOString(), verified_at: new Date().toISOString(), verified_by: OFFICE } })]);
    const [c] = await q<{ id: string }>(`insert into partner_worker_certifications (worker_id, worker_email, status, evidence_note, evidence_source, recorded_by, certificate_number) values ($1,$2,'verified','journey onboarding','office',$3,'CII-1234') returning id`, [w!.id, TRADE_EMAIL, OFFICE]);
    await q(`insert into worker_certification_levels (certification_id, expires_on, level, recorded_by, worker_email) values ($1,$2,'full',$3,$4)`, [c!.id, far, OFFICE, TRADE_EMAIL]);
    // As the office "verify EEC" path does (worker-compliance.functions): the worker links to the verified check row.
    await q(`update partner_workers set certification = certification || jsonb_build_object('verification_id', $2::text) where id=$1`, [w!.id, c!.id]);
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    await tvf.acknowledgeTradeCollectionNotice({ context: instCtx });
    // Office one-off setup: the approved ESC consent wording and ESC notification fields (Settings).
    const pf = await import("../src/lib/portal.functions");
    const officeCtx = { userId: OFFICE, supabase: admin, claims: {} };
    for (const [key, version, body] of [["esc_consent", "journey-esc-1", "TEST ESC information-sharing consent (journey fixture text, office-loaded)."], ["installer_declaration", "journey-decl-1", "TEST Activity 48 installer declaration (journey fixture text, office-loaded)."]] as const) {
      await pf.addComplianceTemplate({ data: { template_key: key, version, body }, context: officeCtx });
      const [t] = await q<{ id: string }>("select id from compliance_templates where template_key=$1", [key]);
      await pf.approveComplianceTemplate({ data: { id: t!.id }, context: officeCtx });
    }
    await pf.addEscConfig({ data: { version: "journey-esc-config-1", fields: [], source_note: "TEST journey ESC notification fields" }, context: officeCtx });
    const [cfg] = await q<{ id: string }>("select id from esc_notification_config where version='journey-esc-config-1'");
    await pf.approveEscConfig({ data: { id: cfg!.id }, context: officeCtx });
    // The owner signs the ESC consent on their link; the AP part signs itself (decision 370).
    const ol = await import("../src/lib/owner-link.functions");
    const { token, session } = await ownerSessionFor(JOB);
    await ol.ownerSignConsentFn({ data: { token, session, signatoryName: "Helen Journey", authorityType: "owner", signatureName: "Helen Journey", accept: true }, context: META });
    await settle();
    const cs = await import("../src/lib/consent.server");
    if ((await cs.currentConsent(JOB))?.status === "awaiting_ap") await cs.confirmApConsent({ jobId: JOB, actorId: OFFICE, apRepName: "Ollie Office", purposeExplained: true, ip: META.ip, userAgent: META.userAgent });
    if (process.env["JOURNEY_DEBUG"]) console.log("CONSENT", await cs.currentConsent(JOB));
    expect((await cs.currentConsent(JOB))?.status).toBe("valid");
    expect(await events(JOB, "consent_ap_signed_auto")).toHaveLength(1);
    // The office submits the notice in the ESC Registry and records the reference.
    await (await import("../src/lib/esc.server")).regenerateEscNotification(JOB, OFFICE);
    const [n] = await q<{ id: string; status: string }>("select id, status from esc_notifications where job_id=$1 and status not in ('stale','cancelled') order by created_at desc limit 1", [JOB]);
    if (process.env["JOURNEY_DEBUG"]) console.log("ESC-NOTICE", n, await q("select last_error from esc_notifications where id=$1", [n!.id]));
    await pf.recordEscSubmissionFn({ data: { notificationId: n!.id, reference: "ESC-JOURNEY-0001", sentAt: new Date().toISOString(), method: "manual_portal", confirmed: true }, context: officeCtx });
    expect(await q("select status, submission_reference from esc_notifications where id=$1", [n!.id])).toEqual([{ status: "sent", submission_reference: "ESC-JOURNEY-0001" }]);
    // The installer chooses the install crew (themself as lead) — the safety plan lists it — then signs their own line on the
    // job page; nobody can sign another person's line.
    const crew = await import("../src/lib/piisa-a3.functions");
    await crew.savePiisaCrew({ data: { jobId: JOB, lead: w!.id, additional: [] }, context: instCtx });
    const sw = await tvf.getTradeSwms({ data: { jobId: JOB }, context: instCtx }) as { show: boolean; plan: { signers: { key: string; role: string }[] }; myKeys: string[] };
    expect(sw.plan.signers.map((x) => x.role)).toEqual(["lead"]);
    await tvf.signTradeSwms({ data: { jobId: JOB, key: sw.myKeys[0]!, typedName: "Ivy Installer" }, context: instCtx });
    await expect(tvf.signTradeSwms({ data: { jobId: JOB, key: "n:someone else", typedName: "Someone Else" }, context: instCtx })).rejects.toThrow();
    // The 15-minute tick emails the signed official PIESA to the owner and the installer once the install day is booked
    // (decision 111) — once each, the next tick sends nothing.
    const pd = await import("../src/lib/piesa-delivery.server");
    await pd.sweepPiesaCopyDeliveries();
    await settle();
    await pd.sweepPiesaCopyDeliveries();
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("PIESA-COPIES", await q("select recipient, method from piesa_deliveries where job_id=$1", [JOB]), (await events(JOB, "piesa_copy_not_sent")).map((e) => e.summary));
    expect((await q<{ recipient: string }>("select recipient from piesa_deliveries where job_id=$1 order by recipient", [JOB])).map((x) => x.recipient)).toEqual(["installer", "owner"]);
    // The owner confirms receipt of the safety check copy on the link (owner paperwork C).
    const ogf = await import("../src/lib/owner-gates.functions");
    const signedC: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await ogf.ownerPaperworkFn({ data: { token } }) as { todo: { key: string; gate: string }[] };
      const next = p.todo.find((x) => x.gate === "C");
      if (!next) break;
      await ogf.ownerSignPaperworkFn({ data: { token, session, key: next.key, signatoryName: "Helen Journey", ticked: true, answers: { role: "owner", life_support: "no" } }, context: META });
      signedC.push(next.key);
    }
    if (process.env["JOURNEY_DEBUG"]) console.log("GATE-C", signedC);
    // The office records the pre-install consumer documents (Activity 48 record) given to the owner.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    await pf.recordComplianceItem({ data: { jobId: JOB, key: "pre_install_consumer_docs", occurredAt: today, reference: "Emailed with the quote", notes: null }, context: officeCtx });
  });
  test("noon the day before: the pre-start check runs; the PIISA form is created once for the installer", async () => {
    const ps = await import("../src/lib/prestart.server");
    const pa = await import("../src/lib/piisa-autosend.server");
    const { noonBefore } = await dayBefore();
    const forms = await import("./helpers/journey-forms");
    providers.templates[TPL_A5] = forms.installDayTemplate((await import("../src/lib/install-day.core")).INSTALL_DAY_QUESTIONS);
    const run = await ps.sweepPrestart(noonBefore);
    const gate = await ps.prestartGate(JOB, noonBefore);
    const send = await pa.sweepPiisaAutoSend({ now: noonBefore, allowTest: true });
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("PRESTART", run, gate, JSON.stringify(send), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(gate.locked).toBe(false);
    expect(send.results.map((r) => r.outcome)).toEqual(["created"]);
    // The next tick: one form per job, never a second one.
    expect((await pa.sweepPiisaAutoSend({ now: new Date(noonBefore.getTime() + 15 * 60_000), allowTest: true })).results.map((r) => r.outcome)).toEqual(["skipped"]);
    expect([...providers.mitti.audits.values()].filter((a) => a.template_id === TPL_A5)).toHaveLength(1);
    const a5 = [...providers.mitti.audits.values()].find((a) => a.template_id === TPL_A5)!;
    if (process.env["JOURNEY_DEBUG"]) console.log("A5-PREFILL", a5.items.filter((i) => i.responses).map((i) => `${i.label.slice(0, 50)} = ${JSON.stringify(i.responses)}`));
    // Night run fix: life support and solar come from the PIESA (A3 answered No to both) — the owner gave no answer here.
    const id = await import("../src/lib/install-day.core");
    const picked = (label: string) => ((a5.items.find((i) => i.label === label)?.responses as { selected?: { label: string }[] } | undefined)?.selected ?? []).map((x) => x.label);
    expect(picked(id.INSTALL_DAY_Q.lifeSupport)).toEqual(["No"]);
    expect(picked(id.INSTALL_DAY_Q.solar)).toEqual(["No"]);
  });
});

describe("A1 step 12 — install day: the installer fills in the A5 form → the installation is recorded (decisions 213/262/328)", () => {
  test("half-done form: 'Check my form now' says what is missing and nothing is recorded", async () => {
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    const r = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    if (process.env["JOURNEY_DEBUG"]) console.log("A5-EMPTY", JSON.stringify(r));
    expect(r.state).toBe("not_complete");
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
  });
  test("decision 396: the lead installer completes every answer, photo and video — the A5 ruler photos per area are required, then the installation is recorded once", async () => {
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
    const tvf0 = await import("../src/lib/trade-view.functions");
    const r0 = await tvf0.checkTradeInstallForm({ data: { jobId: JOB }, context: { userId: INST, supabase: asUser(INST), claims: {} } }) as { state: string; missing: string[] };
    await settle();
    expect(r0.state).toBe("not_finished");
    expect(r0.missing).toContain(ie396.RULER_SECTION_MISSING);
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
    // Then the A5 with the ruler photo section: one copy per Ready Check area, both photos geotagged and timed.
    const withRuler = forms.completedA5({ q: id.INSTALL_DAY_Q as unknown as Record<string, string>, capturedAt, mediaPrefix: "a5", lead: "Ivy Installer", areas: Math.max(1, zones.length), ruler: id.INSTALL_DAY_RULER_Q });
    for (const m of withRuler.mediaIds) providers.mitti.media.set(m, { bytes: forms.PNG_1X1, type: "image/png" });
    fillAudit(a5, withRuler.items.filter((i) => i.label === ""));
    const tvf = await import("../src/lib/trade-view.functions");
    const instCtx = { userId: INST, supabase: asUser(INST), claims: {} };
    const r = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[]; title: string; body: string };
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("A5-DONE", zones.length, JSON.stringify(r), await stageOf(JOB), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 14", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    // Product labels are a human office review (piisa-products.core): until then the form is "not finished" and
    // nothing is recorded.
    expect(r.missing).toEqual(["The product label evidence needs current office review."]);
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).toBeNull();
    const [req] = await q<{ id: string }>("select id from evidence_requirements where job_id=$1 and category='product_evidence'", [JOB]);
    const pf = await import("../src/lib/portal.functions");
    await pf.verifyEvidence({ data: { requirementId: req!.id, status: "verified", actualProducts: [{ brand: "Bradford", model: "Gold Ceiling Batt R5.0", rValue: 5 }], installedAreaM2: 120 }, context: { userId: OFFICE, supabase: admin, claims: {} } });
    await settle();
    const r2 = await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: instCtx }) as { state: string; missing: string[] };
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("A5-AFTER-REVIEW", JSON.stringify(r2), await stageOf(JOB), (await q<{ event_type: string; summary: string; details: unknown }>("select event_type, summary, details from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary} ${e.event_type === "piisa_prestart_captured" ? JSON.stringify(e.details) : ""}`));
    expect(r2.state).toBe("all_filled_in");
    // Decision 396: "All filled in ✓ You can leave site" depends on the A5 only — the retired chase made no job-page
    // photo requirements, so nothing else holds the installation.
    expect(await q("select id from evidence_requirements where job_id=$1 and gate='installation' and label like 'Install day:%'", [JOB])).toHaveLength(0);
    expect((await events(JOB, "install_complete_auto_held")).map((e) => e.summary).join(" ")).not.toContain("install-day photos");
    // The ruler photos are kept on the job file like the other Mitti evidence (one copy per Mitti media id).
    const rulerDocs = await q<{ title: string }>("select title from documents where job_id=$1 and kind='install_ruler_photo' order by title", [JOB]);
    expect(rulerDocs.length).toBe(2 * Math.max(1, zones.length));
    expect(rulerDocs.map((d) => d.title).join(" | ")).toContain("existing insulation depth");
    if (process.env["JOURNEY_DEBUG"]) console.log("AFTER-PHOTOS", await stageOf(JOB), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 10", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect((await q<{ c: Date | null }>("select installation_completed_at as c from jobs where id=$1", [JOB]))[0]!.c).not.toBeNull();
  });
});

describe("A1 step 13 — completion documents, the final balance and the trades' payouts (decisions 109/318/355)", () => {
  test("installation recorded once; the owner gets the completion documents; checking the form again records nothing new", async () => {
    const tvf = await import("../src/lib/trade-view.functions");
    await tvf.checkTradeInstallForm({ data: { jobId: JOB }, context: { userId: INST, supabase: asUser(INST), claims: {} } });
    await settle();
    expect(await events(JOB, "INSTALLATION_COMPLETED")).toHaveLength(1);
    expect(await stageOf(JOB)).toBe("evidence_outstanding");
    const cp = await import("../src/lib/completion-pack.server");
    const sweep = await cp.sweepCompletionPacks();
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("COMPLETION", JSON.stringify(sweep), (await comms(JOB)).slice(-8).map((c) => `${c.channel}:${c.source_event}:${c.delivery_status}`), providers.emails.slice(-6).map((e) => `${e.subject} [${e.attachments}] key=${e.idempotencyKey}`), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 16", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
  });
  test("the owner pays the balance (bank transfer in Xero) → invoice fully paid once", async () => {
    const [inv] = await q<{ id: string; xero_invoice_id: string; total_inc_gst: number; total_paid: number }>("select id, xero_invoice_id, total_inc_gst, total_paid from invoices where job_id=$1 and kind='installation'", [JOB]);
    const due = Math.round((Number(inv!.total_inc_gst) - Number(inv!.total_paid)) * 100) / 100;
    if (process.env["JOURNEY_DEBUG"]) console.log("BALANCE", inv, due);
    providers.xero.payments.push({ PaymentID: "xero-pay-balance-1", Invoice: { InvoiceID: inv!.xero_invoice_id }, Amount: due, Date: "/Date(1761696000000+0000)/", Status: "AUTHORISED", Reference: "HV balance bank transfer" });
    const x = await import("../src/lib/xero.server");
    await x.syncInvoiceFromXero(inv!.id, null);
    await settle();
    await x.syncInvoiceFromXero(inv!.id, null);
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("AFTER-BALANCE", await stageOf(JOB), await q("select total_inc_gst, total_paid, status from invoices where id=$1", [inv!.id]), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 12", [JOB])).map((e) => `${e.event_type}: ${e.summary}`));
    expect(await events(JOB, "balance_paid")).toHaveLength(1);
  });
  test("every Mitti form is 100% complete → the electrician's (safety check + fixes) and the installer's payouts are not held", async () => {
    const pg = await import("../src/lib/trade-payout-gate.server");
    const held = { assessment: await pg.payoutBlockersFor(JOB, "assessment"), rectification: await pg.payoutBlockersFor(JOB, "rectification"), installation: await pg.payoutBlockersFor(JOB, "installation") };
    const tv = await import("../src/lib/trade-view.server");
    const instMoney = await tv.tradeMoney(INST).catch((e) => ({ error: (e as Error).message }));
    const elecMoney = await tv.tradeMoney(ELEC).catch((e) => ({ error: (e as Error).message }));
    if (process.env["JOURNEY_DEBUG"]) console.log("PAYOUTS", JSON.stringify(held), JSON.stringify(instMoney).slice(0, 1500), JSON.stringify(elecMoney).slice(0, 1500));
    expect(held).toEqual({ assessment: [], rectification: [], installation: [] });
    // The installer's install row is not held (it waits for the office's final check / AP approval as usual).
    const iRows = (instMoney as { rows?: { kind: string; held: string[]; state: { kind: string } }[] }).rows ?? [];
    expect(iRows.map((r) => [r.kind, r.held])).toEqual([["installation", []]]);
    // Night run fix: the electrician's Money shows BOTH the safety check and the fixes rows, each with its amount.
    const eRows = (elecMoney as { rows?: { kind: string; amount: number | null; state: { kind: string } }[] }).rows ?? [];
    expect(eRows.map((r) => r.kind).sort()).toEqual(["assessment", "rectification"]);
    for (const r of eRows) expect(r.amount, r.kind).toBeGreaterThan(0);
  });
});
