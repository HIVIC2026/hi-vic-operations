import { test } from "bun:test";
import assert from "node:assert/strict";
import { canonicalMittiTemplateId, sameMittiTemplateId } from "../src/lib/mitti-identity.core";
import { buildPrefill, createOrReuseAudit, mittiApi, planSync, PIISA_A3_TEMPLATE_ID, type CreateCtx } from "../src/lib/mitti.core";
import { inspectSavedMittiForm } from "../src/lib/mitti-form-health.core";
import { createMittiBoundaryHarness, providerWrites, type DbResult, type ApiOperation } from "./helpers/mitti-boundary-harness";

// The observed A2 spelling is a regression fixture, never a production setting or seed.
const A2_UUID = "dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39";
const A2_ID = "template_dbaf67a2c9c541208c690f4a43c5bd39";
const OTHER = "template_22222222222222222222222222222222";
const AUDIT = "audit_fixture";
const JOB = "HV-1001";
const EMAIL = "installer@hivic.test";
const A3_UUID = PIISA_A3_TEMPLATE_ID.slice(9).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
const ctx: CreateCtx = {
  businessUnit: "hivic", stage: "ready_check_scheduled", jobNumber: JOB,
  existingAuditId: null, electricianEmail: EMAIL, assigneeRole: "installer", templateId: A2_UUID,
  prefill: { jobNumber: JOB, address: "1 Fixture Road, Melbourne, VIC 3000", ownerName: "TEST Owner", assessorName: "TEST Installer" },
};
const definition = (id: unknown = A2_ID) => ({ template: { template_id: id, name: "TEST A2", items: [
  { item_id: "job", label: "Portal Job Number", type: "textsingle" },
  { item_id: "address", label: "Site address", type: "address" },
  { item_id: "owner", label: "Owner name", type: "textsingle" },
  { item_id: "assessor", label: "Assessor", type: "textsingle" },
] } });
const audit = (over: Record<string, unknown> = {}) => ({
  audit_id: AUDIT, template_id: A2_ID,
  header_items: [{ item_id: "job", label: "Portal Job Number", responses: { text: JOB } }], items: [], ...over,
});
const ordinaryProvider = (doc: unknown = definition(), existing: unknown = audit()) => async (op: ApiOperation) => {
  if (op.path === "/users/search") return { users: [{ user_id: "user_fixture", email: EMAIL }] };
  if (op.method === "GET" && op.path.startsWith("/templates/")) return doc;
  if (op.path === "/audits" && op.method === "POST") return { audit_id: AUDIT };
  if (op.path === `/audits/${AUDIT}` && op.method === "GET") return existing;
  if (op.path.endsWith("/share") || op.path.endsWith("/owner")) return {};
  throw new Error(`Unexpected fixture operation: ${op.method} ${op.path}`);
};

test("only valid non-null Mitti identities match, regardless of supported spelling", () => {
  for (const invalid of [undefined, null, "", "   ", "template_invalid", "../other", {}, 123]) {
    assert.equal(canonicalMittiTemplateId(invalid), null);
    assert.equal(sameMittiTemplateId(invalid, invalid), false);
    assert.equal(sameMittiTemplateId(invalid, A2_ID), false);
    assert.equal(sameMittiTemplateId(A2_ID, invalid), false);
  }
  for (const id of [A2_UUID, A2_ID, A2_ID.slice(9), ` ${A2_UUID.toUpperCase()} `]) {
    assert.equal(sameMittiTemplateId(id, A2_ID), true);
    assert.equal(sameMittiTemplateId(id, OTHER), false);
  }
});

test("saved A2 UUID returned as template_ works through actual health, create, plan and reuse", async () => {
  const h = createMittiBoundaryHarness({ provider: ordinaryProvider() });
  const api = mittiApi(h.call);
  const health = await inspectSavedMittiForm({ key: "ready_check", savedId: A2_UUID, approvalBlocker: null },
    id => api.getTemplateDefinition(id), (_key, doc) => {
      const p = buildPrefill(doc, ctx.prefill);
      return { ok: p.missing.length === 0 && p.ambiguous.length === 0 && p.blank.length === 0, issues: p.missing };
    });
  assert.equal(health.ok, true); assert.equal(health.returnedId, A2_ID);
  const created = await createOrReuseAudit(api, ctx);
  assert.equal(created.auditId, AUDIT); assert.equal(created.prefillCount, 4);
  const payload = h.apiCalls.find(c => c.path === "/audits")!.body;
  assert.equal(payload.template_id, A2_UUID);
  assert.equal(payload.items.find((i: any) => i.item_id === "job").responses.text, JOB);
  const plan = planSync(audit(), { storedAuditId: AUDIT, jobNumber: JOB, assessmentStatus: "draft", templateId: A2_UUID });
  assert.equal(plan.locked, false);
  assert.equal("stage" in plan.patch!, false); assert.equal("status" in plan.patch!, false);
  h.apiCalls.length = 0;
  const reused = await createOrReuseAudit(api, { ...ctx, existingAuditId: AUDIT });
  assert.equal(reused.reused, true);
  assert.deepEqual(h.apiCalls.map(c => c.path), ["/users/search", `/audits/${AUDIT}`, `/audits/${AUDIT}/share`, `/inspections/v1/inspections/${AUDIT}/owner`]);
});

