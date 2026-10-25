// Decision 293 (Jo 25 Oct 2026): the "A4 – Electrical fixes" form. Pure rules + prompt drift, no database.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FIXES_DAY_Q, FIXES_DAY_QUESTIONS, FIXES_DAY_TEMPLATE_NAME, fixesCompletionPlan, fixesDayMissingQuestions, fixesDayPrefillItems, fixesFormNeeded,
  isFixesDayDoc, mergeFixesIntoPiesaSnapshot, readFixesDay, repairWorkList,
} from "../src/lib/fixes-day.core";
import { FORMS, validateTemplate, flattenDefinition } from "../src/lib/mitti-forms.core";
import { B2_OPTIONS } from "../src/lib/official-forms.core";
import { RECTIFICATION_OUTCOMES, SHORT_PIESA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";

const PROMPT = readFileSync("docs/MITTI_FIXES_FORM_PROMPT.md", "utf8");
const body = PROMPT.slice(PROMPT.indexOf("\n---\n"));

describe("prompt drift: docs/MITTI_FIXES_FORM_PROMPT.md carries every question verbatim, in order", () => {
  test("15 questions, Q1..Q15, labels and only-show-when rules", () => {
    expect(FIXES_DAY_QUESTIONS).toHaveLength(15);
    expect(body).toContain(`**Template name:** \`${FIXES_DAY_TEMPLATE_NAME}\``);
    let last = -1;
    for (const q of FIXES_DAY_QUESTIONS) {
      const at = body.indexOf(`Q${q.n}: \`${q.label}\``);
      expect(at, q.label).toBeGreaterThan(-1);
      expect(at, `${q.label} out of order`).toBeGreaterThan(last);
      last = at;
      const line = body.slice(at, body.indexOf("\n", at));
      expect(line.includes("Required"), `${q.label} required flag`).toBe(q.required);
      if (q.showWhen) expect(line).toContain(`only show when Q${q.showWhen.n} = \`${q.showWhen.is[0]}\``);
      if (q.prefill) expect(line).toContain("portal fills this in");
      if (q.help) expect(line).toContain(`help text: \`${q.help}\``);
    }
  });
  test("the build sheet (FORMS.fixes) is derived from the same constants and validates its own template", () => {
    expect(FORMS.fixes.fields.map((f) => f.label)).toEqual(FIXES_DAY_QUESTIONS.map((q) => q.label));
    const def = { template: { items: FIXES_DAY_QUESTIONS.map((q) => ({ item_id: `i${q.n}`, label: q.label, type: q.type === "photo" ? "media" : q.type === "signature" ? "signature" : q.type === "date" ? "datetime" : q.type === "yes_no" ? "question" : "textsingle", ...(q.type === "yes_no" ? { options: { response_set: "yn" } } : {}) })) } };
    expect(validateTemplate("fixes", flattenDefinition(def)).issues.filter((i) => /^Missing/.test(i))).toEqual([]);
    expect(fixesDayMissingQuestions(def)).toEqual([]);
    expect(isFixesDayDoc(def)).toBe(true);
    expect(isFixesDayDoc({ template: { items: [{ label: "Length (m)" }] } })).toBe(false);
  });
});

const REPAIR_NEEDED = RECTIFICATION_OUTCOMES[1];
describe("when the fixes form is needed", () => {
  test("q20 repair needed and q30 not Yes → needed; same-visit fix or no repair → not", () => {
    expect(fixesFormNeeded({ rectificationOutcome: REPAIR_NEEDED })).toBe(true);
    expect(fixesFormNeeded({ rectificationOutcome: REPAIR_NEEDED, rectificationComplete: "No" })).toBe(true);
    expect(fixesFormNeeded({ rectificationOutcome: REPAIR_NEEDED, rectificationComplete: "Yes" })).toBe(false);
    expect(fixesFormNeeded({ rectificationOutcome: RECTIFICATION_OUTCOMES[0] })).toBe(false);
    expect(fixesFormNeeded({})).toBe(false);
  });
  test("repair list = the q21 ticks in official wording, Other with its text", () => {
    expect(repairWorkList({ rectificationWork: `${B2_OPTIONS[0]}, ${B2_OPTIONS[5]}`, rectificationOther: "Loose junction box" })).toEqual([B2_OPTIONS[0], "Other: Loose junction box"]);
    expect(repairWorkList({ rectificationWork: B2_OPTIONS[5] })).toEqual(["Other: (not described)"]);
    expect(repairWorkList({})).toEqual([]);
  });
});

const Q = FIXES_DAY_Q;
const item = (label: string, v: unknown, extra: Record<string, unknown> = {}) => ({ item_id: label.slice(0, 8), label, responses: v == null ? {} : typeof v === "string" ? { text: v } : v, ...extra });
const media = (lat?: number) => [{ media_id: "m1", ...(lat != null ? { location: { latitude: lat, longitude: 145.0 } } : {}) }];
const yes = (label: string) => item(label, { selected: [{ label: "Yes" }] });
const no = (label: string) => item(label, { selected: [{ label: "No" }] });
const fullAudit = () => ({ items: [
  item(Q.jobNumber, "HV-3001"), item(Q.electricianName, "Sam Sparks"), item(Q.licence, "A1"), item(Q.recName, "Sparks P/L"), item(Q.recNo, "REC9"), item(Q.phone, "0400"),
  yes(Q.done), item(Q.coesNumber, "C123"), item(Q.certDate, "2026-10-20"),
  item(Q.coesFile, null, { media: media() }), item(Q.workPhoto, null, { media: media(-37.8) }),
  item(Q.signature, { image: { media_id: "0123456789abcdef0123456789abcdef", timestamp: "2026-10-20T03:00:00Z" }, name: "Sam Sparks" }),
] });

describe("reading the audit and planning the Complete press", () => {
  test("every answer is read by exact wording", () => {
    const r = readFixesDay(fullAudit());
    expect(r).toMatchObject({ jobNumber: "HV-3001", done: "Yes", coesNumber: "C123", certDate: "2026-10-20", licence: "A1", recNo: "REC9" });
    expect(r.coesFiles).toHaveLength(1);
    expect(r.workPhotos[0]).toMatchObject({ lat: -37.8 });
    expect(r.signature).toMatchObject({ present: true, name: "Sam Sparks" });
  });
  test("not completed in Mitti → waiting; Q9 No → office item with the Q10 text", () => {
    expect(fixesCompletionPlan(readFixesDay(fullAudit()), { completed: false, today: "2026-10-25" })).toMatchObject({ kind: "waiting" });
    const a = { items: [no(Q.done), item(Q.notDone, "RCD still on order")] };
    expect(fixesCompletionPlan(readFixesDay(a), { completed: true, today: "2026-10-25" })).toEqual({ kind: "not_done", text: "RCD still on order" });
  });
  test("Q9 Yes needs CoES number, date (not future), CoES file, geotagged work photo and signature — each missing one is named", () => {
    const base = fullAudit();
    const plan = fixesCompletionPlan(readFixesDay(base), { completed: true, today: "2026-10-25" });
    expect(plan.kind).toBe("done");
    const without = (label: string, replace?: unknown) => ({ items: base.items.map((i) => (i.label === label ? (replace as typeof i) ?? item(label, null) : i)) });
    expect(fixesCompletionPlan(readFixesDay(without(Q.coesNumber)), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [Q.coesNumber] });
    expect(fixesCompletionPlan(readFixesDay(without(Q.certDate, item(Q.certDate, "2026-12-01"))), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [`${Q.certDate} (cannot be in the future)`] });
    expect(fixesCompletionPlan(readFixesDay(without(Q.coesFile)), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [Q.coesFile] });
    expect(fixesCompletionPlan(readFixesDay(without(Q.workPhoto, item(Q.workPhoto, null, { media: media() }))), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [`${Q.workPhoto} (must be geotagged)`] });
    expect(fixesCompletionPlan(readFixesDay(without(Q.signature)), { completed: true, today: "2026-10-25" })).toMatchObject({ kind: "missing", missing: [Q.signature] });
  });
});

describe("Part C lands in the stored PIESA answers where the same-visit answers would sit", () => {
  const L = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
  test("merge sets rectificationComplete/CoES/date, fills blank Part B3 electrician details, and the q45 file", () => {
    const snapshot = [
      { label: L("rectificationNeeded"), value: "Yes" },
      { label: L("b3.licence"), value: "B3-A1" }, // pre-filled on the PIESA: wins over the fixes form
      { label: L("rectificationComplete"), value: null },
      { label: L("coesNumber"), value: null },
      { label: L("certDate"), value: null },
      { label: PIESA_EVIDENCE_BY_ID.ces_file.label, value: null },
    ];
    const r = readFixesDay(fullAudit());
    const plan = fixesCompletionPlan(r, { completed: true, today: "2026-10-25" });
    expect(plan.kind).toBe("done");
    const merged = mergeFixesIntoPiesaSnapshot(snapshot, r, plan as Extract<typeof plan, { kind: "done" }>);
    const short = shortAnswersFromEntries("piesa", merged as { label: string; value: string | null }[]);
    expect(short["rectificationComplete"]).toBe("Yes");
    expect(short["coesNumber"]).toBe("C123");
    expect(short["certDate"]).toBe("2026-10-20");
    expect(merged.filter((e) => e.label === L("b3.licence")).map((e) => e.value)).toEqual(["B3-A1"]); // the PIESA's own answer wins
    const ces = merged.find((e) => e.label === PIESA_EVIDENCE_BY_ID.ces_file.label)!;
    expect(ces.media).toHaveLength(1);
    expect(merged.filter((e) => e.label === L("b3.recName")).map((e) => [e.value, e.section])).toEqual([["Sparks P/L", "fixes day (A4)"]]); // appended when absent
    expect(short["c.licence"]).toBeUndefined(); // Section C is derived by expandPiesa from Part B3, not stored twice
  });
});

describe("prefill by exact wording", () => {
  test("only questions the template has, only facts that exist; the repair list is numbered", () => {
    const tpl = { template: { items: FIXES_DAY_QUESTIONS.filter((q) => q.n !== 7).map((q) => ({ item_id: `i${q.n}`, label: q.label })) } };
    const items = fixesDayPrefillItems(tpl, { jobNumber: "HV-1", address: "1 Test St", electricianName: "Sam", licence: null, recName: "Sparks", recNo: "R1", phone: "0400", repairList: [B2_OPTIONS[0], "Other: box"] });
    expect(items.map((i) => i.item_id)).toEqual(["i1", "i2", "i3", "i5", "i6", "i8"]); // no licence (null), no phone (not on template)
    expect(items.at(-1)!.responses).toEqual({ text: `1. ${B2_OPTIONS[0]}\n2. Other: box` });
  });
});

// ---------- F06: a file that can't be kept holds the form (no evidence / PIESA record / completion) and the sweep retries ----------
describe("completeFixesForm: files are kept first; a failed download holds and is retried", () => {
  type Row = Record<string, unknown>;
  const JOB = "00000000-0000-0000-0000-0000000000f6", AUDIT = "audit-fixes-1", TPL = `template_${"f6".repeat(16)}`;
  let tables: Record<string, Row[]> = {};
  let uploads: string[] = [];
  const reset = () => {
    uploads = [];
    tables = {
      jobs: [{ id: JOB, job_number: "HV-3001", stage: "rectification_booked", source: "website", deleted_at: null, qa_archived_at: null }],
      assessments: [{ id: "as1", job_id: JOB, mitti_raw_snapshot: [{ label: "Original", value: "kept" }] }],
      workflow_settings: [{ id: 1, mitti_fixes_template_id: TPL }],
      evidence_requirements: [{ job_id: JOB, category: "rectification_completion", status: "outstanding" }],
      documents: [], workflow_events: [], job_assignments: [],
    };
  };
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select", patch: Row = {}, mode: "many" | "maybe" = "many", count = false;
    const rows = () => (tables[table] ??= []);
    const contains = (have: unknown, want: Row) => Object.entries(want).every(([k, v]) => (have as Row | null)?.[k] === v);
    const run = () => {
      if (op === "insert") { rows().push({ ...patch }); return { data: null, error: null }; }
      if (op === "update") { for (const r of rows()) if (filters.every((f) => f(r))) Object.assign(r, patch); return { data: null, error: null }; }
      const out = rows().filter((r) => filters.every((f) => f(r)));
      if (count) return { data: null, count: out.length, error: null };
      return { data: mode === "many" ? out : out[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { if (op === "select") count = o?.count === "exact"; return b; },
      insert: (p: Row) => { op = "insert"; patch = p; return b; }, update: (p: Row) => { op = "update"; patch = p; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; }, in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
      contains: (c: string, v: Row) => { filters.push((r) => contains(r[c], v)); return b; },
      order: () => b, limit: () => b, maybeSingle: () => { mode = "maybe"; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  }
  const fakeAdmin = { from: builder, storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { data: { path }, error: null }; } }) } };
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
  mock.module("../src/lib/workflow.server", () => ({
    WorkflowError: class WorkflowError extends Error {},
    getStage: async () => "rectification_booked",
    logEvent: async (job: string, _actor: string | null, type: string, summary: string, details?: unknown) => { (tables["workflow_events"] ??= []).push({ job_id: job, event_type: type, summary, details: details ?? {} }); },
  }));
  const audit = { items: [...fullAudit().items, item(Q.repairList, "1. Replace RCD")], audit_id: AUDIT, template_id: TPL, completed: true };
  const call = (async () => audit) as never;
  const PDF = new TextEncoder().encode("%PDF-1.4");

  test("saveFixesFiles: a throwing download is reported as failed, a later run saves it, a filed document counts as saved", async () => {
    reset();
    const { saveFixesFiles } = await import("../src/lib/fixes-day.server");
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error("Mitti media 502"); return { bytes: PDF, contentType: "application/pdf" }; };
    const files = [{ label: "Certificate of Electrical Safety", title: "CoES", media: [{ mediaId: "c1" }] }, { label: "Finished work photo", title: "Photo", media: [{ mediaId: "w1" }] }];
    const first = await saveFixesFiles(JOB, AUDIT, files, flaky as never);
    expect(first.failed).toEqual([{ label: "Certificate of Electrical Safety", mediaId: "c1", reason: "Mitti media 502" }]);
    expect(first.saved).toHaveLength(1);
    const second = await saveFixesFiles(JOB, AUDIT, files, flaky as never);
    expect(second.failed).toEqual([]);
    expect(second.saved).toHaveLength(2); // c1 stored now; w1 already on the job counts as saved
    expect(tables["documents"]!.length).toBe(2);
  });

  test("a failed file → held once; no Section C, no evidence update, no completion event; the next run gets past the files", async () => {
    reset();
    const { completeFixesForm } = await import("../src/lib/fixes-day.server");
    const failing = async () => { throw new Error("Mitti media timeout"); };
    const r = await completeFixesForm(JOB, AUDIT, { call, fetchMedia: failing as never, today: "2026-10-25" });
    expect(r.status).toBe("held");
    expect(r.detail).toContain("Certificate of Electrical Safety");
    const ev = tables["workflow_events"]!;
    expect(ev.filter((e) => e["event_type"] === "fixes_form_held")).toHaveLength(1);
    expect(ev.some((e) => e["event_type"] === "fixes_form_completed")).toBe(false);
    expect(tables["assessments"]![0]!["mitti_raw_snapshot"]).toEqual([{ label: "Original", value: "kept" }]);
    expect(tables["evidence_requirements"]![0]!["status"]).toBe("outstanding");
    // Retry (still failing): the office item is not repeated.
    await completeFixesForm(JOB, AUDIT, { call, fetchMedia: failing as never, today: "2026-10-25" });
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "fixes_form_held")).toHaveLength(1);
    // Media readable again: the files are kept and processing moves on to the Section C merge (later steps not stubbed here).
    const ok = async () => ({ bytes: PDF, contentType: "application/pdf" });
    await completeFixesForm(JOB, AUDIT, { call, fetchMedia: ok as never, today: "2026-10-25" }).catch(() => undefined);
    expect(tables["documents"]!.length).toBeGreaterThan(0);
    expect((tables["assessments"]![0]!["mitti_raw_snapshot"] as unknown[]).length).toBeGreaterThan(1);
  });
});
