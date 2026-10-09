import { test, expect } from "bun:test";
import { INSULATION_DETAILS_REAL_SEND_APPROVED } from "../src/lib/hot-leads.core";
import { originalEnquiryMedia, groupBInvitationBlocker } from "../src/lib/group-b-media.core";
test("Group B real delivery approved by Jo 9 Oct", () => expect(INSULATION_DETAILS_REAL_SEND_APPROVED).toBe(true));
test("omitted upload list stays held", () => expect(groupBInvitationBlocker(originalEnquiryMedia({ answers: {} }, []))).toBe("Original media sync is not confirmed — invitation held"));
test("authoritative empty upload list is not held", () => expect(groupBInvitationBlocker(originalEnquiryMedia({ answers: {}, media: [] }, []))).toBeNull());
test("pending original upload excluded", () => expect(originalEnquiryMedia({ media: [{ source_id: "a", name: "x.jpg", mime_type: "image/jpeg" }] }, []).excluded).toBe(true));
