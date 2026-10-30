import { describe, expect, it } from "vitest";
import { bookedNoticeNotSentReason, bookedNoticeSummary } from "@/lib/ready-check-booked-notice.core";
import { QUIET_HOURS_WAIT } from "@/lib/approved-texts.core";

describe("Ready Check booked: no silent skips (Jo 29 Oct, HV-3542)", () => {
  it("records a reason for every not-sent outcome", () => {
    expect(bookedNoticeNotSentReason("not sent — owner link missing")).toBe("owner link missing");
    expect(bookedNoticeNotSentReason("not sent — no owner email")).toBe("no owner email");
    expect(bookedNoticeNotSentReason("blocked — not sent")).toBe("blocked — not sent");
    expect(bookedNoticeNotSentReason("error — fetch failed")).toBe("error — fetch failed");
    expect(bookedNoticeNotSentReason("failed: send error")).toBe("failed: send error");
    expect(bookedNoticeNotSentReason(QUIET_HOURS_WAIT)).toBe(QUIET_HOURS_WAIT);
    expect(bookedNoticeNotSentReason("")).toBe("no result returned");
  });
  it("records nothing when it was sent or already handled", () => {
    for (const o of ["sent", "already attempted — not resent", "already handled", "owner sms sent: ok", "owner sms (test) sent: ok", "delivery uncertain — not retried"]) expect(bookedNoticeNotSentReason(o)).toBeNull();
  });
  it("summary names the channel and reason", () => {
    expect(bookedNoticeSummary("email", "no owner email")).toBe(`Ready Check booked — the owner's "You're booked" email was not sent: no owner email`);
  });
});
