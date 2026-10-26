// The LIVE full-journey runner (src/lib/journey.server.ts — `bun scripts/journey.ts --keep --no-browser`) driven end to
// end against an isolated PGlite database seeded the way a fresh live database looks for the TEST personas: the Test
// Centre's "Create TEST trade accounts" (createQaTrades, real code) and "Prepare TEST access" (prepareQaAccess, real code,
// which adds the TEST Alpha field worker as pending/unverified) and nothing else. Everything else the run needs must be
// set up by the runner's own TEST setup (ensureTestTrades) through the real recording paths — this test fails if a
// newer gate stops a step. Only the external providers are faked (tests/helpers/journey-harness.ts). Never touches the
// live database or any network.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeProviders, journeyAdmin, journeyDb, loadPendingFunctions, serverFnStandIn, type MittiItem } from "./helpers/journey-harness";

const TPL_A1 = "template_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", TPL_A2 = "template_a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2";
const TPL_A3 = "template_a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3", TPL_A4 = "template_a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4", TPL_A5 = "template_a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
const OFFICE = "40000000-0000-4000-8000-0000000000f9";

for (const [k, v] of Object.entries({ MITTI_API_TOKEN: "test-mitti", LOVABLE_API_KEY: "test-lovable", RESEND_API_KEY: "test-resend", TWILIO_API_KEY: "test-twilio", TWILIO_FROM_NUMBER: "+61400000000", XERO_API_KEY_1: "test-xero", STRIPE_SECRET_KEY: "sk_test_journey", STRIPE_WEBHOOK_SECRET: "whsec_journey", SUPABASE_URL: "https://supabase.test", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })) process.env[k] = v;