test("new audit creation rejects missing, invalid and different returned template identities before writes", async () => {
  for (const id of [null, "", "template_invalid", OTHER]) {
    const h = createMittiBoundaryHarness({ provider: ordinaryProvider(definition(id)) });
    await assert.rejects(createOrReuseAudit(mittiApi(h.call), ctx), /unexpected or unidentifiable template/);
    assert.deepEqual(providerWrites(h.apiCalls), []);
  }
});

test("an invalid configured template ID makes no provider request", async () => {
  const h = createMittiBoundaryHarness();
  await assert.rejects(createOrReuseAudit(mittiApi(h.call), { ...ctx, templateId: "template_invalid" }), /valid form ID/);
  assert.deepEqual(h.apiCalls, []);
});

const invalidAudits = [
  null, audit({ audit_id: undefined }), audit({ audit_id: "audit_other" }),
  audit({ template_id: undefined }), audit({ template_id: "invalid" }), audit({ template_id: OTHER }),
  audit({ header_items: [] }),
  audit({ header_items: [{ item_id: "job", label: "Portal Job Number", responses: { text: "HV-OTHER" } }] }),
  audit({ header_items: [
    { item_id: "job1", label: "Portal Job Number", responses: { text: JOB } },
    { item_id: "job2", label: "Portal Job Number", responses: { text: "HV-OTHER" } },
  ] }),
];

test("stored audit identity and same-job checks block reuse without share, owner change or replacement", async () => {
  for (const existing of invalidAudits) {
    const h = createMittiBoundaryHarness({ provider: ordinaryProvider(definition(), existing) });
    await assert.rejects(createOrReuseAudit(mittiApi(h.call), { ...ctx, existingAuditId: AUDIT }), /audit|template|Job Number/);
    assert.deepEqual(providerWrites(h.apiCalls), []);
    assert.deepEqual(h.dbCalls, []);
  }
});

test("unreadable stored audit blocks reuse without falling through to create", async () => {
  const h = createMittiBoundaryHarness({ provider: async op => {
    if (op.path === `/audits/${AUDIT}`) throw new Error("fixture audit read failure");
    return ordinaryProvider()(op);
  } });
  await assert.rejects(createOrReuseAudit(mittiApi(h.call), { ...ctx, existingAuditId: AUDIT }), /audit read failure/);
  assert.deepEqual(providerWrites(h.apiCalls), []);
});

test("sync uses the same positive identity checks while preserving completed-assessment immutability", () => {
  const context = { storedAuditId: AUDIT, jobNumber: JOB, assessmentStatus: "draft", templateId: A2_UUID };
  for (const doc of invalidAudits) assert.throws(() => planSync(doc, context), /audit|template|Job Number/);
  assert.throws(() => planSync(audit({ template_id: "bad" }), { ...context, templateId: "bad" }), /template/);
  assert.deepEqual(planSync(null, { ...context, assessmentStatus: "complete" }), { locked: true });
});

