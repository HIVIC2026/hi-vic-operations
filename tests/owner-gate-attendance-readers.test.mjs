// Actual fact readers and rule modules. Only I/O boundaries are isolated; no provider or live database calls.
// PGlite stores the canonical nullable jobs.installer_site_check column; unrelated Office data is a read-only fixture.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, webcrypto } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.HIVIC_ATTENDANCE_READER_SOURCE_ROOT || repo;
const base = process.env.HIVIC_ATTENDANCE_READER_BASE_ROOT || root;
const require = process.env.HIVIC_ATTENDANCE_READER_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_ATTENDANCE_READER_DEPS_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const codeCache = new Map();
function load(file, dependencies = {}) {
  const path = existsSync(resolve(root, file)) ? resolve(root, file) : resolve(base, file);
  const source = readFileSync(path, "utf8");
  if (!codeCache.has(source)) {
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n"));
    codeCache.set(source, result.outputText);
  }
  const m = { exports: {} };
  new Function("require", "module", "exports", "crypto", "fetch", codeCache.get(source))(name => {
    if (!(name in dependencies)) throw new Error("Unexpected source dependency: " + name);
    return dependencies[name];
  }, m, m.exports, webcrypto, () => { throw new Error("No network allowed"); });
  return m.exports;
}
const core = load("src/lib/owner-gates.core.ts");
const rcCore = load("src/lib/installer-ready-check.core.ts");
const intakeCore = load("src/lib/installer-intake.core.ts", {
  "./intake-quote-details.core": load("src/lib/intake-quote-details.core.ts"),
  "./melbourne-time.core": { melbourneToday: () => "2026-10-20" }, // fixed clock
});
let db;
const JOB = "00000000-0000-4000-8000-000000000001";
before(async () => {
  db = new PGlite();
  // Read-boundary practice table: the nullable text attendance column matches generated Supabase types.
  await db.exec("CREATE TABLE jobs (id text PRIMARY KEY, source text NOT NULL, life_support boolean, installer_site_check text)");
});
after(async () => { if (db) await db.close(); });

