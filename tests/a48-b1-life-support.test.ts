// A48 batch 1 task 4 (Jo 29 Oct 2026): life support consent or a medical plan is needed BEFORE the safety check visit is
// booked (piesa_scheduled). Yes and Unknown both block; the owner's upload or the office record clears it; the
// electrician's own Yes on site marks the job (never cleared by a No). The REAL workflow.server stageEntryBlockers and
// job-records.server code runs against an in-memory database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { complianceRecordBlockers, lifeSupportNeedsPlan, lifeSupportPatchFromPiesa, type RecordKey } from "../src/lib/compliance-timeline.core";

const J = "00000000-0000-4000-8000-0000000000d1";
const TOKEN = "t".repeat(43);
const MISSING = `Activity 48 record missing: Life support written consent / medical plan`;
const none = new Set<RecordKey>();
const plan = new Set<RecordKey>(["life_support_plan"]);

describe("pure rules", () => {
  test("yes and unknown need the plan; no and unanswered do not", () => {
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "yes" })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "unknown" })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: true, life_support_status: null })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "no" })).toBe(false);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: null })).toBe(false);
  });
  test("the safety check visit is blocked until the plan exists; no life support is not blocked", () => {
    expect(complianceRecordBlockers("piesa_scheduled", none, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([MISSING]);
    expect(complianceRecordBlockers("piesa_scheduled", plan, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([]);
    expect(complianceRecordBlockers("piesa_scheduled", none, { lifeSupport: false, ownerPaidIncGst: 0 })).toEqual([]);
  });
  test("the retired stage no longer carries the rule; later stages still do", () => {
    expect(complianceRecordBlockers("assessment_booked", none, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([]);
    for (const to of ["installation_booked", "evidence_outstanding"]) expect(complianceRecordBlockers(to, none, { lifeSupport: true, ownerPaidIncGst: 0 })).toContain(MISSING);
  });
  test("the electrician's answer: Yes marks the job, No and blank change nothing", () => {
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: false, life_support_status: "no" })).toEqual({ life_support: true, life_support_status: "yes" });
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: false, life_support_status: "unknown" })).toEqual({ life_support: true, life_support_status: "yes" });
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: true, life_support_status: "yes" })).toBeNull();
    expect(lifeSupportPatchFromPiesa("No", { life_support: true, life_support_status: "yes" })).toBeNull();
    expect(lifeSupportPatchFromPiesa(undefined, { life_support: false, life_support_status: "no" })).toBeNull();
  });
});

const tables: Tables = {};
// In-memory storage: path -> { size, mimetype }.
const objects = new Map<string, { size: number; mimetype: string }>();
const removed: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }), storage: { from: () => ({
  upload: async () => ({ error: { message: "no storage in test" } }),
  createSignedUploadUrl: async (path: string) => ({ data: { token: `up-${path}`, path }, error: null }),
  list: async (folder: string, o: { search: string }) => ({ data: [...objects.entries()].filter(([k]) => k.startsWith(`${folder}/`) && k.includes(o.search)).map(([k, v]) => ({ name: k.slice(folder.length + 1), metadata: { size: v.size, mimetype: v.mimetype } })), error: null }),
  remove: async (paths: string[]) => { removed.push(...paths); for (const x of paths) objects.delete(x); return { data: null, error: null }; },
}) } } }));
const sniffed: string[] = [];
mock.module("../src/lib/upload-safety.server", () => ({ verifyStoredUpload: async (_b: string, path: string, mime: string) => { sniffed.push(`${path}|${mime}`); }, BAD_FILE_MESSAGE: "That file type isn't accepted. Please upload a PDF, photo (JPG, PNG, WEBP, HEIC), video (MP4, MOV), Word or Excel file." }));
const { stageEntryBlockers } = await import("../src/lib/workflow.server");
const { applyPiesaLifeSupport, recordComplianceRecord, lifeSupportPlanMissingJobs } = await import("../src/lib/job-records.server");

function seed(job: { life_support: boolean; life_support_status: string | null }) {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0801", source: "website", stage: "piesa_and_install_window_pending", deleted_at: null, qa_archived_at: null, business_unit: "hivic", ...job }],
    job_compliance_records: [], owner_gate_signatures: [], documents: [], invoices: [], workflow_events: [], job_assignments: [], assessments: [],
    customer_estimate_links: [{ id: "l1", job_id: J, token: TOKEN, purpose: "step3_estimate", status: "active", expires_at: "2099-01-01T00:00:00Z" }],
  });
  objects.clear(); removed.length = 0; sniffed.length = 0;
}
const has = async (to: "piesa_scheduled" | "installation_booked") => (await stageEntryBlockers(J, to)).includes(MISSING);

