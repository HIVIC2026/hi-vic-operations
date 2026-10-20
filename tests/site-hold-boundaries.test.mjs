// Actual production function bodies executed in an isolated Node VM. No auth sessions, provider calls or database writes.
// Run: node --experimental-vm-modules --test --test-isolation=none tests/site-hold-boundaries.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = process.env.HIVIC_HOLD_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFileSync(path.join(root, "src/lib", name + ".ts"), "utf8");
const JOB = "00000000-0000-0000-0000-000000000001", QID = "00000000-0000-0000-0000-000000000002";
const RAISED = "site_conditions_differ_raised", CLEARED = "site_conditions_differ_cleared";
const OPEN = { id: "hold", job_id: JOB, event_type: RAISED, created_at: "2026-10-20T10:00:00.000Z", details: { note: "Extra roof void" } };
const QUEUED = { id: "queue", job_id: JOB, event_type: "installer_quote_queued", created_at: "2026-10-20T08:00:00.000Z", details: { quote_id: QID } };
const quote = () => ({ id: QID, job_id: JOB, kind: "installation", option_code: "INSTALLER_A1", status: "issued", release_state: "held", release_hold_reason: "Site conditions differ", sent_at: null, accepted_at: null, accepted_by: null, version: 3, customer_total_inc_gst: 1287.45, subtotal_inc_gst: 4500, veec_discount_inc_gst: 3212.55 });
const clone = (x) => structuredClone(x);
const contains = (actual, wanted) => Array.isArray(wanted) ? Array.isArray(actual) && wanted.every((v) => actual.some((a) => contains(a, v))) : wanted && typeof wanted === "object" ? actual && Object.entries(wanted).every(([k, v]) => contains(actual[k], v)) : actual === wanted;

function database(options = {}) {
  const tables = {
    quotes: [quote()],
    workflow_settings: [{ id: 1, auto_send_quote: true, customer_comms_enabled: true }],
    workflow_events: [clone(QUEUED), ...(options.open ? [clone(OPEN)] : [])],
    customer_agreements: [], invoices: [], quote_items: [{ id: "item", quote_id: QID, line_total_inc_gst: 4500 }],
    pre_start_checks: [{ job_id: JOB, passed: true }],
    ...clone(options.tables ?? {}),
  };
  const reads = [], writes = [];
  let raceUsed = false;
  const admin = { from(table) {
    const q = { table, filters: [], head: false, singleRow: false, changes: null, orderBy: null, maximum: null,
      select(_fields, opt = {}) { this.head = !!opt.head; return this; },
      eq(key, value) { this.filters.push(["eq", key, value]); return this; },
      is(key, value) { this.filters.push(["eq", key, value]); return this; },
      in(key, value) { this.filters.push(["in", key, value]); return this; },
      not(key, op, value) { assert.equal(op, "in"); this.filters.push(["notin", key, value.slice(1, -1).split(",")]); return this; },
      contains(key, value) { this.filters.push(["contains", key, value]); return this; },
      order(key, opt = {}) { this.orderBy = [key, opt.ascending !== false]; return this; },
      limit(n) { this.maximum = n; return this; },
      maybeSingle() { this.singleRow = true; return this; },
      single() { this.singleRow = true; return this; },
      update(changes) { this.changes = clone(changes); return this; },
      async then(resolve, reject) {
        try {
          if (!tables[table]) throw new Error("Unexpected table " + table);
          reads.push({ table, filters: clone(this.filters), head: this.head, update: !!this.changes });
          if (options.fail?.(this)) return resolve({ data: null, count: null, error: { message: "Injected checked database failure" } });
          if (this.changes && options.beforeUpdate && !raceUsed) { raceUsed = true; options.beforeUpdate(tables); }
          let rows = tables[table].filter((row) => this.filters.every(([op, key, val]) => op === "eq" ? row[key] === val : op === "in" ? val.includes(row[key]) : op === "notin" ? !val.includes(row[key]) : contains(row[key], val)));
          if (this.orderBy) { const [key, asc] = this.orderBy; rows = rows.slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (asc ? 1 : -1)); }
          if (this.maximum != null) rows = rows.slice(0, this.maximum);
          if (this.changes) { for (const row of rows) Object.assign(row, this.changes); writes.push({ table, changes: clone(this.changes), matched: rows.length, filters: clone(this.filters) }); }
          resolve({ data: this.head ? null : this.singleRow ? clone(rows[0] ?? null) : clone(rows), count: options.nullCount?.(this) ? null : rows.length, error: null });
        } catch (e) { reject(e); }
      },
    };
    return q;
  } };
  return { tables, reads, writes, admin };
}

