// Old A3 forms (24 Oct 2026): the whole-job A5 videos were deleted and each zone's own before / after video stands in.
import { describe, expect, test } from "bun:test";
import { INSTALL_EVIDENCE_QUESTIONS as Q, zoneVideoFiles } from "../src/lib/install-evidence.core";
import { A3_MEDIA_IDS, A3_REQUIREMENT_LABELS, a3CompletionBlockers, a3EvidenceChecklist, a3MediaFiles, a3MediaSummary, a3MissingFields, a3PrestartBlockers, type A3EvidenceCtx } from "../src/lib/piisa-a3.core";
import { currentPostworkMedia } from "../src/lib/piisa-postwork.core";
import { a3Template } from "./helpers/a3-template";

const geo = (id: string, t: string) => ({ media_id: id, captured_at: t, location: { lat: -37.8, lng: 145.0 }, file_size: 1000 });
const zc = (n: string) => ({ item_id: "zc", type: "question", label: Q.zoneCount, responses: { selected: [{ label: n }] } });
const media = (label: string, files: unknown[]) => ({ item_id: `id-${label.slice(0, 30)}`, type: "media", label, media: files });
const BEFORE = "2026-11-03T19:50:00Z", AFTER = "2026-11-04T03:00:00Z", START = "2026-11-03T20:00:00Z";
const ctx: A3EvidenceCtx = { crewCount: 1, electricianRequiredAtStart: false, existingPlanMatchesInstall: false, lifeSupportConsentOnFile: false, generatedFinalPlan: true };
const photos = [A3_MEDIA_IDS.installer_photos, A3_MEDIA_IDS.isolation_photo, A3_MEDIA_IDS.product_photos].map((id) => ({ item_id: id, label: "x", media: [geo(`p-${id}`, BEFORE)] }));
const zoneAudit = (zones: number, opts: { skipBefore?: number; skipAfter?: number; beforeAt?: string } = {}) => ({ items: [
  ...photos, zc(String(zones)),
  ...Array.from({ length: zones }, (_, i) => i + 1).flatMap((z) => [
    ...(opts.skipBefore === z ? [] : [media(Q.zoneBeforeVideo(z), [geo(`b${z}`, opts.beforeAt ?? BEFORE)])]),
    ...(opts.skipAfter === z ? [] : [media(Q.zoneAfterVideo(z), [geo(`a${z}`, AFTER)])]),
  ]),
] });
const videoBlockers = (audit: unknown, phase: "before" | "after") => {
  const m = a3MediaSummary(a3MediaFiles(audit));
  return phase === "before" ? a3PrestartBlockers({}, ctx, m, START).filter((b) => /video/i.test(b)) : a3CompletionBlockers({}, ctx, m);
};

describe("zone videos satisfy the deleted whole-job videos", () => {
  test("every zone with its before / after video meets before_video / completed_video (no whole-job item on the form)", () => {
    const a = zoneAudit(2);
    expect(zoneVideoFiles(a).before!.map((f) => f.mediaId)).toEqual(["b1", "b2"]);
    expect(a3MediaFiles(a).completed_video.map((f) => f.mediaId)).toEqual(["a1", "a2"]);
    expect(videoBlockers(a, "before")).toEqual([]);
    expect(videoBlockers(a, "after")).toEqual([]);
    const rows = a3EvidenceChecklist({}, ctx, a3MediaSummary(a3MediaFiles(a)));
    expect(rows.filter((r) => r.key === "before_video" || r.key === "completed_video").map((r) => r.state)).toEqual(["met", "met"]);
    expect(currentPostworkMedia(a, { generatedFinalPlan: true }).blockers).toEqual([]);
  });
  test("one zone short = the item is missing (never a partial set), named by the zone wording", () => {
    expect(videoBlockers(zoneAudit(2, { skipBefore: 2 }), "before")).toEqual([`${A3_REQUIREMENT_LABELS.before_video}: 0 of 1`]);
    expect(videoBlockers(zoneAudit(2, { skipAfter: 1 }), "after")).toEqual([`${A3_REQUIREMENT_LABELS.completed_video}: 0 of 1`]);
    expect(zoneVideoFiles({ items: [media(Q.zoneBeforeVideo(1), [geo("b1", BEFORE)])] })).toEqual({ before: null, after: null }); // zone count unanswered
  });
  test("the before-work timing rule applies to the zone before videos", () => {
    expect(videoBlockers(zoneAudit(1, { beforeAt: "2026-11-03T21:00:00Z" }), "before")).toEqual([`${A3_REQUIREMENT_LABELS.before_video}: must be taken before work starts`]);
  });
  test("an older form with the whole-job videos (and no zone questions) still passes; its video counts alongside zones", () => {
    const old = { items: [...photos, { item_id: A3_MEDIA_IDS.before_video, label: "x", media: [geo("wb", BEFORE)] }, { item_id: A3_MEDIA_IDS.completed_video, label: "x", media: [geo("wa", AFTER)] }] };
    expect(videoBlockers(old, "before")).toEqual([]);
    expect(videoBlockers(old, "after")).toEqual([]);
    const both = { items: [...zoneAudit(1).items, { item_id: A3_MEDIA_IDS.before_video, label: "x", media: [geo("wb", BEFORE)] }] };
    expect(a3MediaFiles(both).before_video.map((f) => f.mediaId)).toEqual(["wb", "b1"]);
  });
  test("a template without the two whole-job video items is not reported as missing fields", () => {
    const t = a3Template() as { items: { item_id: string }[] };
    t.items = t.items.filter((x) => x.item_id !== A3_MEDIA_IDS.before_video && x.item_id !== A3_MEDIA_IDS.completed_video && x.item_id !== A3_MEDIA_IDS.final_plan);
    expect(a3MissingFields(t)).toEqual([]);
  });
});
