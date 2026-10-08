// Real campaign handlers, isolated PGlite persistence. No hosted calls or messages.
import { beforeEach, expect, mock, test } from "bun:test";
import { launchCampaignDb, LAUNCH_ID } from "./helpers/pglite-launch-campaign";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { GATE1_RULESET_VERSION } from "../src/lib/eligibility.core";
const db = await launchCampaignDb();
await db.exec(`
ALTER TABLE jobs ADD source text, ADD stage text, ADD eligibility_outcome text, ADD eligibility_review_required boolean DEFAULT false,
 ADD eligibility_decision_source text, ADD eligibility_decision_rules jsonb, ADD estimated_area_m2 numeric, ADD owners jsonb, ADD properties jsonb;
ALTER TABLE customer_estimate_links ADD token text, ADD purpose text, ADD status text, ADD expires_at timestamptz;
CREATE TABLE owner_contact_consents(job_id uuid, consent_status text, created_at timestamptz DEFAULT now());
CREATE TABLE customer_email_optouts(job_id uuid, opted_out_at timestamptz);
CREATE TABLE post_intake_work(job_id uuid, status text);
CREATE TABLE workflow_events(id uuid DEFAULT gen_random_uuid(), job_id uuid, event_type text, summary text, details jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE indicative_estimates(id uuid DEFAULT gen_random_uuid(), job_id uuid, status text, area_m2 numeric, insulation_declared text, scenarios jsonb);
ALTER TABLE customer_delivery_settings ADD ready_check_available_postcodes text[];
CREATE TABLE retail_estimator_settings(is_current boolean, indicative_veec_value numeric, piesa_assessment_inc_gst numeric, ap_management_inc_gst numeric, r5_install_inc_gst_per_m2 numeric);
INSERT INTO customer_delivery_settings(id) VALUES (1);
INSERT INTO retail_estimator_settings VALUES(true,70,349,349,30);
`);
const shim = postgrestShim(db);
const admin = { from(table: string) {
  const b = shim.from(table);
  const select = b.select.bind(b);
  b.select = (cols = "*", opts) => select(cols.replace(/owners\([^)]*\)/g, "owners").replace(/properties\([^)]*\)/g, "properties"), opts);
  return Object.assign(b, { upsert(p: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }) {
    let returning = false;
    const q = { select() { returning = true; return q; }, async then(resolve: (value: unknown) => unknown) {
      const keys = Object.keys(p); const vals = Object.values(p).map((v) => v && typeof v === "object" ? JSON.stringify(v) : v);
      try {
        const result = await db.query(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (${opts.onConflict}) DO NOTHING RETURNING id`, vals);
        return resolve({ data: returning ? result.rows : null, error: null });
      } catch (e) { return resolve({ data: null, error: { message: String(e) } }); }
    } }; return q;
  } });
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job: string, _actor: unknown, type: string, summary: string, details: unknown) => { await db.query("INSERT INTO workflow_events(job_id,event_type,summary,details) VALUES($1,$2,$3,$4)", [job,type,summary,JSON.stringify(details)]); },
  transition: async (job: string, stage: string) => { await db.query("UPDATE jobs SET stage=$1 WHERE id=$2", [stage,job]); },
}));
mock.module("../src/lib/estimatelink.server", () => ({ resolvePublicEstimate: async () => ({ estimate: {} }) }));
mock.module("../src/lib/referral.server", () => ({ referralUrlForJob: async () => null }));
const { campaignLink, campaignPage, recordInsulationDeclaration, saveCampaignSpot, markCampaignMediaReceived } = await import("../src/lib/launch-campaign.server");
const token = "A".repeat(43);
const audit = { ruleset_version: GATE1_RULESET_VERSION, rules: ["location", "residential", "ceiling_age", "previous_activity", "roof_access"].map((key) => ({ key, result: "pass" })).concat([{ key: "existing_insulation", result: "onsite" }]), hard_failures: [], review_reasons: [] };
beforeEach(async () => {
  await db.exec("DELETE FROM lead_campaign_responses; DELETE FROM workflow_events; DELETE FROM owner_contact_consents; DELETE FROM customer_email_optouts; DELETE FROM post_intake_work; DELETE FROM indicative_estimates;");
  await db.query("UPDATE jobs SET source='qa_test',stage='preliminary_estimate_ready',eligibility_outcome='needs_onsite_confirmation',eligibility_review_required=false,eligibility_decision_source='system',eligibility_decision_rules=$1,estimated_area_m2=120,owners=$2,properties=$3", [JSON.stringify(audit), JSON.stringify({full_name:"TEST Owner"}), JSON.stringify({postcode:"3000",enrichment:{base44:{raw:{answers:{existing_insulation:"present"}}}}})]);
  await db.query("UPDATE customer_estimate_links SET token=$1,purpose='step3_estimate',status='active',expires_at=now()+interval '1 day'", [token]);
  await db.query("INSERT INTO owner_contact_consents VALUES($1,'granted',now())", [LAUNCH_ID.job]);
  await db.query("INSERT INTO workflow_events(job_id,event_type) VALUES($1,'spot_saved_confirmation_queued')", [LAUNCH_ID.job]);
  await db.query("INSERT INTO indicative_estimates(job_id,status,area_m2,insulation_declared,scenarios) VALUES($1,'current',120,'present',$2)", [LAUNCH_ID.job,JSON.stringify([{by_access:{standard:{estimated_customer_total:2500,applied_discount:1400,pre_discount_total:3900}}}])]);
});
for (const type of ["loose_fill_only", "below_r2"] as const) test(`${type}: actual declaration→page→save→repeat, keeps existing insulation and price`, async () => {
  expect((await campaignLink(token))?.ownerQualified).toBe(false);
  await recordInsulationDeclaration(token,type,true);
  const page = JSON.parse(await campaignPage(token) ?? "null");
  expect(page.saveAllowed).toBe(true); expect(page.group).toBe("onsite"); expect(page.pricing.insulation).toBe("present");
  await saveCampaignSpot(token); await saveCampaignSpot(token);
  const row = (await db.query<Record<string, unknown>>("SELECT * FROM lead_campaign_responses")).rows[0];
  expect(row?.saved_insulation).toBe("present"); expect(Number(row?.saved_total)).toBe(2500); expect(Number(row?.saved_veu_discount)).toBe(1400);
  expect(row?.desk_checked_at).toBeNull(); expect(row?.desk_checked_by).toBeNull(); expect(row?.desk_check_status).toBe("not_needed");
  expect((await db.query("SELECT stage FROM jobs")).rows[0]).toEqual({stage:"ready_check_ready_to_schedule"});
  const events = (await db.query<{details: Record<string,unknown>}>("SELECT details FROM workflow_events WHERE event_type=$1", [type === "loose_fill_only" ? "owner_insulation_loose_fill_only_declared" : "owner_insulation_below_r2_declared"])).rows;
  expect(events).toHaveLength(1); expect(events[0]?.details.answer).toBe("yes"); expect(events[0]?.details.declaration_type).toBe(type); expect(events[0]?.details.basis).toBe("owner_declared"); expect(Number.isFinite(Date.parse(String(events[0]?.details.answered_at)))).toBe(true);
  expect((await db.query("SELECT count(*)::int n FROM lead_campaign_responses")).rows[0]).toEqual({n:1});
});
test("photos/video queue pending, only approved review unlocks save", async () => {
  await markCampaignMediaReceived(LAUNCH_ID.job,LAUNCH_ID.link);
  expect(JSON.parse(await campaignPage(token) ?? "null").saveAllowed).toBe(false);
  await expect(saveCampaignSpot(token)).rejects.toThrow();
  await db.exec("UPDATE lead_campaign_responses SET desk_check_status='looks_eligible'");
  await saveCampaignSpot(token);
  expect((await db.query("SELECT spot_saved_at IS NOT NULL saved FROM lead_campaign_responses")).rows[0]).toEqual({saved:true});
});
test("unanswered, no, unsure and old below-R2 history do not qualify", async () => {
  for (const answer of [false, undefined, "no", "unsure"]) {
    await expect(recordInsulationDeclaration(token,"below_r2",answer as boolean)).rejects.toThrow();
  }
  await db.query("INSERT INTO workflow_events(job_id,event_type,details) VALUES($1,'owner_insulation_below_r2_declared',$2)", [LAUNCH_ID.job,JSON.stringify({declaration:"I confirm this is below R2",basis:"owner_declared"})]);
  expect((await campaignLink(token))?.ownerQualified).toBe(false);
  await expect(saveCampaignSpot(token)).rejects.toThrow();
});
test("all other criteria must pass, even with a yes", async () => {
  await db.query("UPDATE jobs SET eligibility_decision_rules=$1",[JSON.stringify({...audit,rules:audit.rules.filter((r)=>r.key!=="previous_activity")})]);
  await expect(recordInsulationDeclaration(token,"loose_fill_only",true)).rejects.toThrow();
});
for (const state of ["ineligible","closed","opted_out","expired","revoked","wrong_source","no_consent","review","processing"] as const) test(`${state} blocks declaration/save`, async () => {
  if (state === "ineligible") await db.exec("UPDATE jobs SET eligibility_outcome='does_not_appear_eligible'");
  if (state === "closed") await db.exec("UPDATE jobs SET stage='complete'");
  if (state === "opted_out") await db.query("INSERT INTO customer_email_optouts VALUES($1,now())",[LAUNCH_ID.job]);
  if (state === "expired") await db.exec("UPDATE customer_estimate_links SET expires_at=now()-interval '1 day'");
  if (state === "revoked") await db.exec("UPDATE customer_estimate_links SET status='revoked'");
  if (state === "wrong_source") await db.exec("UPDATE jobs SET source='installer'");
  if (state === "no_consent") await db.exec("DELETE FROM owner_contact_consents");
  if (state === "review") await db.exec("UPDATE jobs SET eligibility_review_required=true");
  if (state === "processing") await db.query("INSERT INTO post_intake_work VALUES($1,'processing')",[LAUNCH_ID.job]);
  await expect(recordInsulationDeclaration(token,"below_r2",true)).rejects.toThrow(); await expect(saveCampaignSpot(token)).rejects.toThrow();
});