function declaration(text, name, optional = false) {
  const marker = new RegExp("(?:export )?async function " + name + "\\(");
  const found = marker.exec(text);
  if (!found) { if (optional) return ""; throw new Error("Missing actual source declaration " + name); }
  const end = text.indexOf("\n}", found.index);
  if (end < 0) throw new Error("Missing source boundary " + name);
  return text.slice(found.index, end + 2);
}
function serverFn(text, name) {
  const start = text.indexOf("export const " + name + " = createServerFn");
  const end = text.indexOf("\n  });", start);
  if (start < 0 || end < 0) throw new Error("Missing server action " + name);
  return text.slice(start, end + 7);
}

async function harness(options = {}) {
  const db = database(options);
  const reached = new Error("EXISTING_GATES_REACHED");
  let agreementWrites = 0, authorizations = 0;
  const deps = {
    admin: db.admin, WorkflowError: class WorkflowError extends Error {},
    logEvent: async (job, actor, type, summary, details) => { db.tables.workflow_events.push({ id: "audit-" + db.tables.workflow_events.length, job_id: job, actor_id: actor, event_type: type, summary, details: clone(details), created_at: new Date().toISOString() }); },
    installerIntakeState: async () => ({ readiness: { blockers: options.intakeBlockers ?? [] }, releaseBlockers: options.releaseBlockers ?? [] }),
    retiredStageBlocker: () => null,
    readyCheckBlockers: async () => { throw reached; },
    getStage: async () => "awaiting_quote_acceptance",
    assertAgreementCanSign: async () => undefined,
    signCustomerAgreement: async () => { agreementWrites++; throw reached; },
    commercialBlocker: async () => null,
    piesaStatus: async () => ({ piesa_expired: false }),
    requireSupabaseAuth: {}, z: {}, uuid: "uuid",
    createServerFn: () => { const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn) => fn }; return chain; },
  };
  const ctx = vm.createContext({ deps, Date, console, fetch: () => { throw new Error("Network is forbidden in this test"); } });
  const modules = new Map(), pending = new Map();
  const fields = Object.keys(deps).join(",");
  const bodies = {
    "./installer-intake.server": ["isIntakeJob", "siteConditionsHoldFor", "intakeSendBlockers"].map((n) => declaration(source("installer-intake.server"), n)).join("\n"),
    "./quotes.server": declaration(source("quotes.server"), "requireUnsentQueuedQuote", true) + "\n" + ["approveHeldQuote", "releaseQueuedQuotes"].map((n) => declaration(source("quotes.server"), n)).join("\n"),
    "./workflow.boundary": declaration(source("workflow.server"), "stageEntryBlockers"),
    "./owner.boundary": declaration(source("portal.functions"), "respondToQuoteImpl"),
    "./admin.boundary": declaration(source("workflow.server"), "requireAdmin") + "\n" + serverFn(source("portal.functions"), "approveHeldQuote"),
    "./site-conditions.core": source("site-conditions.core"),
  };
  const mocks = {
    "./ready-check-draft.server": { rcAreaWorksBlockers: async () => [] }, // unrelated area facts; actual area guard has its own PGlite regressions
    "./installer-quote.server": { quoteBillingBlocker: async () => options.billingBlocker ?? null },
    "./owner-quote-visibility.core": { ownerQuoteReleased: (q) => q.status === "issued" && q.release_state === "released" && !!q.sent_at, QUOTE_NOT_RELEASED: "Quote not released" },
    "./quote-expiry.core": { quoteIsExpired: () => false },
  };
  function get(id) {
    if (modules.has(id)) return modules.get(id);
    let mod;
    if (mocks[id]) { const values = mocks[id]; mod = new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { identifier: id, context: ctx }); }
    else {
      if (!(id in bodies)) throw new Error("Unexpected module boundary " + id);
      const code = "const {" + fields + "} = deps;\n" + bodies[id];
      mod = new vm.SourceTextModule(stripTypeScriptTypes(code, { mode: "transform" }), { identifier: id, context: ctx, importModuleDynamically: async (spec) => { const m = get(spec); await evaluate(m); return m; } });
    }
    modules.set(id, mod); return mod;
  }
  async function evaluate(mod) {
    if (pending.has(mod.identifier)) return pending.get(mod.identifier);
    const p = (async () => { if (mod.status === "unlinked") await mod.link((spec) => get(spec)); if (mod.status === "linked") await mod.evaluate(); return mod.namespace; })();
    pending.set(mod.identifier, p); return p;
  }
  const intake = await evaluate(get("./installer-intake.server"));
  const quotes = await evaluate(get("./quotes.server"));
  return { ...db, intake, quotes, reached, load: async (id) => evaluate(get(id)),
    owner: async () => {
      const mod = await evaluate(get("./owner.boundary"));
      return mod.respondToQuoteImpl({ quoteId: QID, accept: true, consent: true, signing: { assistance: "none" } }, { userId: "owner", ip: null, userAgent: null, authorize: async () => { authorizations++; }, isOwner: async () => true });
    }, stats: () => ({ agreementWrites, authorizations }),
  };
}
const unchanged = (h, before) => { assert.deepEqual(h.tables.quotes, before); assert.equal(h.writes.length, 0); };
const approved = (h) => h.quotes.approveHeldQuote(QID, "office");
const isHoldRead = (q) => q.table === "workflow_events" && q.filters.some(([op, key, val]) => op === "in" && key === "event_type" && val.includes(RAISED));

