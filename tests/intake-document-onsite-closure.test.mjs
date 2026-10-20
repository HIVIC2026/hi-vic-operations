// Focused actual-handler regressions for b0 attachment reconciliation and Ready Check measurement facts.
// PGlite stores real writes; the checked PostgREST shim injects a single I/O failure. No external calls.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.HIVIC_INTAKE_CLOSURE_SOURCE_ROOT || repo;
const base = process.env.HIVIC_INTAKE_CLOSURE_BASE_ROOT || root;
const require = process.env.HIVIC_INTAKE_CLOSURE_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_INTAKE_CLOSURE_DEPS_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const cache = new Map();
function load(file, dependencies = {}) {
  const path = existsSync(resolve(root, file)) ? resolve(root, file) : resolve(base, file);
  const source = readFileSync(path, "utf8");
  if (!cache.has(source)) {
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n"));
    cache.set(source, result.outputText);
  }
  const m = { exports: {} };
  new Function("require", "module", "exports", "crypto", "fetch", cache.get(source))(name => {
    if (!(name in dependencies)) throw new Error("Unexpected source dependency: " + name);
    return dependencies[name];
  }, m, m.exports, webcrypto, () => { throw new Error("No network allowed"); });
  return m.exports;
}
const details = load("src/lib/intake-quote-details.core.ts");
const intakeCore = load("src/lib/installer-intake.core.ts", {
  "./intake-quote-details.core": details, "./melbourne-time.core": { melbourneToday: () => "2026-10-20" }, // fixed clock
});
const commercial = load("src/lib/installer-quote-commercial.core.ts");
const siteCore = load("src/lib/site-conditions.core.ts");
const rcCore = load("src/lib/installer-ready-check.core.ts");
const { postgrestShim } = load("tests/helpers/pglite-postgrest-shim.ts");
const JOB = "00000000-0000-4000-8000-000000000001";
const OTHER_JOB = "00000000-0000-4000-8000-000000000002";
const BIZ = "00000000-0000-4000-8000-000000000010";
const ACTOR = "00000000-0000-4000-8000-000000000020";
const IMP = "00000000-0000-4000-8000-000000000030";
const upload = (name, purpose) => ({ path: "partners/" + BIZ + "/imports/" + name, name, type: "image/jpeg", ...(purpose ? { purpose } : {}) });
let db;
before(async () => { db = new PGlite(); await db.exec("\nCREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text, owner_id uuid, channel text, stage text, source text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date,\n  installer_quoted text, installer_quoted_price_inc_gst numeric, installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean,\n  measure_up_responsibility text, customer_relationship_owner text, source_system text, external_refs jsonb, commercial_model text, commercial_model_set_by uuid, commercial_model_set_at timestamptz);\nCREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, active boolean default true, user_id uuid, business_id uuid, assigned_by uuid, first_response_at timestamptz);\nCREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());\nCREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, created_by uuid, raw_snapshot jsonb, partner_method_id uuid,\n  source_role text, external_source text, external_id text, provenance text, measured_area_m2 numeric, removal_required boolean, removal_m2 numeric, existing_r_value numeric,\n  insulation_present boolean, supplied_area_m2 numeric, supplied_removal_m2 numeric, supplied_snapshot jsonb, measurement_method text, measurement_purpose text,\n  measured_by_name text, measured_by_role text, measured_by_business_id uuid, measured_on date, gross_area_m2 numeric, excluded_area_m2 numeric, confidence text,\n  review_flags jsonb, evidence_notes text, status text, verified_area_m2 numeric, notes text);\nCREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, created_by uuid, source_system text, method text, raw_text text, source_url text,\n  external_refs jsonb, files jsonb, extracted jsonb, status text default 'draft', confirmed_by uuid, confirmed_at timestamptz, confirmed_facts jsonb, created_at timestamptz default now(), updated_at timestamptz);\nCREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text);\nCREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, owner_id uuid, source text, consent_key text, consent_status text, contact_consent boolean,\n  consented_at timestamptz, snapshot jsonb, sha256 text, created_at timestamptz default now());\nCREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);\nCREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, original_name text, mime_type text, storage_path text, source_system text, external_id text, uploaded_by uuid, created_at timestamptz default now());\nCREATE TABLE workflow_settings (id int, measurement_standard_approved boolean);\nCREATE TABLE partner_measurement_methods (id uuid, business_id uuid, status text, approved_at timestamptz);\nCREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz);"); });
beforeEach(async () => {
  await db.exec("TRUNCATE jobs, job_assignments, workflow_events, ceiling_measurements, job_imports, quotes, owner_contact_consents, evidence_requirements, documents, bookings");
});
after(async () => { if (db) await db.close(); });

