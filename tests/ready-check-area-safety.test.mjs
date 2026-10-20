// Actual area handlers + PGlite, actual upload/review action bodies, and actual EvidencePanel/EvidenceRow rendering.
// Unrelated auth RPCs, storage bytes/location and workflow gates are isolated boundaries; no network or live data.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.HIVIC_AREA_SOURCE_ROOT || repo;
const require = process.env.HIVIC_AREA_DEPS_ROOT ? createRequire(resolve(process.env.HIVIC_AREA_DEPS_ROOT, "package.json")) : createRequire(import.meta.url);
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const read = file => readFileSync(resolve(root, file), "utf8");
const cache = new Map();
function actual(file, names) {
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const statements = ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(ast))));
  assert.equal(statements.length, names.length, "Every requested actual declaration must exist");
  return statements.map(n => n.getText(ast)).join("\n");
}
function load(file, dependencies = {}, selected = null, globals = {}) {
  const source = "const {" + Object.keys(globals).join(",") + "} = globals;\n" + (selected || read(file));
  const key = file + source;
  if (!cache.has(key)) {
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    cache.set(key, result.outputText);
  }
  const m = { exports: {} };
  new Function("require", "module", "exports", "globals", "crypto", "fetch", cache.get(key))(name => {
    if (!(name in dependencies)) throw new Error("Unexpected dependency " + name);
    return dependencies[name];
  }, m, m.exports, globals, webcrypto, () => { throw new Error("Network forbidden"); });
  return m.exports;
}
const areaCore = load("src/lib/ready-check-areas.core.ts");
const checkCore = load("src/lib/readycheck.core.ts");
const draftCore = load("src/lib/ready-check-draft.core.ts", { "./readycheck.core": checkCore });
const prestartCore = load("src/lib/prestart.core.ts", {
  "./esc.core": {}, "./piesa-windows.core": {}, // date/notification helpers are unrelated to these area tests
});
const { postgrestShim } = load("tests/helpers/pglite-postgrest-shim.ts");
const confirmation = load("src/lib/evidence-confirmation.server.ts");
const JOB = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const BIZ = "00000000-0000-4000-8000-000000000003";
const OFFICE = "00000000-0000-4000-8000-000000000004";
const areas = [
  { key: "main", label: "Main", areaM2: 50, existing: "present", rValue: null, removal: "yes", removalM2: 50, product: null, scope: null, sources: {} },
  { key: "garage", label: "Garage", areaM2: 30, existing: "none", rValue: null, removal: "no", removalM2: null, product: null, scope: null, sources: {} },
];
let db;
before(async () => {
  db = new PGlite();
  const original = ts.createSourceFile("test.ts", read("tests/ready-check-areas-db.test.ts"), ts.ScriptTarget.Latest, true);
  let schema;
  const visit = node => { if (!schema && ts.isCallExpression(node) && node.expression.getText(original) === "db.exec" && ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) schema = node.arguments[0].text; ts.forEachChild(node, visit); };
  visit(original); assert.ok(schema, "Use the original feature's practice schema");
  await db.exec(schema);
  await db.exec(read("docs/pending-migrations/0214_evidence_requirement_area_key.sql"));
  await db.exec("CREATE TABLE evidence_files (id uuid primary key, job_id uuid, requirement_id uuid, storage_path text, file_name text, mime_type text, size_bytes int, uploaded_by uuid, lat numeric, lng numeric, location_accuracy_m numeric, captured_at timestamptz, distance_m numeric, location_source text, uploaded_at timestamptz default now())");
});
beforeEach(async () => { await db.exec("TRUNCATE jobs, ready_checks, ready_check_observations, evidence_requirements, ceiling_measurements, documents, workflow_events, bookings, pre_start_checks, evidence_files"); });
after(async () => { if (db) await db.close(); });

