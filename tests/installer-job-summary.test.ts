// Jo 23 Oct 2026: the office installer-job summary in plain words.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installerJobSummary, type InstallerSummaryFacts } from "../src/lib/installer-job-summary.core";

const base: InstallerSummaryFacts = { installer: "Reinsulate", consent: "granted", mittiAuditId: null, formProblem: null, basics: null, heldReasons: null, quote: null, warnings: [] };

describe("installer job summary", () => {
  test("no form yet: waiting for it to be created, nothing for the office", () => {
    const s = installerJobSummary(base);
    expect([s.upTo, s.waitingOn, s.officeActions]).toEqual(["Waiting for the Ready Check form to be created in Mitti", "nobody", []]);
  });
  test("form creation failed: the office is told why", () => {
    const s = installerJobSummary({ ...base, formProblem: "Mitti Ready Check form could not be created automatically: Mitti user not found" });
    expect(s.waitingOn).toBe("office");
    expect(s.officeActions[0]).toContain("Mitti user not found");
  });
  test("form linked, basics missing: waiting on the installer with the list", () => {
    const s = installerJobSummary({ ...base, mittiAuditId: "audit_1", basics: { missing: ["insulation product", "price"], stops: [], completed: false } });
    expect(s.upTo).toBe("Waiting for Reinsulate to fill in the Ready Check — missing: insulation product, price");
    expect(s.form.status).toBe("Reinsulate still needs to add: insulation product, price");
    expect(s.waitingOn).toBe("installer");
  });
  test("held quote needs the office, with the reason", () => {
    const s = installerJobSummary({ ...base, mittiAuditId: "audit_1", basics: { missing: [], stops: [], completed: true }, heldReasons: ["Price outside range"] });
    expect([s.waitingOn, s.quote.status]).toEqual(["office", "Held: Price outside range"]);
    expect(s.officeActions).toContain("Sort out the held quote: Price outside range");
  });
  test("quote journey (Jo 24 Oct: no installer approval): Complete in Mitti → office send → owner → accepted", () => {
    const q = { total: 3900, sent: false, accepted: false, held: false };
    const f = { ...base, mittiAuditId: "audit_1", basics: { missing: [], stops: [], completed: false } };
    const drafted = installerJobSummary({ ...f, quote: q });
    expect([drafted.waitingOn, drafted.upTo]).toEqual(["installer", "Waiting for Reinsulate to finish the Ready Check and press Complete in Mitti"]);
    const done = { ...f, basics: { missing: [], stops: [], completed: true } };
    const ready = installerJobSummary({ ...done, quote: q });
    expect([ready.waitingOn, ready.officeActions[0]]).toEqual(["office", "Check and send the quote ($3,900.00) (Quotes to check)"]);
    const held = installerJobSummary({ ...done, quote: { ...q, held: true } });
    expect([held.waitingOn, held.quote.status]).toEqual(["office", "Held for you to check ($3,900.00)"]);
    expect(installerJobSummary({ ...done, quote: { ...q, sent: true } }).upTo).toBe("Waiting for the owner to accept the quote");
    expect(installerJobSummary({ ...done, quote: { ...q, sent: true, accepted: true } }).upTo).toContain("Owner accepted the quote");
    expect(installerJobSummary({ ...done, quote: { ...q, sent: true, declined: true } }).quote.status).toBe("Declined by the owner ($3,900.00)");
    for (const s of [drafted, ready, held]) expect(JSON.stringify(s)).not.toMatch(/approv|to check it\b/i);
  });
  test("missing owner permission is always an office action; other warnings pass through", () => {
    const s = installerJobSummary({ ...base, consent: null, warnings: ["Possible duplicate of HV-2282"] });
    expect(s.officeActions).toEqual(["Possible duplicate of HV-2282", "Owner contact permission isn't recorded — the quote can't be sent until it is"]);
    expect(s.waitingOn).toBe("office");
  });
  test("office page: summary on installer jobs, website checks folded away, no website estimate", () => {
    const page = readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8");
    expect(page).toContain("{installerJob && <InstallerJobSummary jobId={jobId} />}");
    expect(page).toContain("<Wrap installerJob={installerJob}>");
    expect(page).toContain("installerJob ? <p className=\"my-2 text-sm text-muted-foreground\" data-no-estimate>");
    const fns = readFileSync("src/lib/installer-job-summary.functions.ts", "utf8");
    expect(fns).toContain("await requireAdmin(context.supabase)");
    expect(fns).not.toMatch(/\.insert\(|\.update\(|\.delete\(|logEvent\(/);
  });
});
