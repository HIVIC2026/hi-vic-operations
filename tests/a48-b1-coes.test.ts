// A48 batch 1 task 5 (Jo 29 Oct 2026): the electrical certificate (CoES) kept after the repairs is read by the AI. A clear
// description of ceiling-space repair work is ticked; anything else waits for the office (Needs me "Check electrical
// certificate — {why}", Tick or Reject) and the install day can't be booked until it is ticked. No repairs → no check.
// The REAL coes-check / workflow.server code runs against an in-memory database; the AI gateway ("ai" + "@ai-sdk/openai")
// is stubbed, so nothing goes over the network. Own file: it mocks modules for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { FIXES_WORK_OPTIONS, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";
import { FIXES_COES_DOC_TITLE } from "../src/lib/fixes-day.core";
import { needsCandidates } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

const J = "00000000-0000-4000-8000-0000000000d1", P = "00000000-0000-4000-8000-0000000000d2", OFFICE = "00000000-0000-4000-8000-0000000000d3";
const LINE = "Check electrical certificate — ";

// ---- the stored A3 answers (label/value) + the CoES media on q45 ----
const entries = (values: Record<string, string>) => SHORT_PIESA_FIELDS.filter((f) => values[f.id!] !== undefined).map((f) => ({ label: f.label, value: values[f.id!]! }));
const clean = (): Record<string, string> => ({
  jobRef: "HV-0801", address: "3 Elm St, Kew VIC 3101", noPriceTalk: "Yes", inspectionDate: "2026-10-28", lifeSupportPresent: "No", mainsSafe: "Yes", solarPresent: "No", ceilingSafe: "Yes",
  downlightsPresent: "No", appliancesPresent: "No", rectificationNeeded: "No", "b3.licence": "L1", "b3.name": "Sam Spark", "b3.recName": "Spark Co", "b3.recNo": "R1", "b3.phone": "0422 222 222", "b3.declaration": "Yes", electricianSignature: "sig-1",
});
const repaired = (): Record<string, string> => ({
  ...clean(), downlightsPresent: "Yes", downlightCount: "6", downlightsNonIc: "Yes", downlightsNonIcCount: "6", rectificationNeeded: "Yes", fixesWork: FIXES_WORK_OPTIONS[0]!, fixesDownlightCount: "6", fixesPriceIncGst: "900",
  rectificationComplete: "Yes", coesNumber: "CES-1", certDate: "2026-10-29", fixesSignedBy: "Sam Spark", fixesSignedOn: "2026-10-29",
});
const CES = PIESA_EVIDENCE_BY_ID.ces_file.label;
const snapshot = (values: Record<string, string>, mediaIds: string[]) => [...entries(values), ...(mediaIds.length ? [{ label: CES, value: `${mediaIds.length} file`, media: mediaIds.map((m) => ({ mediaId: m, capturedAt: null, lat: null, lng: null })) }] : [])];
const doc = (auditId: string, mediaId: string, mime = "application/pdf") => ({ id: `doc-${mediaId}`, job_id: J, kind: "piesa_evidence", title: FIXES_COES_DOC_TITLE, storage_path: `${J}/mitti/fixes/${auditId}-${mediaId}.${mime.includes("pdf") ? "pdf" : "jpg"}`, mime_type: mime, source_system: "mitti", external_id: `${auditId}:${mediaId}` });

// ---- in-memory database + storage; the AI gateway stubbed ----
const tables: Tables = {};
const stored = new Map<string, Uint8Array>();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }),
  storage: { from: () => ({ download: async (p: string) => stored.has(p) ? { data: new Blob([stored.get(p)!]), error: null } : { data: null, error: { message: "not found" } }, upload: async () => ({ error: { message: "no upload in test" } }) }) },
} }));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "full", label: "whole ceiling", measurementRow: null }), advanceSiteRequirements: async () => ({ advanced: false, scope: "full" }) }));
type AiArgs = { instructions?: string; messages: { role: string; content: { type: string; text?: string; data?: unknown; mediaType?: string }[] }[] };
const ai = { calls: [] as AiArgs[], reply: "" as string | Error, model: [] as string[], baseURL: [] as string[] };
mock.module("@ai-sdk/openai", () => ({ createOpenAI: (o: { baseURL: string }) => { ai.baseURL.push(o.baseURL); return { responses: (m: string) => { ai.model.push(m); return { modelId: m }; } }; } }));
mock.module("ai", () => ({ streamText: (args: AiArgs) => { ai.calls.push(args); const r = ai.reply; return { get text() { return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); } }; } }));

const core = await import("../src/lib/coes-check.core");
const server = await import("../src/lib/coes-check.server");
const { stageEntryBlockers } = await import("../src/lib/workflow.server");