const connectedHealth = { ok: true, connection: "reachable", connectionMessage: "fixture", schemaIssues: [], approvalBlocker: null, templateName: "TEST A2", returnedId: A2_ID };
const adminContext = { supabase: { testRole: "admin" }, userId: "test_admin" };
function formHarness(options: { save?: DbResult; auditError?: boolean; health?: any; settings?: DbResult; officialBlocker?: string | null } = {}) {
  const healthCalls: unknown[][] = [];
  const h = createMittiBoundaryHarness({
    database: op => {
      if (op.table === "workflow_settings" && op.mode === "read") return options.settings ?? { data: { mitti_ready_check_template_id: A2_UUID }, error: null };
      if (op.table === "workflow_settings" && op.mode === "update") return options.save ?? { data: [{ id: 1, mitti_ready_check_template_id: A2_ID }], error: null };
      if (op.table === "admin_config_events" && op.mode === "insert") return { data: null, error: options.auditError ? { message: "fixture audit insert failed" } : null };
      throw new Error(`Unexpected form DB operation ${op.table}/${op.mode}`);
    },
    dependencies: {
      "./official-forms.core": { officialFormUseBlocker: () => options.officialBlocker ?? null },
      "./mitti-form-health.server": { checkMittiFormHealth: async (...args: unknown[]) => { healthCalls.push(args); return options.health ?? connectedHealth; } },
    },
  });
  return { ...h, healthCalls, functions: h.load("mitti-forms.functions") };
}
const connectData = { key: "ready_check", templateId: A2_UUID };

test("connect confirms the single saved row before audit and reports the provider's canonical identity", async () => {
  const h = formHarness();
  const result = await h.functions.connectMittiForm({ data: connectData, context: adminContext });
  assert.equal(result.ok, true); assert.equal(result.templateId, A2_ID);
  assert.deepEqual(h.healthCalls, [["ready_check", A2_UUID]]);
  assert.deepEqual(h.dbCalls.map(o => [o.table, o.mode]), [["workflow_settings", "update"], ["admin_config_events", "insert"]]);
  assert.deepEqual(h.dbCalls[0].filters, [["id", 1]]);
  assert.deepEqual(h.dbCalls[0].values, { mitti_ready_check_template_id: A2_UUID });
  assert.equal(h.dbCalls[1].values.details.template_id, A2_ID);
  assert.equal(h.dbCalls[1].values.details.verified_template_id, A2_ID);
});

test("zero rows, multiple rows, wrong row or wrong saved ID never claim success or create an audit entry", async () => {
  for (const data of [null, [], [{ id: 2, mitti_ready_check_template_id: A2_ID }],
    [{ id: 1, mitti_ready_check_template_id: A2_ID }, { id: 1, mitti_ready_check_template_id: A2_ID }],
    [{ id: 1 }], [{ id: 1, mitti_ready_check_template_id: null }], [{ id: 1, mitti_ready_check_template_id: OTHER }]]) {
    const h = formHarness({ save: { data, error: null } });
    await assert.rejects(h.functions.connectMittiForm({ data: connectData, context: adminContext }), /save could not be confirmed/);
    assert.deepEqual(h.dbCalls.map(o => o.mode), ["update"]);
  }
});

test("a settings update error blocks success and audit; audit failure reports the already-saved ID honestly", async () => {
  const failed = formHarness({ save: { data: null, error: { message: "fixture update failed" } } });
  await assert.rejects(failed.functions.connectMittiForm({ data: connectData, context: adminContext }), /Could not save/);
  assert.deepEqual(failed.dbCalls.map(o => o.mode), ["update"]);
  const partial = formHarness({ auditError: true });
  await assert.rejects(partial.functions.connectMittiForm({ data: connectData, context: adminContext }), /ID was saved, but its audit entry could not be recorded/);
  assert.deepEqual(partial.dbCalls.map(o => o.mode), ["update", "insert"]);
});

test("failed health or official approval blocks settings writes", async () => {
  const failed = formHarness({ health: { ...connectedHealth, ok: false, schemaIssues: ["Wrong template"] } });
  assert.equal((await failed.functions.connectMittiForm({ data: connectData, context: adminContext })).ok, false);
  assert.deepEqual(failed.dbCalls, []);
  const blocked = formHarness({ officialBlocker: "Fixture official approval pending" });
  const result = await blocked.functions.connectMittiForm({ data: { ...connectData, key: "piisa" }, context: adminContext });
  assert.equal(result.ok, false); assert.deepEqual(result.issues, ["Fixture official approval pending"]);
  assert.deepEqual(blocked.dbCalls, []); assert.deepEqual(blocked.healthCalls, []);
});

test("actual settings handlers require admin before any configuration read, health check or save", async () => {
  for (const name of ["getMittiForms", "checkSavedMittiForm", "connectMittiForm"]) {
    const h = formHarness();
    await assert.rejects(h.functions[name]({ data: connectData, context: { supabase: { testRole: "installer" } } }), /Admin access required/);
    assert.equal(h.authCalls.length, 1); assert.deepEqual(h.dbCalls, []); assert.deepEqual(h.healthCalls, []);
  }
});

