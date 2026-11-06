import { expect, test } from "bun:test";
import { testPhotoFileBlocker, testPhotoPathOk, TEST_PHOTO_PATH_PREFIX } from "../src/lib/test-centre-photo.core";

test("a normal phone photo is accepted", () => {
  expect(testPhotoFileBlocker({ mimeType: "image/jpeg", sizeBytes: 2_000_000 })).toBeNull();
});

test("a short video is accepted", () => {
  expect(testPhotoFileBlocker({ mimeType: "video/mp4", sizeBytes: 10_000_000 })).toBeNull();
});

test("non-media files are refused", () => {
  expect(testPhotoFileBlocker({ mimeType: "application/pdf", sizeBytes: 1000 })).toBe("Only a photo or video file.");
  expect(testPhotoFileBlocker({ mimeType: "text/plain", sizeBytes: 1000 })).toBe("Only a photo or video file.");
});

test("oversized and empty files are refused", () => {
  expect(testPhotoFileBlocker({ mimeType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 })).toBe("That file is too large.");
  expect(testPhotoFileBlocker({ mimeType: "image/jpeg", sizeBytes: 0 })).toBe("That file looks empty.");
});

test("only minted test-intake paths can be attached", () => {
  expect(testPhotoPathOk(`${TEST_PHOTO_PATH_PREFIX}abc_photo.jpg`)).toBe(true);
  expect(testPhotoPathOk("job-123/portal-ready-check/x.jpg")).toBe(false);
  expect(testPhotoPathOk("test-intake/../secrets")).toBe(false);
});
