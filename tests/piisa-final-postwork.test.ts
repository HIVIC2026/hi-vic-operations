import { expect, test } from "bun:test";
import final from "../src/lib/piisa-final-postwork-published.data.json";
import { resolvePiisaNativeVersion } from "../src/lib/piisa-native-version.core";
import { a3CompletionBlockers, A3_MEDIA_IDS } from "../src/lib/piisa-a3.core";
import { currentPostworkMedia, postworkReviewProblems } from "../src/lib/piisa-postwork.core";

test("current published company is first before lead; both final attachments mandatory and section non-answer", () => {
  const before = final.template.items.find((p) => p.label === "AP Evidence – Before Work");
  expect(before?.children[0]?.id).toBe("dc12088c-8316-461e-91e2-53b1db0dc558");
  expect(before?.children[1]?.id).toBe("9e1a8b94-d3fc-492e-bb33-57b6bd4e85a8");
  const after = final.template.items.find((p) => p.label === "AP Evidence – After Installation");
  expect(after?.children.map((i) => i.id)).toEqual(["86b3772c-6227-4b6f-8011-b7ed288e734e", "344e863b-3af3-44f5-b1b8-966941f0e667"]);
  for (const i of after?.children ?? []) expect((i as unknown as { media: { options: { is_mandatory: boolean } } }).media.options.is_mandatory).toBe(true);
  const declaration = final.template.items.find((p) => p.label === "Part 8 – Installer Declaration");
  const last = declaration?.children.at(-1);
  expect(last?.id).toBe("d11eaa63-198b-471f-b57c-d3717bce551c");
  expect(last && "category" in last).toBe(true);
  expect(resolvePiisaNativeVersion(final).active).toBe(true);
  const changed = structuredClone(final);
  const changedAfter = changed.template.items.find((p) => p.label === "AP Evidence – After Installation");
  const plan = changedAfter?.children.find((i) => i.id === "344e863b-3af3-44f5-b1b8-966941f0e667") as unknown as { media: { options: { is_mandatory: boolean } } } | undefined;
  if (!plan) throw new Error("Plan missing");
  plan.media.options.is_mandatory = false;
  expect(resolvePiisaNativeVersion(changed).active).toBe(false);
});

test("signature-only and historical plan cannot satisfy current after-work attachments", () => {
  expect(currentPostworkMedia({ items: [] }).blockers).toHaveLength(2);
  const ctx = { crewCount: 1, electricianRequiredAtStart: false, lifeSupportConsentOnFile: false, existingPlanMatchesInstall: true, mandatoryCurrentPostwork: true };
  expect(a3CompletionBlockers({}, ctx, [])).toHaveLength(2);
  expect(a3CompletionBlockers({}, { ...ctx, mandatoryCurrentPostwork: false }, [])).toHaveLength(1);
  const video = { items: [{ item_id: A3_MEDIA_IDS.completed_video, label: "Video", media: [{ media_id: "test-video" }] }] };
  expect(currentPostworkMedia(video).blockers).toHaveLength(1);
});

test("actual current attachments remain blocked until recorded human verification; changed file fails closed", () => {
  const verified = { status: "verified", verified_by: "test-reviewer", verified_at: "2026-10-08T22:00:00Z" };
  expect(postworkReviewProblems("Plan", verified, ["current"], ["current"])).toEqual([]);
  expect(postworkReviewProblems("Plan", verified, ["old"], ["current"])).toHaveLength(1);
  expect(postworkReviewProblems("Plan", { ...verified, status: "uploaded" }, ["current"], ["current"])).toHaveLength(1);
  expect(postworkReviewProblems("Video", { ...verified, verified_by: null }, ["current"], ["current"])).toHaveLength(1);
});