import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as core from "../src/lib/fixes-day.core";
import * as mitti from "../src/lib/mitti.core";
import * as inHouse from "../src/lib/in-house.core";
import * as identity from "../src/lib/mitti-identity.core";
import * as claimsCore from "../src/lib/mitti-create-claim.core";
import * as autoCore from "../src/lib/piesa-autoform.core";
import * as short from "../src/lib/official-short.core";
import * as allocation from "../src/lib/allocation.core";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let calls: { method: string; path: string; body: any }[];
let failCreate = false;
let held = true;
let quoteWrites = 0;
let claimHeld = false;
const JOB = "job", EMAIL = "electrician@example.invalid", PIESA = `template_${"a".repeat(32)}`, RECT = `template_${"b".repeat(32)}`;
class WorkflowError extends Error {}
class MittiClaimHeld extends Error {}
class MittiOutcomeUncertain extends Error {}
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op = "read", patch: any, single = false, count = false, limit = Infinity;
  const q: any = {
    select: (_c: string, o: any) => { count = o?.count === "exact"; return q; },
    eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    neq: (k: string, v: any) => { filters.push(r => r[k] !== v); return q; },
    is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return q; },
    in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push(r => Object.entries(v).every(([key, value]) => r[k]?.[key] === value)); return q; },
    order: () => q, limit: (n: number) => { limit = n; return q; },
    update: (p: any) => { op = "update"; patch = p; return q; },
    insert: (p: any) => { op = "insert"; patch = p; return q; },
    single: () => { single = true; return q; }, maybeSingle: () => { single = true; return q; },
    then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      const all = tables[table] ??= [];
      let rows = all.filter(r => filters.every(f => f(r)));
      if (op === "insert") { rows = (Array.isArray(patch) ? patch : [patch]).map((p: Row) => ({ id: `${table}-${all.length}`, ...p })); all.push(...rows); }
      if (op === "update") rows.forEach(r => Object.assign(r, patch));
      rows = rows.slice(0, limit);
      return { data: single ? rows[0] ?? null : rows, error: null, count: count ? rows.length : null };
    }).then(resolve, reject),
  };
  return q;
}
const logEvent = async (job: string, actor: string | null, event_type: string, summary: string, details: Row = {}) => {
  tables.workflow_events.push({ job_id: job, actor_id: actor, event_type, summary, details, created_at: new Date().toISOString() });
};
const call: mitti.MittiCall = async (method, path, body) => {
  calls.push({ method, path, body });
  if (path === "/audits") { if (failCreate) throw new Error("Mitti create reply lost"); return { audit_id: `audit-${calls.filter(c => c.path === "/audits").length}` }; }
  if (path.includes("/templates/")) return { template: { template_id: RECT, items: core.FIXES_DAY_QUESTIONS.map(q => ({ item_id: `i${q.n}`, label: q.label })) } };
  return {};
};
const overrides: Record<string, any> = {
  "@/integrations/supabase/client.server": { supabaseAdmin: { from } },
  "./workflow.server": { WorkflowError, logEvent, getStage: async () => tables.jobs[0].stage, transition: async (_j: string, stage: string) => { tables.jobs[0].stage = stage; } },
  "./mitti.core": mitti, "./fixes-day.core": core, "./in-house.core": inHouse, "./mitti-identity.core": identity,
  "./mitti-create-claim.core": claimsCore, "./piesa-autoform.core": autoCore, "./official-short.core": short,
  "./in-house-suppression.server": { readInHouseDispatchState: async () => ({ held: new Set(held ? [JOB] : []), failed: false }) },
  "./repeat-piesa.server": { repeatPiesaContext: async () => ({ state: { stage: "none" } }) },
  "./test-send.core": { isTestPartner: () => false }, "./onsite-ready-check.core": { TEST_MITTI_ASSIGNEE: "test@example.invalid" },
  "./mitti-create.server": { MittiClaimHeld, MittiOutcomeUncertain, claimMittiCreate: async () => { if (claimHeld) throw new MittiClaimHeld("creation already claimed"); claimHeld = true; return "claim"; }, releaseMittiCreate: async () => { claimHeld = false; }, recordMittiCreateUncertain: async () => {} },
  "./official-forms.server": { officialPrefillContext: async () => ({ address: "TEST address", electrician: { name: "Electrician" } }) },
  "./eligibility.server": { todayMelbourne: () => "2026-10-30" },
  "./autoadvance.server": { autoAdvanceJob: async () => {} },
  "./install-clearance.server": { notifyInstallerClearance: async () => {} },
  "./fixes-quote-save.server": { saveFixesQuote: async () => { quoteWrites++; return { id: "quote", already: true }; } },
  "./our-lead-piesa-electrician.server": { electricianSourceForJob: async () => "installer_usual" },
};
// Actual module bodies with isolated mocked dependencies, no process-wide mock pollution or real Mitti.
function load(name: string, cache: Record<string, any> = {}): any {
  if (cache[name]) return cache[name];
  let source = readFileSync(`src/lib/${name}.ts`, "utf8");
  if (name === "quotes.server") {
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    source = ast.statements.filter(s => ts.isFunctionDeclaration(s) && ["generateRectificationQuote", "activePricing", "activeRateCard", "a4FixesPriceSource", "generateA4FixesQuote"].includes(s.name?.text ?? "")).map(s => s.getText(ast)).join("\n");
    source += "\nexports.generateRectificationQuote = generateRectificationQuote;";
  }
  const out = {}; cache[name] = out;
  const extra = name === "quotes.server" ? { admin: { from }, WorkflowError, logEvent, saveFixesQuote: overrides["./fixes-quote-save.server"].saveFixesQuote,
    fixesMarginFor: () => 0, fixesPriceSource: () => ({ path: "rate_card" }), shortAnswersFromEntries: short.shortAnswersFromEntries,
    applyRectificationMargin: (x: unknown) => x, r2: (n: number) => Math.round(n * 100) / 100 } : {};
  new Function("exports", "require", ...Object.keys(extra), ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(out, (p: string) => {
    if (p === "./mitti.server") return {
      realMittiCall: call, mittiCallFor: async (c: any) => c, findMittiUserByEmail: async () => "mitti-user",
      createAssignMittiAudit: async () => {
        const a = tables.assessments[0];
        if (a.external_mitti_id) return { auditId: a.external_mitti_id, reused: true };
        const r: any = await call("POST", "/audits", { template_id: PIESA });
        Object.assign(a, { external_mitti_id: r.audit_id, mitti_assignee_email: EMAIL });
        await call("POST", `/audits/${r.audit_id}/share`, { shares: [{ id: "mitti-user" }] });
        return { auditId: r.audit_id, reused: false };
      },
    };
    if (p in overrides) return overrides[p];
    if (p.startsWith("./")) return load(p.slice(2), cache);
    throw new Error(`Unexpected test dependency ${p}`);
  }, ...Object.values(extra));
  return out;
}
beforeEach(() => {
  held = true; failCreate = false; claimHeld = false; calls = []; quoteWrites = 0;
  tables = {
    jobs: [{ id: JOB, job_number: "HV-TEST", source: "base44", business_unit: "hivic", stage: "piesa_scheduled", deleted_at: null, install_deadline: "2026-11-29" }],
    assessments: [{ id: "assessment", job_id: JOB, external_mitti_id: null, mitti_raw_snapshot: [], no_rectification_confirmed: false }],
    job_assignments: [
      { job_id: JOB, role: "electrician", active: true, user_id: "electrician", business_id: "biz", profiles: { email: EMAIL }, businesses: { in_house: true, rectification_billed_by: "partner" } },
      { job_id: JOB, role: "installer", active: true, business_id: "biz", businesses: { in_house: true, rectification_billed_by: "partner" } },
    ],
    workflow_settings: [{ id: 1, mitti_fixes_template_id: RECT }], workflow_events: [], rectification_items: [], piesa_records: [], bookings: [], compliance_checks: [],
    pricing_settings: [{ is_active: true, gst_rate: 0.1 }], rate_cards: [{ kind: "electrical", is_active: true, business_id: "biz", rate_card_items: [{ code: "RCD", unit_price_ex_gst: 10 }] }],
  };
});
test("in-house PIESA booking creates exactly two template-bound audits with the same assignee, and retries reuse", async () => {
  const server = load("piesa-autoform.server");
  await server.onPiesaBooked(JOB, "booking", null, { call });
  await server.onPiesaBooked(JOB, "booking", null, { call });
  expect(calls.filter(c => c.path === "/audits").map(c => c.body.template_id)).toEqual([PIESA, RECT]);
  expect(calls.filter(c => c.path.endsWith("/share")).map(c => c.body.shares[0].id)).toEqual(["mitti-user", "mitti-user"]);
});
test("non-in-house PIESA booking still creates only one audit", async () => {
  held = false;
  await load("piesa-autoform.server").onPiesaBooked(JOB, "booking", null, { call });
  expect(calls.filter(c => c.path === "/audits").map(c => c.body.template_id)).toEqual([PIESA]);
});
test("a rectification booking reuses the precreated open audit", async () => {
  const s = load("piesa-autoform.server"); await s.onPiesaBooked(JOB, "booking", null, { call });
  tables.rectification_items.push({ job_id: JOB, status: "required", description: "RCD" });
  expect(await load("fixes-day.server").onRectificationBooked(JOB, "rect-booking", null, call)).toMatchObject({ status: "reused", auditId: "audit-2" });
  expect(calls.filter(c => c.path === "/audits")).toHaveLength(2);
});
test("unused rectification form is closed once locally and never recreated by a rectification booking", async () => {
  await load("piesa-autoform.server").onPiesaBooked(JOB, "booking", null, { call });
  tables.assessments[0].no_rectification_confirmed = true;
  const s = load("fixes-day.server");
  await s.closeUnusedRectificationForm(JOB); await s.closeUnusedRectificationForm(JOB);
  expect(tables.workflow_events.filter(e => e.event_type === "rectification_form_closed_unused")).toHaveLength(1);
  expect((await s.onRectificationBooked(JOB, "rect-booking", null, call)).status).toBe("not_needed");
  expect(calls.filter(c => c.path === "/audits")).toHaveLength(2);
});
test("partner-billed in-house quote creation skips without any HIV quote or invoice", async () => {
  expect(await load("quotes.server").generateRectificationQuote(JOB, null)).toEqual({ skipped: "in_house_partner_bills" });
  expect(quoteWrites).toBe(0); expect(tables.invoices ?? []).toEqual([]);
});
for (const scenario of ["hivic", "non-in-house"]) test(`${scenario} rectification items still produce the existing quote`, async () => {
  if (scenario === "hivic") tables.job_assignments[1].businesses.rectification_billed_by = "hivic";
  else { held = false; tables.job_assignments[1].businesses.in_house = false; }
  tables.rectification_items.push({ job_id: JOB, status: "required", rate_code: "RCD", quantity: 1, description: "RCD" });
  expect(await load("quotes.server").generateRectificationQuote(JOB, null)).toBe("quote");
  expect(quoteWrites).toBe(1);
});
test("rectification Mitti creation failure is visible and an uncertain create is not retried", async () => {
  await load("piesa-autoform.server").onPiesaBooked(JOB, "booking", null, { call });
  // A distinct seed with existing PIESA but no rectification form: retry must still try the companion form.
  tables.workflow_events = []; claimHeld = false; failCreate = true;
  const s = load("piesa-autoform.server");
  await s.onPiesaBooked(JOB, "booking", null, { call });
  expect(tables.assessments[0].mitti_sync_status).toBe("error");
  expect(tables.assessments[0].mitti_last_error).toContain("Mitti create reply lost");
  const attempts = calls.filter(c => c.path === "/audits").length;
  await s.onPiesaBooked(JOB, "booking", null, { call });
  expect(calls.filter(c => c.path === "/audits")).toHaveLength(attempts);
});
test("Part C sync records post_rectification once and leaves the official PIESA deadline unchanged", async () => {
  tables.jobs[0].stage = "rectification_booked";
  const s = load("piesa-record.server");
  const input = { jobId: JOB, actorId: "electrician", kind: "post_rectification", outcome: "pass", completedDate: "2026-11-02", sectionCSignedDate: "2026-11-02", source: { kind: "mitti_fixes_form", auditId: "audit-2" } };
  await s.applyPiesaRecord(input); await s.applyPiesaRecord(input);
  expect(tables.piesa_records).toHaveLength(1);
  expect(tables.piesa_records[0].section_c_signed_at).toBe("2026-11-02T00:00:00.000Z");
  expect(tables.jobs[0].install_deadline).toBe("2026-11-29");
  expect(allocation.electricalClearance({ piesaOutcome: "pass", piesaCompletedAt: "2026-10-30", rectificationRequired: false }).timingDate).toBe("2026-10-30");
});