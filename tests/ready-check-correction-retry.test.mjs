// Focused regressions executing the actual Ready Check handlers and pure rules against PGlite.
// Read/copy failures are real PostgreSQL errors. Intake facts and eligibility are controlled boundaries;
// logEvent writes to this practice database. No production database, credentials, provider or network calls.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.HIVIC_RC_VERSION_SOURCE_ROOT || repo;
const require = process.env.HIVIC_RC_VERSION_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_RC_VERSION_DEPS_ROOT, "package.json")) : createRequire(import.meta.url);
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
function load(file, dependencies = {}, sourceRoot = root) {
  assert.ok(existsSync(resolve(sourceRoot, file)), "Missing actual source: " + file);
  const result = ts.transpileModule(readFileSync(resolve(sourceRoot, file), "utf8"), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n"));
  const m = { exports: {} };
  new Function("require", "module", "exports", "crypto", "fetch", result.outputText)(name => {
    if (!(name in dependencies)) throw new Error("Unexpected source dependency: " + name);
    return dependencies[name];
  }, m, m.exports, webcrypto, () => { throw new Error("No network allowed"); });
  return m.exports;
}
const rcCore = load("src/lib/readycheck.core.ts");
const draftCore = load("src/lib/ready-check-draft.core.ts", { "./readycheck.core": rcCore });
const areasCore = load("src/lib/ready-check-areas.core.ts");
// Both baseline and candidate use the same shim. Explicit JSON columns model scalar JSON strings as PostgREST does.
const { postgrestShim } = load("tests/helpers/pglite-postgrest-shim.ts", {}, repo);
const JOB = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000020";
const AUTHOR = "00000000-0000-4000-8000-000000000021";
const BIZ = "00000000-0000-4000-8000-000000000030";
const RC = "00000000-0000-4000-8000-000000000040";
const ORIGINAL_TIME = "2026-10-15T01:00:00.000Z";
let db, server, eligible = false, pauseNextCopy = null;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
CREATE TABLE jobs (id uuid primary key);
CREATE TABLE ready_checks (id uuid primary key default gen_random_uuid(), job_id uuid, version int, status text,
  installer_user_id uuid, installer_business_id uuid, external_mitti_id text, submitted_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique(job_id, version));
CREATE TABLE ready_check_observations (id uuid primary key default gen_random_uuid(), ready_check_id uuid, job_id uuid,
  field_key text, value jsonb, recorded_by uuid, recorded_at timestamptz default now(), unique(ready_check_id, field_key), constraint rc_obs_key check (field_key ~ '^(attendance|measure|insulation|removal|access|elec)\.[a-z0-9_]+$'));
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text,
  label text, gate text, required boolean, status text, verified_by uuid, verified_at timestamptz, notes text, sort int default 0, area_key text);
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean,
  removal_required boolean, removal_m2 numeric, supplied_removal_m2 numeric, created_by uuid, created_at timestamptz default now());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, uploaded_by uuid, created_at timestamptz default now());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text,
  summary text, details jsonb, created_at timestamptz default now());