async function fixture(options = {}) {
  await db.query("INSERT INTO jobs VALUES ($1)", [JOB]);
  const shim = postgrestShim(db);
  let restorationFailure = false, signedUploads = 0, byteChecks = 0;
  const admin = { ...shim, from(table) {
    const b = shim.from(table);
    let patch = null;
    const update = b.update; b.update = p => { patch = p; return update(p); };
    const run = b.run; b.run = () => {
      if (restorationFailure && table === "evidence_requirements" && patch?.status === "outstanding") {
        restorationFailure = false;
        return Promise.resolve({ data: null, error: { message: "Injected restoration write failure" } });
      }
      return run();
    };
    return b;
  }, storage: { from: bucket => {
    assert.equal(bucket, "job-files");
    return { createSignedUploadUrl: async path => { signedUploads++; return { data: { token: "private-test-token" }, error: null }; } };
  } } };
  class WorkflowError extends Error {}
  const wf = { WorkflowError, logEvent: async (job, actor, type, summary, details) => {
    await db.query("INSERT INTO workflow_events (job_id,event_type,summary,details) VALUES ($1,$2,$3,$4)", [job, type, summary, JSON.stringify(details || {})]);
  } };
  const intake = { isIntakeJob: async () => options.intake !== false, siteConditionsHoldFor: async () => ({ open: false, note: null }),
    installerIntakeState: async () => ({ attended: "yes", areaM2: 80, insulation: "below_r2", proposedR: null, includes: null, areaProvenance: "installer_provisional", coordination: "self_managed", readiness: { ready: false, blockers: [] }, releaseBlockers: [] }) };
  const server = load("src/lib/ready-check-draft.server.ts", { "./file-links.server": { signFile: async () => ({ data: { signedUrl: null } }) },
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./workflow.server": wf,
    "./ready-check-draft.core": draftCore, "./ready-check-areas.core": areaCore, "./installer-intake.server": intake,
  });
  const prestart = load("src/lib/prestart.server.ts", { "./ready-check-draft.server": server, "./installer-intake.server": intake },
    actual("src/lib/prestart.server.ts", ["upcomingBooking", "latestCheck", "prestartGate", "requirePrestartClear", "siteHoldBlockers"]),
    { admin, WorkflowError, prestartLocked: () => ({ locked: false, reasons: [] }) });
  const requestNames = ["requirementWithAccess", "requestEvidenceUpload", "confirmEvidenceUpload", "verifyEvidence"];
  const portal = load("src/lib/portal.functions.ts", {
    "./prestart.core": prestartCore,
    "./prestart.server": prestart, "./upload-safety.core": { allowedUpload: () => "image/jpeg" },
    "./upload-safety.server": { verifyStoredUpload: async () => { byteChecks++; } },
    "./evidence-confirmation.server": confirmation,
  }, actual("src/lib/portal.functions.ts", requestNames), {
    admin, WorkflowError, requireSupabaseAuth: {},
    createServerFn: () => { const c = { middleware: () => c, inputValidator: () => c, handler: fn => fn }; return c; },
    requireJobRole: async sb => { if (!sb.member) throw new WorkflowError("Not your business job"); return sb.office ? "admin" : "installer"; },
    requireAdmin: async sb => { if (!sb.office) throw new WorkflowError("Admin only"); },
    enforcePhotoLocation: async () => ({ distanceM: 0, exempt: false, role: "installer" }),
    logEvent: wf.logEvent, autoAdvanceJob: async () => {},
  });
  const reached = new Error("EXISTING_COMPLETION_GATES_REACHED");
  const workflow = load("src/lib/workflow.server.ts", { "./ready-check-draft.server": server, "./installer-intake.server": intake },
    actual("src/lib/workflow.server.ts", ["stageEntryBlockers"]), {
      retiredStageBlocker: () => null, readyCheckBlockers: async () => { throw reached; },
    });
  const save = input => server.saveRcAreas(JOB, USER, BIZ, input);
  await save(areas);
  const reqs = async () => (await db.query("SELECT * FROM evidence_requirements WHERE job_id=$1 ORDER BY area_key,category", [JOB])).rows;
  const beforeReq = async key => (await reqs()).find(r => r.area_key === key && r.category === "before_ceiling_space");
  const ctx = { userId: USER, supabase: { member: true, office: false } };
  const review = async (key, status) => portal.verifyEvidence({ data: { requirementId: (await beforeReq(key)).id, status }, context: { userId: OFFICE, supabase: { member: true, office: true } } });
  const fillGlobal = async () => {
    const rc = (await db.query("SELECT id FROM ready_checks WHERE job_id=$1", [JOB])).rows[0];
    for (const key of draftCore.RC_ORIGINAL_CONDITION_KEYS) {
      const f = draftCore.RC_DRAFT_FIELDS.find(f => f.key === key);
      const value = f.kind === "enum" ? f.options[0] : f.kind === "boolean" ? true : f.kind === "number" || f.kind === "integer" ? 80 : "test";
      await db.query("INSERT INTO ready_check_observations (ready_check_id,job_id,field_key,value) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [rc.id, JOB, key, JSON.stringify(value)]);
    }
  };
  return { admin, server, prestart, portal, workflow, reached, save, reqs, beforeReq, review, ctx, fillGlobal,
    failRestoration: () => { restorationFailure = true; }, counts: () => ({ signedUploads, byteChecks }) };
}

test("remove and re-add restores the same outstanding requirements; retries never waive or duplicate them", async () => {
  const f = await fixture(), ids = (await f.reqs()).map(r => r.id).sort();
  await f.save([]); await f.save(areas); await f.save(areas);
  const rows = await f.reqs();
  assert.deepEqual(rows.map(r => r.id).sort(), ids);
  assert.ok(rows.every(r => r.required && r.status === "outstanding"));
  assert.equal((await f.server.rcAreaWorksBlockers(JOB)).length, 2);
});
test("a failed restoration after saved areas remains blocked and the same save repairs it", async () => {
  const f = await fixture(); await f.save([]); f.failRestoration();
  await assert.rejects(f.save(areas), /restoration write failure/);
  assert.equal((await f.server.rcAreaWorksBlockers(JOB)).length, 2);
  await f.save(areas);
  assert.ok((await f.reqs()).every(r => r.required && r.status === "outstanding"));
});
test("Office acceptance and explicit waiver survive removal/re-add, with uploaded originals unchanged", async () => {
  const f = await fixture();
  const req = await f.beforeReq("main");
  await db.query("INSERT INTO evidence_files (id,job_id,requirement_id,storage_path,file_name) VALUES ($1,$2,$3,'original/private/photo.jpg','original.jpg')", [webcrypto.randomUUID(), JOB, req.id]);
  await f.review("main", "verified"); await f.review("garage", "not_required");
  const originals = (await db.query("SELECT * FROM evidence_files")).rows;
  await f.save([]); await f.save(areas);
  assert.deepEqual((await db.query("SELECT * FROM evidence_files")).rows, originals);
  assert.equal((await f.beforeReq("main")).status, "verified");
  assert.equal((await f.beforeReq("garage")).verified_by, OFFICE);
  assert.deepEqual(await f.server.rcAreaWorksBlockers(JOB), []);
});
test("actual upload/confirm stay open while Start is blocked; Office acceptance clears only the reviewed area", async () => {
  const f = await fixture(); await f.fillGlobal();
  await assert.rejects(f.prestart.requirePrestartClear(JOB), /original-condition evidence/);
  const main = await f.beforeReq("main"), garage = await f.beforeReq("garage");
  const up = await f.portal.requestEvidenceUpload({ data: { requirementId: main.id, fileName: "before.jpg", mimeType: "image/jpeg" }, context: f.ctx });
  const data = { requirementId: main.id, path: up.path, fileName: "before.jpg", mimeType: "image/jpeg", size: 16 };
  await f.portal.confirmEvidenceUpload({ data, context: f.ctx });
  await f.portal.confirmEvidenceUpload({ data, context: f.ctx });
  assert.equal((await db.query("SELECT count(*)::int n FROM evidence_files")).rows[0].n, 1);
  assert.equal((await f.beforeReq("main")).status, "uploaded");
  assert.equal((await f.server.rcAreaWorksBlockers(JOB)).length, 2, "An uploaded file is never accepted evidence");
  await assert.rejects(f.portal.confirmEvidenceUpload({ data: { ...data, requirementId: garage.id }, context: f.ctx }), /another evidence requirement/);
  await f.review("main", "verified");
  assert.deepEqual(await f.server.rcAreaWorksBlockers(JOB), ["Garage: original-condition evidence photo or video not uploaded"]);
  await f.review("garage", "verified");
  assert.deepEqual(await f.server.rcAreaWorksBlockers(JOB), []);
});
test("another business is refused before upload signing or evidence persistence", async () => {
  const f = await fixture(), req = await f.beforeReq("main"), context = { userId: USER, supabase: { member: false, office: false } };
  await assert.rejects(f.portal.requestEvidenceUpload({ data: { requirementId: req.id, fileName: "x.jpg", mimeType: "image/jpeg" }, context }), /Not your business job/);
  await assert.rejects(f.portal.confirmEvidenceUpload({ data: { requirementId: req.id, path: JOB + "/before_ceiling_space/x.jpg", fileName: "x.jpg", mimeType: "image/jpeg", size: 16 }, context }), /Not your business job/);
  assert.deepEqual(f.counts(), { signedUploads: 0, byteChecks: 0 });
  assert.equal((await db.query("SELECT count(*)::int n FROM evidence_files")).rows[0].n, 0);
});
test("saved areas block legacy Start; old intake-only global answers remain intake-only", async () => {
  const f = await fixture({ intake: false });
  await assert.rejects(f.prestart.requirePrestartClear(JOB), /Main: original-condition evidence/);
  await f.review("main", "verified"); await f.review("garage", "verified");
  assert.deepEqual(await f.server.rcWorksBlockers(JOB), [], "Legacy job has no global draft answers");
  await f.prestart.requirePrestartClear(JOB);
});
test("intake global-answer guard is retained after all area evidence is accepted", async () => {
  const f = await fixture(); await f.review("main", "verified"); await f.review("garage", "verified");
  assert.ok((await f.server.rcWorksBlockers(JOB)).length > 0);
  await assert.rejects(f.prestart.requirePrestartClear(JOB), /record the original ceiling condition/);
});
test("completion rereads rejected area evidence despite a prior passed pre-start snapshot", async () => {
  const f = await fixture(); await f.review("main", "verified");
  await db.query("UPDATE evidence_requirements SET status='rejected' WHERE job_id=$1 AND area_key='garage' AND category='before_ceiling_space'", [JOB]);
  await db.query("INSERT INTO pre_start_checks (job_id,passed,failures) VALUES ($1,true,'[]')", [JOB]);
  const result = await f.workflow.stageEntryBlockers(JOB, "evidence_outstanding", USER);
  assert.deepEqual(result, ["Garage: original-condition evidence rejected — upload again"]);
});
test("completion fails on an unreadable area schema; cleared areas still reach the existing completion gates", async () => {
  const f = await fixture();
  await db.exec("ALTER TABLE evidence_requirements RENAME COLUMN area_key TO area_key_missing");
  try { await assert.rejects(f.workflow.stageEntryBlockers(JOB, "evidence_outstanding", USER), /pending database update/); }
  finally { await db.exec("ALTER TABLE evidence_requirements RENAME COLUMN area_key_missing TO area_key"); }
  await f.review("main", "verified"); await f.review("garage", "verified");
  await assert.rejects(f.workflow.stageEntryBlockers(JOB, "evidence_outstanding", USER), e => e === f.reached);
});

function renderEvidence(rows) {
  const jsx = (type, props) => typeof type === "function" ? type(props || {}) : { type, props: props || {} };
  const noop = () => {};
  const ui = load("src/components/portal/panels.tsx", { "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" } },
    actual("src/components/portal/panels.tsx", ["EvidencePanel", "EvidenceRow"]), {
      useQuery: () => ({ data: rows, isPending: false, isError: false }),
      useRef: value => ({ current: value }), useState: value => [value, noop], useQueryClient: () => ({}),
      useServerFn: () => noop, useAction: () => noop, useReasonDialog: () => ({ dialog: null }),
      requestEvidenceUpload: noop, confirmEvidenceUpload: noop, verifyEvidence: noop, getEvidenceUrl: noop,
      Section: "section", Button: "button", Input: "input", Pill: "status", FileUp: "upload-icon", Paperclip: "file-icon",
      EVIDENCE_STATUS_LABEL: { outstanding: "Missing", rejected: "Rejected", uploaded: "Review", verified: "Accepted", not_required: "Waived" },
    });
  const tree = ui.EvidencePanel({ jobId: JOB, role: "measure", gates: ["assessment"] });
  const collect = node => Array.isArray(node) ? node.flatMap(collect) : node && typeof node === "object" ? [node, ...collect(node.props?.children)] : [];
  return collect(tree);
}
const uiReq = (p = {}) => ({ id: "r", area_key: "main", label: "Main before", category: "before_ceiling_space", gate: "assessment", responsible_role: "installer", status: "outstanding", required: true, notes: null, evidence_files: [], ...p });
test("the actual Ready Check evidence controls expose before-work uploads for missing and rejected area photos", () => {
  for (const status of ["outstanding", "rejected"]) {
    const nodes = renderEvidence([uiReq({ status })]);
    assert.equal(nodes.filter(n => n.type === "input" && n.props.type === "file").length, 1);
  }
});
test("the Ready Check control fix retains party/category boundaries and accepted-file immutability", () => {
  for (const p of [{ responsible_role: "electrician" }, { area_key: null }, { status: "verified" }, { status: "not_required" }, { category: "completed_installation", gate: "installation" }])
    assert.equal(renderEvidence([uiReq(p)]).filter(n => n.type === "input" && n.props.type === "file").length, 0);
  assert.equal(renderEvidence([uiReq({ area_key: null, category: "measurement", responsible_role: "electrician" })]).filter(n => n.type === "input" && n.props.type === "file").length, 1);
});
