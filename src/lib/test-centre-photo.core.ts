// Test Centre photo rules (Jo 6 Nov 2026, approved): a dummy journey may include one ceiling
// photo, stored as private intake media exactly like a real website upload, so the firm-quote
// flow can be tested end to end on TEST data. Pure checks only — no database, no storage.
import { maxBytesFor } from "./enquiry.core";

export const TEST_PHOTO_PATH_PREFIX = "test-intake/";

/** null = OK; otherwise a plain reason the file cannot be used. */
export function testPhotoFileBlocker(file: { mimeType: string; sizeBytes: number }): string | null {
  if (!file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/")) return "Only a photo or video file.";
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) return "That file looks empty.";
  if (file.sizeBytes > maxBytesFor(file.mimeType)) return "That file is too large.";
  return null;
}

/** Only paths this feature minted may be attached — never an arbitrary storage path. */
export function testPhotoPathOk(path: string): boolean {
  return path.startsWith(TEST_PHOTO_PATH_PREFIX) && !path.includes("..") && path.length <= 500;
}
