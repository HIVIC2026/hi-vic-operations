// New job flow Part 8 Task 10 (Jo 2 Nov 2026, answer 16): the A5 "Changes during the job" -> printed on the SWMS.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { INSTALL_DAY_NOV2_Q, INSTALL_DAY_QUESTIONS, installDayNov2MissingQuestions, installDaySwmsChanges } from "../src/lib/install-day.core";
import { swmsChangesKey } from "../src/lib/swms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { readFileSync } from "node:fs";

const item = (label: string, x: Record<string, unknown> = {}) => ({ item_id: label, label, ...x });
const text = (label: string, t: string, at?: string) => item(label, { type: "text", responses: { text: t, ...(at ? { datetime: at } : {}) } });
const blank = (label: string) => item(label, { type: "text", responses: {} });
const a5 = (what: string | null, control: string | null, extra: Record<string, unknown> = {}) => ({ ...extra, items: [
  what == null ? blank(INSTALL_DAY_NOV2_Q.swmsChange) : text(INSTALL_DAY_NOV2_Q.swmsChange, what),
  control == null ? blank(INSTALL_DAY_NOV2_Q.swmsNewControl) : text(INSTALL_DAY_NOV2_Q.swmsNewControl, control),
] });
const WHAT = "Wasp nest in the back ceiling", CTRL = "Area closed off, nest removed";

describe("installDaySwmsChanges", () => {
  test("filled item -> one change by the Lead Installer, time from the audit", () => {
    const r = installDaySwmsChanges(a5(WHAT, CTRL, { modified_at: "2026-11-03T04:00:00Z" }), "John Smith");
    expect(r).toEqual([{ what: WHAT, control: CTRL, by: "John Smith", at: "2026-11-03T04:00:00Z" }]);
  });
  test("an answer time on the item wins over the audit's modified time", () => {
    const audit = { modified_at: "2026-11-03T06:00:00Z", items: [text(INSTALL_DAY_NOV2_Q.swmsChange, WHAT, "2026-11-03T02:30:00Z"), text(INSTALL_DAY_NOV2_Q.swmsNewControl, CTRL)] };
    expect(installDaySwmsChanges(audit, "John Smith")[0]!.at).toBe("2026-11-03T02:30:00Z");
  });
  test("blank, or not on the form (old form): none", () => {
    expect(installDaySwmsChanges(a5(null, null), "John Smith")).toEqual([]);
    expect(installDaySwmsChanges(a5("  ", CTRL), "John Smith")).toEqual([]);
    expect(installDaySwmsChanges({ items: [item("Something else")] }, "John Smith")).toEqual([]);
    expect(installDaySwmsChanges(null, "John Smith")).toEqual([]);
  });
  test("a change with no control still records (the office sees it)", () => {
    expect(installDaySwmsChanges(a5(WHAT, null, { modified_at: "2026-11-03T04:00:00Z" }), "J")[0]).toMatchObject({ what: WHAT, control: "" });
  });
  test("labels sit outside Q1-Q48 and are advisory on a template that lacks them", () => {
    expect(INSTALL_DAY_QUESTIONS.at(-1)!.n).toBe(48);
    const labels = [INSTALL_DAY_NOV2_Q.swmsChange, INSTALL_DAY_NOV2_Q.swmsNewControl];
    for (const l of labels) expect(INSTALL_DAY_QUESTIONS.some((q) => q.label === l)).toBe(false);
    const tpl = { items: [item("Unrelated")] };
    expect(installDayNov2MissingQuestions(tpl)).toEqual(expect.arrayContaining(labels));
    expect(installDayNov2MissingQuestions({ items: labels.map((l) => item(l)) })).not.toEqual(expect.arrayContaining(labels));
  });
  test("an old A5 gives no form-health problem beyond 'send a new form'", () => {
    const v = validateSavedDefinition("piisa", { items: [item("Unrelated")] });
    expect(v.issues.filter((i) => i.includes(INSTALL_DAY_NOV2_Q.swmsChange)).every((i) => /send a new form/.test(i))).toBe(true);
  });
  test("paste file carries both labels character for character", () => {
    const b = readFileSync("docs/mitti-paste-2026-11-02-A5-adult-part-b.md", "utf8");
    expect(b).toContain(`"${INSTALL_DAY_NOV2_Q.swmsChange}"`);
    expect(b).toContain(`"${INSTALL_DAY_NOV2_Q.swmsNewControl}"`);
  });
});