async function fixture(options = {}) {
  await db.query("INSERT INTO jobs (id, source, life_support, installer_site_check) VALUES ($1, 'qa_test', false, $2) ON CONFLICT (id) DO UPDATE SET installer_site_check = EXCLUDED.installer_site_check", [JOB, options.attendance ?? null]);
  const calls = [], observedOfficeFacts = [];
  const baseKeys = options.unsigned ? [] : ["contact_privacy", "trade_contact_share", "details_confirmation", "life_support_answer"];
  if (options.visitSigned) baseKeys.push("visit_permission");
  const signatures = core.GATE_DOCS.filter(d => baseKeys.includes(d.key)).map((d, i) => ({
    id: "signature-" + i, job_id: JOB, doc_key: d.key, doc_version: d.version, doc_draft: false,
    answers: {}, signed_at: "2026-10-20T00:00:00Z",
  }));
  const approvals = core.GATE_DOCS.map(d => ({ doc_key: d.key, doc_version: d.version, body_sha256: createHash("sha256").update(d.body).digest("hex") }));
  const realJob = async () => {
    const row = (await db.query("SELECT * FROM jobs WHERE id = $1", [JOB])).rows[0];
    return { ...row, channel: "installer_sourced", stage: options.stage || "ready_check_scheduled", installer_quoted: "yes",
      job_number: "TEST-ATTENDANCE", created_at: "2026-10-20T00:00:00Z", last_activity_at: "2026-10-20T00:00:00Z",
      qa_archived_at: null, deleted_at: null, owners: { full_name: "TEST owner" }, properties: { suburb: "TEST", postcode: "3000" } };
  };
  async function rows(table) {
    if (table === "jobs") return [await realJob()];
    if (table === "owner_gate_signatures") return signatures;
    if (table === "owner_paperwork_approvals") return approvals;
    if (table === "bulk_import_rows") return options.bulkStage ? [{ id: "legacy-row", job_id: JOB, import_stage: options.bulkStage }] : [];
    if (table === "owner_contact_consents") return options.onsite ? [{ id: "onsite", job_id: JOB, source: "onsite_ready_check", consent_status: "granted" }] : [];
    if (table === "workflow_settings") return [{ id: 1, office_time_limits: {} }];
    if (table === "bookings") return options.booked > 0 ? [{ id: "booking", job_id: JOB, kind: "ready_check", status: "confirmed", scheduled_start: "2026-10-21T00:00:00Z" }] : [];
    return [];
  }
  const admin = { from(table) {
    const q = { table, cols: "*", filters: [], mode: null, head: false, start: 0, end: Infinity, limit: Infinity };
    const b = {
      select(cols = "*", opts = {}) { q.cols = cols; q.head = !!opts.head; return b; },
      eq(key, value) { q.filters.push({ key, value, matches: row => row[key] === value }); return b; },
      neq(key, value) { q.filters.push({ key, value, matches: row => row[key] !== value }); return b; },
      in(key, values) { q.filters.push({ key, value: values, matches: row => values.includes(row[key]) }); return b; },
      is(key, value) { q.filters.push({ key, value, matches: row => row[key] === value }); return b; },
      not(key, op, value) { q.filters.push({ key, value, matches: row => op === "is" ? row[key] !== value : true }); return b; },
      contains(key, value) { q.filters.push({ key, value, matches: row => Object.entries(value).every(([k, v]) => row[key]?.[k] === v) }); return b; },
      or() { return b; },
      order() { return b; },
      range(start, end) { q.start = start; q.end = end; return b; },
      limit(n) { q.limit = n; return b; },
      single() { q.mode = "one"; return b; },
      maybeSingle() { q.mode = "maybe"; return b; },
      insert() { throw new Error("Unexpected mutation: insert " + table); },
      update() { throw new Error("Unexpected mutation: update " + table); },
      delete() { throw new Error("Unexpected mutation: delete " + table); },
      async run() {
        calls.push({ table, cols: q.cols, head: q.head, filters: q.filters.map(({ key, value }) => ({ key, value })) });
        if (table === "jobs" && options.jobError) return { data: null, error: { message: "read unavailable" } };
        if (table === "jobs" && options.jobMissing) return { data: q.mode ? null : [], error: null };
        if (table === "bookings" && q.head) {
          const completed = q.filters.some(f => f.key === "status" && f.value === "completed");
          return { data: null, count: completed ? (options.done === undefined ? 0 : options.done) : (options.booked === undefined ? 0 : options.booked),
            error: (completed ? options.doneError : options.bookedError) ? { message: "count unavailable" } : null };
        }
        let data = (await rows(table)).filter(row => q.filters.every(f => f.matches(row)));
        const count = data.length;
        data = data.slice(q.start, q.end + 1).slice(0, q.limit);
        if (q.head) return { data: null, count, error: null };
        if (q.cols !== "*") {
          const fields = q.cols.split(/,(?![^(]*\))/).map(k => k.trim().split("(")[0]);
          data = data.map(row => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]])));
        }
        return { data: q.mode ? (data[0] ?? null) : data, count, error: null };
      },
      then(yes, no) { return b.run().then(yes, no); },
    };
    return b;
  }};
  class WorkflowError extends Error {}
  const unexpected = () => { throw new Error("Unexpected provider or mutation"); };
  const wf = { WorkflowError, logEvent: unexpected, agreementSigned: async () => false, assignmentStatus: async () => "pending" };
  const server = load("src/lib/owner-gates.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "pdf-lib": {},
    "./payment-gate.core": {}, "./owner-gates.core": core, "./workflow.server": wf,
  });
  const office = load("src/lib/office.server.ts", {
    "./melbourne-time.core": { melbourneToday: () => "2026-10-20" },
    "./office-status.core": { limits: () => ({}), officeStatus: () => null },
    "./needs-me.core": { buildNeedsMe: facts => facts, movedFromTodo: () => [] },
    "./trade-choice.core": { chosenTradeNoAnswer: () => null },
    "./owner-gates.core": { ...core, evaluateOwnerGates: facts => { observedOfficeFacts.push(facts); return core.evaluateOwnerGates(facts); } },
    "./owner-gates.server": server,
  });
  let windowsRead = 0;
  const readyCheck = load("src/lib/installer-ready-check.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./workflow.server": wf,
    "./worker-links.core": { newToken: unexpected }, "./installer-ready-check.core": rcCore,
    "./installer-intake.core": intakeCore,
    "./readycheck-booking.server": { readyCheckWindowRound: async () => { windowsRead++; return { open: [] }; } },
  });
  return { admin, server, office, readyCheck, calls, observedOfficeFacts, windowsRead: () => windowsRead };
}
function noBulkRead(f) { assert.equal(f.calls.filter(c => c.table === "bulk_import_rows").length, 0); }
const gateA = result => result.gates.find(g => g.gate === "A");

