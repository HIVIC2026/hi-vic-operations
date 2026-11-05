// Photo-quote installers Task 8 (reverses #13): the optional "Got photos or a video?" box on the quick questions page.
import { expect, test } from "bun:test";
import { CAPTURE_KIND, CAPTURE_MAX_FILES, captureLinkState, optionalUploadAllowed } from "../src/lib/owner-capture.core";
import { hasOwnerMedia } from "../src/lib/photo-quote.core";

const link = { status: "active", expires_at: "2099-01-01T00:00:00Z" };
const job = (stage: string) => ({ stage, outcome: "likely_eligible", decisionSource: "system", reviewRequired: false });

test("open job, no media → optional upload allowed", () => {
  expect(captureLinkState(link, job("ready_check_ready_to_schedule"))).toBe("ok");
  expect(optionalUploadAllowed({ excluded: false, received: 0 })).toBe(true);
});
test("cancelled job → closed (no page, no upload)", () => {
  expect(captureLinkState(link, job("cancelled"))).toBe("closed");
});
test("job at the file limit → not allowed", () => {
  expect(optionalUploadAllowed({ excluded: false, received: CAPTURE_MAX_FILES })).toBe(false);
  expect(optionalUploadAllowed({ excluded: false, received: CAPTURE_MAX_FILES - 1 })).toBe(true);
});
test("original enquiry media excluded (and no office request) → not allowed, unchanged rule", () => {
  expect(optionalUploadAllowed({ excluded: true, received: 0 })).toBe(false);
});
test("an uploaded file lands as intake_media, so hasOwnerMedia sees it", () => {
  expect(CAPTURE_KIND).toBe("intake_media");
  expect(hasOwnerMedia([{ kind: CAPTURE_KIND, mime_type: "image/jpeg", storage_path: "j/owner-capture/u.jpg" }])).toBe(true);
  expect(hasOwnerMedia([{ kind: CAPTURE_KIND, mime_type: "video/quicktime", storage_path: "j/owner-capture/u.mov" }])).toBe(true);
});
