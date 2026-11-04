// New job flow part 8, Task 4: the life support plan the electrician photographs on the PIESA counts as "on file"
// (documents kind life_support_plan) so the install gate sees it. Pure selector + the saver against an in-memory database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { piesaLifeSupportFiles } from "../src/lib/piesa-evidence.core";
import { LIFE_SUPPORT_ATTACHMENT_LABEL, LIFE_SUPPORT_CONSENT_LABEL, LIFE_SUPPORT_PRESENT } from "../src/lib/official-short.core";

const J = "00000000-0000-4000-8000-0000000000e4";
const AUDIT = "audit-1";
const files = [{ mediaId: "m1", capturedAt: null, lat: null, lng: null }, { mediaId: "m2", capturedAt: "2026-11-03T01:00:00Z", lat: null, lng: null }];
const snap = (present: string, consent: string, media = files) => [
  { label: LIFE_SUPPORT_PRESENT, value: present },
  { label: LIFE_SUPPORT_CONSENT_LABEL, value: consent },
  { label: LIFE_SUPPORT_ATTACHMENT_LABEL, value: null, media },
];

describe("piesaLifeSupportFiles", () => {
  test("Yes + received Medical Plan keeps both files; Consent too", () => {
    expect(piesaLifeSupportFiles(snap("Yes", "Yes – received Medical Plan")).map((f) => f.mediaId)).toEqual(["m1", "m2"]);
    expect(piesaLifeSupportFiles(snap("Yes", "Yes – received Consent"))).toHaveLength(2);
  });
  test("not received, life support No, or form without the question keep nothing", () => {
    expect(piesaLifeSupportFiles(snap("Yes", "No – not received"))).toEqual([]);
    expect(piesaLifeSupportFiles(snap("No", "Yes – received Medical Plan"))).toEqual([]);
    expect(piesaLifeSupportFiles([{ label: "Something else", value: "Yes" }])).toEqual([]);
    expect(piesaLifeSupportFiles(null as never)).toEqual([]);
  });
  test("files without a media id are dropped", () => {
    expect(piesaLifeSupportFiles(snap("Yes", "Yes – received Consent", [{ mediaId: null, capturedAt: null, lat: null, lng: null }, files[0]!]))).toHaveLength(1);
  });
});

const tables: Tables = {};
const uploaded: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => memoryPostgrest(tables).from(t),
    rpc: async () => ({ data: false, error: null }),
    storage: { from: () => ({ upload: async (p: string) => { uploaded.push(p); return { error: null }; } }) },
  },
}));
const { savePiesaLifeSupportPlan } = await import("../src/lib/mitti.server");
const { lifeSupportPlansOnFile } = await import("../src/lib/job-records.server");
const fetchMedia = async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });

describe("savePiesaLifeSupportPlan", () => {
  beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, { documents: [], workflow_events: [], job_compliance_records: [] }); uploaded.length = 0; });
  test("inserts one row per media id, is idempotent, and the job then counts as on file", async () => {
    expect((await lifeSupportPlansOnFile([J])).has(J)).toBe(false);
    expect(await savePiesaLifeSupportPlan(J, AUDIT, files, fetchMedia)).toBe(2);
    const rows = tables["documents"]!.filter((d) => d["kind"] === "life_support_plan");
    expect(rows).toHaveLength(2);
    expect(rows[0]!["title"]).toBe("Life support plan (PIESA attachment)");
    expect(uploaded[0]).toBe(`${J}/life-support/m1`);
    expect(await savePiesaLifeSupportPlan(J, AUDIT, files, fetchMedia)).toBe(0);
    expect(tables["documents"]!.filter((d) => d["kind"] === "life_support_plan")).toHaveLength(2);
    expect((await lifeSupportPlansOnFile([J])).has(J)).toBe(true);
  });
  test("a failing fetch is logged and never thrown", async () => {
    const bad = async () => { throw new Error("boom"); };
    expect(await savePiesaLifeSupportPlan(J, AUDIT, files, bad)).toBe(0);
    expect(tables["documents"]).toHaveLength(0);
  });
});