function seed(values: Record<string, string>, mediaIds: string[], docs = mediaIds.map((m) => doc("aud-4", m))) {
  for (const k of Object.keys(tables)) delete tables[k];
  stored.clear();
  Object.assign(ai, { calls: [], reply: "", model: [], baseURL: [] });
  process.env["LOVABLE_API_KEY"] = "test-key";
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0801", source: "website", stage: "installation_scheduling", deleted_at: null, qa_archived_at: null, life_support_status: "no", life_support: false, property_id: P, business_unit: "hivic" }],
    properties: [{ id: P, address_line: "3 Elm St, Kew VIC 3101", suburb: "Kew" }],
    assessments: [{ id: "as-1", job_id: J, status: "complete", external_mitti_id: "aud-3", mitti_modified_at: "2026-10-28T01:00:00.000Z", mitti_completed: true, mitti_raw_snapshot: snapshot(values, mediaIds) }],
    documents: docs, workflow_events: [], job_assignments: [], profiles: [], evidence_requirements: [], rectification_items: [], piesa_records: [],
  });
  for (const d of docs) stored.set(d.storage_path, new TextEncoder().encode(`%PDF-1.4 certificate ${d.external_id}`));
}
const events = (type: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === type);
const evRows = () => tables["workflow_events"]!.map((e) => ({ id: String(e["id"]), event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] as Record<string, unknown> }));
const coesBlocked = async () => (await stageEntryBlockers(J, "installation_booked")).filter((b) => b.startsWith(LINE));
const reply = (verdict: string, quote: string | null) => JSON.stringify({ verdict, quote });

describe("pure: verdict, wording, Needs me row", () => {
  test("model reply → verdict (JSON, fenced JSON); ceiling_work needs a quote; anything else is unsure", () => {
    expect(core.coesVerdictFromModel(reply("ceiling_work", "Replaced 6 downlights in ceiling space with IC-4"))).toEqual({ verdict: "ceiling_work", quote: "Replaced 6 downlights in ceiling space with IC-4" });
    expect(core.coesVerdictFromModel("```json\n" + reply("not_ceiling", "Replaced main switch") + "\n```")).toEqual({ verdict: "not_ceiling", quote: "Replaced main switch" });
    expect(core.coesVerdictFromModel(reply("ceiling_work", null))).toEqual({ verdict: "unsure", quote: null });
    expect(core.coesVerdictFromModel("I think it's fine")).toEqual({ verdict: "unsure", quote: null });
    expect(core.coesVerdictFromModel(reply("maybe", "x"))).toEqual({ verdict: "unsure", quote: "x" });
  });
  test("office line wording", () => {
    expect(core.coesOfficeLine(core.COES_WHY.unsure)).toBe(`${LINE}the AI couldn't tell if it covers the ceiling-space repairs`);
  });
  test("Needs me: Today row with Tick / Reject, on the Other card", () => {
    const rows = needsCandidates({ jobId: J, jobNumber: "HV-0801", surname: "Lee", suburb: "Kew", coesCheck: { at: "2026-10-29T01:00:00Z", why: core.COES_WHY.not_ceiling, eventId: "ev-1" } }, Date.parse("2026-10-29T02:00:00Z"));
    const row = rows.find((r) => r.kind === "coes_check")!;
    expect(row).toMatchObject({ group: "today", line: `${LINE}it doesn't say the repairs were in the ceiling space`, eventId: "ev-1", button: { label: "Tick", to: "act", act: "coes_tick" }, secondary: { label: "Reject", to: "act", act: "coes_reject" } });
    expect(cardOf("coes_check")).toBe("other");
  });
});

describe("the AI ticks a certificate that clearly describes ceiling-space repairs", () => {
  beforeEach(() => seed(repaired(), ["m1"]));
  test("ceiling_work → coes_checked {by: ai}, no row, install not blocked by it; the PDF goes to the gateway as a file", async () => {
    ai.reply = reply("ceiling_work", "Replaced 6 non-IC downlights in the ceiling space with IC-4 rated");
    expect(await server.checkCurrentCoes(J, null)).toBe("ticked by AI");
    const ev = events(core.COES_CHECKED_EVENT);
    expect(ev.length).toBe(1);
    expect(ev[0]!["details"]).toMatchObject({ by: "ai", verdict: "ceiling_work", quote: "Replaced 6 non-IC downlights in the ceiling space with IC-4 rated", key: "coes:m1" });
    expect(core.coesNeedsFact(evRows())).toBeNull();
    expect(await coesBlocked()).toEqual([]);
    // Same gateway + model as the AI email replies; the certificate is sent as a file part (PDF), with the prompt.
    expect(ai.baseURL).toEqual(["https://ai.gateway.lovable.dev/v1"]);
    expect(ai.model).toEqual(["openai/gpt-6-astra"]);
    expect(ai.calls[0]!.instructions).toBe(core.COES_PROMPT);
    const parts = ai.calls[0]!.messages[0]!.content;
    const file = parts.find((p) => p.type === "file")!;
    expect(file.mediaType).toBe("application/pdf");
    expect(new TextDecoder().decode(file.data as Uint8Array)).toContain("%PDF-1.4 certificate aud-4:m1");
  });
  test("the same certificate is checked once (re-sync / sweep)", async () => {
    ai.reply = reply("ceiling_work", "Ceiling space wiring made safe");
    await server.checkCurrentCoes(J, null);
    await server.checkCurrentCoes(J, null);
    expect(ai.calls.length).toBe(1);
    expect(events(core.COES_CHECKED_EVENT).length).toBe(1);
  });
  test("a photo of the certificate goes as an image file", async () => {
    seed(repaired(), ["m2"], [doc("aud-4", "m2", "image/jpeg")]);
    ai.reply = reply("ceiling_work", "Ceiling space wiring made safe");
    await server.checkCurrentCoes(J, null);
    expect(ai.calls[0]!.messages[0]!.content.find((p) => p.type === "file")!.mediaType).toBe("image/jpeg");
  });
});