describe("booking the safety check visit (piesa_scheduled) runs the life support blocker", () => {
  test("yes -> blocked; office record clears it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await has("piesa_scheduled")).toBe(true);
    await recordComplianceRecord({ jobId: J, key: "life_support_plan", occurredAt: "2026-10-29", reference: null, notes: null, actorId: "00000000-0000-4000-8000-0000000000e1" });
    expect(await has("piesa_scheduled")).toBe(false);
  });
  test("the owner's tick alone (no stored file) does not clear it, at the visit or later", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    tables["owner_gate_signatures"]!.push({ job_id: J, doc_key: "life_support_plan", doc_version: "v1", signed_at: "2026-10-29T01:00:00Z" });
    expect(await has("piesa_scheduled")).toBe(true);
    expect(await has("installation_booked")).toBe(true);
  });
  test("final fix: the stored file alone (the owner's upload, no tick) clears it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    tables["documents"]!.push({ id: "d1", job_id: J, kind: "life_support_plan", storage_path: "x/plan.pdf" });
    expect(await has("piesa_scheduled")).toBe(false);
    expect(await has("installation_booked")).toBe(false);
  });
  test("the owner's tick + the stored file clears it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    tables["owner_gate_signatures"]!.push({ job_id: J, doc_key: "life_support_plan", doc_version: "v1", signed_at: "2026-10-29T01:00:00Z" });
    tables["documents"]!.push({ id: "d1", job_id: J, kind: "life_support_plan", storage_path: "x/plan.pdf" });
    expect(await has("piesa_scheduled")).toBe(false);
    expect(await has("installation_booked")).toBe(false);
  });
  test("unknown (flag off) blocks like yes", async () => {
    seed({ life_support: false, life_support_status: "unknown" });
    expect(await has("piesa_scheduled")).toBe(true);
  });
  test("no -> not blocked", async () => {
    seed({ life_support: false, life_support_status: "no" });
    expect(await has("piesa_scheduled")).toBe(false);
  });
});

describe("the electrician's life support answer on site", () => {
  test("Yes on a 'no' job sets both fields, logs once, and the block applies before the install", async () => {
    seed({ life_support: false, life_support_status: "no" });
    expect(await has("installation_booked")).toBe(false);
    expect(await applyPiesaLifeSupport(J, null, "Yes")).toBe(true);
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
    expect(await has("installation_booked")).toBe(true);
    expect(await applyPiesaLifeSupport(J, null, "Yes")).toBe(false);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "life_support_from_safety_check").length).toBe(1);
  });
  test("Yes on an 'unknown' job makes it yes", async () => {
    seed({ life_support: false, life_support_status: "unknown" });
    await applyPiesaLifeSupport(J, null, "Yes");
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
  });
  test("a PIESA No never clears an owner yes", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await applyPiesaLifeSupport(J, null, "No")).toBe(false);
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
  });
  test("the Mitti sync calls it with the electrician's own answer", () => {
    expect(readFileSync("src/lib/mitti.server.ts", "utf8")).toContain('applyPiesaLifeSupport(jobId, actorId, shortAnswers["lifeSupportPresent"])');
  });
});

// ---------------- A48 batch 1 final fix F1 (Jo 29 Oct 2026) ----------------
const { piesaOfferBlockers } = await import("../src/lib/allocation.core");
const { evaluateOwnerGates, ownerToSign, RETIRED_DOC_KEYS } = await import("../src/lib/owner-gates.core");
const { needsCandidates } = await import("../src/lib/office-needs.core");
const { cardOf } = await import("../src/lib/needs-cards.core");
const owner = await import("../src/lib/owner-myjob.server");
const { validateLifeSupportPlanFile, lifeSupportPlanPath, parseLifeSupportPlanPath } = await import("../src/lib/owner-myjob.core");
const { LIFE_SUPPORT_PLAN_ROW, lifeSupportPlanRowStage } = await import("../src/lib/compliance-timeline.core");

