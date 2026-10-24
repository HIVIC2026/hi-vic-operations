import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { classifyNewInstallerJob, sortNewInstallerJobs, howAdded, type NewJobFacts } from "../src/lib/installer-new-jobs.core";

const now = new Date("2026-10-23T08:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const job = (over: Partial<NewJobFacts> = {}): NewJobFacts => ({
  jobId: "j1", jobNumber: "HV-3141", createdAt: daysAgo(0.5), source: "bulk_import", stage: "ready_check_ready_to_schedule",
  owner: "A Owner", address: "1 Test St, Essendon", installer: "Reinsulate", eligibility: null,
  hasMittiForm: true, mittiAuditId: "audit_1", hasQuote: false, events: [], ...over,
});
const ev = (type: string, details: Record<string, unknown> | null = null, summary: string | null = null, at = daysAgo(0)) => ({ type, at, summary, details });

describe("New from installers (no manual 'seen' step)", () => {
  test("a job added this week shows with no warnings when all is fine", () => {
    const i = classifyNewInstallerJob(job(), now)!;
    expect([i.isNew, i.how, i.warnings]).toEqual([true, "Bulk upload", []]);
  });

  test("it drops off by itself after 7 days when nothing needs the office", () => {
    expect(classifyNewInstallerJob(job({ createdAt: daysAgo(7), events: [ev("ready_check_basics", { missing: [] })] }), now)).toBeNull();
  });

  test("a problem keeps an older job on the list until it's fixed", () => {
    expect(classifyNewInstallerJob(job({ createdAt: daysAgo(9), hasMittiForm: false, mittiAuditId: null }), now)!.warnings).toEqual(["No Mitti Ready Check form yet"]);
    expect(classifyNewInstallerJob(job({ createdAt: daysAgo(9), events: [ev("ready_check_basics", { missing: [] })] }), now)).toBeNull();
  });

  test("a missing form is not flagged in the first hour (the automatic form is on its way)", () => {
    const fresh = new Date(now.getTime() - 20 * 60_000).toISOString();
    expect(classifyNewInstallerJob(job({ createdAt: fresh, hasMittiForm: false, mittiAuditId: null }), now)!.warnings).toEqual([]);
  });

  test("a failed automatic form shows its reason; a later created form clears it", () => {
    const failed = ev("mitti_autoform_failed", null, "Mitti Ready Check form could not be created automatically: Mitti user not found", daysAgo(0.4));
    const i = classifyNewInstallerJob(job({ hasMittiForm: false, mittiAuditId: null, events: [failed] }), now)!;
    expect(i.warnings).toEqual(["Mitti Ready Check form could not be created automatically: Mitti user not found"]);
    expect(classifyNewInstallerJob(job({ events: [ev("mitti_audit_created", null, null, daysAgo(0.1)), failed] }), now)!.warnings).toEqual([]);
  });

  test("not started after 14 days is a reminder; synced answers, a quote or a later stage count as started", () => {
    const old = { createdAt: daysAgo(15) };
    expect(classifyNewInstallerJob(job(old), now)!.warnings).toEqual(["Ready Check not started after 15 days"]);
    expect(classifyNewInstallerJob(job({ ...old, createdAt: daysAgo(13) }), now)).toBeNull();
    expect(classifyNewInstallerJob(job({ ...old, events: [ev("ready_check_basics", { missing: [] })] }), now)).toBeNull();
    expect(classifyNewInstallerJob(job({ ...old, hasQuote: true }), now)).toBeNull();
    expect(classifyNewInstallerJob(job({ ...old, stage: "measured_quote_accepted" }), now)).toBeNull();
  });

  test("timeline-only Mitti flags, missing basics, held quote and ineligibility become warnings", () => {
    const i = classifyNewInstallerJob(job({
      source: "installer_mitti", eligibility: "does_not_appear_eligible",
      events: [
        ev("mitti_pickup_clash", null, "Owner/address matches HV-2282 — linked, office to check"),
        ev("mitti_pickup_installer_started_a2", null, "Installer-started A2 form — office to review"),
        ev("ready_check_basics", { missing: ["insulation product", "price"] }),
        ev("installer_quote_held", { blockers: ["Price outside range"] }),
      ],
    }), now)!;
    expect(i.how).toBe("Started in Mitti");
    expect(i.warnings).toEqual([
      "Owner/address matches HV-2282 — linked, office to check",
      "Installer-started A2 form — office to review",
      "Eligibility check: does not appear eligible",
      "Ready Check missing: insulation product, price",
      "Quote held: Price outside range",
    ]);
  });

  test("an A2 note later corrected as recorded in error is not shown", () => {
    const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
    const a2 = ev("mitti_pickup_installer_started_a2", null, "Installer-started A2 form", at(10));
    const fix = ev("mitti_pickup_note_correction", null, "Correction: A1 form", at(5));
    expect(classifyNewInstallerJob(job({ events: [fix, a2] }), now)!.warnings).toEqual([]);
    expect(classifyNewInstallerJob(job({ events: [a2] }), now)!.warnings).toEqual(["Installer-started A2 form"]);
  });

  test("jobs needing attention come first (oldest on top), then this week's fine jobs (newest on top)", () => {
    const items = [
      classifyNewInstallerJob(job({ jobId: "a", createdAt: daysAgo(2) }), now)!,
      classifyNewInstallerJob(job({ jobId: "b", createdAt: daysAgo(1) }), now)!,
      classifyNewInstallerJob(job({ jobId: "c", createdAt: daysAgo(15) }), now)!,
      classifyNewInstallerJob(job({ jobId: "d", createdAt: daysAgo(40) }), now)!,
    ];
    const { attention, fresh } = sortNewInstallerJobs(items);
    expect(attention.map((i) => i.jobId)).toEqual(["d", "c"]);
    expect(fresh.map((i) => i.jobId)).toEqual(["b", "a"]);
  });

  test("every installer source has a plain label", () => {
    expect(howAdded("installer_import")).toBe("Added in portal");
    expect(howAdded("installer_onsite")).toBe("Added on site");
    expect(howAdded(null)).toBe("Added by installer");
  });

  test("the reader is office-only and read-only, with practice jobs kept separate; no Mark seen anywhere", () => {
    const fns = readFileSync("src/lib/installer-new-jobs.functions.ts", "utf8");
    expect(fns.match(/await requireAdmin\(context\.supabase\)/g)?.length).toBe(1);
    expect(fns).toContain('const practice = j.source === "qa_test" || isTestPartner(');
    expect(fns).toContain("if (practice !== !!data?.showTestJobs) continue;");
    expect(fns).not.toMatch(/\.insert\(|\.update\(|\.delete\(|sendMessage|logEvent\(/);
    const panel = readFileSync("src/components/portal/NewFromInstallers.tsx", "utf8");
    expect(panel).not.toMatch(/Mark seen|markInstallerJobsSeen/);
    // One pile (0218): New from installers lives only on Jobs › Active (Today's brief retired, decision 218).
    expect(readFileSync("src/components/portal/JobsScreen.tsx", "utf8")).toContain("<NewFromInstallers />");
    expect(readFileSync("src/routes/_authenticated/admin.today.tsx", "utf8")).not.toContain("<NewFromInstallers />");
  });
});

test("Jo 24 Oct: a held quote shows on New from installers until a quote goes to the owner", () => {
  const held = ev("quote_auto_send_held", { reasons: ["Quote held: difficult access fee $650 is over the $500 limit"] }, null, daysAgo(2));
  expect(classifyNewInstallerJob(job({ createdAt: daysAgo(9), events: [held] }), now)!.warnings).toContain("Quote held: difficult access fee $650 is over the $500 limit");
  expect(classifyNewInstallerJob(job({ createdAt: daysAgo(9), events: [ev("quote_sent_automatically", null, null, daysAgo(1)), held] }), now)?.warnings ?? []).not.toContainEqual(expect.stringContaining("Quote held"));
});