describe("unsure / not ceiling → office row; install waits for Tick", () => {
  for (const [verdict, why] of [["unsure", core.COES_WHY.unsure], ["not_ceiling", core.COES_WHY.not_ceiling]] as const) {
    test(`${verdict} → row "${LINE}${why}", install blocked until the office ticks`, async () => {
      seed(repaired(), ["m1"]);
      ai.reply = reply(verdict, verdict === "not_ceiling" ? "Replaced main switch" : null);
      await server.checkCurrentCoes(J, null);
      expect(events(core.COES_CHECKED_EVENT)[0]!["details"]).toMatchObject({ by: "ai", verdict });
      const fact = core.coesNeedsFact(evRows())!;
      expect(fact.why).toBe(why);
      expect(await coesBlocked()).toEqual([`${LINE}${why}`]);
      await server.officeTickCoes(fact.eventId!, OFFICE);
      const ticked = events(core.COES_CHECKED_EVENT).at(-1)!;
      expect(ticked["details"]).toMatchObject({ by: "office", verdict: "ceiling_work", key: "coes:m1" });
      expect(ticked["actor_id"]).toBe(OFFICE);
      expect(core.coesNeedsFact(evRows())).toBeNull();
      expect(await coesBlocked()).toEqual([]);
    });
  }
  test("office Reject → coes_rejected {by: office, note}; still blocked, row stays", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = reply("unsure", null);
    await server.checkCurrentCoes(J, null);
    await server.officeRejectCoes(core.coesNeedsFact(evRows())!.eventId!, "work description is blank", OFFICE);
    expect(events(core.COES_REJECTED_EVENT)[0]!["details"]).toMatchObject({ by: "office", note: "work description is blank", key: "coes:m1" });
    const why = "you rejected it (work description is blank) — waiting for a new certificate";
    expect(core.coesNeedsFact(evRows())!.why).toBe(why);
    expect(await coesBlocked()).toEqual([`${LINE}${why}`]);
  });
  test("a stale row (a newer certificate came in) can't be ticked", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = reply("unsure", null);
    await server.checkCurrentCoes(J, null);
    const old = core.coesNeedsFact(evRows())!.eventId!;
    tables["assessments"]![0]!["mitti_raw_snapshot"] = snapshot(repaired(), ["m9"]);
    (tables["documents"] as unknown[]).push(doc("aud-5", "m9"));
    await expect(server.officeTickCoes(old, OFFICE)).rejects.toThrow("A newer certificate");
  });
});

