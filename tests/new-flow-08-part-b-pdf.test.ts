// New job flow Part 8 Task 8 (Jo 2 Nov 2026): "the Mitti signature must land on the official VEEC PDF". Renders the real form PDF
// from an assignment carrying a Mitti Part B signature and proves the image sits in the Part B signature slot.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { SAMPLE_VALUES, SIGNATURE_PNG } from "./helpers/veec-form-sample";

const tables: Tables = {};
const files: Record<string, Uint8Array> = {};
let downloadFails = false;
const base = memoryPostgrest(tables);
const admin = {
  ...base,
  from: base.from.bind(base),
  storage: { from: () => ({
    download: async (p: string) => (downloadFails || !files[p] ? { data: null, error: { message: "not found" } } : { data: new Blob([files[p] as BlobPart]), error: null }),
    upload: async (p: string, b: unknown) => { files[p] = b as Uint8Array; return { error: null }; },
  }) },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Record<string, unknown> = {}) => { (tables.workflow_events ??= []).push({ job_id, actor_id, event_type, summary, details }); },
}));

const { veecFinalCopyPdf } = await import("../src/lib/assignment.server");

const PATH = "job-1/assignment/part-b-media1.png";
const asg = (snap: Record<string, unknown> | null, name: string | null = "John Smith") => ({
  id: "a1", installer_signature_name: name, installer_signed_at: "2026-11-13T05:00:00Z", installer_snapshot: snap,
  ap_signature_name: "Chris Lowe", ap_signed_at: "2026-11-14T03:00:00Z", consumer_signature_name: "Sarah Brown", consumer_signed_at: "2026-11-13T07:00:00Z",
}) as any;
const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; for (const k of Object.keys(files)) delete files[k]; downloadFails = false; files[PATH] = SIGNATURE_PNG; });

describe("Mitti Part B signature on the official VEEC PDF", () => {
  test("stored image lands in the Part B signature slot with the name and Melbourne date", async () => {
    const r = await veecFinalCopyPdf(asg({ image_path: PATH, typed_name: "John Smith" }), SAMPLE_VALUES, "HV-1", "job-1", null);
    expect(r.held).toBeUndefined();
    const layout = r.layout!;
    const page = layout.blockPage["s3-partB"]!;
    expect(layout.images).toEqual([{ block: "s3-partB", page }]);
    expect(layout.split).toEqual([]);
    expect((await pdfText(r.bytes!))[page - 1]).toMatch(/John Smith[\s\S]*13 Nov 2026/);
  });
  test("a portal-typed signature (no image path) prints the name alone", async () => {
    const r = await veecFinalCopyPdf(asg({ typed_name: "John Smith" }), SAMPLE_VALUES, "HV-1", "job-1", null);
    expect(r.layout!.images).toEqual([]);
    expect((await pdfText(r.bytes!))[r.layout!.blockPage["s3-partB"]! - 1]).toContain("John Smith");
  });
  test("image cannot be read: held with an office line, no PDF built without the signature", async () => {
    downloadFails = true;
    const r = await veecFinalCopyPdf(asg({ image_path: PATH }), SAMPLE_VALUES, "HV-1", "job-1", null);
    expect(r.bytes).toBeUndefined();
    expect(r.held).toContain("signature image");
    const ev = (tables.workflow_events ?? []).filter((e) => e.event_type === "veec_part_b_image_held");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details.needs_office).toBe(true);
    await veecFinalCopyPdf(asg({ image_path: PATH }), SAMPLE_VALUES, "HV-1", "job-1", null);
    expect((tables.workflow_events ?? []).filter((e) => e.event_type === "veec_part_b_image_held")).toHaveLength(1); // same reason: logged once
  });
});