describe("F1: electrician offers for the safety check wait for the plan", () => {
  const okPay = { cleared: true, blocker: "" } as never;
  const base = { readyCheckComplete: true, verifiedEligible: true, currentQuoteApproved: true, payment: okPay, hasActiveElectrician: false, hasOpenOffers: false };
  test("pure: a missing plan is the same blocker the visit uses", () => {
    expect(piesaOfferBlockers({ ...base, lifeSupportPlanMissing: true })).toEqual([MISSING]);
    expect(piesaOfferBlockers({ ...base, lifeSupportPlanMissing: false })).toEqual([]);
  });
  test("startPiesaAllocation passes the job's plan state to the offer gate", () => {
    const src = readFileSync("src/lib/allocation.server.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function startPiesaAllocation"));
    expect(fn).toMatch(/lifeSupportPlanMissing: kind === "piesa" && planMissing/);
    expect(fn).toContain("lifeSupportPlanMissing(jobId)");
  });
  test("server: yes/unknown with nothing on file → missing; the owner's file or the office record → not missing; no → not missing", async () => {
    const { lifeSupportPlanMissing } = await import("../src/lib/job-records.server");
    seed({ life_support: true, life_support_status: "yes" });
    expect(await lifeSupportPlanMissing(J)).toBe(true);
    tables["documents"]!.push({ id: "d1", job_id: J, kind: "life_support_plan", storage_path: "x/plan.pdf" });
    expect(await lifeSupportPlanMissing(J)).toBe(false);
    seed({ life_support: false, life_support_status: "unknown" });
    expect(await lifeSupportPlanMissing(J)).toBe(true);
    tables["job_compliance_records"]!.push({ job_id: J, record_key: "life_support_plan" });
    expect(await lifeSupportPlanMissing(J)).toBe(false);
    seed({ life_support: false, life_support_status: "no" });
    expect(await lifeSupportPlanMissing(J)).toBe(false);
  });
});