describe("ai error → office row, never auto-ticked", () => {
  test("no key", async () => {
    seed(repaired(), ["m1"]);
    delete process.env["LOVABLE_API_KEY"];
    await server.checkCurrentCoes(J, null);
    expect(ai.calls.length).toBe(0);
    expect(events(core.COES_CHECKED_EVENT)[0]!["details"]).toMatchObject({ by: "ai", verdict: "unsure", why: "ai_error" });
    expect(core.coesNeedsFact(evRows())!.why).toBe(core.COES_WHY.ai_error);
    expect(await coesBlocked()).toEqual([`${LINE}${core.COES_WHY.ai_error}`]);
  });
  test("gateway throws", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = new Error("gateway down");
    expect(await server.checkCurrentCoes(J, null)).toContain("office");
    expect(events(core.COES_CHECKED_EVENT)[0]!["details"]).toMatchObject({ by: "ai", verdict: "unsure", why: "ai_error", error: "gateway down" });
    expect(await coesBlocked()).toEqual([`${LINE}${core.COES_WHY.ai_error}`]);
  });
  test("a failed check is retried later (once the AI is back) without a duplicate office event while it stays down", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = new Error("gateway down");
    await server.checkCurrentCoes(J, null);
    await server.checkCurrentCoes(J, null);
    expect(events(core.COES_CHECKED_EVENT).length).toBe(1);
    ai.reply = reply("ceiling_work", "Ceiling space wiring made safe");
    await server.checkCurrentCoes(J, null);
    expect(events(core.COES_CHECKED_EVENT).at(-1)!["details"]).toMatchObject({ by: "ai", verdict: "ceiling_work" });
    expect(await coesBlocked()).toEqual([]);
  });
  test("the certificate file isn't on the job → office row, no AI call", async () => {
    seed(repaired(), ["m1"], []);
    await server.checkCurrentCoes(J, null);
    expect(ai.calls.length).toBe(0);
    expect(await coesBlocked()).toEqual([`${LINE}${core.COES_WHY.no_file}`]);
  });
  test("an office decision is never overwritten by a later AI run", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = reply("unsure", null);
    await server.checkCurrentCoes(J, null);
    await server.officeRejectCoes(core.coesNeedsFact(evRows())!.eventId!, "", OFFICE);
    ai.reply = reply("ceiling_work", "Ceiling space wiring made safe");
    await server.checkCurrentCoes(J, null);
    expect(ai.calls.length).toBe(1);
    expect(core.coesState(evRows()).state).toBe("rejected");
  });
});

describe("no rectification → no check needed; a new certificate re-runs the check", () => {
  test("clean safety check (no repairs) → nothing checked, nothing blocked", async () => {
    seed(clean(), []);
    expect(await server.checkCurrentCoes(J, null)).toBe("skipped: no repairs, no certificate needed");
    expect(ai.calls.length).toBe(0);
    expect(tables["workflow_events"]!.length).toBe(0);
    expect(await coesBlocked()).toEqual([]);
  });
  test("repairs needed but not done yet → not needed yet", async () => {
    const v = repaired(); delete v["rectificationComplete"];
    seed(v, []);
    expect(await server.checkCurrentCoes(J, null)).toBe("skipped: no repairs, no certificate needed");
    expect(await coesBlocked()).toEqual([]);
  });
  test("repairs done but nothing checked (e.g. filed before this change) → blocked as 'not checked yet'", async () => {
    seed(repaired(), ["m1"]);
    expect(await coesBlocked()).toEqual([`${LINE}${core.COES_WHY.not_checked}`]);
  });
  test("new certificate upload re-runs the check (new media id → new key)", async () => {
    seed(repaired(), ["m1"]);
    ai.reply = reply("not_ceiling", "Replaced main switch");
    await server.checkCurrentCoes(J, null);
    await server.officeRejectCoes(core.coesNeedsFact(evRows())!.eventId!, "wrong certificate", OFFICE);
    // The electrician sends a new certificate (the fixes form merges it into q45; the file is kept with the job).
    tables["assessments"]![0]!["mitti_raw_snapshot"] = snapshot(repaired(), ["m7"]);
    const d = doc("aud-6", "m7"); (tables["documents"] as unknown[]).push(d); stored.set(d.storage_path, new TextEncoder().encode("%PDF new"));
    ai.reply = reply("ceiling_work", "Ceiling space wiring made safe");
    expect(await server.checkCurrentCoes(J, null)).toBe("ticked by AI");
    expect(ai.calls.length).toBe(2);
    expect(events(core.COES_CHECKED_EVENT).at(-1)!["details"]).toMatchObject({ by: "ai", verdict: "ceiling_work", key: "coes:m7" });
    expect(core.coesNeedsFact(evRows())).toBeNull();
    expect(await coesBlocked()).toEqual([]);
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(new URL(`../src/lib/${p}`, import.meta.url), "utf8");
  test("the CoES upload paths run the check: A4 fixes form (after Section C merge) and the A3 sync (after the evidence files)", () => {
    const fixes = src("fixes-day.server.ts");
    expect(fixes.indexOf("checkCurrentCoes(jobId")).toBeGreaterThan(fixes.indexOf("mergeFixesIntoPiesaSnapshot(snapshotOf("));
    const sync = src("mitti.server.ts");
    expect(sync.indexOf("checkCurrentCoes(jobId")).toBeGreaterThan(sync.indexOf("await savePiesaEvidenceFiles(jobId"));
  });
  test("office Needs me reads the certificate events; Tick/Reject server functions are office-only", () => {
    expect(src("office-needs.server.ts")).toContain("coesNeedsFact");
    const fns = src("coes-check.functions.ts");
    expect(fns).toMatch(/export const tickCoes = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator\(/);
    expect(fns).toMatch(/export const rejectCoes = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator\(/);
    expect(fns.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(2);
  });
});
