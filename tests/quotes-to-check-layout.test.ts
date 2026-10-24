import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { missingStatus, splitQuotesToCheck } from "@/lib/installer-quote-status.core";
import { mittiAuditUrl } from "@/lib/mitti-link.core";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("Quotes to check layout rules (Jo 24 Oct 2026: installers no longer approve quotes)", () => {
  it("every draft is Ready for you — no installer-approval split; only jobs with no draft are listed apart", () => {
    const s = splitQuotesToCheck([{ quoteId: "a" }, { quoteId: "b", waitingOnInstaller: true }, { quoteId: null }]);
    expect(s.drafts.map(r => r.quoteId)).toEqual(["a", "b"]);
    expect(s.notDrafted).toHaveLength(1);
  });
  it("short status counts missing things", () => {
    expect(missingStatus(["a", "b", "c", "d"])).toBe("4 things missing");
    expect(missingStatus(["a"])).toBe("1 thing missing");
    expect(missingStatus([])).toBe("Details missing");
  });
  it("Mitti form link opens the audit", () => {
    expect(mittiAuditUrl("audit_x")).toBe("https://app.au.safetyculture.com/inspection/audit_x");
    expect(mittiAuditUrl(null)).toBeNull();
  });
  it("the office list returns every draft as rows and has no Waiting on installer section", () => {
    const fn = readFileSync("src/lib/installer-quote-review.functions.ts", "utf8");
    expect(fn).toContain("return { rows: split.drafts, notDrafted: split.notDrafted, declined };");
    expect(fn).not.toMatch(/waitingOnInstaller|WAITING_ON_INSTALLER|installer-quote-approval/);
    const ui = readFileSync("src/components/portal/QuotesToCheck.tsx", "utf8");
    expect(ui).not.toMatch(/data-waiting-on-installer|Waiting on installer/);
  });
  it("no screen offers an installer approve step or a waiting-for-installer-approval state", () => {
    const offenders = walk("src/components").concat(walk("src/routes")).filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => /Waiting on installer|Waiting for installer (to approve|reapproval)|Measurements are final|Quote is ready to send|installer must check it again/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("approval machinery is gone: no reads/writes of installer_quote_approved, no approve server function", () => {
    const offenders = walk("src").filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => /installer_quote_approved|installer-quote-approval|approveMyQuote|approveInstallerQuote|installerApprovalBlocker/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
