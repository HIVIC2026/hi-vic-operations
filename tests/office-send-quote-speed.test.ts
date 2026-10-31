import { expect, test } from "bun:test";

// Keep module/provider stubs in a separate process, away from the other quote tests.
if (process.env.OFFICE_QUOTE_SPEED_CHILD !== "1") {
  test("isolated TEST quote release: refusals, parallel reads and one concurrent winner", () => {
    const result = Bun.spawnSync(["bun", "test", import.meta.filename], {
      cwd: process.cwd(), env: { ...process.env, OFFICE_QUOTE_SPEED_CHILD: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    console.log(new TextDecoder().decode(result.stdout));
    console.log(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
  }, 30000);
} else {
  const { beforeEach, afterAll, mock } = await import("bun:test");
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgrestShim } = await import("./helpers/pglite-postgrest-shim");
  const db = new PGlite();
  const J = "00000000-0000-4000-8000-000000000001";
  const Q = "00000000-0000-4000-8000-000000000002";
  const O = "00000000-0000-4000-8000-000000000003";
  const B = "00000000-0000-4000-8000-000000000004";
  await db.exec(`
    CREATE TABLE jobs (id uuid PRIMARY KEY, stage text, source text, channel text, deleted_at timestamptz, qa_archived_at timestamptz, owner_id uuid, property_id uuid, job_number text);
    CREATE TABLE quotes (id uuid PRIMARY KEY, job_id uuid, kind text, status text, sent_at timestamptz, release_state text, release_hold_reason text, created_at timestamptz, option_code text, office_reviewed_at timestamptz, office_reviewed_by uuid, customer_total_inc_gst numeric, veec_discount_inc_gst numeric, subtotal_inc_gst numeric);
    CREATE TABLE workflow_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, event_type text, created_at timestamptz DEFAULT now(), details jsonb);
    CREATE TABLE ceiling_measurements (id uuid, job_id uuid, status text, measured_area_m2 numeric, verified_area_m2 numeric, removal_required boolean, removal_m2 numeric, access_difficulty text, external_source text, external_id text, is_current boolean);
    CREATE TABLE customer_estimate_links (job_id uuid, purpose text, status text, expires_at timestamptz, token text);
    CREATE TABLE owners (id uuid, phone text, email text, full_name text);
    CREATE TABLE quote_items (quote_id uuid, description text, line_total_inc_gst numeric, sort integer);
    CREATE TABLE job_assignments (job_id uuid, role text, active boolean, business_id uuid);
    CREATE TABLE businesses (id uuid, onboarding_notes text);
    CREATE TABLE customer_email_sends (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, purpose text, idempotency_key text UNIQUE, status text);
  `);
  const timings: { name: string; start: number; end: number }[] = [];
  const writes: string[] = [];
  let comms = true, commercial: string | null = null, ownerLink = true, intake: string[] = [], stageBlocks: string[] = [];
  const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const step = { name, start: performance.now(), end: 0 }; timings.push(step);
    await new Promise(resolve => setTimeout(resolve, 15));
    try { return await fn(); } finally { step.end = performance.now(); }
  };
  const shim = postgrestShim(db);
  const admin = { from(table: string) {
    const query = shim.from(table);
    let fields = "*", update = false;
    const select = query.select.bind(query), patch = query.update.bind(query), run = query.run.bind(query);
    query.select = (...args: Parameters<typeof select>) => { fields = args[0] ?? "*"; return select(...args); };
    query.update = (...args: Parameters<typeof patch>) => { update = true; return patch(...args); };
    query.run = () => timed(`${update ? "claim" : "read"}:${table}:${fields}`, async () => {
      if (update) writes.push("claim");
      // Presentation's joined business read is best-effort; no provider or live data is reachable.
      if (fields.startsWith("businesses(")) return { data: null, error: null };
      return run();
    });
    return query;
  } };
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
  mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error,
    commercialBlocker: () => timed("commercial", async () => commercial),
    stageEntryBlockers: () => timed("stage-entry", async () => stageBlocks),
    transition: async () => { writes.push("transition"); await db.query("UPDATE jobs SET stage='measured_estimate_ready' WHERE id=$1", [J]); },
    logEvent: async (job: string, _actor: unknown, type: string) => { writes.push("logEvent"); await db.query("INSERT INTO workflow_events(job_id,event_type) VALUES ($1,$2)", [job,type]); },
  }));
  mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: (_job: string, what: string) => timed("permission", async () => {
    if (!comms) throw Error(`PRE-LAUNCH: customer communications are disabled – nothing was sent to the customer or trade. (${what})`);
  }) }));
  mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: () => timed("blockers", async () => intake) }));
  mock.module("../src/lib/installer-quote.server", () => ({ quoteBillingBlocker: async () => null }));
  mock.module("../src/lib/install-evidence.server", () => ({ jobProductProblems: async () => [] }));
  mock.module("../src/lib/estimatelink.server", () => ({ ensureOwnerLink: async () => { writes.push("ensureOwnerLink"); return ownerLink; } }));
  mock.module("../src/lib/pilot.server", () => ({ applyCobrand: async () => { writes.push("applyCobrand"); } }));
  // This helper may INSERT a token in production: deliberately stays sequential.
  mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => { writes.push("unsubscribe"); return null; } }));
  mock.module("../src/lib/test-send.server", () => ({
    sendTestEmail: async (ctx: { jobId: string; jobSource: string; partnerIsTest: boolean; label: string }, to: string) => {
      expect(ctx.jobSource).toBe("qa_test"); expect(ctx.partnerIsTest).toBe(true); expect(to).toBe("owner@hivic-test.example");
      writes.push("email");
      await db.query("INSERT INTO customer_email_sends(job_id,purpose,idempotency_key,status) VALUES ($1,'quote_ready',$2,'sent')", [ctx.jobId,ctx.label]);
      return { status: "sent", detail: "practice row only" };
    },
    sendTestSms: async () => { writes.push("sms"); return { status: "blocked", detail: "isolated TEST: no provider" }; },
  }));
  const { releaseQuoteToOwner } = await import("../src/lib/office-quote-review.server");
  beforeEach(async () => {
    await db.exec("TRUNCATE jobs,quotes,workflow_events,ceiling_measurements,customer_estimate_links,owners,quote_items,job_assignments,businesses,customer_email_sends");
    await db.query("INSERT INTO jobs VALUES ($1,'ready_check_complete','qa_test','installer_sourced',null,null,$2,null,'TEST-QUOTE')", [J,O]);
    await db.query("INSERT INTO quotes(id,job_id,kind,status,release_state,release_hold_reason,created_at,option_code,customer_total_inc_gst,veec_discount_inc_gst,subtotal_inc_gst) VALUES ($1,$2,'installation','draft','held','Waiting for office review before sending',now(),'INSTALLER_A1',5988,210,6198)", [Q,J]);
    await db.query("INSERT INTO owners VALUES ($1,null,'owner@hivic-test.example','Practice Owner')", [O]);
    await db.query("INSERT INTO customer_estimate_links VALUES ($1,'step3_estimate','active','2099-01-01',repeat('a',64))", [J]);
    await db.query("INSERT INTO job_assignments VALUES ($1,'installer',true,$2)", [J,B]);
    await db.query("INSERT INTO businesses VALUES ($1,'[TEST PARTNER]')", [B]);
    comms = true; commercial = null; ownerLink = true; intake = []; stageBlocks = []; timings.length = 0; writes.length = 0;
  });
  afterAll(() => db.close());
  const send = () => releaseQuoteToOwner(J,Q,O,"office");
  test.each([
    ["closed job", "Job is closed or archived"],
    ["wrong stage", "The job isn't at the quote stage yet (new_enquiry), so the owner couldn't accept it."],
    ["commercial", "Commercial setup required – invoice route not configured for this installer-sourced job."],
    ["no owner link", "The owner has no secure My job link, so they couldn't open or accept the quote."],
    ["comms off", "PRE-LAUNCH: customer communications are disabled – nothing was sent to the customer or trade. (Office Send quote)"],
    ["TEST link missing", "TEST owner quote link must be prepared before Send."],
  ])("same refusal: %s", async (reason, message) => {
    if (reason === "closed job") await db.query("UPDATE jobs SET stage='cancelled' WHERE id=$1", [J]);
    if (reason === "wrong stage") await db.query("UPDATE jobs SET stage='new_enquiry' WHERE id=$1", [J]);
    if (reason === "commercial") commercial = message;
    if (reason === "no owner link") ownerLink = false;
    if (reason === "comms off") comms = false;
    if (reason === "TEST link missing") await db.exec("TRUNCATE customer_estimate_links");
    await expect(send()).rejects.toThrow(message);
    expect((await db.query("SELECT * FROM customer_email_sends")).rows).toEqual([]);
    expect(writes).not.toContain("claim");
  });
  test("refusal priority stays blockers, permission, stage, commercial", async () => {
    intake = ["Owner eligibility needs checking"]; comms = false; commercial = "Commercial setup required";
    await db.query("UPDATE jobs SET stage='new_enquiry' WHERE id=$1", [J]);
    await expect(send()).rejects.toThrow("Owner eligibility needs checking");
    intake = [];
    await expect(send()).rejects.toThrow("PRE-LAUNCH:");
    comms = true;
    await expect(send()).rejects.toThrow("The job isn't at the quote stage yet (new_enquiry)");
    await db.query("UPDATE jobs SET stage='ready_check_complete' WHERE id=$1", [J]);
    stageBlocks = ["Verified eligibility not recorded as eligible by the office for the current Ready Check."];
    await expect(send()).rejects.toThrow(stageBlocks[0]);
    expect(writes).toEqual([]);
    stageBlocks = [];
    await expect(send()).rejects.toThrow("Commercial setup required");
    expect(writes).toEqual(["transition"]);
  });
  test("independent checks overlap; writes retain their order; log step timings", async () => {
    const started = performance.now();
    await send();
    const checks = ["blockers","permission","commercial","read:jobs:stage, source"].map(name => timings.find(step => step.name === name));
    for (const step of checks) expect(step).toBeDefined();
    const starts = checks.map(step => step?.start ?? Infinity), ends = checks.map(step => step?.end ?? 0);
    expect(Math.max(...starts)).toBeLessThan(Math.min(...ends));
    expect(timings.filter(step => step.name === "read:jobs:stage, source")).toHaveLength(1);
    expect(timings.filter(step => step.name === "read:jobs:source")).toHaveLength(0);
    const partner = timings.find(step => step.name === "read:job_assignments:business_id");
    const facts = timings.find(step => step.name === "read:quotes:customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, kind");
    if (!partner || !facts) throw Error("Missing notification timing");
    expect(Math.max(partner.start,facts.start)).toBeLessThan(Math.min(partner.end,facts.end));
    expect(writes).toEqual(["transition","ensureOwnerLink","applyCobrand","claim","logEvent","unsubscribe","email","sms"]);
    const origin = timings[0]?.start ?? 0;
    for (const step of timings) console.log(`TIMING ${step.name}: start +${(step.start-origin).toFixed(1)}ms, duration ${(step.end-step.start).toFixed(1)}ms`);
    console.log(`TIMING complete TEST release: ${(performance.now()-started).toFixed(1)}ms (15ms artificial delay per read; no provider)`);
  });
  test("two simultaneous Send presses produce exactly one quote_ready email row", async () => {
    const results = await Promise.allSettled([send(),send()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find(result => result.status === "rejected");
    if (refused?.status !== "rejected") throw Error("Missing concurrent loser");
    expect(refused.reason.message).toBe("The quote changed or was already sent. Reload it.");
    expect((await db.query("SELECT purpose,status FROM customer_email_sends")).rows).toEqual([{ purpose: "quote_ready", status: "sent" }]);
    expect((await db.query("SELECT event_type FROM workflow_events WHERE event_type='quote_sent_by_office'")).rows).toHaveLength(1);
  });
}