const tplItem = (item_id: string, label: string, type = "textsingle"): MittiItem => ({ item_id, label, type });
const basic = { items: [tplItem("i_addr", "Site address", "address"), tplItem("i_owner", "Owner name"), tplItem("i_phone", "Homeowner phone"), tplItem("i_email", "Homeowner email"), tplItem("i_when", "Assessment date/time", "datetime")] };
const providers = fakeProviders({ mittiTemplates: { [TPL_A1]: basic, [TPL_A2]: basic, [TPL_A3]: basic, [TPL_A4]: basic, [TPL_A5]: basic } });
// The Xero Demo Company TEST payment (xero.server recordDemoTestPayment) also reads the bank accounts and PUTs a payment.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host === "connector-gateway.lovable.dev" && url.pathname.startsWith("/xero/api.xro/2.0/Accounts")) return new Response(JSON.stringify({ Accounts: [{ AccountID: "acc-demo-bank", Type: "BANK" }] }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.host === "connector-gateway.lovable.dev" && url.pathname === "/xero/api.xro/2.0/Payments" && (init?.method ?? "GET").toUpperCase() === "PUT") {
    const b = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const p = { ...b, PaymentID: `xero-pay-${providers.xero.payments.length + 1}`, Status: "AUTHORISED", Date: "/Date(1761523200000+0000)/" };
    providers.xero.payments.push(p);
    return new Response(JSON.stringify({ Payments: [p] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // Xero's invoice lookup by Reference, matched on the whole decoded reference (the shared fake stops at the first escape).
  if (url.host === "connector-gateway.lovable.dev" && url.pathname === "/xero/api.xro/2.0/Invoices" && (init?.method ?? "GET").toUpperCase() === "GET" && url.searchParams.get("where")) {
    const ref = /Reference=="([^"]*)"/.exec(url.searchParams.get("where")!)?.[1];
    if (ref !== undefined) return new Response(JSON.stringify({ Invoices: [...providers.xero.invoices.values()].filter((i) => i["Reference"] === ref) }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return providers.fetchImpl(input, init);
}) as typeof fetch;

const j = await journeyDb();
await loadPendingFunctions(j);
// The live database's invoice_status view (pending migration 0080) reads straight from invoices; the harness makes views
// empty tables (and SQL functions depend on its row type), so the rows the view would show are mirrored on every write.
await j.db.exec(`create function journey_invoice_status_mirror() returns trigger language plpgsql as $$ begin
  delete from public.invoice_status where id = new.id;
  insert into public.invoice_status (id, job_id, quote_id, kind, xero_invoice_number, xero_online_url, total_inc_gst, deposit_amount, deposit_paid_amount, deposit_paid_at, balance_due_date, balance_paid_at, total_paid, created_at)
    values (new.id, new.job_id, new.quote_id, new.kind, new.xero_invoice_number, new.xero_online_url, new.total_inc_gst, new.deposit_amount, new.deposit_paid_amount, new.deposit_paid_at, new.balance_due_date, new.balance_paid_at, new.total_paid, new.created_at);
  return new; end $$;
create trigger journey_invoice_status_mirror after insert or update on public.invoices for each row execute function journey_invoice_status_mirror();`);
// The live database seeds every new job's evidence checklist, compliance checks and VEEC row (migration 0000 trigger).
await j.db.exec("create trigger jobs_seed_requirements after insert on public.jobs for each row execute function public.seed_job_requirements();");
// The live database refuses approving an installer whose CII is not office-verified (pending migration 0082 guard).
const guard0082 = /CREATE FUNCTION public\.guard_installer_worker_certified\(\)[\s\S]*?FOR EACH ROW EXECUTE FUNCTION public\.guard_installer_worker_certified\(\);/.exec(readFileSync(new URL("../docs/pending-migrations/0082_installer_sign_activation.sql", import.meta.url), "utf8"))![0];
await j.db.exec(`DROP TRIGGER IF EXISTS partner_workers_installer_certified ON public.partner_workers; DROP FUNCTION IF EXISTS public.guard_installer_worker_certified() CASCADE; ${guard0082}`);
const { admin: baseAdmin, asUser, storage } = journeyAdmin(j);
providers.storageFiles.map = storage;
const q = j.q;

// Supabase Auth admin as the Test Centre uses it: users keep their metadata (qa_test) and magic links carry a token.
const authUsers = new Map<string, { id: string; email: string; user_metadata: Record<string, unknown> }>();
let userSeq = 0;
const authAdmin = {
  async createUser(u: { email: string; user_metadata?: Record<string, unknown> }) {
    const id = `6${String(++userSeq).padStart(7, "0")}-0000-4000-8000-000000000000`;
    const user = { id, email: u.email.toLowerCase(), user_metadata: u.user_metadata ?? {} };
    authUsers.set(id, user);
    return { data: { user }, error: null };
  },
  async getUserById(id: string) { const u = authUsers.get(id); return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "User not found" } }; },
  async listUsers() { return { data: { users: [...authUsers.values()] }, error: null }; },
  async generateLink(p: { email: string }) {
    const u = [...authUsers.values()].find((x) => x.email === p.email.toLowerCase());
    return u ? { data: { user: u, properties: { hashed_token: `hash:${u.id}`, action_link: "https://auth.test/link" } }, error: null } : { data: { user: null, properties: null }, error: { message: "no user" } };
  },
  async updateUserById(id: string) { return { data: { user: authUsers.get(id) ?? { id } }, error: null }; },
};
const admin = { ...baseAdmin, auth: { admin: authAdmin } };

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", serverFnStandIn);
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// personaClient (a TEST person's own signed-in client): the magic-link token resolves to that user's own client.
mock.module("@supabase/supabase-js", () => ({
  createClient: () => {
    let me: string | null = null;
    const client = {
      auth: {
        verifyOtp: async ({ token_hash }: { token_hash: string }) => { me = token_hash.replace(/^hash:/, ""); return { data: { user: { id: me } }, error: null }; },
        getSession: async () => ({ data: { session: me ? { user: { id: me } } : null } }),
        getUser: async () => ({ data: { user: me ? { id: me, user_metadata: {} } : null }, error: null }),
      },
    };
    return new Proxy(client, { get: (t, k) => (k === "auth" ? t.auth : (asUser(me ?? "") as Record<string | symbol, unknown>)[k]) });
  },
}));
const pending: Promise<unknown>[] = [];
const backgroundErrors: string[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { pending.push(task().catch((e: Error) => { backgroundErrors.push(e.message); })); return "wait_until"; } }));

afterAll(async () => { await j.db.close(); });

// ---- the live database before the run: HIV settings, the office actor, and the Test Centre's TEST accounts ----------
await q(`insert into workflow_settings (id, mitti_ready_check_template_id, mitti_ready_check_priced_template_id, mitti_piesa_template_id, mitti_piisa_template_id, mitti_fixes_template_id, auto_send_mitti, customer_comms_enabled, safety_check_payment_inc_gst, payment_option_gate_enabled, ready_check_booking_enabled, piesa_install_window_days)
  values (1,$1,$2,$3,$4,$5,true,true,349,true,true,30)`, [TPL_A2, TPL_A1, TPL_A3, TPL_A5, TPL_A4]);
await q(`insert into retail_estimator_settings (is_current, ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier)
  values (true, 349, 349, 95, 200, 30, 10, 1, 1.1, 1.25)`);
await q("insert into pricing_settings (version, ap_fee_ex_gst) values (1, 317.27)");
{ const { lookupLocation } = await import("../src/lib/activity48.core"); const l = lookupLocation("3199")!; await q("insert into veu_location_variables (postcode, metropolitan_or_regional, reticulated_gas, climate_region, climate_zone, source_version) values ($1,$2,$3,$4,$5,$6)", [l.postcode, l.metropolitan_or_regional, l.reticulated_gas, l.climate_region, l.climate_zone, l.source_version]); }
await q(`insert into profiles (id, full_name, email) values ($1,'Journey Office','admin@hivic.test')`, [OFFICE]);
await q(`insert into user_roles (user_id, role) values ($1,'admin')`, [OFFICE]);
authUsers.set(OFFICE, { id: OFFICE, email: "admin@hivic.test", user_metadata: {} });

