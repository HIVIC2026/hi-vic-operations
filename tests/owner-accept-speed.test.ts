import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";

if (process.env.OWNER_ACCEPT_SPEED_CHILD !== "1") {
  test("TEST-only before/after owner loading, refusal and signing parity", () => {
    const baseline = process.env.OWNER_ACCEPT_SPEED_BASELINE ?? "/tmp/task5-baseline";
    if (!existsSync(`${baseline}/src/lib/assignment.server.ts`)) {
      mkdirSync(baseline, { recursive: true });
      const archive = Bun.spawnSync(
        ["git", "archive", "c00fca080f09190c582104c84d2951f80bd46538"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(archive.exitCode).toBe(0);
      const extract = Bun.spawnSync(["tar", "-x", "-C", baseline], {
        stdin: archive.stdout,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(extract.exitCode).toBe(0);
      symlinkSync(`${process.cwd()}/node_modules`, `${baseline}/node_modules`);
    }
    // The unchanged source copy is captured before any production edits.
    writeFileSync(
      `${baseline}/tests/owner-accept-speed.test.ts`,
      readFileSync(import.meta.filename),
    );
    const run = (cwd: string, output: string) => {
      const r = Bun.spawnSync(["bun", "test", "tests/owner-accept-speed.test.ts"], {
        cwd,
        env: { ...process.env, OWNER_ACCEPT_SPEED_CHILD: "1", OWNER_ACCEPT_SPEED_OUTPUT: output },
        stdout: "pipe",
        stderr: "pipe",
      });
      console.log(new TextDecoder().decode(r.stdout));
      console.log(new TextDecoder().decode(r.stderr));
      expect(r.exitCode).toBe(0);
      return JSON.parse(readFileSync(output, "utf8"));
    };
    const before = run(baseline, "/tmp/task5-before.json"),
      after = run(process.cwd(), "/tmp/task5-after.json");
    expect(after.outputs).toEqual(before.outputs);
    expect(after.refusals).toEqual(before.refusals);
    expect(after.records).toEqual(before.records);
    expect(after.writes).toEqual(before.writes);
    for (const name of Object.keys(before.timings)) {
      console.log(
        `BEFORE/AFTER ${name}: ${before.timings[name].toFixed(1)}ms → ${after.timings[name].toFixed(1)}ms (15ms/read, isolated)`,
      );
    }
    if (process.env.OWNER_ACCEPT_SPEED_MEASURE_ONLY !== "1") {
      expect(after.overlaps.package).toBe(true);
      expect(after.overlaps.loader).toBe(true);
      expect(after.overlaps.paperwork).toBe(true);
      expect(after.overlaps.sign).toBe(true);
    }
  }, 60000);
} else {
  const { mock } = await import("bun:test");
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgrestShim } = await import("./helpers/pglite-postgrest-shim");
  const db = new PGlite();
  const J = "00000000-0000-4000-8000-000000000001",
    Q = "00000000-0000-4000-8000-000000000002",
    U = "00000000-0000-4000-8000-000000000003",
    B = "00000000-0000-4000-8000-000000000004";
  // Stable signature timestamps, ids and hashes make exact signed-record parity meaningful.
  const RealDate = Date;
  const instant = "2026-10-31T21:40:00.000Z";
  const steps: { name: string; start: number; end: number }[] = [];
  const writes: { name: string; value: unknown }[] = [];
  const timed = async <T>(name: string, fn: () => Promise<T>) => {
    const s = { name, start: performance.now(), end: 0 };
    steps.push(s);
    await new Promise((r) => setTimeout(r, 15));
    try {
      return await fn();
    } finally {
      s.end = performance.now();
    }
  };
  await db.exec(`
    CREATE TABLE quotes(id uuid, job_id uuid, kind text, option_label text, option_code text, version int, subtotal_inc_gst numeric, veec_discount_inc_gst numeric, customer_total_inc_gst numeric, status text, release_state text, sent_at timestamptz, created_at timestamptz, accepted_at timestamptz, accepted_by uuid);
    CREATE TABLE jobs(id uuid, job_number text, stage text, source text, life_support boolean, life_support_status text, installer_site_check jsonb);
    CREATE TABLE ceiling_measurements(job_id uuid, measured_area_m2 numeric, is_current boolean);
    CREATE TABLE rectification_items(job_id uuid, description text, status text);
    CREATE TABLE job_assignments(job_id uuid, user_id uuid, business_id uuid, role text, active boolean);
    CREATE TABLE profiles(id uuid, full_name text, licence_number text, business_id uuid);
    CREATE TABLE businesses(id uuid, name text, abn text, licence_number text);
    CREATE TABLE compliance_templates(template_key text, version text, body text, approved boolean, is_active boolean, required boolean, form_fields jsonb, requires_final_consumer_signature boolean);
    CREATE TABLE owner_paperwork_approvals(doc_key text, doc_version text, body_sha256 text);
    CREATE TABLE owner_gate_signatures(doc_key text, doc_version text, doc_draft boolean, answers jsonb, signed_at timestamptz, job_id uuid);
    CREATE TABLE owner_esc_consents(id uuid, job_id uuid, owner_signed_at timestamptz);
    CREATE TABLE piesa_deliveries(job_id uuid, recipient text);
    CREATE TABLE owner_contact_consents(id uuid,job_id uuid,source text,consent_status text);
    CREATE TABLE workflow_settings(id int,safety_check_payment_inc_gst numeric);
    CREATE TABLE assignment_variations(id uuid,job_id uuid,status text,reasons jsonb,raised_at timestamptz);
    CREATE TABLE customer_agreements(id uuid DEFAULT '00000000-0000-4000-8000-000000000010',job_id uuid,status text DEFAULT 'signed', payload jsonb);
    CREATE TABLE documents(job_id uuid,kind text,title text,storage_path text,mime_type text,uploaded_by uuid);
    CREATE TABLE declarations(job_id uuid,kind text,declared_by uuid,statement text,UNIQUE(job_id,kind));
    CREATE TABLE compliance_checks(job_id uuid,check_key text,status text,checked_at timestamptz);
  `);
  const items = [
    {
      description: "Insulation install",
      quantity: 1,
      unit: "job",
      unit_price_inc_gst: 5500,
      line_total_inc_gst: 5500,
      code: "INSTALL",
      sort: 1,
    },
    {
      description: "PIESA",
      quantity: 1,
      unit: "job",
      unit_price_inc_gst: 349,
      line_total_inc_gst: 349,
      code: "SAFETY_CHECK",
      sort: 2,
    },
    {
      description: "AP fee",
      quantity: 1,
      unit: "job",
      unit_price_inc_gst: 349,
      line_total_inc_gst: 349,
      code: "AP",
      sort: 3,
    },
  ];
  const joinedJob = {
    job_number: "TEST-ACCEPT",
    owners: { id: U, full_name: "Practice Owner", email: "owner@hivic-test.example", phone: null },
    properties: {
      address_line: "1 Practice Street",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
    },
  };
  const shim = postgrestShim(db);
  const admin = {
    from(table: string) {
      const q = shim.from(table);
      let fields = "*",
        op = "read",
        patch: Record<string, unknown> | null = null;
      const select = q.select.bind(q),
        update = q.update.bind(q),
        insert = q.insert.bind(q),
        upsert = q.upsert.bind(q),
        run = q.run.bind(q);
      q.select = (...args: Parameters<typeof select>) => {
        fields = args[0] ?? "*";
        return select(...args);
      };
      q.update = (p) => {
        op = "update";
        patch = p;
        return update(p);
      };
      q.insert = (p) => {
        op = "insert";
        patch = p;
        return insert(p);
      };
      q.upsert = (p, o) => {
        op = "upsert";
        patch = p;
        return upsert(p, o);
      };
      q.run = () =>
        timed(`${op}:${table}:${fields}`, async () => {
          if (op !== "read") writes.push({ name: `${op}:${table}`, value: patch });
          if (table === "quotes" && fields.includes("quote_items(")) {
            const r = await db.query("SELECT * FROM quotes WHERE id=$1", [Q]);
            return { data: r.rows[0] ? { ...r.rows[0], quote_items: items } : null, error: null };
          }
          if (table === "jobs" && fields.includes("owners("))
            return { data: joinedJob, error: null };
          if (table === "job_assignments" && fields === "businesses(name)")
            return { data: { businesses: { name: "Practice Installer" } }, error: null };
          if (table === "customer_agreements" && op === "insert") {
            await db.query("INSERT INTO customer_agreements(job_id,payload) VALUES ($1,$2)", [
              J,
              JSON.stringify(patch),
            ]);
            return { data: { id: "00000000-0000-4000-8000-000000000010" }, error: null };
          }
          return run();
        });
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          writes.push({ name: "upload", value: path });
          return { error: null };
        },
      }),
    },
  };
  mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
  const builder = () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (h: unknown) => h };
    return b;
  };
  mock.module("@tanstack/react-start", () => ({ createServerFn: builder }));
  mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
  mock.module("../src/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
  let billing: string | null = null,
    intake: string[] = [],
    commercial: string | null = null,
    expired = false,
    owner = true;
  mock.module("../src/lib/workflow.server", () => ({
    WorkflowError: Error,
    nextStepBlockers: async () => [],
    stageEntryBlockers: async () => [],
    requireAdmin: async () => {},
    requireJobRole: async () => {},
    paymentOptionCleared: async () => false,
    agreementSigned: () => timed("agreementSigned", async () => false),
    assignmentStatus: () => timed("assignmentStatus", async () => "draft"),
    getStage: () =>
      timed(
        "getStage",
        async () => (await db.query<{ stage: string }>("SELECT stage FROM jobs")).rows[0]?.stage,
      ),
    commercialBlocker: () => timed("commercialBlocker", async () => commercial),
    piesaStatus: () => timed("piesaStatus", async () => ({ piesa_expired: expired })),
    logEvent: async (...args: unknown[]) => {
      writes.push({ name: "logEvent", value: args });
    },
    transition: async (...args: unknown[]) => {
      writes.push({ name: "transition", value: args });
      await db.query("UPDATE jobs SET stage=$1", [args[1]]);
    },
  }));
  mock.module("../src/lib/job-records.server", () => ({
    lifeSupportPlansOnFile: () => timed("lifeSupportPlansOnFile", async () => new Set()),
  }));
  mock.module("../src/lib/safety-check-amount.server", () => ({
    quoteSafetyCheck: () => timed("quoteSafetyCheck", async () => ({ incGst: 349 })),
  }));
  mock.module("../src/lib/owner-myjob.server", () => ({
    resolveOwnerJob: () => timed("resolveOwnerJob", async () => ({ quote: { id: Q } })),
  }));
  mock.module("../src/lib/owner-verify.server", () => ({
    ownerSession: () => timed("ownerSession", async () => ({ jobId: J, userId: U })),
  }));
  mock.module("../src/lib/installer-quote.server", () => ({
    quoteBillingBlocker: () => timed("quoteBillingBlocker", async () => billing),
  }));
  mock.module("../src/lib/installer-intake.server", () => ({
    intakeSendBlockers: () => timed("intakeSendBlockers", async () => intake),
    isIntakeJob: () => timed("isIntakeJob", async () => false),
  }));
  mock.module("../src/lib/signed-pdf.server", () => ({ textToPdf: async () => new Uint8Array() }));
  mock.module("../src/lib/invoice-after-acceptance.server", () => ({
    createInvoiceAfterAcceptance: async (...args: unknown[]) => {
      writes.push({ name: "invoice", value: args });
    },
  }));
  mock.module("../src/lib/autoadvance.server", () => ({
    autoAdvanceOpenJobs: async () => {},
    autoAdvanceJob: async (...args: unknown[]) => {
      writes.push({ name: "autoAdvance", value: args });
    },
  }));
  // Other portal exports are not exercised; stub its unrelated server-only imports
  // by their declared names so no live Mitti/Xero/email module can be reached.
  const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
  const keep = new Set(["./workflow.server", "./assignment.server"]);
  for (const match of portal.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*"(\.\/[^"]+(?:server|functions))"/g,
  )) {
    const path = match[2];
    if (!path || keep.has(path) || path === "./autoadvance.server") continue;
    const names = (match[1] ?? "")
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter((s) => s && !s.startsWith("type "));
    mock.module(`../src/lib/${path.slice(2)}`, () =>
      Object.fromEntries(names.map((name) => [name, async () => null])),
    );
  }
  const assignment = await import("../src/lib/assignment.server");
  const gates = await import("../src/lib/owner-gates.server");
  const links = await import("../src/lib/owner-link.functions");
  const actions = await import("../src/lib/portal.functions");
  const reset = async () => {
    await db.exec(
      "TRUNCATE quotes,jobs,ceiling_measurements,rectification_items,job_assignments,profiles,businesses,compliance_templates,customer_agreements,documents,declarations,compliance_checks,workflow_settings",
    );
    await db.query(
      "INSERT INTO quotes VALUES ($1,$2,'installation','R5 insulation','INSTALL',1,6198,210,5988,'issued','released',$3,$3,null,null)",
      [Q, J, instant],
    );
    await db.query(
      "INSERT INTO jobs VALUES ($1,'TEST-ACCEPT','measured_estimate_ready','qa_test',false,null,null)",
      [J],
    );
    await db.query("INSERT INTO ceiling_measurements VALUES ($1,25,true)", [J]);
    await db.query("INSERT INTO job_assignments VALUES ($1,$2,$3,'installer',true)", [J, U, B]);
    await db.query("INSERT INTO profiles VALUES ($1,'Practice Installer','TEST-LIC',$2)", [U, B]);
    await db.query(
      "INSERT INTO businesses VALUES ($1,'Practice Installer','TEST-ABN','TEST-LIC')",
      [B],
    );
    await db.exec(
      "INSERT INTO compliance_templates VALUES ('consumer_rights','v1','Approved consumer rights practice wording only.',true,true,true,null,false),('customer_agreement','v1','Approved agreement practice wording only.',true,true,true,null,false);INSERT INTO workflow_settings VALUES(1,349)",
    );
    billing = null;
    intake = [];
    commercial = null;
    expired = false;
    owner = true;
    steps.length = 0;
    writes.length = 0;
  };
  const outputs: Record<string, unknown> = {},
    timings: Record<string, number> = {},
    overlaps: Record<string, boolean> = {};
  const capture = async (name: string, fn: () => Promise<unknown>, a: string, b: string) => {
    await reset();
    const start = performance.now();
    outputs[name] = await fn();
    timings[name] = performance.now() - start;
    const aa = steps.find((s) => s.name.startsWith(a)),
      bb = steps.find((s) => s.name.startsWith(b));
    overlaps[name] = !!aa && !!bb && Math.max(aa.start, bb.start) < Math.min(aa.end, bb.end);
    for (const s of steps) {
      const others = steps
        .filter((x) => x !== s && x.start < s.end && s.start < x.end)
        .map((x) => x.name);
      console.log(
        `READ ${name} +${(s.start - start).toFixed(1)}ms ${(s.end - s.start).toFixed(1)}ms ${s.name} ${others.length ? `WITH ${others.join(" | ")}` : "ALONE"}`,
      );
    }
  };
  test("measure every owner load and signed acceptance with reserved TEST data only", async () => {
    globalThis.Date = class extends RealDate {
      constructor(value?: string | number) {
        super(value ?? instant);
      }
      static now() {
        return RealDate.now();
      }
    } as DateConstructor;
    await capture(
      "package",
      () => assignment.buildAcceptancePackage(Q),
      "read:jobs:",
      "read:ceiling_measurements:",
    );
    await capture(
      "loader",
      () =>
        (links.ownerAgreementFn as unknown as (x: unknown) => Promise<unknown>)({
          data: { token: "practice", quoteId: Q },
        }),
      "read:compliance_templates:",
      "read:quotes:",
    );
    await capture(
      "paperwork",
      () => gates.ownerPaperworkToSign(J),
      "read:jobs:source",
      "read:jobs:job_number",
    );
    await capture(
      "gateFacts",
      () => gates.gateFacts(J),
      "read:owner_contact_consents:",
      "read:jobs:source",
    );
    const sign = {
      authorityType: "owner" as const,
      readConsumerInfo: true,
      acceptAgreement: true,
      assistance: "none" as const,
    };
    const data = { quoteId: Q, accept: true, consent: true, expectedVersion: 1, signing: sign };
    const actor = {
      userId: U,
      ip: null,
      userAgent: null,
      authorize: async () => {},
      isOwner: async () => owner,
    };
    const refusals: Record<string, string> = {};
    for (const name of [
      "missing",
      "expired",
      "closed",
      "held",
      "version",
      "consent",
      "billing",
      "stage",
      "signing",
      "owner",
      "consumer-info",
      "agreement-tick",
      "intake",
      "commercial",
      "PIESA",
      "already-signed",
    ]) {
      await reset();
      const d = { ...data, signing: { ...sign } };
      if (name === "missing") await db.exec("TRUNCATE quotes");
      if (name === "expired" || name === "closed")
        await db.query("UPDATE quotes SET status=$1", [
          name === "expired" ? "expired" : "accepted",
        ]);
      if (name === "held") await db.exec("UPDATE quotes SET release_state='held'");
      if (name === "version") d.expectedVersion = 2;
      if (name === "consent") d.consent = false;
      if (name === "billing") billing = "Commercial details missing";
      if (name === "stage") await db.exec("UPDATE jobs SET stage='new_enquiry'");
      if (name === "signing") delete (d as { signing?: unknown }).signing;
      if (name === "owner") owner = false;
      if (name === "consumer-info") d.signing.readConsumerInfo = false;
      if (name === "agreement-tick") d.signing.acceptAgreement = false;
      if (name === "intake") intake = ["Owner eligibility needs checking"];
      if (name === "commercial") commercial = "Commercial setup required";
      if (name === "PIESA") expired = true;
      if (name === "already-signed")
        await db.query("INSERT INTO customer_agreements(job_id,payload) VALUES ($1,'{}')", [J]);
      try {
        await actions.respondToQuoteImpl(d, actor);
        throw Error(`Expected refusal: ${name}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        expect(message).not.toBe(`Expected refusal: ${name}`);
        refusals[name] = message;
      }
      expect(writes).toEqual([]);
    }
    await capture(
      "sign",
      () =>
        (links.ownerAcceptQuoteFn as unknown as (x: unknown) => Promise<unknown>)({
          data: {
            token: "practice",
            session: "practice-session",
            quoteId: Q,
            expectedVersion: 1,
            signing: sign,
          },
          context: { ip: null, userAgent: null },
        }),
      "piesaStatus",
      "read:rectification_items:id",
    );
    const records = {
      agreement: (await db.query("SELECT payload FROM customer_agreements")).rows,
      documents: (await db.query("SELECT * FROM documents")).rows,
      quote: (await db.query("SELECT status,accepted_at,accepted_by FROM quotes")).rows,
      declarations: (await db.query("SELECT * FROM declarations")).rows,
    };
    expect(records.agreement).toHaveLength(1);
    expect(records.quote[0]?.status).toBe("accepted");
    expect(records.documents).toHaveLength(1);
    const output = process.env.OWNER_ACCEPT_SPEED_OUTPUT;
    if (!output) throw Error("Missing isolated output path");
    writeFileSync(
      output,
      JSON.stringify({ outputs, timings, overlaps, refusals, records, writes }),
    );
    await db.close();
    globalThis.Date = RealDate;
  }, 30000);
}
