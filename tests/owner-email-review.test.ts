import { describe, expect, it } from "bun:test";
import { canUseReviewButtons, emailNeedsOffice, emailOwnerMedia } from "@/lib/owner-email-review.core";

const at = "2026-10-22T01:00:00Z";
describe("Owner emails to review (Jo 23 Oct)", () => {
  it("an owner email with nothing after it needs the office", () => {
    expect(emailNeedsOffice({ latestInboundAt: at, laterOutboundAt: null, laterReviewAt: null, doneAt: null })).toBe(true);
  });
  it("a reply, a review decision or Done after it clears it", () => {
    expect(emailNeedsOffice({ latestInboundAt: at, laterOutboundAt: "2026-10-22T02:00:00Z", laterReviewAt: null, doneAt: null })).toBe(false);
    expect(emailNeedsOffice({ latestInboundAt: at, laterOutboundAt: null, laterReviewAt: "2026-10-22T02:00:00Z", doneAt: null })).toBe(false);
    expect(emailNeedsOffice({ latestInboundAt: at, laterOutboundAt: null, laterReviewAt: null, doneAt: "2026-10-22T02:00:00Z" })).toBe(false);
  });
  it("a reply from before the owner's latest email does not clear it", () => {
    expect(emailNeedsOffice({ latestInboundAt: at, laterOutboundAt: "2026-10-21T00:00:00Z", laterReviewAt: null, doneAt: null })).toBe(true);
  });
  it("only real photo/video attachments count as the owner's photos, never inline logos or PDFs", () => {
    const m = emailOwnerMedia([
      { name: "ceiling.jpg", contentType: "image/jpeg", isInline: false },
      { name: "roof.mov", contentType: "video/quicktime", isInline: false },
      { name: "logo.png", contentType: "image/png", isInline: true },
      { name: "quote.pdf", contentType: "application/pdf", isInline: false },
    ]);
    expect(m.map((a) => a.name)).toEqual(["ceiling.jpg", "roof.mov"]);
  });
  it("review buttons only on early enquiries", () => {
    expect(canUseReviewButtons("new_enquiry")).toBe(true);
    expect(canUseReviewButtons("installation_booked")).toBe(false);
  });
});
