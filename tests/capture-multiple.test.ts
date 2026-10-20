import { expect, test } from "bun:test";
import { originalEnquiryMedia, originalMediaForCapture } from "../src/lib/group-b-media.core";
import { capturePath, parseCapturePath, validateCaptureFile } from "../src/lib/owner-capture.core";

const job = "11111111-1111-4111-8111-111111111111";
const media = ["image/jpeg", "video/mp4", "image/png"].map((mime_type, index) => ({
  kind: "intake_media", mime_type, source_system: "owner_capture",
  storage_path: capturePath(job, `22222222-2222-4222-8222-22222222222${index}`, mime_type),
}));
test("multiple photo/video captures have separate paths against the same enquiry", () => {
  expect(new Set(media.map((file) => file.storage_path)).size).toBe(3);
  for (const file of media) expect(parseCapturePath(job, file.storage_path)).not.toBeNull();
  expect(parseCapturePath("33333333-3333-4333-8333-333333333333", media[0]?.storage_path)).toBeNull();
});
test("later upload remains available after earlier owner captures without repeat invitations", () => {
  expect(originalMediaForCapture({ media: [] }, media.slice(0, 2)).excluded).toBe(false);
  expect(originalMediaForCapture({ media: [] }, media).excluded).toBe(false);
  expect(originalEnquiryMedia({ media: [] }, media)).toMatchObject({ excluded: true, count: 3 });
});
test("capture keeps original website media precedence", () => {
  expect(originalMediaForCapture({ media: [] }, [...media, { kind: "intake_media", mime_type: "image/jpeg", storage_path: "website.jpg", source_system: "base44" }]).received).toBe(true);
});
test("capture keeps pending original references blocked", () => {
  expect(originalMediaForCapture({ media: ["https://example.test/pending.jpg"] }, media)).toMatchObject({ excluded: true, pendingSync: true });
});
test("capture keeps missing, ambiguous and historic manifests fail closed", () => {
  for (const raw of [{}, { media: "unknown" }, { media: [], original_media_manifest_uncertain: true }]) expect(originalMediaForCapture(raw, media).uncertain).toBe(true);
});
test("capture keeps read failures fail closed", () => {
  expect(originalMediaForCapture({ media: [] }, media, true).excluded).toBe(true);
});
test("accepted photo and video validation remains unchanged", () => {
  expect(validateCaptureFile({ mime: "image/jpeg", fileName: "photo.jpg", size: 12 }).ok).toBe(true);
  expect(validateCaptureFile({ mime: "video/mp4", fileName: "clip.mp4", size: 12 }).ok).toBe(true);
  expect(validateCaptureFile({ mime: "text/html", fileName: "photo.html", size: 12 }).ok).toBe(false);
  expect(validateCaptureFile({ mime: "image/jpeg", fileName: "empty.jpg", size: 0 }).ok).toBe(false);
});