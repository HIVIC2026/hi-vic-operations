import { expect, test } from "bun:test";
import published from "./fixtures/piisa-a3-published.json";
import { A3_EVIDENCE_LABELS, A3_MEDIA_IDS, A3_NATIVE_IDS, A3_ALIASES, a3MissingFields, a3MediaFiles, a3EvidenceChecklist } from "../src/lib/piisa-a3.core";
import { a3Template } from "./helpers/a3-template";

test("approved expanded definition retains every evidence ID and current schema", () => {
  const t = a3Template();
  for (const [key, id] of Object.entries(A3_MEDIA_IDS)) {
    const item = t.items.find((i) => i.item_id === id);
    if (item) item.label = A3_EVIDENCE_LABELS[key as keyof typeof A3_MEDIA_IDS];
  }
  expect(a3MissingFields(t)).toEqual([]);
  expect(a3MissingFields(published)).toEqual([]);
});

test("each evidence ID rejects unrelated content even on a recognised native schema", () => {
  for (const id of Object.values(A3_MEDIA_IDS)) {
    const t = a3Template();
    const item = t.items.find((i) => i.item_id === id);
    if (item) item.label = "Unrelated question";
    expect(a3MissingFields(t).some((p) => p.includes(id))).toBe(true);
  }
});

test("expanded native labels still read media by original ID; labels cannot grant geotags or capture time", () => {
  const audit = { items: Object.entries(A3_MEDIA_IDS).map(([key, item_id]) => ({ item_id, label: A3_EVIDENCE_LABELS[key as keyof typeof A3_MEDIA_IDS], media: [{ media_id: key }] })) };
  const files = a3MediaFiles(audit);
  for (const key of Object.keys(A3_MEDIA_IDS) as (keyof typeof A3_MEDIA_IDS)[]) {
    expect(files[key]).toHaveLength(1);
    expect(files[key]?.[0]).toMatchObject({ capturedAt: null, lat: null, lng: null });
  }
});

test("full consent attachment instruction preserves missing consent gate and existing consent reuse", () => {
  const t = a3Template();
  const consent = t.items.find((i) => i.item_id === A3_NATIVE_IDS.lifeSupportAttachment?.[0]);
  if (consent) consent.label = A3_ALIASES.lifeSupportAttachment?.[0];
  expect(a3MissingFields(t)).toEqual([]);
  const context = { crewCount: 2, electricianRequiredAtStart: false, existingPlanMatchesInstall: true, lifeSupportConsentOnFile: true };
  const rows = a3EvidenceChecklist({ "p5.electricianPresent": "N/A" }, context, []);
  expect(rows.find((r) => r.key === "installer_photos")).toMatchObject({ required: 2, state: "missing", phase: "before" });
  expect(rows.find((r) => r.key === "electrician_photo")).toMatchObject({ required: 0, state: "not_required" });
  expect(rows.find((r) => r.key === "final_plan")).toMatchObject({ required: 0, state: "not_required" });
});