const officeCtx = { userId: OFFICE, supabase: admin, claims: {} };
// Live office one-off settings (global, not TEST data — every real owner needs them too): the approved owner documents
// and ESC wording, loaded through the office server functions exactly as the A1/A2 journey tests do.
{
  const pf = await import("../src/lib/portal.functions");
  for (const [key, body] of [["consumer_rights", "TEST VEU consumer information and consumer rights (fixture text)."], ["customer_agreement", "TEST customer agreement wording (fixture text)."],
    ["esc_consent", "TEST ESC information-sharing consent (fixture text)."], ["installer_declaration", "TEST Activity 48 installer declaration (fixture text)."]] as const) {
    await pf.addComplianceTemplate({ data: { template_key: key, version: "live-1", body }, context: officeCtx });
    const [t] = await q<{ id: string }>("select id from compliance_templates where template_key=$1 and version='live-1'", [key]);
    await pf.approveComplianceTemplate({ data: { id: t!.id }, context: officeCtx });
  }
  // The official ESC VEEC assignment form v1.1 (pending migration 0225, loaded unapproved) as Jo approves it in Compliance
  // Setup. ASSUMPTION for the live run: until Jo approves it there, step 8 stops at "VEEC assignment is not ready".
  await j.db.exec(readFileSync(new URL("../docs/pending-migrations/0225_veec_assignment_v1_1.sql", import.meta.url), "utf8"));
  const [veecForm] = await q<{ id: string }>("select id from compliance_templates where template_key='consumer_declaration' order by created_at desc limit 1");
  await pf.approveComplianceTemplate({ data: { id: veecForm!.id }, context: officeCtx });
  await pf.addEscConfig({ data: { version: "live-esc-config-1", fields: [], source_note: "ESC notification fields" }, context: officeCtx });
  const [cfg] = await q<{ id: string }>("select id from esc_notification_config where version='live-esc-config-1'");
  await pf.approveEscConfig({ data: { id: cfg!.id }, context: officeCtx });
}
const ta = await import("../src/lib/test-accounts.functions");
const created = await ta.createTestTradeAccounts({ data: {}, context: officeCtx }) as { results: { status: string }[] };
// "Prepare TEST access" on an earlier TEST job adds the TEST Alpha field worker (pending, unverified) — as on the live database.
const [alpha] = await q<{ id: string }>("select id from businesses where name='TEST Alpha Insulation'");
{
  const [o] = await q<{ id: string }>("insert into owners (full_name, email) values ('TEST Earlier Owner','qa.owner.earlier@hivic-test.example') returning id");
  const [p] = await q<{ id: string }>("insert into properties (address_line, suburb, postcode, state) values ('1 Earlier Test Street','Frankston','3199','VIC') returning id");
  const [jb] = await q<{ id: string }>("insert into jobs (owner_id, property_id, source, stage) values ($1,$2,'qa_test','new_enquiry') returning id", [o!.id, p!.id]);
  await ta.prepareQaJourneyAccess({ data: { jobId: jb!.id }, context: officeCtx });
  await ta.archiveQaJourney({ data: { jobId: jb!.id }, context: officeCtx });
}

// A REAL installer business with a real, pending, unverified person covering the same postcode: the TEST setup must never
// touch it (nor offer it anything).
const REAL_BIZ = "30000000-0000-4000-8000-00000000e001";
await q(`insert into businesses (id, name, trading_name, business_type, capabilities, is_active, onboarding_status, approved_at, service_postcodes, coverage_verified_at, free_measureups_for_hivic_quote_leads)
  values ($1,'Real Insulation Co','Real Insulation Co','eec_installer','{installer}',true,'approved',now(),'{3199}',now(),true)`, [REAL_BIZ]);
await q(`insert into partner_workers (business_id, trade_role, full_legal_name, email, mobile, approval_status, certification_status) values ($1,'installer','Real Person','real.person@example.com','0412345678','pending','unverified')`, [REAL_BIZ]);
const realState = () => q("select b.name, b.service_postcodes, b.coverage_verified_at, w.approval_status, w.certification_status, w.certification, w.piisa_status, w.piisa_verified_at from businesses b join partner_workers w on w.business_id = b.id where b.id = $1", [REAL_BIZ]);
const realBefore = JSON.stringify(await realState());

const snapshot = async () => ({
  businesses: await q<{ name: string }>("select id, name, onboarding_notes from businesses where id <> $1 order by name", [REAL_BIZ]),
  workers: await q<{ email: string }>("select email, approval_status, certification_status, trade_role from partner_workers where business_id <> $1 order by email", [REAL_BIZ]),
});

