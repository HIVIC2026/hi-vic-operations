// Mitti instant notice (27 Oct 2026), final review item 6: the notice and the 15-minute pull can run
// syncMittiAssessment for the same job at the same moment. When the electrician's A3 PIESA form is Complete and says
// repair work is needed (priced on the form), the A3 branch prepares the fixes quote and sends it automatically
// (decision 354, AUTO_FIXES_QUOTE_SEND_ENABLED on as shipped). Two overlapping syncs must leave exactly ONE live
// (non-superseded) fixes quote and reach the owner exactly ONCE (O29 email; a text too if one is ever sent).
// Harness: the full-schema PGlite journey harness (tests/helpers/journey-harness.ts) — every real server module, only
// Mitti / Resend / Twilio behind `fetch` are faked. Sibling of tests/mitti-sync-overlap.test.ts (the A1 Ready Check case).
// Run alone: bun test tests/mitti-sync-overlap-fixes.test.ts
import { afterAll, describe, expect, mock, test } from "bun:test";
import { fakeProviders, fillAudit, journeyAdmin, journeyDb, serverFnStandIn } from "./helpers/journey-harness";

const BIZ = "30000000-0000-4000-8000-0000000000b6", INST = "40000000-0000-4000-8000-0000000000b6";
const REC = "30000000-0000-4000-8000-0000000000e6", ELEC = "40000000-0000-4000-8000-0000000000e6";
const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3";
const OWNER_EMAIL = "jolowexo@hotmail.com", TRADE_EMAIL = "jo@actpropertyinspections.com.au", PHONE = "0477 511 901";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000" })) process.env[k] = v;

const forms = await import("./helpers/journey-forms");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
const a3 = forms.completedA3({ inspectionDate: today, capturedAt: new Date().toISOString(), priceIncGst: 600, mediaPrefix: "ov" });
const providers = fakeProviders({ mittiTemplates: { [TPL_A3]: forms.templateOf([forms.text("Job Reference ID", ""), ...a3.items]) } });
globalThis.fetch = providers.fetchImpl as typeof fetch;
for (const id of a3.mediaIds) providers.mitti.media.set(id, { bytes: forms.PNG_1X1, type: "image/png" });

// quote_internals.quote_id is the table's primary key live (the generated types can't say so); saveFixesQuote upserts on it.
const j = await journeyDb({ extraSql: "ALTER TABLE quote_internals ADD PRIMARY KEY (quote_id);" });
const { admin, storage } = journeyAdmin(j);
providers.storageFiles.map = storage;
const q = j.q;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const pending: Promise<unknown>[] = [];
const backgroundErrors: string[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { backgroundErrors.push(e.message); })); return "wait_until"; } }));
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

// ---- seed: TEST installer + TEST REC (assigned), one qa_test job at PIESA complete, its A3 form in Mitti ----
const far = new Date(Date.now() + 365 * 86_400_000).toISOString();
await q(`insert into businesses (id, name, trading_name, abn, business_type, capabilities, is_active, onboarding_status, approved_at, onboarding_notes, accepting_new_jobs, phone, email)
  values ($1,'TEST Overlap Insulation','TEST Overlap Insulation','11 222 333 444','eec_installer','{installer}',true,'approved',now(),'[TEST PARTNER] overlap',true,$3,$4),
         ($2,'TEST Overlap Sparks','TEST Overlap Sparks','22 333 444 555','rec','{electrician}',true,'approved',now(),'[TEST PARTNER] overlap REC',true,$3,$4)`, [BIZ, REC, PHONE, TRADE_EMAIL]);