describe("swmsChangesKey", () => {
  test("same set -> same key; edited or empty differ", () => {
    const c = { what: WHAT, control: CTRL, by: "J", at: "t" };
    expect(swmsChangesKey([c])).toBe(swmsChangesKey([{ ...c }]));
    expect(swmsChangesKey([c])).not.toBe(swmsChangesKey([{ ...c, control: "Other" }]));
    expect(swmsChangesKey([])).toBe("");
  });
});

const tables: Tables = {};
const base = memoryPostgrest(tables);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: base }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => { (tables.workflow_events ??= []).push({ job_id, actor_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
mock.module("../src/lib/prestart.server", () => ({ leadInstallerCert: async () => ({ name: "John Smith" }) }));
const filed: unknown[][] = [];
let fileThrows = false;
let fileResult: { filed: boolean; path: string | null } = { filed: true, path: "p" };
mock.module("../src/lib/swms.server", () => ({ fileSwms: async (...a: unknown[]) => { filed.push(a); if (fileThrows) throw new Error("storage down"); return fileResult; } }));
const { syncSwmsChanges } = await import("../src/lib/swms-changes.server");

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; filed.length = 0; fileThrows = false; fileResult = { filed: true, path: "p" }; });

describe("syncSwmsChanges", () => {
  test("first read files once; same again does not; edited files again", async () => {
    const audit = a5(WHAT, CTRL, { modified_at: "2026-11-03T04:00:00Z" });
    expect(await syncSwmsChanges("j1", null, audit)).toBe("filed");
    expect(filed).toHaveLength(1);
    expect(filed[0]![0]).toBe("j1");
    expect((filed[0]![2] as any).changes).toEqual([{ what: WHAT, control: CTRL, by: "John Smith", at: "2026-11-03T04:00:00Z" }]);
    expect(await syncSwmsChanges("j1", null, audit)).toBe("unchanged");
    expect(filed).toHaveLength(1);
    expect(await syncSwmsChanges("j1", null, a5(WHAT, "Nest removed and sealed", { modified_at: "2026-11-03T04:00:00Z" }))).toBe("filed");
    expect(filed).toHaveLength(2);
  });
  test("no changes / old form: nothing filed", async () => {
    expect(await syncSwmsChanges("j1", null, a5(null, null))).toBe("none");
    expect(await syncSwmsChanges("j1", null, { items: [] })).toBe("none");
    expect(filed).toHaveLength(0);
  });
  test("a re-file failure logs on the job, never throws, and retries next sync", async () => {
    fileThrows = true;
    const audit = a5(WHAT, CTRL, { modified_at: "2026-11-03T04:00:00Z" });
    expect(await syncSwmsChanges("j1", null, audit)).toBe("failed");
    expect(tables.workflow_events!.some((e) => e.event_type === "swms_changes_refile_failed")).toBe(true);
    fileThrows = false;
    expect(await syncSwmsChanges("j1", null, audit)).toBe("filed");
  });
  test("SWMS not complete yet (fileSwms files nothing): not marked done, so it files on a later sync", async () => {
    fileResult = { filed: false, path: null };
    const audit = a5(WHAT, CTRL, { modified_at: "2026-11-03T04:00:00Z" });
    expect(await syncSwmsChanges("j1", null, audit)).toBe("waiting");
    expect(await syncSwmsChanges("j1", null, audit)).toBe("waiting");
    expect(filed).toHaveLength(2);
  });
});

describe("SWMS PDF", () => {
  test("prints a Changes during the job table only when there are changes", async () => {
    const { buildSwms } = await import("../src/lib/swms.core");
    const { buildSwmsPdf } = await import("../src/lib/swms-pdf.server");
    const plan = buildSwms({ jobNumber: "HV-TEST-1", address: "1 Test St", businessName: "TEST Co", installDate: "2026-11-03", lead: { name: "John Smith", workerId: "t1" }, crew: [], yearBuilt: 1972, hazardNote: null, siteNote: null });
    const sigs = [{ key: "w:t1", name: "John Smith", typedName: "John Smith", signedAt: "2026-11-02T08:15:00Z" }];
    const none = await buildSwmsPdf(plan, sigs, {});
    const some = await buildSwmsPdf(plan, sigs, { changes: [{ what: WHAT, control: CTRL, by: "John Smith", at: "2026-11-03T04:00:00Z" }] });
    expect(none.layout.changeHeaderPages).toEqual([]);
    expect(some.layout.changeHeaderPages.length).toBeGreaterThan(0);
  });
});