test("owner reader keeps unsupported saved attendance values unknown instead of treating a quote or file as a visit", async () => {
  for (const attendance of [null, "quoted", "visited", "photo.jpg"]) {
    const f = await fixture({ attendance });
    assert.equal((await f.server.gateFacts(JOB)).visitedByInstaller, null);
  }
});
test("owner reader: quoted bulk with explicit no does not ask the owner to confirm an earlier visit", async () => {
  const f = await fixture({ attendance: "no", bulkStage: "quoted" });
  const r = await f.server.ownerGates(JOB);
  assert.equal(r.facts.visitedByInstaller, false); assert.equal(gateA(r).complete, true);
  assert.ok(!core.ownerToSign(r.gates).some(d => d.key === "visit_permission")); noBulkRead(f);
});
test("owner reader: attended single job requires Earlier visit until its genuine signature exists", async () => {
  const f = await fixture({ attendance: "yes" });
  const r = await f.server.ownerGates(JOB);
  assert.equal(r.facts.visitedByInstaller, true);
  assert.ok(core.ownerToSign(r.gates).some(d => d.key === "visit_permission"));
  await assert.rejects(f.server.assertGateA(JOB, "TEST visit"), /Earlier visit/);
  assert.equal(await f.server.gateAComplete(JOB), false);
  assert.ok((await f.server.ownerGateStageBlockers(JOB, "ready_check_scheduled")).some(x => /Earlier visit/.test(x)));
  const signed = await fixture({ attendance: "yes", visitSigned: true });
  assert.equal(await signed.server.gateAComplete(JOB), true); noBulkRead(f);
});
test("owner reader: null history stays null despite an old quoted bulk row", async () => {
  const f = await fixture({ attendance: null, bulkStage: "quoted" });
  const r = await f.server.ownerGates(JOB);
  assert.equal(r.facts.visitedByInstaller, null);
  assert.ok(!gateA(r).items.some(d => d.key === "visit_permission")); noBulkRead(f);
});
test("owner reader rejects a failed canonical job read instead of returning invented visit facts", async () => {
  const f = await fixture({ attendance: "yes", jobError: true });
  await assert.rejects(f.server.gateFacts(JOB), /could not load/);
});
test("owner reader rejects a missing expected job even when no transport error is supplied", async () => {
  const f = await fixture({ jobMissing: true });
  await assert.rejects(f.server.gateFacts(JOB), /could not be found/);
});
test("the existing onsite-consent override is preserved", async () => {
  const f = await fixture({ attendance: "yes", unsigned: true, onsite: true });
  const r = await f.server.ownerGates(JOB);
  assert.equal(r.facts.onsiteConsent, true); assert.equal(gateA(r).complete, true);
  assert.deepEqual(gateA(r).items.map(d => d.key), ["onsite_consent"]);
});
test("no visit never waives the existing base owner signatures", async () => {
  const f = await fixture({ attendance: "no", unsigned: true });
  await assert.rejects(f.server.assertGateA(JOB, "TEST visit"), /Contact and privacy/);
});
test("Office reader: explicit no overrides old quoted bulk stage without an Earlier visit failure", async () => {
  const f = await fixture({ attendance: "no", bulkStage: "quoted" });
  const r = await f.office.loadOffice(f.admin, { includeTest: true, onlyIds: [JOB] });
  assert.equal(f.observedOfficeFacts[0].visitedByInstaller, false);
  assert.ok(!r.jobs[0].needs.failures.some(x => /Earlier visit/.test(x))); noBulkRead(f);
});
test("Office reader: attended single job shows its missing Earlier visit signature", async () => {
  const f = await fixture({ attendance: "yes" });
  const r = await f.office.loadOffice(f.admin, { includeTest: true, onlyIds: [JOB] });
  assert.equal(f.observedOfficeFacts[0].visitedByInstaller, true);
  assert.ok(r.jobs[0].needs.failures.some(x => /Earlier visit/.test(x))); noBulkRead(f);
});
test("Office reader preserves null attendance in its gate facts despite an old quoted stage", async () => {
  const f = await fixture({ attendance: null, bulkStage: "quoted" });
  await f.office.loadOffice(f.admin, { includeTest: true, onlyIds: [JOB] });
  assert.equal(f.observedOfficeFacts[0].visitedByInstaller, null); noBulkRead(f);
});
test("Office reader still rejects an unreadable job page", async () => {
  const f = await fixture({ jobError: true });
  await assert.rejects(f.office.loadOffice(f.admin, { includeTest: true, onlyIds: [JOB] }), /Could not load jobs/);
});
for (const [name, options] of [
  ["confirmed booking count null", { booked: null }],
  ["completed booking count null", { done: null }],
  ["confirmed booking read error", { bookedError: true }],
  ["completed booking read error", { doneError: true }],
]) test("Ready Check rejects " + name + " before choosing an action", async () => {
  const f = await fixture({ attendance: "no", stage: "ready_check_ready_to_schedule", ...options });
  await assert.rejects(f.readyCheck.installerRcState(JOB), /Ready Check status could not load/);
  assert.equal(f.windowsRead(), 0);
});
test("Ready Check exact zero counts remain valid and allow the current booking prompt", async () => {
  const f = await fixture({ attendance: "no", stage: "ready_check_ready_to_schedule", booked: 0, done: 0 });
  assert.equal((await f.readyCheck.installerRcState(JOB)).action, "book");
});
test("Ready Check confirmed booking stays visible even when attendance is yes", async () => {
  const f = await fixture({ attendance: "yes", stage: "new_enquiry", booked: 1, done: 0 });
  const r = await f.readyCheck.installerRcState(JOB);
  assert.equal(r.action, "booked"); assert.equal(r.bookedAt, "2026-10-21T00:00:00Z");
});
test("Ready Check completed evidence still settles unknown attendance without a repeat visit prompt", async () => {
  const f = await fixture({ attendance: null, stage: "new_enquiry", booked: 0, done: 1 });
  assert.equal((await f.readyCheck.installerRcState(JOB)).action, "none");
});

