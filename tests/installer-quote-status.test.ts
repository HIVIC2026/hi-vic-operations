// Jo 24 Oct 2026: installers no longer approve owner quotes (A1 and A2). The installer card shows the quote status only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRESS_COMPLETE_LINE, QUOTE_HELD_LINE, installerQuoteLine, isReadyCheckQuote } from "../src/lib/installer-quote-status.core";

const f = { sent: false, accepted: false, declined: false, held: false };

describe("installer quote status line", () => {
  test("prepared → press Complete in Mitti; after Complete or a hold → office is checking", () => {
    expect(installerQuoteLine(f)).toBe(PRESS_COMPLETE_LINE);
    expect(PRESS_COMPLETE_LINE).toBe("You: when the Ready Check is finished, press Complete in Mitti — we then send the owner their quote");
    expect(installerQuoteLine({ ...f, held: true })).toBe(QUOTE_HELD_LINE);
    expect(installerQuoteLine({ ...f, formCompleted: true })).toBe("Waiting on office: checking the quote");
  });
  test("sent / accepted / declined", () => {
    expect(installerQuoteLine({ ...f, sent: true })).toBe("Waiting on owner: to accept the quote");
    expect(installerQuoteLine({ ...f, sent: true, accepted: true })).toBe("Waiting on owner: quote accepted – waiting for owner's payment");
    expect(installerQuoteLine({ ...f, sent: true, declined: true })).toBe("Waiting on office: the owner declined the quote");
  });
  test("no line ever asks the installer to check or approve the quote", () => {
    for (const x of [f, { ...f, held: true }, { ...f, formCompleted: true }, { ...f, sent: true }])
      expect(installerQuoteLine(x)).not.toMatch(/check the quote|approve|Measurements are final/i);
  });
  test("Ready Check quotes: A1, A2 rate-card options, or a linked Mitti form", () => {
    expect(isReadyCheckQuote("INSTALLER_A1", null)).toBe(true);
    for (const c of ["R5_BATTS", "R6_BATTS", "R7_BATTS"]) expect(isReadyCheckQuote(c, null)).toBe(true);
    expect(isReadyCheckQuote("OTHER", { external_source: "mitti", external_id: "audit_1" })).toBe(true);
    expect(isReadyCheckQuote("OTHER", { external_source: "mitti", external_id: null })).toBe(false);
    expect(isReadyCheckQuote(null, null)).toBe(false);
  });
});

describe("wiring", () => {
  test("office Send readiness has no installer-approval blocker", () => {
    const s = readFileSync("src/lib/office-quote-review.server.ts", "utf8");
    expect(s).not.toMatch(/installerApprovalBlocker|WAITING_ON_INSTALLER|installer-quote-approval/);
  });
  test("Office Adjust keeps the audited helper and leaves a Ready Check draft for office Send (no reapproval)", () => {
    const s = readFileSync("src/lib/quotes.server.ts", "utf8");
    const adj = s.slice(s.indexOf("export async function adjustQuote"), s.indexOf("export async function adjustQuote") + 4000);
    expect(adj).toContain('release_hold_reason: readyCheck ? "Waiting for office review before sending"');
    expect(adj).toContain('from("quote_adjustments").insert');
    expect(adj).toContain('"quote_adjusted"');
    expect(adj).not.toMatch(/Waiting for installer reapproval|installer-quote-approval/);
  });
  test("the installer's quote card is read-only (no approve button or mutation)", () => {
    const card = readFileSync("src/components/trade/OwnerQuoteCard.tsx", "utf8");
    expect(card).not.toMatch(/approve|useMutation|invalidateQueries/i);
    const fn = readFileSync("src/lib/installer-quote-status.functions.ts", "utf8");
    expect(fn).not.toMatch(/logEvent|\.insert\(|\.update\(/);
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).not.toContain("sweepInstallerQuoteReminders");
  });
});
