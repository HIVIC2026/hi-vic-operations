import { expect, mock, test } from "bun:test";
import { A3_MEDIA_IDS } from "../src/lib/piisa-a3.core";
import { fillOfficialDocxXml } from "../src/lib/official-docx.core";
import { OFFICIAL_TEMPLATES } from "../src/lib/official-forms.core";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
const files: Record<string, { id: string; storage_path: string } > = {};
let resets = 0, uploads = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    let id: string | null = null, op = "read", payload: Record<string, unknown> = {};
    const q = { select: () => q, eq: (k: string, v: string) => { if (k === "id") id = v; return q; }, order: () => q, limit: () => q,
      update: (p: Record<string, unknown>) => { op = "update"; payload = p; return q; },
      upsert: (p: Record<string, unknown>) => { op = "upsert"; payload = p; return q; },
      maybeSingle: async () => ({ data: table === "evidence_requirements" ? { id: "req" } : id ? files[id] ?? null : null, error: null }),
      then: (resolve: (r: unknown) => unknown) => {
        if (op === "upsert") files[String(payload["id"])] = payload as unknown as { id: string; storage_path: string };
        if (op === "update") resets++;
        return resolve({ data: Object.values(files), error: null });
      } }; return q;
  }, storage: { from: () => ({ upload: async () => { uploads++; return { error: null }; } }) },
} }));
test("same-audit original product label sync is idempotent; changed bytes invalidate human review", async () => {
  const { syncNativeProductEvidence } = await import("../src/lib/piisa-products.server");
  const audit = { items: [{ item_id: A3_MEDIA_IDS.product_photos, label: "Product labels", responses: { media: [{ media_id: "photo", latitude: -37, longitude: 145 }] } }] };
  const fetch = async () => ({ bytes: new Uint8Array([1,2,3]), contentType: "image/jpeg" });
  expect(await syncNativeProductEvidence("job", "audit", audit, fetch)).toEqual([]);
  expect(Object.keys(files).length).toBe(1); expect(resets).toBe(1); expect(uploads).toBe(1);
  expect(await syncNativeProductEvidence("job", "audit", audit, fetch)).toEqual([]);
  expect(resets).toBe(1); expect(uploads).toBe(1);
  expect(await syncNativeProductEvidence("job", "audit", audit, async () => ({ bytes: new Uint8Array([4]), contentType: "image/jpeg" }))).toEqual([]);
  expect(Object.keys(files).length).toBe(1); expect(resets).toBe(2); expect(uploads).toBe(2);
  expect((await syncNativeProductEvidence("job", "audit", { items: [] }, fetch)).length).toBeGreaterThan(0);
});
test("reviewed actual product brand/model/R reaches original official Part 7 field", () => {
  const body = unzipSync(readFileSync(OFFICIAL_TEMPLATES.piisa.originalFile))["word/document.xml"];
  if (!body) throw new Error("Missing original form");
  const r = fillOfficialDocxXml(strFromU8(body), "piisa", { "p7.products": "Actual Brand | Actual Model | R5" });
  expect(r.filled).toContain("p7.products"); expect(r.missed).not.toContain("p7.products");
  expect(r.xml).toContain("Actual Brand | Actual Model | R5");
});
