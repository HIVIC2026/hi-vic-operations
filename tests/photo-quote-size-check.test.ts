// Firm quote Task 8: size check on the Quote from photos box. In-memory database; no live calls.
import { expect, mock, test } from "bun:test";
import { memoryPostgrest } from "./helpers/memory-postgrest";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { sizeCheckFrom, sizeCheckParts, SOLAR_FOOTPRINT_METHOD } = await import("../src/lib/photo-quote-size-check.core");
const { photoSizeCheckFor } = await import("../src/lib/photo-quote.server");

const tables = () => ({
  jobs: [{ id: "j", estimated_area_m2: "120" }],
  property_area_estimates: [
    { job_id: "j", method: SOLAR_FOOTPRINT_METHOD, net_m2: 98.4, is_current: false },
    { job_id: "j", method: SOLAR_FOOTPRINT_METHOD, net_m2: 101.2, is_current: true },
    { job_id: "j", method: "Pricefinder floor area", net_m2: 140, is_current: true },
  ],
  property_floorplans: [{ job_id: "j", storage_path: "plans/j.png", storage_policy: "store_permitted", retrieved_at: "2026-11-05T00:00:00Z" }],
});

test("photo job: owner estimate, current aerial footprint and stored floor plan", async () => {
  const s = await photoSizeCheckFor("j", memoryPostgrest(tables()) as never, async (p) => `https://signed/${p}`);
  expect(s).toEqual({ ownerM2: 120, aerialM2: 101.2, floorplanUrl: "https://signed/plans/j.png" });
  expect(sizeCheckParts(s).map((p) => p.text).join(" · ")).toBe("Owner said 120 m² · Aerial 101.2 m² · Floor plan");
  expect(sizeCheckParts(s)[2]!.href).toBe("https://signed/plans/j.png");
});

test("each missing value reads Not found", async () => {
  const t = { jobs: [{ id: "j", estimated_area_m2: null }], property_area_estimates: [], property_floorplans: [{ job_id: "j", storage_path: null, storage_policy: "reference_only", retrieved_at: "2026-11-05T00:00:00Z" }] };
  const s = await photoSizeCheckFor("j", memoryPostgrest(t) as never, async () => "x");
  expect(s).toEqual({ ownerM2: null, aerialM2: null, floorplanUrl: null });
  expect(sizeCheckParts(s).map((p) => p.text)).toEqual(["Owner said: Not found", "Aerial: Not found", "Floor plan: Not found"]);
  expect(sizeCheckParts(s).some((p) => p.href)).toBe(false);
});

test("no price fields in the size check", () => {
  const s = sizeCheckFrom({ ownerEstimate: 90, areaRows: [], floorplanUrl: null });
  expect(Object.keys(s).sort()).toEqual(["aerialM2", "floorplanUrl", "ownerM2"]);
  expect(JSON.stringify(s)).not.toMatch(/price|gst|total|\$/i);
});

test("non-photo jobs: refused before any size-check read", async () => {
  const src = await Bun.file("src/lib/trade-view.server.ts").text();
  const body = src.slice(src.indexOf("export async function photoQuoteMedia"), src.indexOf("export async function photoQuoteMedia") + 900);
  // The give check (photo job for this business) comes before the size-check read.
  expect(body.indexOf("give.businessId !== c.biz.id")).toBeGreaterThan(0);
  expect(body.indexOf("give.businessId !== c.biz.id")).toBeLessThan(body.indexOf("photoSizeCheckFor"));
});