test("legacy supplied job: open hold blocks the shared quote guard", async () => {
  const h = await harness({ open: true });
  const blockers = await h.intake.intakeSendBlockers(JOB);
  assert.equal(blockers.length, 1); assert.match(blockers[0], /Site conditions differ.*Extra roof void/);
});
test("legacy supplied job: unreadable hold history fails closed", async () => {
  const h = await harness({ fail: isHoldRead });
  await assert.rejects(h.intake.intakeSendBlockers(JOB), /site conditions review history could not load/);
});
test("owner acceptance rechecks a legacy hold before writing any agreement", async () => {
  const q = { ...quote(), release_state: "released", sent_at: "2026-10-20T09:00:00Z" };
  const h = await harness({ open: true, tables: { quotes: [q] } }), before = clone(h.tables.quotes);
  await assert.rejects(h.owner(), /Site conditions differ/); unchanged(h, before);
  assert.equal(h.stats().authorizations, 1); assert.equal(h.stats().agreementWrites, 0);
});
test("owner acceptance fails closed on unreadable legacy hold history", async () => {
  const h = await harness({ fail: isHoldRead, tables: { quotes: [{ ...quote(), release_state: "released", sent_at: "2026-10-20T09:00:00Z" }] } });
  await assert.rejects(h.owner(), /site conditions review history could not load/); assert.equal(h.stats().agreementWrites, 0);
});
test("draft approval also blocks a non-intake hold", async () => {
  const h = await harness({ open: true, tables: { quotes: [{ ...quote(), status: "draft" }] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /Site conditions differ/); unchanged(h, before);
});
test("queue release also blocks a non-intake hold without setting sent_at", async () => {
  const h = await harness({ open: true, tables: { quotes: [{ ...quote(), release_state: "queued" }] } });
  const result = await h.quotes.releaseQueuedQuotes();
  assert.equal(result.released, 0); assert.equal(h.tables.quotes[0].sent_at, null); assert.equal(h.tables.quotes[0].release_state, "held");
});
test("explicit Office recovery returns a proven unsent quote to queued; amounts are preserved", async () => {
  const h = await harness(), before = clone(h.tables.quotes[0]), items = clone(h.tables.quote_items);
  const result = await approved(h);
  assert.equal(result.releaseState, "queued"); assert.equal(h.tables.quotes[0].sent_at, null);
  for (const key of ["customer_total_inc_gst", "subtotal_inc_gst", "veec_discount_inc_gst", "version"]) assert.equal(h.tables.quotes[0][key], before[key]);
  assert.deepEqual(h.tables.quote_items, items);
  assert.equal(h.tables.workflow_events.filter((e) => e.event_type === "quote_requeued_after_review").length, 1);
  await assert.rejects(approved(h), /Only a held/);
  assert.equal(h.tables.workflow_events.filter((e) => e.event_type === "quote_requeued_after_review").length, 1);
});
test("recovered quote is released once by the existing guarded sender", async () => {
  const h = await harness(); await approved(h);
  assert.equal((await h.quotes.releaseQueuedQuotes()).released, 1);
  assert.equal((await h.quotes.releaseQueuedQuotes()).released, 0);
  assert.equal(h.tables.workflow_events.filter((e) => e.event_type === "installation_quote_released").length, 1);
});
test("a new hold after requeue is checked again by the sender", async () => {
  const h = await harness(); await approved(h); h.tables.workflow_events.push(clone(OPEN));
  assert.equal((await h.quotes.releaseQueuedQuotes()).released, 0);
  assert.equal(h.tables.quotes[0].sent_at, null); assert.equal(h.tables.quotes[0].release_state, "held");
});
for (const [name, patch] of [
  ["sent timestamp", { sent_at: "2026-10-20T09:00:00Z" }],
  ["accepted timestamp", { accepted_at: "2026-10-20T09:00:00Z" }],
  ["accepted actor", { accepted_by: "owner" }],
  ["accepted status", { status: "accepted" }],
  ["released state", { release_state: "released" }],
]) test("recovery refuses " + name, async () => {
  const h = await harness({ tables: { quotes: [{ ...quote(), ...patch }] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /sent or accepted|Only a held/); unchanged(h, before);
});
for (const type of ["installation_quote_released", "installer_quote_sent", "QUOTE_ACCEPTED", "quote_hold_approved"]) test("recovery refuses conflicting audit " + type, async () => {
  const h = await harness({ tables: { workflow_events: [clone(QUEUED), { ...clone(QUEUED), id: "conflict", event_type: type }] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /not proven|Only a held/); unchanged(h, before);
});
test("recovery also checks quote_ids audit records", async () => {
  const h = await harness({ tables: { workflow_events: [clone(QUEUED), { ...clone(QUEUED), event_type: "installation_quote_released", details: { quote_ids: [QID] } }] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /not proven|Only a held/); unchanged(h, before);
});
for (const table of ["customer_agreements", "invoices"]) test("recovery refuses existing " + table, async () => {
  const h = await harness({ tables: { [table]: [{ id: "existing", quote_id: QID, status: "signed" }] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /not proven|Only a held/); unchanged(h, before);
});
test("recovery requires positive Office queue provenance", async () => {
  const h = await harness({ tables: { workflow_events: [] } }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /not proven|Only a held/); unchanged(h, before);
});
for (const table of ["workflow_events", "customer_agreements", "invoices"]) test("recovery fails closed when history read fails: " + table, async () => {
  const h = await harness({ fail: (q) => q.table === table && q.head }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /history could not be checked|Only a held/); unchanged(h, before);
});
test("recovery fails closed on a missing exact count", async () => {
  const h = await harness({ nullCount: (q) => q.table === "customer_agreements" && q.head }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /history could not be checked|Only a held/); unchanged(h, before);
});
test("recovery keeps live site hold, intake consent and billing blockers", async () => {
  for (const options of [
    { open: true },
    { tables: { workflow_events: [clone(QUEUED), { ...clone(QUEUED), event_type: "installer_evidence_acknowledged", details: {} }] }, releaseBlockers: ["Owner contact consent missing"] },
    { billingBlocker: "Electrical payer changed; quote needs review" },
  ]) {
    const h = await harness(options), before = clone(h.tables.quotes);
    await assert.rejects(approved(h), /Site conditions differ|Owner contact consent|Electrical payer|Only a held/); unchanged(h, before);
  }
});
test("recovery compare-and-set refuses a quote sent during review", async () => {
  const h = await harness({ beforeUpdate: (tables) => { tables.quotes[0].sent_at = "2026-10-20T11:00:00Z"; } });
  await assert.rejects(approved(h), /changed during review|Only a held/);
  assert.equal(h.tables.workflow_events.filter((e) => e.event_type === "quote_requeued_after_review").length, 0);
  assert.equal(h.tables.quotes[0].release_state, "held");
});
test("recovery write errors never return a successful approval", async () => {
  const h = await harness({ fail: (q) => q.table === "quotes" && !!q.changes }), before = clone(h.tables.quotes);
  await assert.rejects(approved(h), /database failure|Only a held/); unchanged(h, before);
});
test("the actual Office server action denies non-admin before reading quote history", async () => {
  const h = await harness(), action = await h.load("./admin.boundary");
  await assert.rejects(action.approveHeldQuote({ data: { quoteId: QID }, context: { userId: "rec", supabase: { rpc: async () => ({ data: false, error: null }) } } }), /Admin only/);
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});
test("completion transition blocks the live hold despite a passed earlier pre-start check", async () => {
  const h = await harness({ open: true }), stage = await h.load("./workflow.boundary");
  const blockers = await stage.stageEntryBlockers(JOB, "evidence_outstanding");
  assert.match(blockers[0], /Site conditions differ.*Extra roof void/);
  assert.equal(h.tables.pre_start_checks[0].passed, true); assert.equal(h.writes.length, 0);
});
test("completion transition fails closed when the live hold cannot be read", async () => {
  const h = await harness({ fail: isHoldRead }), stage = await h.load("./workflow.boundary");
  await assert.rejects(stage.stageEntryBlockers(JOB, "evidence_outstanding"), /site conditions review history could not load/);
  assert.equal(h.writes.length, 0);
});
test("a later Office clear delegates completion to the existing gates", async () => {
  const h = await harness({ tables: { workflow_events: [clone(OPEN), { ...clone(OPEN), event_type: CLEARED, created_at: "2026-10-20T11:00:00Z" }] } }), stage = await h.load("./workflow.boundary");
  await assert.rejects(stage.stageEntryBlockers(JOB, "evidence_outstanding"), (e) => e === h.reached);
});
test("unrelated stage checks do not read or clear the site hold", async () => {
  const h = await harness({ open: true }), stage = await h.load("./workflow.boundary");
  await assert.rejects(stage.stageEntryBlockers(JOB, "ready_check_scheduled"), (e) => e === h.reached);
  assert.equal(h.reads.length, 0); assert.equal(h.tables.workflow_events.filter((e) => e.event_type === RAISED).length, 1);
});

