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
let realMitti = false, realWorkflow = false, failShare = false;
let repeatDeadline: string | null = null;
let auditResponse: any = null;
const claims = new Set<string>();
const JOB = "job", EMAIL = "electrician@example.invalid", PIESA = `template_${"a".repeat(32)}`, RECT = `template_${"b".repeat(32)}`;
class WorkflowError extends Error {}
class MittiClaimHeld extends Error {}
class MittiOutcomeUncertain extends Error {}
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op = "read", patch: any, single = false, count = false, limit = Infinity; let sortKey = "", ascending = true;
  const q: any = {
    select: (_c: string, o: any) => { count = o?.count === "exact"; return q; },
    eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    neq: (k: string, v: any) => { filters.push(r => r[k] !== v); return q; },
    is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return q; },
    in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
    contains: (k: string, v: Row) => { filters.push(r => Object.entries(v).every(([key, value]) => r[k]?.[key] === value)); return q; },
    order: (k: string, o?: any) => { sortKey = k; ascending = o?.ascending !== false; return q; }, range: () => q, limit: (n: number) => { limit = n; return q; },
    update: (p: any) => { op = "update"; patch = p; return q; },
    insert: (p: any) => { op = "insert"; patch = p; return q; },
    single: () => { single = true; return q; }, maybeSingle: () => { single = true; return q; },
    then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      const all = tables[table] ??= [];
      if (table === "job_piesa_deadlines") { const initial = tables.piesa_records.filter(r => r.kind !== "post_rectification").at(-1); const current = tables.piesa_records.find(r => r.is_current); return {data: {piesa_date: initial?.completed_date, piesa_outcome: current?.outcome ?? initial?.outcome, install_deadline: "2026-11-29", piesa_expired: false}, error: null}; }
      let rows = all.filter(r => filters.every(f => f(r)));
      if (op === "insert") { rows = (Array.isArray(patch) ? patch : [patch]).map((p: Row) => ({ id: `${table}-${all.length}`, created_at: new Date(Date.now()+all.length).toISOString(), is_current: true, ...p })); all.push(...rows); }
      if (op === "update") rows.forEach(r => Object.assign(r, patch));
      if (sortKey) rows = [...rows].sort((a,b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")) * (ascending ? 1 : -1));
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
  if (path.endsWith("/share") && failShare) throw new Error("share failed");
  if (method === "GET" && path.startsWith("/users")) return {users:[{id:"mitti-user", email:EMAIL}]};
  if (method === "GET" && path.startsWith("/audits/")) return auditResponse ?? {audit_id:path.split("/")[2], template_id:path.endsWith("audit-1") ? PIESA : RECT, items:[]};
  if (path === "/audits") { if (failCreate) throw new Error("Mitti create reply lost"); return { audit_id: `audit-${calls.filter(c => c.path === "/audits").length}` }; }
  if (path.includes("/templates/")) return { template: { template_id: path.includes(PIESA) ? PIESA : RECT, items: path.includes(PIESA) ? ["Property Address", "Owner name"].map((label,i)=>({item_id:`p${i}`,label})) : core.FIXES_DAY_QUESTIONS.map(q => ({ item_id: `i${q.n}`, label: q.label })) } };
  return {};
};
const overrides: Record<string, any> = {
  "@/integrations/supabase/client.server": { supabaseAdmin: { from, storage: {from:()=>({upload:async()=>({error:null})})}, rpc:async (_n:string,p:any)=> { tables.jobs[0].stage=p._to; return {error:null}; } } },
  "./workflow.server": { WorkflowError, logEvent, getStage: async () => tables.jobs[0].stage, transition: async (_j: string, stage: string) => { tables.jobs[0].stage = stage; } },
  "./mitti.core": mitti, "./fixes-day.core": core, "./in-house.core": inHouse, "./mitti-identity.core": identity,
  "./mitti-create-claim.core": claimsCore, "./piesa-autoform.core": autoCore, "./official-short.core": short,
  "./in-house-suppression.server": { readInHouseDispatchState: async () => ({ held: new Set(held ? [JOB] : []), failed: false }) },
  "./repeat-piesa.server": { currentPiesaSupersededByReopen: async()=>false, repeatPiesaContext: async () => ({ state: { stage: repeatDeadline ? "offer" : "none", deadline: repeatDeadline } }) },
  "./test-send.core": { isTestPartner: () => false }, "./onsite-ready-check.core": { TEST_MITTI_ASSIGNEE: "test@example.invalid" },
  "./mitti-create.server": { MittiClaimHeld, MittiOutcomeUncertain, claimMittiCreate: async (_j:string, kind:string, _a:any, _s:any, details:any) => { const key = `${kind}:${details?.rectification_round ?? "initial"}`; if (claims.has(key)) throw new MittiClaimHeld("creation already claimed"); claims.add(key); claimHeld = true; return key; }, releaseMittiCreate: async (_j:string,_k:string,key:string) => { claims.delete(key); claimHeld = false; }, recordMittiCreateUncertain: async () => {} },
  "./official-forms.server": { officialPrefillContext: async () => ({ address: "TEST address", electrician: { name: "Electrician" }, lifeSupportDeclared: false }) },
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
  const out = {}; cache[name] = out;
  const extra = {};
  new Function("exports", "require", ...Object.keys(extra), ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(out, (p: string) => {
    if (p === "./mitti.server" && !realMitti) return {
      realMittiCall: call, mittiCallFor: async (c: any) => c, findMittiUserByEmail: async () => "mitti-user",
      createAssignMittiAudit: async () => {
        const a = tables.assessments[0];
        if (a.external_mitti_id) { await call("POST", `/audits/${a.external_mitti_id}/share`, {shares:[{id:"mitti-user"}]}); await call("POST", `/audits/${a.external_mitti_id}/owner`, {}); return { auditId: a.external_mitti_id, reused: true }; }
        const r: any = await call("POST", "/audits", { template_id: PIESA });
        Object.assign(a, { external_mitti_id: r.audit_id, mitti_assignee_email: EMAIL });
        await call("POST", `/audits/${r.audit_id}/share`, { shares: [{ id: "mitti-user" }] });
        return { auditId: r.audit_id, reused: false };
      },
    };
    if (p === "./workflow.server" && realWorkflow) return load("workflow.server",cache);
    if (p in overrides) return overrides[p];
    if (p.startsWith("./") && !p.endsWith(".server")) return require(`../src/lib/${p.slice(2)}`);
    if (p.startsWith("./")) return load(p.slice(2), cache);
    throw new Error(`Unexpected test dependency ${p}`);
  }, ...Object.values(extra));
  return out;
}
beforeEach(() => {
  held = true; failCreate = false; claimHeld = false; realMitti=false; realWorkflow=false; failShare=false; repeatDeadline=null; auditResponse=null; claims.clear(); calls = []; quoteWrites = 0;
  tables = {
    jobs: [{ id: JOB, job_number: "HV-TEST", source: "base44", business_unit: "hivic", stage: "piesa_scheduled", property_id:"property", owner_id:"owner", channel:"hivic_sourced", deleted_at: null, install_deadline: "2026-11-29" }],
    assessments: [{ id: "assessment", job_id: JOB, external_mitti_id: null, mitti_raw_snapshot: [], no_rectification_confirmed: false }],
    job_assignments: [
      { job_id: JOB, role: "electrician", active: true, user_id: "electrician", business_id: "biz", profiles: { email: EMAIL }, businesses: { in_house: true, rectification_billed_by: "partner" } },
      { job_id: JOB, role: "installer", active: true, business_id: "biz", businesses: { in_house: true, rectification_billed_by: "partner" } },
    ],
    properties:[{id:"property",address_line:"1 TEST street"}],owners:[{id:"owner",full_name:"Owner"}], customer_agreements:[{job_id:JOB,status:"signed"}], invoices:[], workflow_settings: [{ id: 1, payment_option_gate_enabled:true, safety_check_payment_inc_gst:349, mitti_piesa_template_id:PIESA, mitti_fixes_template_id: RECT }], workflow_events: [], rectification_items: [], piesa_records: [], bookings: [], compliance_checks: [], documents:[{job_id:JOB,source_system:"mitti",external_id:"audit-2:completed"}],
    pricing_settings: [{ is_active: true, gst_rate: 0.1 }], rate_cards: [{ kind: "electrical", is_active: true, business_id: "biz", rate_card_items: [{ code: "RCD", unit_price_ex_gst: 10 }] }],
  };
});
test("in-house PIESA booking creates exactly two template-bound audits with the same assignee, and retries reuse", async () => {
  const server = load("piesa-autoform.server");
  await server.onPiesaBooked(JOB, "booking", null, { call });
  await server.onPiesaBooked(JOB, "booking", null, { call });
  expect(calls.filter(c => c.path === "/audits").map(c => c.body.template_id)).toEqual([PIESA, RECT]);
  expect(calls.filter(c => c.path.endsWith("/share")).every(c => c.body.shares[0].id === "mitti-user")).toBe(true);
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
  tables.workflow_events = []; claims.clear(); claimHeld = false; failCreate = true;
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
// Real production completion, sync and clearance functions; only external side effects are mocked.
Object.assign(overrides, {
 "./requirements.server": {jobScope:async()=>({scope:"ELECTRICAL_ONLY",label:"PIESA",measurementRow:null})},
 "./owner-gates.server": {ownerGateStageBlockers:async()=>[]},
 "./installer-intake.server": {isIntakeJob:async()=>false},
 "./piesa-rules-notice.server": {recheckPiesaRules:async()=>{},piesaRulesBlockerFor:async()=>null},
 "./piesa-owner-confirm.server": {ownerConfirmationForExpand:async()=>null},
 "./piesa-fixes-confirm.server": {ownerFixesConfirmationForExpand:async()=>null},
 "./official-signature.server": {savePiesaSignatureImage:async()=>{}},
 "./coes-check.server": {checkCurrentCoes:async()=>{}},
 "./piesa-delivery.server": {deliverPiesaCopies:async()=>({hold:"TEST no delivery"})},
 "./electrician-piesa-copy.server": {sendElectricianPiesaCopy:async()=>"TEST no delivery"},
 "./piesa-fixes-confirm-send.server": {sendFixesConfirmStep:async()=>"TEST no delivery"},
 "./safety-check-amount.server": {quoteSafetyCheck:async()=>({incGst:349})},
 "./job-records.server": {applyPiesaLifeSupport:async()=>{}},
 "./fixes-times-link.server": {textFixesTimesLink:async()=>{}},
 "./auto-fixes-quote-send.server": {maybeAutoSendFixesQuote:async()=>{}},
 "./installer-quote.server": {draftInstallerQuoteFromReadyCheck:async()=>{}},
 "./pilot.server": {applyCobrand:async()=>{}},
});
overrides["./official-forms.server"].hazardBlockers=async()=>[];
overrides["./official-forms.server"].currentCopy=async()=>({unavailable:true});
const signedAudit = () => ({audit_id:"audit-2",template_id:RECT,completed:true,items:[
 ...core.FIXES_DAY_QUESTIONS.map(q=>({item_id:`i${q.n}`,label:q.label})),
 ...[[core.FIXES_DAY_Q.jobNumber,"HV-TEST"],[core.FIXES_DAY_Q.done,"Yes"],[core.FIXES_DAY_Q.coesNumber,"C123"],[core.FIXES_DAY_Q.certDate,"2026-11-02"]].map(([label,text])=>({label,responses:{text}})),
 {label:core.FIXES_DAY_Q.coesFile,media:[{media_id:"coes"}]},
 {label:core.FIXES_DAY_Q.workPhoto,media:[{media_id:"photo",location:{latitude:-37.8,longitude:145}}]},
 {label:core.FIXES_DAY_Q.signature,responses:{image:{media_id:"signature",timestamp:"2026-11-02T03:00:00Z"},name:"Electrician"}},
]});
const seedOfficial = () => { tables.piesa_records.push({job_id:JOB,kind:"initial",outcome:"fail",completed_date:"2026-10-30",signed_off_by:"electrician",is_current:true}); tables.rectification_items.push({job_id:JOB,status:"required",description:"RCD"}); };
test("partner-billed same-visit signed form reaches real install clearance without a quote and keeps official deadline",async()=>{
 realWorkflow=true; seedOfficial(); tables.jobs[0].stage="piesa_complete"; auditResponse=signedAudit();
 const server=load("fixes-day.server");
 const result=await server.completeFixesForm(JOB,"audit-2",{call,fetchMedia:async()=>({bytes:new Uint8Array([1]),contentType:"image/png"}),today:"2026-11-03"});
 expect(result.status).toBe("done");
 const facts=await load("electrical-clearance.server").clearanceFacts(JOB);
 const cleared=allocation.electricalClearance(facts);
 expect(cleared.cleared).toBe(true); expect(cleared.timingDate).toBe("2026-10-30");
 expect(require("../src/lib/install-days.core").installWindowDeadline(cleared.timingDate)).toBe("2026-11-29");
 expect(tables.piesa_records.filter(r=>r.kind==="post_rectification")[0].section_c_signed_at).toBe("2026-11-02T00:00:00.000Z");
});
for(const partnerBilled of [false,true]) test(`real clearance quote gate partner billing=${partnerBilled}`,()=>{
 const facts:any={piesaOutcome:"fail",piesaCompletedAt:"2026-10-30",rectificationRequired:true,rectificationQuoteAccepted:false,rectificationCompletedAt:"2026-11-02",sectionCSignedAt:"2026-11-02",partnerBilledRectification:partnerBilled};
 expect(allocation.electricalClearance(facts).cleared).toBe(partnerBilled);
 expect(allocation.rectificationVisitBlocker({quoteAccepted:false,recActiveApproved:true,partnerBilledRectification:partnerBilled} as any)===null).toBe(partnerBilled);
});
test("post_rectification requires explicit Section C date before any writes; reassessment does not",async()=>{
 const s=load("piesa-record.server");
 await expect(s.applyPiesaRecord({jobId:JOB,actorId:null,kind:"post_rectification",outcome:"pass",completedDate:"2026-11-02"})).rejects.toThrow("Section C");
 expect(tables.piesa_records).toHaveLength(0);
 await s.applyPiesaRecord({jobId:JOB,actorId:null,kind:"reassessment",outcome:"pass",completedDate:"2026-11-02"});
 expect(tables.piesa_records).toHaveLength(1);
});
test("non-in-house second rectification booking creates a new audit after completion",async()=>{
 held=false; tables.job_assignments[1].businesses.in_house=false; seedOfficial();
 const s=load("fixes-day.server"); await s.onRectificationBooked(JOB,"visit-1",null,call);
 tables.workflow_events.push({job_id:JOB,event_type:core.FIXES_FORM_COMPLETED_EVENT,details:{audit_id:"audit-1"}});
 expect((await s.onRectificationBooked(JOB,"visit-2",null,call)).status).toBe("created");
 expect(calls.filter(c=>c.path==="/audits")).toHaveLength(2);
});
test("repeat in-house PIESA gets its own rectification audit",async()=>{
 const s=load("piesa-autoform.server"); await s.onPiesaBooked(JOB,"visit-1",null,{call});
 tables.assessments[0].status="complete"; repeatDeadline="2026-11-29";
 await s.onPiesaBooked(JOB,"visit-2",null,{call});
 expect(calls.filter(c=>c.path==="/audits").map(c=>c.body.template_id)).toEqual([PIESA,RECT,PIESA,RECT]);
});
test("share failure retries both handover operations without creating duplicate audits",async()=>{
 realMitti=true; failShare=true; tables.bookings.push({job_id:JOB,kind:"assessment",status:"confirmed",scheduled_start:"2026-11-01T00:00:00Z"});
 const s=load("piesa-autoform.server"); await s.onPiesaBooked(JOB,"visit",null,{call});
 expect(tables.assessments[0].mitti_sync_status).toBe("error");
 failShare=false; await s.onPiesaBooked(JOB,"visit",null,{call});
 expect(calls.filter(c=>c.path==="/audits")).toHaveLength(2);
 expect(calls.filter(c=>c.path.endsWith("/share")).length).toBeGreaterThanOrEqual(3);
 expect(calls.filter(c=>c.path.endsWith("/owner")).length).toBeGreaterThanOrEqual(2);
});
test("rectification handover failure retries share and owner using its existing identity",async()=>{
 await load("piesa-autoform.server").onPiesaBooked(JOB,"visit",null,{call});
 failShare=true; const s=load("fixes-day.server"); await s.onRectificationBooked(JOB,"rect-visit",null,call);
 expect(tables.assessments[0].mitti_sync_status).toBe("error");
 failShare=false; await s.onRectificationBooked(JOB,"rect-visit",null,call);
 expect(calls.filter(c=>c.path==="/audits")).toHaveLength(2);
 expect(calls.filter(c=>c.path==="/audits/audit-2/owner").length).toBeGreaterThanOrEqual(2);
});

const setPiesaAudit = (repair:boolean) => {
 const forms=require("./helpers/journey-forms");
 const form=repair ? forms.completedA3({inspectionDate:"2026-10-30",capturedAt:"2026-10-30T01:00:00Z",priceIncGst:600,mediaPrefix:"round"}) : forms.completedA3Pass({inspectionDate:"2026-10-30",capturedAt:"2026-10-30T01:00:00Z",mediaPrefix:"round"});
 auditResponse={audit_id:"audit-1",template_id:PIESA,completed:true,items:form.items,modified_at:repair?"2026-10-30T02:00:00Z":"2026-10-30T01:00:00Z"};
 tables.documents ??= []; tables.documents.push({job_id:JOB,source_system:"mitti",external_id:`audit-1:${auditResponse.modified_at}`});
 tables.assessments[0].mitti_template_id=PIESA;
};
test("real Mitti no-rectification sync closes companion once and writes the existing partner-visible note",async()=>{
 await load("piesa-autoform.server").onPiesaBooked(JOB,"visit",null,{call}); realMitti=true; setPiesaAudit(false);
 const s=load("mitti.server"); await s.syncMittiAssessment(JOB,null,call,async()=>({bytes:new Uint8Array([1]),contentType:"image/png"}));
 expect(tables.assessments[0].no_rectification_confirmed).toBe(true);
 expect(tables.workflow_events.filter(e=>e.event_type==="rectification_form_closed_unused")).toHaveLength(1);
 expect(tables.workflow_events.filter(e=>e.event_type==="installer_note").map(e=>e.details.note)).toEqual(["Rectification form not needed — you can ignore it in Mitti."]);
});
test("real amended PIESA sync reopens only a new round and resets no-rectification flag",async()=>{
 await load("piesa-autoform.server").onPiesaBooked(JOB,"visit",null,{call}); realMitti=true; setPiesaAudit(false);
 const s=load("mitti.server"), media=async()=>({bytes:new Uint8Array([1]),contentType:"image/png"});
 await s.syncMittiAssessment(JOB,null,call,media); setPiesaAudit(true);
 await s.syncMittiAssessment(JOB,null,call,media);
 expect(tables.assessments[0].no_rectification_confirmed).toBe(false);
 expect(calls.filter(c=>c.path==="/audits")).toHaveLength(3);
 await s.syncMittiAssessment(JOB,null,call,media);
 expect(calls.filter(c=>c.path==="/audits")).toHaveLength(3);
});