await q(`insert into profiles (id, full_name, email, phone) values ($1,'Ivy Installer',$3,$4), ($2,'Eddie Electrician',$3,$4)`, [INST, ELEC, TRADE_EMAIL, PHONE]);
await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true), ($3,$4,'business_admin',true)`, [BIZ, INST, REC, ELEC]);
await q(`insert into workflow_settings (id, mitti_piesa_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst) values (1,$1,true,true,349)`, [TPL_A3]);
await q("insert into pricing_settings (version, ap_fee_ex_gst, gst_rate, is_active) values (1, 317.27, 0.1, true)");
const [{ id: OWNER }] = await q<{ id: string }>("insert into owners (full_name, email, phone) values ('Helen Overlap',$1,$2) returning id", [OWNER_EMAIL, PHONE]);
const [{ id: PROP }] = await q<{ id: string }>("insert into properties (owner_id, address_line, suburb, postcode, state) values ($1,'6 Overlap Street','Frankston','3199','VIC') returning id", [OWNER]);
const [{ id: JOB }] = await q<{ id: string }>(`insert into jobs (owner_id, property_id, stage, source, business_unit, channel, originating_installer_business_id, job_number)
  values ($1,$2,'piesa_complete','qa_test','hivic','installer_sourced',$3,'HV-9601') returning id`, [OWNER, PROP, BIZ]);
await q(`insert into job_assignments (job_id, user_id, role, business_id, active) values ($1,$2,'installer',$3,true), ($1,$4,'electrician',$5,true)`, [JOB, INST, BIZ, ELEC, REC]);
await q("insert into customer_estimate_links (job_id, owner_id, purpose, token, status, expires_at) values ($1,$2,'step3_estimate','overlap-token-0123456789abcdef','active',$3)", [JOB, OWNER, far]);
// Decision 315: the electrician already gave the fixes times, so nothing waits on them.
await q(`insert into appointment_proposals (job_id, kind, proposed_by, proposer_role, starts_at, ends_at, electrician_window, status)
  values ($1,'rectification',$2,'electrician',now() + interval '3 days',now() + interval '3 days 2 hours',true,'proposed')`, [JOB, ELEC]);
// The A3 the portal made at booking, then answered and Completed by the electrician: repairs needed, $600 on the form.
const created = await (await providers.fetchImpl("https://api.mitti.com/audits", { method: "POST", body: JSON.stringify({ template_id: TPL_A3 }) })).json() as { audit_id: string };
const AUDIT = created.audit_id;
fillAudit(providers.mitti.audits.get(AUDIT)!, [forms.text("Job Reference ID", "HV-9601"), ...a3.items]);
await q("insert into assessments (job_id, status, external_mitti_id, mitti_template_id, mitti_sync_status) values ($1,'in_progress',$2,$3,'pending')", [JOB, AUDIT, TPL_A3]);

afterAll(async () => { await j.db.close(); });

describe("Mitti instant notice + 15-minute pull overlap — A3 fixes quote", () => {
  test("two overlapping syncs of a Complete A3 needing repairs → one live fixes quote, one owner email, at most one text", async () => {
    const { AUTO_FIXES_QUOTE_SEND_ENABLED } = await import("../src/lib/auto-fixes-quote-send.core");
    expect(AUTO_FIXES_QUOTE_SEND_ENABLED).toBe(true);
    const ms = await import("../src/lib/mitti.server");
    const both = await Promise.all([ms.syncMittiAssessment(JOB, null), ms.syncMittiAssessment(JOB, null)]);
    await settle();
    if (process.env["JOURNEY_DEBUG"]) console.log("OVERLAP", JSON.stringify(both), await q("select id, status, release_state, sent_at, customer_total_inc_gst from quotes where job_id=$1", [JOB]), (await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at", [JOB])).map((e) => `${e.event_type}: ${e.summary}`), providers.emails.map((e) => e.subject), providers.texts.length, backgroundErrors);
    expect(backgroundErrors).toEqual([]);
    expect(both.every((r) => r.completed)).toBe(true);

    const live = await q<{ id: string; status: string; release_state: string; customer_total_inc_gst: number }>("select id, status, release_state, customer_total_inc_gst from quotes where job_id=$1 and kind='rectification' and status <> 'superseded'", [JOB]);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "issued", customer_total_inc_gst: 700 }); // $600 + $100 (our electrician, decision 351) — it did go out
    expect(await q("select id from workflow_events where job_id=$1 and event_type='rectification_quote_issued'", [JOB])).toHaveLength(1);

    // Owner sends: TEST jobs go through test-send into job_communications (source_event jo_tradie:<purpose>:<key>).
    const ownerComms = await q<{ channel: string; source_event: string }>("select channel, source_event from job_communications where job_id=$1 and source_event like 'jo_tradie:fixes_quote%'", [JOB]);
    expect(ownerComms.filter((c) => c.channel === "email")).toHaveLength(1);
    expect(ownerComms.filter((c) => c.channel === "sms").length).toBeLessThanOrEqual(1);
    expect(providers.emails.filter((e) => e.to.includes(OWNER_EMAIL) && /fix/i.test(e.subject))).toHaveLength(1);
  });
});