describe("live journey runner — TEST setup from a fresh live database", () => {
  test("the Test Centre accounts exist as on the live database (seed sanity)", async () => {
    expect(created.results.every((r) => r.status === "created")).toBe(true);
    expect(alpha).toBeTruthy();
    expect(await q("select email, approval_status, certification_status from partner_workers where business_id <> $1", [REAL_BIZ])).toEqual([{ email: "qa.worker.alpha@hivic-test.example", approval_status: "pending", certification_status: "unverified" }]);
  });

  let run: Awaited<ReturnType<typeof import("../src/lib/journey.server").runServerJourney>>;
  test("runServerJourney: every step (1–10) passes", async () => {
    const jr = await import("../src/lib/journey.server");
    if (process.env["JOURNEY_DEBUG"]) { const c = await jr.newJourneyCtx(); console.log("BIZ", await q("select name, free_measureups_for_hivic_quote_leads, service_postcodes, coverage_verified_at from businesses"), c.installer); }
    run = await jr.runServerJourney({ cleanup: false, afterStep: async () => { while (pending.length) await Promise.all(pending.splice(0)); } });
    for (const s of run.result.steps) {
      if (!s.passed || process.env["JOURNEY_DEBUG"]) console.log(`${s.passed ? "PASS" : "FAIL"} ${s.label}${s.error ? ` — ${s.error}` : ""}`, s.passed ? "" : JSON.stringify(s.checks.filter((c) => !c.ok)));
    }
    if (!run.result.passed) console.log("DELIVERED", JSON.stringify(await q("select channel, source_event, recipients, delivery_status, sent_at from job_communications where direction='outbound' and (sent_at is not null or delivery_status in ('sent','delivered'))")));
    if (!run.result.passed && run.ctx.jobId) console.log((await q<{ event_type: string; summary: string }>("select event_type, summary from workflow_events where job_id=$1 order by created_at desc limit 25", [run.ctx.jobId])).map((e) => `${e.event_type}: ${e.summary}`).join("\n"));
    expect(run.result.steps.map((s) => [s.key, s.passed ? "pass" : s.error])).toEqual(run.result.steps.map((s) => [s.key, "pass"]));
    expect(run.result.passed).toBe(true);
  }, 300_000);

  test("setup only ever touched TEST identities: the real business and its person are exactly as they were", async () => {
    const s = await snapshot();
    expect(s.businesses.every((b) => b.name.startsWith("TEST "))).toBe(true);
    expect(s.workers.every((w) => w.email.endsWith("@hivic-test.example"))).toBe(true);
    expect(JSON.stringify(await realState())).toBe(realBefore);
    expect(await q("select id from partner_offers where business_id = $1", [REAL_BIZ])).toEqual([]);
    expect(await q("select id from admin_config_events where details::text like $1", [`%${REAL_BIZ}%`])).toEqual([]);
  });

  test("the setup refuses a business that is not a TEST partner (SAFETY STOP), and a non-TEST person", async () => {
    const js = await import("../src/lib/journey-setup.server");
    const [boss] = await q<{ id: string; business_id: string }>("select id, business_id from profiles where email = 'qa.installer.alpha@hivic-test.example'");
    await expect(js.ensureJourneyTestTrades(OFFICE, { id: boss!.id, business_id: REAL_BIZ, email: "qa.installer.alpha@hivic-test.example" }, { id: boss!.id, business_id: REAL_BIZ, email: "qa.rec.delta@hivic-test.example" })).rejects.toThrow(/SAFETY STOP/);
    await expect(js.ensureTestInstallerPeople(OFFICE, boss!.business_id, { id: boss!.id, email: "someone@example.com" }, [])).rejects.toThrow(/SAFETY STOP/);
    expect(JSON.stringify(await realState())).toBe(realBefore);
  });

  test("a second run on the same database passes too (setup is idempotent)", async () => {
    const jr = await import("../src/lib/journey.server");
    const before = await q<{ n: number }>("select count(*)::int as n from admin_config_events");
    const certsBefore = await q<{ n: number }>("select count(*)::int as n from partner_worker_certifications");
    const again = await jr.runServerJourney({ cleanup: true, afterStep: async () => { while (pending.length) await Promise.all(pending.splice(0)); } });
    for (const s of again.result.steps) if (!s.passed) console.log(`FAIL (2nd run) ${s.label} — ${s.error}`);
    expect(again.result.passed).toBe(true);
    // Nothing recorded twice by the setup itself.
    expect((await q<{ n: number }>("select count(*)::int as n from partner_worker_certifications"))[0]!.n).toBe(certsBefore[0]!.n);
    void before;
  }, 300_000);
});