async function fixture(options = {}) {
  await db.query("INSERT INTO jobs (id, channel, stage, source, originating_installer_business_id, installer_site_check, installer_quoted, electrician_choice) VALUES ($1,'installer_sourced','ready_check_ready_to_schedule','qa_test',$2,$3,'no','hivic_organise')",
    [JOB, BIZ, options.attendance === undefined ? "yes" : options.attendance]);
  await db.query("INSERT INTO job_imports (id,job_id,business_id,files,status) VALUES ($1,$2,$3,$4,'confirmed')", [IMP, JOB, BIZ, JSON.stringify(options.files || [])]);
  await db.query("INSERT INTO ceiling_measurements (job_id,is_current,provenance,supplied_area_m2,verified_area_m2) VALUES ($1,true,$2,120,$3)",
    [JOB, options.provenance === undefined ? "installer_supplied_provisional" : options.provenance, options.verifiedArea ?? null]);
  for (const [type, d] of [
    ["installer_evidence_acknowledged", { proposed_r_value: null }],
    ["installer_existing_insulation_declared", { value: "none" }],
    ["installer_quote_answer", { answer: "not_quoted" }],
  ]) await db.query("INSERT INTO workflow_events (job_id,event_type,details) VALUES ($1,$2,$3)", [JOB, type, JSON.stringify(d)]);
  for (const doc of options.documents || []) await db.query("INSERT INTO documents (job_id,kind,title,original_name,storage_path) VALUES ($1,$2,$3,$4,$5)",
    [doc.jobId || JOB, doc.kind || "installer_import", doc.title, doc.file.name, doc.file.path]);
  for (const status of options.bookings || []) await db.query("INSERT INTO bookings (job_id,kind,status,scheduled_start) VALUES ($1,'ready_check',$2,'2026-10-21T01:00:00Z')", [JOB, status]);
  const failures = [...(options.documentFailures || [])];
  const calls = [], observedFacts = [];
  const shim = postgrestShim(db);
  const admin = { ...shim, from(table) {
    const b = shim.from(table);
    let op = "select", head = false;
    const filters = [];
    for (const method of ["insert", "update"]) {
      const original = b[method];
      b[method] = (...args) => { op = method; return original(...args); };
    }
    const select = b.select;
    b.select = (cols, opts) => { head = !!opts?.head; return select(cols, opts); };
    const eq = b.eq;
    b.eq = (key, value) => { filters.push([key, value]); return eq(key, value); };
    const run = b.run;
    b.run = async () => {
      calls.push({ table, op });
      if (table === "documents" && failures[0] === op) {
        failures.shift(); return { data: null, error: { message: "injected document " + op + " failure" } };
      }
      if (table === "bookings" && head && filters.some(([key, value]) => key === "status" && value === options.nullBookingCount))
        return { data: null, count: null, error: null };
      return run();
    };
    return b;
  } };
  const wf = { WorkflowError: class WorkflowError extends Error {},
    logEvent: async (job, actor, type, summary, d) => {
      await db.query("INSERT INTO workflow_events (job_id,actor_id,event_type,summary,details) VALUES ($1,$2,$3,$4,$5)",
        [job, actor, type, summary, JSON.stringify(d || {})]);
    },
  };
  const server = load("src/lib/installer-intake.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./workflow.server": wf,
    "./intake-quote-details.core": details, "./installer-quote-commercial.core": commercial,
    "./installer-intake.core": intakeCore, "./site-conditions.core": siteCore,
  });
  let windowReads = 0;
  const rc = load("src/lib/installer-ready-check.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./workflow.server": wf,
    "./worker-links.core": { newToken: () => { throw new Error("Unexpected token/provider operation"); } },
    "./installer-intake.core": intakeCore,
    "./installer-ready-check.core": { ...rcCore, installerReadyCheckAction: f => { observedFacts.push(f); return rcCore.installerReadyCheckAction(f); } },
    "./readycheck-booking.server": { readyCheckWindowRound: async () => { windowReads++; return { open: [] }; } },
  });
  const save = files => server.installerUpdateIntake(JOB, ACTOR, BIZ, {
    areaM2: 120, insulation: "none", quoteStatus: "not_quoted", quoteIncGst: null, includes: null, proposedR: null, files,
  });
  const files = async () => (await db.query("SELECT files FROM job_imports WHERE id=$1", [IMP])).rows[0].files;
  const documents = async () => (await db.query("SELECT job_id,kind,title,storage_path FROM documents ORDER BY storage_path,job_id,kind")).rows;
  const events = async type => Number((await db.query("SELECT count(*)::int n FROM workflow_events WHERE job_id=$1 AND event_type=$2", [JOB, type])).rows[0].n);
  return { save, files, documents, events, rc, failures, calls, observedFacts, windowReads: () => windowReads };
}