CREATE FUNCTION fail_correction_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('hivic_test.fail_copy', true) = 'on' THEN RAISE EXCEPTION 'practice database copy failed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_failure BEFORE INSERT ON ready_check_observations FOR EACH ROW EXECUTE FUNCTION fail_correction_copy();
`);
  const shim = postgrestShim(db, { jsonColumns: { ready_check_observations: ["value"] } });
  const admin = { ...shim, from(table) {
    const b = shim.from(table); let copying = false;
    for (const method of ["insert", "upsert"]) {
      const original = b[method];
      b[method] = (value, ...args) => { copying = table === "ready_check_observations" && Array.isArray(value); return original(value, ...args); };
    }
    const run = b.run;
    b.run = async () => {
      if (copying && pauseNextCopy) { const pause = pauseNextCopy; pauseNextCopy = null; pause.reached(); await pause.release; }
      return run();
    };
    return b;
  } };
  server = load("src/lib/ready-check-draft.server.ts", { "./file-links.server": { signFile: async () => ({ data: { signedUrl: null } }) },
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./workflow.server": { WorkflowError: class WorkflowError extends Error {}, logEvent: async (job, actor, type, summary, details) => {
      await query("INSERT INTO workflow_events(job_id,actor_id,event_type,summary,details) VALUES($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details || {})]);
    } },
    "./ready-check-draft.core": draftCore,
    "./ready-check-areas.core": areasCore,
    "./installer-intake.server": { installerIntakeState: async () => ({ attended: "yes", areaM2: 80, insulation: "unknown",
      proposedR: null, includes: null, areaProvenance: "installer_provisional", coordination: "self_managed",
      readiness: { ready: false, blockers: [] }, releaseBlockers: [] }), isIntakeJob: async () => true },
    "./verified-eligibility.server": { verifiedEligible: async () => eligible },
  });
});
beforeEach(async () => {
  eligible = false; pauseNextCopy = null;
  await db.exec("SET hivic_test.fail_copy = 'off'; TRUNCATE jobs,ready_checks,ready_check_observations,evidence_requirements,ceiling_measurements,documents,workflow_events");
});
after(async () => { if (db) await db.close(); });

async function seed(options = {}) {
  await query("INSERT INTO jobs VALUES($1)", [JOB]);
  await query("INSERT INTO ready_checks(id,job_id,version,status,installer_user_id,installer_business_id,external_mitti_id,submitted_at,updated_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$7)",
    [RC, JOB, options.status || "submitted", AUTHOR, BIZ, options.mitti || null, ORIGINAL_TIME]);
  const values = {
    "measure.eligible_area_m2": 80,
    "insulation.existing": "present",
    "measure.areas_v1": { areas: [{ key: "main", label: "Main", areaM2: 80, existing: "present", rValue: 1,
      removal: "yes", removalM2: 20, product: "R4", scope: "Ceiling", sources: {
        areaM2: { kind: "recorded_onsite", by: AUTHOR, at: ORIGINAL_TIME } } }] },
  };
  for (const [key, value] of Object.entries(values)) await query("INSERT INTO ready_check_observations(ready_check_id,job_id,field_key,value,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6)",
    [RC, JOB, key, JSON.stringify(value), AUTHOR, ORIGINAL_TIME]);
}
const versions = () => query("SELECT id,version,status,submitted_at,updated_at FROM ready_checks ORDER BY version");
const original = async () => ({ row: (await query("SELECT * FROM ready_checks WHERE id=$1", [RC]))[0],
  answers: await query("SELECT * FROM ready_check_observations WHERE ready_check_id=$1 ORDER BY field_key", [RC]) });
const answers = id => query("SELECT field_key,value,recorded_by,recorded_at FROM ready_check_observations WHERE ready_check_id=$1 AND field_key <> 'measure.correction_copy_v1' ORDER BY field_key", [id]);
const completionEvents = () => query("SELECT actor_id,details,summary,created_at FROM workflow_events WHERE event_type='ready_check_correction_started'");
async function assertCopied(id) {
  assert.deepEqual(await answers(id), await answers(RC), "answers, area sources and original recorder/time are copied intact");
  const loaded = await server.loadRcDraft(JOB);
  assert.equal(loaded.readyCheckId, id);
  assert.equal(loaded.values["measure.eligible_area_m2"], "80");
  assert.equal(loaded.areas[0].sources.areaM2.by, AUTHOR);
}
async function failCopy(call) {
  await db.exec("SET hivic_test.fail_copy = 'on'");
  try { await assert.rejects(call(), /copy|copied/i); }
  finally { await db.exec("SET hivic_test.fail_copy = 'off'"); }
}

test("existing Office reopen creates a dated correction and never rewrites the submitted version", async () => {
  await seed(); const before = await original();
  await server.reopenRcDraft(JOB, ACTOR, "Correct the removal area");
  assert.deepEqual(await original(), before, "submitted header, submission time and observations remain unchanged");
  const rows = await versions(); assert.equal(rows.length, 2); assert.equal(rows[1].status, "draft");
  await assertCopied(rows[1].id);
  await server.reopenRcDraft(JOB, ACTOR, "Correct the removal area");
  assert.equal((await versions()).length, 2);
  const events = await completionEvents(); assert.equal(events.length, 1);
  assert.equal(events[0].actor_id, ACTOR); assert.equal(events[0].details.from_ready_check_id, RC);
  assert.match(events[0].summary, /Correct the removal area/);
  assert.ok(new Date(events[0].created_at) > new Date(ORIGINAL_TIME));
});

for (const method of ["startRcCorrection", "reopenRcDraft"]) test(method + " resumes a real failed copy into the same version without duplicate answers", async () => {
  await seed(); const before = await original();
  const call = () => server[method](JOB, ACTOR, "Correct the removal area");
  await failCopy(call);
  const pending = await versions(); assert.equal(pending.length, 2); assert.equal(pending[1].status, "draft");
  assert.equal((await answers(pending[1].id)).length, 0, "failed multirow statement copied nothing");
  assert.deepEqual(await original(), before);
  await call(); await call();
  assert.deepEqual((await versions()).map(r => r.id), pending.map(r => r.id));
  await assertCopied(pending[1].id);
  assert.deepEqual(await original(), before);
  assert.equal((await completionEvents()).length, 1);
  const duplicate = await query("SELECT field_key FROM ready_check_observations WHERE ready_check_id=$1 GROUP BY field_key HAVING count(*)>1", [pending[1].id]);
  assert.deepEqual(duplicate, []);
});

test("a failed correction cannot be loaded or overwritten as an empty editable draft", async () => {
  await seed();
  await failCopy(() => server.startRcCorrection(JOB, ACTOR, "Correct measurements"));
  const pending = (await versions())[1];
  await assert.rejects(server.loadRcDraft(JOB), /still being copied/);
  await assert.rejects(server.saveRcDraft(JOB, ACTOR, BIZ, {}), /still being copied/);
  await assert.rejects(server.saveRcAreas(JOB, ACTOR, BIZ, []), /still being copied/);
  await assert.rejects(server.rcAreaWorksBlockers(JOB), /still being copied/);
  assert.equal((await query("SELECT * FROM ready_check_observations WHERE ready_check_id=$1", [pending.id])).length, 0);
  await server.startRcCorrection(JOB, ACTOR, "Correct measurements");
  await assertCopied(pending.id);
  assert.ok((await server.rcAreaWorksBlockers(JOB)).some(message => /Main/.test(message)), "copied area still requires its original-condition evidence");
});

test("simultaneous correction requests reuse one version and one completion event", async () => {
  await seed(); const before = await original();
  const responses = await Promise.all([server.startRcCorrection(JOB, ACTOR, "Correct area"), server.startRcCorrection(JOB, ACTOR, "Correct area")]);
  assert.equal(responses[0].readyCheckId, responses[1].readyCheckId);
  assert.equal((await versions()).length, 2);
  await assertCopied(responses[0].readyCheckId);
  assert.equal((await completionEvents()).length, 1);
  assert.deepEqual(await original(), before);
});

test("retrying a completed correction never restores answers deliberately cleared afterward", async () => {
  await seed();
  const first = await server.startRcCorrection(JOB, ACTOR, "Correct area");
  await server.saveRcDraft(JOB, ACTOR, BIZ, {});
  assert.equal((await answers(first.readyCheckId)).filter(r => r.field_key === "measure.eligible_area_m2").length, 0);
  await server.startRcCorrection(JOB, ACTOR, "Correct area");
  assert.equal((await answers(first.readyCheckId)).filter(r => r.field_key === "measure.eligible_area_m2").length, 0);
  assert.equal((await versions()).length, 2);
});

test("a delayed overlapping copy cannot restore an answer cleared after another request completed", async () => {
  await seed();
  let reached, release;
  const waiting = new Promise(resolve => { reached = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  pauseNextCopy = { reached, release: released };
  const slow = server.startRcCorrection(JOB, ACTOR, "Correct area");
  let fast;
  try {
    await waiting;
    fast = await server.startRcCorrection(JOB, ACTOR, "Correct area");
    await server.saveRcDraft(JOB, ACTOR, BIZ, {});
  } finally { release(); }
  await slow;
  assert.equal((await answers(fast.readyCheckId)).filter(r => r.field_key === "measure.eligible_area_m2").length, 0);
  assert.equal((await versions()).length, 2);
  assert.equal((await completionEvents()).length, 1);
});

test("a row collision without a completion marker refuses, then retry preserves the existing row and attribution", async () => {
  await seed(); const before = await original();
  let reached, release;
  const waiting = new Promise(resolve => { reached = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  pauseNextCopy = { reached, release: released };
  const slow = server.startRcCorrection(JOB, ACTOR, "Correct area");
  await waiting;
  const pending = (await versions())[1];
  const [existing] = await query("INSERT INTO ready_check_observations(ready_check_id,job_id,field_key,value,recorded_by,recorded_at) VALUES($1,$2,'measure.eligible_area_m2','75',$3,'2026-10-19T01:00:00Z') RETURNING *", [pending.id, JOB, ACTOR]);
  release();
  await assert.rejects(slow, /could not be copied|duplicate key/);
  await assert.rejects(server.loadRcDraft(JOB), /still being copied/);
  assert.equal((await completionEvents()).length, 0);
  await server.startRcCorrection(JOB, ACTOR, "Correct area");
  assert.deepEqual((await query("SELECT * FROM ready_check_observations WHERE id=$1", [existing.id]))[0], existing);
  assert.equal((await answers(pending.id)).length, 3);
  assert.equal((await versions()).length, 2);
  assert.equal((await completionEvents()).length, 1);
  assert.deepEqual(await original(), before);
});

test("an earlier successful correction with its existing history event remains usable without refilling answers", async () => {
  await seed();
  const [v2] = await query("INSERT INTO ready_checks(job_id,version,status,installer_user_id) VALUES($1,2,'draft',$2) RETURNING id", [JOB, ACTOR]);
  await query("INSERT INTO workflow_events(job_id,event_type,details) VALUES($1,'ready_check_correction_started',$2)", [JOB, JSON.stringify({ ready_check_id: v2.id, from_ready_check_id: RC })]);
  const result = await server.startRcCorrection(JOB, ACTOR, "Continue correction");
  assert.equal(result.readyCheckId, v2.id);
  assert.equal((await answers(v2.id)).length, 0, "completed correction may intentionally have cleared its answers");
  assert.equal((await versions()).length, 2);
});

test("the Office eligibility restriction still refuses reopen without writes", async () => {
  await seed(); eligible = true; const before = await original();
  await assert.rejects(server.reopenRcDraft(JOB, ACTOR, "Correct area"), /Needs office review/);
  assert.equal((await versions()).length, 1); assert.deepEqual(await original(), before);
});

test("the direct dated-correction entry also preserves the Office eligibility restriction", async () => {
  await seed(); eligible = true; const before = await original();
  await assert.rejects(server.startRcCorrection(JOB, ACTOR, "Correct area"), /Needs office review/);
  assert.equal((await versions()).length, 1); assert.deepEqual(await original(), before);
  assert.equal((await completionEvents()).length, 0);
});

test("Mitti-owned submitted and draft rows are refused before correction writes", async () => {
  await seed({ mitti: "form-123" }); const before = await original();
  await assert.rejects(server.reopenRcDraft(JOB, ACTOR, "Correct area"), /Mitti/);
  await assert.rejects(server.startRcCorrection(JOB, ACTOR, "Correct area"), /Mitti/);
  assert.deepEqual(await original(), before);
  await query("UPDATE ready_checks SET status='draft' WHERE id=$1", [RC]);
  await assert.rejects(server.startRcCorrection(JOB, ACTOR, "Correct area"), /Mitti/);
  assert.equal((await versions()).length, 1);
});

test("a real submitted-answer read failure refuses before any correction version is created", async () => {
  await seed();
  await db.exec("ALTER TABLE ready_check_observations RENAME TO observations_unavailable");
  try { await assert.rejects(server.startRcCorrection(JOB, ACTOR, "Correct area")); }
  finally { await db.exec("ALTER TABLE observations_unavailable RENAME TO ready_check_observations"); }
  assert.equal((await versions()).length, 1);
  assert.equal((await completionEvents()).length, 0);
});