test("saved-form health takes its ID from settings and performs no write; failed reads are explicit", async () => {
  const h = formHarness();
  await h.functions.checkSavedMittiForm({ data: { key: "ready_check", templateId: OTHER }, context: adminContext });
  assert.deepEqual(h.healthCalls, [["ready_check", A2_UUID]]);
  assert.deepEqual(h.dbCalls.map(o => o.mode), ["read"]);
  for (const settings of [{ data: null, error: null }, { data: null, error: { message: "fixture read failed" } }]) {
    const failed = formHarness({ settings });
    await assert.rejects(failed.functions.checkSavedMittiForm({ data: connectData, context: adminContext }), /could not be read/);
    await assert.rejects(failed.functions.getMittiForms({ context: adminContext }), /could not be loaded/);
    assert.deepEqual(failed.healthCalls, []); assert.equal(failed.dbCalls.every(o => o.mode === "read"), true);
  }
});

test("actual health server makes one template GET and preserves an official approval blocker", async () => {
  const h = createMittiBoundaryHarness({ provider: ordinaryProvider(), dependencies: {
    "./official-forms.core": { officialFormUseBlocker: () => "Fixture approval pending" },
    "./mitti-forms.core": { flattenDefinition: (doc: unknown) => doc, validateTemplate: () => ({ ok: true, issues: [] }) },
  } });
  const result = await h.load("mitti-form-health.server").checkMittiFormHealth("piisa", A2_UUID, h.call);
  assert.equal(result.identity, "verified"); assert.equal(result.ok, false); assert.equal(result.approvalBlocker, "Fixture approval pending");
  assert.deepEqual(h.apiCalls.map(c => [c.method, c.path]), [["GET", `/templates/v1/templates/${A2_UUID}`]]);
  assert.deepEqual(h.dbCalls, []); assert.deepEqual(h.eventCalls, []);
});

function piisaHarness(options: { configured?: string; previous?: string | null; existing?: unknown; previousReadError?: boolean; provider?: (op: ApiOperation) => Promise<unknown> } = {}) {
  const observed = { apChecks: 0, crewReads: 0 };
  const h = createMittiBoundaryHarness({
    database: op => {
      if (op.mode !== "read") throw new Error("Unexpected PIISA database mutation");
      if (op.table === "workflow_settings") return { data: { mitti_piisa_template_id: options.configured ?? A3_UUID }, error: null };
      if (op.table === "jobs") return { data: { job_number: JOB, business_unit: "hivic", stage: "installation_booked" }, error: null };
      if (op.table === "job_assignments") return { data: { user_id: "installer_fixture", profiles: { email: EMAIL } }, error: null };
      if (op.table === "workflow_events" && op.count) return { data: null, count: 1, error: null };
      if (op.table === "workflow_events") return { data: options.previous === null ? null : { details: { audit_id: options.previous ?? AUDIT } }, error: options.previousReadError ? { message: "fixture event read failed" } : null };
      throw new Error(`Unexpected PIISA fixture read ${op.table}`);
    },
    provider: options.provider ?? ordinaryProvider(definition(PIISA_A3_TEMPLATE_ID),
      Object.hasOwn(options, "existing") ? options.existing : audit({ template_id: PIISA_A3_TEMPLATE_ID })),
    dependencies: {
      "./official-forms.core": { officialFormUseBlocker: () => null, OFFICIAL_ITEMS: { piisa: [] } },
      "./official-prefill.core": { piisaPrefill: () => [] },
      "./official-forms.server": { officialPrefillContext: async () => ({}) },
      "./eligibility.server": { todayMelbourne: () => "2026-10-20" },
      "./prestart.server": { requirePrestartClear: async () => undefined },
      "./piisa-a3.core": {},
      "./piisa-a3.server": { loadCrew: async () => { observed.crewReads++; return { staff: [], selection: null }; } },
      "./piisa-ap.core": { ensurePiisaAp: async () => { observed.apChecks++; } },
    },
  });
  return { ...h, observed, server: h.load("mitti.server") };
}

test("PIISA reuses a canonical-equivalent template only after verifying the stored audit and same job", async () => {
  const h = piisaHarness();
  const result = await h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call);
  assert.equal(result.reused, true); assert.equal(result.auditId, AUDIT); assert.equal(h.observed.apChecks, 1);
  assert.deepEqual(h.apiCalls.map(c => c.path), ["/users/search", `/audits/${AUDIT}`, `/audits/${AUDIT}/share`, `/inspections/v1/inspections/${AUDIT}/owner`]);
  assert.equal(h.eventCalls.length, 1);
});