for (const failure of ["select", "insert"]) {
  test("edit repairs a missing document after its first " + failure + " failed, without duplicating the canonical file", async () => {
    const f = await fixture({ documentFailures: [failure] });
    const file = upload("later-quote.jpg", "quote");
    await assert.rejects(f.save([file]), /could not|couldn't/i);
    assert.deepEqual(await f.files(), [file], "canonical write precedes the injected document failure");
    assert.equal((await f.documents()).length, 0);
    await f.save([file]);
    await f.save([file]);
    assert.deepEqual(await f.files(), [file]);
    assert.deepEqual((await f.documents()).map(d => [d.kind, d.title, d.storage_path]), [["installer_import", "Installer quote — later-quote.jpg", file.path]]);
  });
}
test("explicit classification updates only this job's canonical import-document title and records one classification", async () => {
  const file = upload("earlier.jpg");
  const f = await fixture({ files: [file], documents: [
    { file, title: "Unclassified file — earlier.jpg" },
    { file, title: "Keep other job", jobId: OTHER_JOB },
    { file, title: "Keep other kind", kind: "other" },
  ] });
  await f.save([{ ...file, purpose: "quote" }]);
  await f.save([{ ...file, purpose: "quote" }]);
  assert.deepEqual(await f.files(), [{ ...file, purpose: "quote" }]);
  const docs = await f.documents();
  assert.equal(docs.find(d => d.job_id === JOB && d.kind === "installer_import").title, "Installer quote — earlier.jpg");
  assert.equal(docs.find(d => d.job_id === OTHER_JOB).title, "Keep other job");
  assert.equal(docs.find(d => d.kind === "other").title, "Keep other kind");
  assert.equal(await f.events("installer_file_classified"), 1);
});
test("a failed title update is repairable after classification already persisted", async () => {
  const file = upload("earlier.jpg");
  const f = await fixture({ files: [file], documents: [{ file, title: "Unclassified file — earlier.jpg" }], documentFailures: ["update"] });
  const request = [{ ...file, purpose: "supporting" }];
  await assert.rejects(f.save(request), /file labels/i);
  assert.deepEqual(await f.files(), request);
  assert.equal((await f.documents())[0].title, "Unclassified file — earlier.jpg");
  await f.save(request);
  assert.equal((await f.documents())[0].title, "Supporting evidence — earlier.jpg");
  assert.equal(await f.events("installer_file_classified"), 1);
});
test("attempted reclassification cannot change an existing supporting file or its document title", async () => {
  const file = upload("roof.jpg", "supporting");
  const f = await fixture({ files: [file], documents: [{ file, title: "Supporting evidence — roof.jpg" }] });
  await f.save([{ ...file, name: "fake quote.jpg", purpose: "quote" }]);
  assert.deepEqual(await f.files(), [file]);
  assert.equal((await f.documents())[0].title, "Supporting evidence — roof.jpg");
  assert.equal(await f.events("installer_file_classified"), 0);
});
test("one repeated path in the same edit makes one canonical file and one document", async () => {
  const f = await fixture();
  const file = upload("same.jpg", "supporting");
  await f.save([file, file]);
  assert.deepEqual(await f.files(), [file]);
  assert.equal((await f.documents()).length, 1);
});
for (const provenance of [null, "unrecognised"]) {
  test("actual Ready Check action asks for unknown attendance when provenance is " + String(provenance), async () => {
    const f = await fixture({ attendance: null, provenance });
    assert.equal((await f.rc.installerRcState(JOB)).action, "confirm_attendance");
    assert.equal(f.observedFacts[0].onsiteDone, false);
  });
}
test("explicit no supplies a false onsite-measurement fact despite stale verified onsite metadata", async () => {
  const f = await fixture({ attendance: "no", provenance: "hivic_onsite", verifiedArea: 120 });
  assert.equal((await f.rc.installerRcState(JOB)).action, "book");
  assert.equal(f.observedFacts[0].onsiteDone, false, "action core already respects no; the loader must also supply a truthful fact");
});
test("known onsite provenance and a verified area each settle unknown attendance", async () => {
  for (const options of [{ provenance: "hivic_onsite" }, { provenance: null, verifiedArea: 120 }]) {
    await db.exec("TRUNCATE jobs, workflow_events, ceiling_measurements, job_imports, bookings");
    const f = await fixture({ attendance: null, ...options });
    assert.equal((await f.rc.installerRcState(JOB)).action, "none");
  }
});
test("unrecognised saved attendance remains unknown in the action loader", async () => {
  const f = await fixture({ attendance: "quoted", provenance: "installer_supplied_provisional" });
  assert.equal((await f.rc.installerRcState(JOB)).action, "confirm_attendance");
  assert.equal(f.observedFacts[0].attended, null);
});
test("completed Ready Check evidence still settles unknown attendance", async () => {
  const f = await fixture({ attendance: null, provenance: null, bookings: ["completed"] });
  assert.equal((await f.rc.installerRcState(JOB)).action, "none");
  assert.equal(f.observedFacts[0].onsiteDone, true);
});
test("a confirmed booking remains visible despite explicit no and stale metadata", async () => {
  const f = await fixture({ attendance: "no", provenance: "hivic_onsite", bookings: ["confirmed"] });
  const state = await f.rc.installerRcState(JOB);
  assert.equal(state.action, "booked");
  assert.ok(state.bookedAt);
});
test("the previously merged missing exact-count guard still rejects both absent counts", async () => {
  for (const status of ["confirmed", "completed"]) {
    await db.exec("TRUNCATE jobs, workflow_events, ceiling_measurements, job_imports, bookings");
    const f = await fixture({ attendance: null, nullBookingCount: status });
    await assert.rejects(f.rc.installerRcState(JOB), /could not load/);
    assert.equal(f.windowReads(), 0);
  }
});

