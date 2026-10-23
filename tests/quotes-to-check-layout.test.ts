import { describe, expect, it } from "bun:test";
import { WAITING_ON_INSTALLER, mittiAuditUrl, splitQuotesToCheck, waitingStatus } from "@/lib/installer-quote-approval.core";

describe("Quotes to check layout rules", () => {
  it("only installer-approved drafts are Ready for you; no-draft jobs wait on installer", () => {
    const s = splitQuotesToCheck([{ quoteId: "a" }, { quoteId: "b", waitingOnInstaller: true }, { quoteId: null }]);
    expect(s.ready.map(r => r.quoteId)).toEqual(["a"]);
    expect(s.waiting).toHaveLength(2);
  });
  it("short status counts missing things", () => {
    expect(waitingStatus([WAITING_ON_INSTALLER, "a", "b", "c", "d"])).toBe("4 things missing");
    expect(waitingStatus(["a"])).toBe("1 thing missing");
    expect(waitingStatus([WAITING_ON_INSTALLER])).toBe("Waiting for installer to approve");
  });
  it("Mitti form link opens the audit", () => {
    expect(mittiAuditUrl("audit_x")).toBe("https://app.au.safetyculture.com/inspection/audit_x");
    expect(mittiAuditUrl(null)).toBeNull();
  });
});