test("PIISA wrong audit, wrong job or unverifiable template blocks AP updates, sharing and owner changes", async () => {
  for (const existing of invalidAudits) {
    const h = piisaHarness({ configured: A2_UUID, existing });
    await assert.rejects(h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call), /audit|template|Job Number/);
    assert.deepEqual(providerWrites(h.apiCalls), []); assert.deepEqual(h.eventCalls, []); assert.equal(h.observed.apChecks, 0);
  }
});

test("an unreadable prior PIISA record never becomes permission to create a replacement", async () => {
  const h = piisaHarness({ previousReadError: true, previous: null });
  await assert.rejects(h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call), /existing PIISA audit could not be checked/);
  assert.deepEqual(h.apiCalls, []); assert.deepEqual(h.eventCalls, []);
});

test("an unreadable PIISA provider audit stops all effects", async () => {
  const h = piisaHarness({ provider: async op => {
    if (op.path === `/audits/${AUDIT}`) throw new Error("fixture PIISA read failed");
    return ordinaryProvider()(op);
  } });
  await assert.rejects(h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call), /PIISA read failed/);
  assert.deepEqual(providerWrites(h.apiCalls), []); assert.deepEqual(h.eventCalls, []); assert.equal(h.observed.apChecks, 0);
});

test("a UUID A3 selection enters the actual verified-crew branch before any form creation", async () => {
  for (const configured of [PIISA_A3_TEMPLATE_ID, A3_UUID.toUpperCase()]) {
    const h = piisaHarness({ configured, previous: null });
    await assert.rejects(h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call), /Choose the install crew/);
    assert.equal(h.observed.crewReads, 1);
    assert.deepEqual(providerWrites(h.apiCalls), []); assert.deepEqual(h.eventCalls, []);
  }
});

test("new PIISA refuses an unidentifiable or different returned form before any create", async () => {
  for (const id of [null, "bad", OTHER]) {
    const h = piisaHarness({ configured: A2_UUID, previous: null, provider: ordinaryProvider(definition(id)) });
    await assert.rejects(h.server.createPiisaMittiAudit("fixture_job", "test_admin", h.call), /unexpected or unidentifiable PIISA template/);
    assert.deepEqual(providerWrites(h.apiCalls), []); assert.deepEqual(h.eventCalls, []);
  }
});

test("missing Mitti credentials perform no HTTP request", async () => {
  const h = createMittiBoundaryHarness();
  await assert.rejects(h.load("mitti.server").realMittiCall("GET", `/templates/v1/templates/${A2_UUID}`), (error: any) => error.code === "not_configured");
  assert.deepEqual(h.httpCalls, []); assert.deepEqual(h.logs, []);
});

test("provider HTTP error bodies and credentials are neither read nor logged nor returned", async () => {
  for (const status of [401, 403, 404, 500]) {
    let bodyReads = 0;
    const h = createMittiBoundaryHarness({ token: "PRIVATE_TEST_TOKEN", fetch: async () => ({ ok: false, status,
      text: async () => { bodyReads++; return "PRIVATE_PROVIDER_BODY_WITH_OWNER_DETAILS"; },
    } as Response) });
    await assert.rejects(h.load("mitti.server").realMittiCall("GET", `/templates/v1/templates/${A2_UUID}`), (error: any) => {
      assert.equal(error.status, status); assert.doesNotMatch(error.message, /PRIVATE_/); return true;
    });
    assert.equal(bodyReads, 0);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_|dbaf67a2/);
    assert.equal(h.logs.length, 1);
  }
});

test("malformed provider JSON produces a fixed public error without response fragments", async () => {
  const h = createMittiBoundaryHarness({ token: "fixture_token", fetch: async () => new Response("PRIVATE_BAD_JSON_BODY", { status: 200 }) });
  await assert.rejects(h.load("mitti.server").realMittiCall("GET", `/audits/${AUDIT}`), (error: any) => {
    assert.equal(error.message, "Mitti returned an unreadable response."); assert.equal(error.code, "api_error"); return true;
  });
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_BAD_JSON_BODY/);
});

test("transport failures also return a sanitized error", async () => {
  const h = createMittiBoundaryHarness({ token: "fixture_token", fetch: async () => { throw new Error("PRIVATE_TRANSPORT_DETAILS"); } });
  await assert.rejects(h.load("mitti.server").realMittiCall("GET", `/audits/${AUDIT}`), (error: any) => {
    assert.equal(error.code, "unavailable"); assert.doesNotMatch(error.message, /PRIVATE_TRANSPORT/); return true;
  });
});
