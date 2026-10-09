import { test, expect } from "bun:test";
import { INSULATION_DETAILS_REAL_SEND_APPROVED } from "../src/lib/hot-leads.core";
import { originalEnquiryMedia, groupBInvitationBlocker } from "../src/lib/group-b-media.core";
test("Group B real delivery approved by Jo 9 Oct", () => expect(INSULATION_DETAILS_REAL_SEND_APPROVED).toBe(true));
test("omitted upload list stays held", () => expect(groupBInvitationBlocker(originalEnquiryMedia({ answers: {} }, []))).toBe("Original media sync is not confirmed — invitation held"));
test("authoritative empty upload list is not held", () => expect(groupBInvitationBlocker(originalEnquiryMedia({ answers: {}, media: [], original_media_verification: { complete: true } }, []))).toBeNull());
test("pending original upload excluded", () => expect(originalEnquiryMedia({ media: [{ source_id: "a", name: "x.jpg", mime_type: "image/jpeg" }] }, []).excluded).toBe(true));
test("unverified empty list stays held", () => expect(originalEnquiryMedia({ media: [] }, []).uncertain).toBe(true));
test("verified empty list not held", () => expect(originalEnquiryMedia({ media: [], original_media_verification: { complete: true } }, []).excluded).toBe(false));
test("repeat sync keeps prior verification and uploads", async () => {
  const { retainOriginalMedia, buildBase44Raw } = await import("../src/lib/enquiry.core");
  const r = retainOriginalMedia({ media: [{ source_id: "a", name: "x.jpg", mime_type: "image/jpeg" }], original_media_verification: { complete: true } }, buildBase44Raw({ media: [], media_manifest_complete: true }));
  expect((r as any).media.length).toBe(1);
  expect(originalEnquiryMedia(r, []).excluded).toBe(true);
});
