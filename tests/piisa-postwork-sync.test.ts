import { expect, mock, test } from "bun:test";
import { A3_MEDIA_IDS } from "../src/lib/piisa-a3.core";
const files: Record<string, { storage_path: string; requirement_id: string }> = {};
const reqs = {
  post_install_video: { id: "video-req", status: "outstanding", verified_by: null as string | null, verified_at: null as string | null },
  final_zone_plan: { id: "plan-req", status: "outstanding", verified_by: null as string | null, verified_at: null as string | null },
};
let writes = 0, uploads = 0, failSave = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const filters: Record<string, string> = {}; let operation = "read", payload: Record<string, unknown> = {};
    const result = () => {
      if (table === "evidence_requirements") {
        const req = filters.category ? reqs[filters.category as keyof typeof reqs] : Object.values(reqs).find((r) => r.id === filters.id);
        if (operation === "update" && req) Object.assign(req, payload);
        return { data: req, error: null };
      }
      if (operation === "save") {
        if (failSave) return { data: null, error: { message: "injected persistence failure" } };
        files[String(payload.id)] = payload as typeof files[string]; writes++;
        return { data: null, error: null };
      }
      return { data: filters.id ? files[filters.id] ?? null : Object.values(files).filter((f) => f.requirement_id === filters.requirement_id), error: null };
    };
    const q = { select: () => q, eq: (k: string, v: string) => { filters[k] = v; return q; }, order: () => q, limit: () => q,
      update: (p: Record<string, unknown>) => { operation = "update"; payload = p; return q; },
      upsert: (p: Record<string, unknown>) => { operation = "save"; payload = p; return q; },
      maybeSingle: async () => result(), then: (resolve: (r: unknown) => void) => Promise.resolve(result()).then(resolve) };
    return q;
  }, storage: { from: () => ({ upload: async () => { uploads++; return { error: null }; } }) },
} }));
const { syncVerifiedPiisaPostwork } = await import("../src/lib/piisa-postwork.server");
const audit = { items: [
  { item_id: A3_MEDIA_IDS.completed_video, label: "Video", media: [{ media_id: "test-video" }] },
  { item_id: A3_MEDIA_IDS.final_plan, label: "Plan", media: [{ media_id: "test-plan" }] },
] };
let changed = false;
const fetchOriginal = async (_audit: string, media: string) => ({ bytes: new Uint8Array([1, 2, changed ? 4 : 3]), contentType: media === "test-video" ? "video/mp4" : "application/pdf" });

test("actual postwork sync holds uploaded originals, retries without duplication, and reopens review on content change", async () => {
  expect(await syncVerifiedPiisaPostwork("test-job", "test-audit", audit, fetchOriginal)).toHaveLength(2);
  expect(writes).toBe(2); expect(uploads).toBe(2);
  expect(Object.values(files)).toHaveLength(2);
  for (const r of Object.values(reqs)) Object.assign(r, { status: "verified", verified_by: "test-human", verified_at: "2026-10-08T22:00:00Z" });
  expect(await syncVerifiedPiisaPostwork("test-job", "test-audit", audit, fetchOriginal)).toEqual([]);
  expect(writes).toBe(2); expect(uploads).toBe(2);
  changed = true; failSave = true;
  await expect(syncVerifiedPiisaPostwork("test-job", "test-audit", audit, fetchOriginal)).rejects.toThrow("injected persistence failure");
  expect(reqs.post_install_video.status).toBe("uploaded");
  expect(reqs.post_install_video.verified_by).toBeNull();
  failSave = false;
  expect(await syncVerifiedPiisaPostwork("test-job", "test-audit", audit, fetchOriginal)).toHaveLength(2);
  expect(Object.values(files)).toHaveLength(2);
  const before = uploads;
  expect(await syncVerifiedPiisaPostwork("test-job", "test-audit", { items: [] }, fetchOriginal)).toHaveLength(2);
  expect(uploads).toBe(before);
});