describe("F1: Gate C — the owner's upload replaces the 'I have uploaded it' tick", () => {
  const facts = (o: Record<string, unknown> = {}) => ({ isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: true, visitedByInstaller: false, hasQuote: true,
    agreementSigned: true, agreementWordingApproved: true, escConsentSigned: true, piesaCopyDelivered: true, piesaDeclarationMappingApproved: false, assignmentEffective: false, ...o }) as never;
  const lsBlock = (f: never) => evaluateOwnerGates(f).find((g) => g.gate === "C")!.blockers.filter((b) => b.includes("Life support plan"));
  test("the tick alone no longer counts; the file or office record does", () => {
    expect(lsBlock(facts({ signed: [{ key: "life_support_plan", version: "2026-10-06-v1", draft: false }] }))).toEqual(["Owner paperwork C: Life support plan not recorded yet."]);
    expect(lsBlock(facts({ lifeSupportPlanOnFile: true }))).toEqual([]);
  });
  test("the owner is never asked to tick it, and it is retired from the paperwork list", () => {
    expect(ownerToSign(evaluateOwnerGates(facts())).some((t) => t.key === "life_support_plan")).toBe(false);
    expect(RETIRED_DOC_KEYS.has("life_support_plan")).toBe(true);
  });
  test("gateFacts reads the plan on file (owner upload or office record)", () => {
    const src = readFileSync("src/lib/owner-gates.server.ts", "utf8");
    expect(src).toMatch(/const\s*\[\s*\{\s*count:\s*onsite\s*\},\s*plans\s*\]\s*=\s*await Promise\.all\(\[\s*admin[\s\S]*?lifeSupportPlansOnFile\(\[jobId\]\)/);
    expect(src).toMatch(/lifeSupportPlanOnFile:\s*plans\.has\(jobId\)/);
  });
});

describe("F1: Needs me 'Life support plan needed before the safety check' (office only)", () => {
  test("row wording, card and button", () => {
    const c = needsCandidates({ jobId: J, jobNumber: "HV-0801", surname: "Lowe", suburb: "Kew", lifeSupportPlanNeeded: { at: "2026-10-29T01:00:00Z" } } as never, Date.parse("2026-10-29T02:00:00Z"));
    const row = c.find((x) => x.kind === "life_support_plan")!;
    expect(row.line).toBe("Life support plan needed before the safety check");
    expect(LIFE_SUPPORT_PLAN_ROW).toBe("Life support plan needed before the safety check");
    expect(row.button).toMatchObject({ to: "job", section: "piesa" });
    expect(cardOf("life_support_plan")).toBe("owner");
  });
  test("only from quote acceptance up to the install", () => {
    for (const st of ["measured_quote_accepted", "piesa_and_install_window_pending", "piesa_scheduled", "installation_scheduling", "evidence_outstanding"]) expect(lifeSupportPlanRowStage(st)).toBe(true);
    for (const st of ["new_enquiry", "measured_estimate_ready", "ap_review", "complete", "cancelled"]) expect(lifeSupportPlanRowStage(st)).toBe(false);
  });
  test("server: jobs blocked on it; clears when the plan is on file", async () => {
    seed({ life_support: false, life_support_status: "unknown" });
    expect([...(await lifeSupportPlanMissingJobs([J]))]).toEqual([J]);
    tables["documents"]!.push({ id: "d1", job_id: J, kind: "life_support_plan", storage_path: "x/plan.pdf" });
    expect([...(await lifeSupportPlanMissingJobs([J]))]).toEqual([]);
    seed({ life_support: false, life_support_status: "no" });
    expect([...(await lifeSupportPlanMissingJobs([J]))]).toEqual([]);
  });
  test("Needs me gathers it", () => {
    const src = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(src).toContain("lifeSupportPlanMissingJobs(");
    expect(src).toContain("x.lifeSupportPlanNeeded =");
  });
});

describe("F1: the owner uploads the plan on My job (token-scoped)", () => {
  test("file rules: photo or PDF only, not empty, within the owner upload limit; paths belong to the job", () => {
    expect(validateLifeSupportPlanFile({ mime: "application/pdf", fileName: "plan.pdf", size: 1000 })).toEqual({ ok: true, mime: "application/pdf" });
    expect(validateLifeSupportPlanFile({ mime: "", fileName: "plan.HEIC", size: 1000 })).toEqual({ ok: true, mime: "image/heic" });
    expect(validateLifeSupportPlanFile({ mime: "image/jpg", fileName: "a.jpg", size: 1000 })).toEqual({ ok: true, mime: "image/jpeg" });
    expect(validateLifeSupportPlanFile({ mime: "video/mp4", fileName: "a.mp4", size: 1000 })).toEqual({ ok: false, error: "Please upload a photo or PDF." });
    expect(validateLifeSupportPlanFile({ mime: "application/pdf", fileName: "a.pdf", size: 201 * 1024 * 1024 })).toEqual({ ok: false, error: "That file is too big. Please upload a smaller photo or PDF." });
    expect(validateLifeSupportPlanFile({ mime: "application/pdf", fileName: "a.pdf", size: 0 }).ok).toBe(false);
    expect(validateLifeSupportPlanFile({ mime: "application/pdf", fileName: "a.pdf", size: 201 * 1024 * 1024 }).ok).toBe(false);
    const id = "00000000-0000-4000-8000-0000000000f1";
    const path = lifeSupportPlanPath(J, id, "application/pdf");
    expect(parseLifeSupportPlanPath(J, path)).toBe(id);
    expect(parseLifeSupportPlanPath("00000000-0000-4000-8000-0000000000d9", path)).toBeNull();
    expect(parseLifeSupportPlanPath(J, `${J}/intake/owner-capture/${id}.pdf`)).toBeNull();
  });
  test("shown only for yes / unknown with no plan on file", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await owner.ownerLifeSupportPlanState(TOKEN)).toEqual({ show: true });
    seed({ life_support: false, life_support_status: "unknown" });
    expect(await owner.ownerLifeSupportPlanState(TOKEN)).toEqual({ show: true });
    seed({ life_support: false, life_support_status: "no" });
    expect(await owner.ownerLifeSupportPlanState(TOKEN)).toEqual({ show: false });
    seed({ life_support: true, life_support_status: "yes" });
    tables["job_compliance_records"]!.push({ job_id: J, record_key: "life_support_plan" });
    expect(await owner.ownerLifeSupportPlanState(TOKEN)).toEqual({ show: false });
    expect(await owner.ownerLifeSupportPlanState("bad")).toEqual({ show: false });
  });
  test("upload → one documents row (kind life_support_plan) → the visit block, the offer block and the row all clear", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await has("piesa_scheduled")).toBe(true);
    const slot = await owner.startLifeSupportPlanUpload(TOKEN, { fileName: "plan.pdf", mime: "application/pdf", size: 2048 });
    expect(slot.path.startsWith(`${J}/owner-life-support/`)).toBe(true);
    objects.set(slot.path, { size: 2048, mimetype: "application/pdf" });
    expect(await owner.finishLifeSupportPlanUpload(TOKEN, { path: slot.path, fileName: "plan.pdf" })).toEqual({ recorded: true });
    const docs = tables["documents"]!.filter((d) => d["kind"] === "life_support_plan");
    expect(docs.length).toBe(1);
    expect(docs[0]).toMatchObject({ job_id: J, storage_path: slot.path, mime_type: "application/pdf", source_system: "owner_life_support" });
    expect(sniffed).toEqual([`${slot.path}|application/pdf`]);
    expect(await has("piesa_scheduled")).toBe(false);
    expect([...(await lifeSupportPlanMissingJobs([J]))]).toEqual([]);
    expect(await owner.ownerLifeSupportPlanState(TOKEN)).toEqual({ show: false });
    // Finishing the same upload again doesn't add a second row.
    await owner.finishLifeSupportPlanUpload(TOKEN, { path: slot.path, fileName: "plan.pdf" });
    expect(tables["documents"]!.filter((d) => d["kind"] === "life_support_plan").length).toBe(1);
  });
  test("refused: a bad link, another job's path, a missing file, a wrong stored type (removed), a job that doesn't need it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    await expect(owner.startLifeSupportPlanUpload("bad", { fileName: "plan.pdf", mime: "application/pdf", size: 10 })).rejects.toThrow();
    await expect(owner.startLifeSupportPlanUpload(TOKEN, { fileName: "a.mp4", mime: "video/mp4", size: 10 })).rejects.toThrow("Please upload a photo or PDF.");
    await expect(owner.startLifeSupportPlanUpload(TOKEN, { fileName: "a.pdf", mime: "application/pdf", size: 201 * 1024 * 1024 })).rejects.toThrow("That file is too big. Please upload a smaller photo or PDF.");
    const other = lifeSupportPlanPath("00000000-0000-4000-8000-0000000000d9", "00000000-0000-4000-8000-0000000000f1", "application/pdf");
    await expect(owner.finishLifeSupportPlanUpload(TOKEN, { path: other, fileName: "plan.pdf" })).rejects.toThrow();
    const slot = await owner.startLifeSupportPlanUpload(TOKEN, { fileName: "plan.pdf", mime: "application/pdf", size: 10 });
    await expect(owner.finishLifeSupportPlanUpload(TOKEN, { path: slot.path, fileName: "plan.pdf" })).rejects.toThrow();
    objects.set(slot.path, { size: 10, mimetype: "video/mp4" });
    await expect(owner.finishLifeSupportPlanUpload(TOKEN, { path: slot.path, fileName: "plan.pdf" })).rejects.toThrow("Please upload a photo or PDF.");
    expect(removed).toContain(slot.path);
    expect(tables["documents"]!.length).toBe(0);
    seed({ life_support: false, life_support_status: "no" });
    await expect(owner.startLifeSupportPlanUpload(TOKEN, { fileName: "plan.pdf", mime: "application/pdf", size: 10 })).rejects.toThrow();
  });
  test("server functions: literal createServerFn chain, token only", () => {
    const fns = readFileSync("src/lib/owner-myjob.functions.ts", "utf8");
    for (const name of ["getLifeSupportPlanState", "startLifeSupportPlanUploadFn", "finishLifeSupportPlanUploadFn"])
      expect(fns).toMatch(new RegExp(`export const ${name} = createServerFn\\(\\{ method: "POST" \\}\\)\\.middleware\\(\\[withRequestMeta\\]\\)\\s*\\.inputValidator\\(`));
    expect(fns).not.toMatch(/jobId/);
  });
  test("the shared upload-safety wrong-type message is unchanged", async () => {
    const shared = readFileSync("src/lib/upload-safety.server.ts", "utf8");
    expect(shared).toContain('BAD_FILE_MESSAGE = "That file type isn\'t accepted. Please upload a PDF, photo (JPG, PNG, WEBP, HEIC), video (MP4, MOV), Word or Excel file."');
  });
  test("My job shows Jo's approved words, verbatim", () => {
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page).toContain(">LIFE SUPPORT PLAN<");
    expect(page).toContain("Someone at your home uses life support equipment (or you weren't sure). Before the electrician's safety check, please upload your written consent or medical plan.");
    expect(page).toContain(">Upload file<");
    expect(page).toContain("Thanks, we've got your life support plan.");
    expect(page).toContain('accept="application/pdf,image/*"');
  });
});
