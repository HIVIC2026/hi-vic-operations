import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { classifyNewInstallerJob, sortNewInstallerJobs, howAdded, OFFICE_SEEN_EVENT, type NewJobFacts } from "../src/lib/installer-new-jobs.core";

const now = new Date("2026-10-23T08:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const job = (over: Partial<NewJobFacts> = {}): NewJobFacts => ({
  jobId: "j1", jobNumber: "HV-3141", createdAt: daysAgo(0), source: "bulk_import", stage: "ready_check_ready_to_schedule",
  owner: "A Owner", address: "1 Test St, Essendon", installer: "Reinsulate", eligibility: null,
  hasMittiForm: false, mittiAuditId: null, hasQuote: false, events: [], ...over,
});
const ev = (type: string, details: Record<string, unknown> | null = null, summary: string | null = null) => ({ type, at: daysAgo(0), summary, details });

describe("New from installers", () => {
  test("a bulk-uploaded job the office hasn't seen is new, with its missing Mitti form flagged", () => {
    const i = classifyNewInstallerJob(job(), now)!;
    expect(i.isNew).toBe(true);
    expect(i.how).toBe("Bulk upload");
    expect(i.warnings).toContain("No Mitti Ready Check form yet");
  });

  test("marking seen removes it from the new list", () => {
    expect(classifyNewInstallerJob(job({ events: [ev(OFFICE_SEEN_EVENT)] }), now)).toBeNull();
  });

  test("seen but not started after 14 days comes back as a reminder", () => {
    const i = classifyNewInstallerJob(job({ createdAt: daysAgo(15), events: [ev(OFFICE_SEEN_EVENT)] }), now)!;
    expect(i.isNew).toBe(false);
    expect(i.notStarted).toBe(true);
    expect(i.warnings).toContain("Ready Check not started after 15 days");
  });

  test("13 days is not yet a reminder", () => {
    expect(classifyNewInstallerJob(job({ createdAt: daysAgo(13), events: [ev(OFFICE_SEEN_EVENT)] }), now)).toBeNull();
  });

  test("synced Ready Check answers, a quote or a later stage all count as started", () => {
    const old = { createdAt: daysAgo(20), events: [ev(OFFICE_SEEN_EVENT)] };
    expect(classifyNewInstallerJob(job({ ...old, events: [...old.events, ev("ready_check_basics", { missing: [] })] }), now)).toBeNull();
    expect(classifyNewInstallerJob(job({ ...old, hasQuote: true }), now)).toBeNull();
    expect(classifyNewInstallerJob(job({ ...old, stage: "measured_quote_accepted" }), now)).toBeNull();
  });

  test("timeline-only Mitti flags, missing basics, held quote and ineligibility become warnings", () => {
    const i = classifyNewInstallerJob(job({
      source: "installer_mitti", hasMittiForm: true, mittiAuditId: "audit_1", eligibility: "does_not_appear_eligible",
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
    const a2 = { type: "mitti_pickup_installer_started_a2", at: at(10), summary: "Installer-started A2 form", details: null };
    const fix = { type: "mitti_pickup_note_correction", at: at(5), summary: "Correction: A1 form", details: null };
    expect(classifyNewInstallerJob(job({ events: [fix, a2] }), now)!.warnings).not.toContain("Installer-started A2 form");
    expect(classifyNewInstallerJob(job({ events: [a2] }), now)!.warnings).toContain("Installer-started A2 form");
  });

  test("new jobs sort newest first, reminders oldest first", () => {
    const items = [
      classifyNewInstallerJob(job({ jobId: "a", createdAt: daysAgo(2) }), now)!,
      classifyNewInstallerJob(job({ jobId: "b", createdAt: daysAgo(1) }), now)!,
      classifyNewInstallerJob(job({ jobId: "c", createdAt: daysAgo(15), events: [ev(OFFICE_SEEN_EVENT)] }), now)!,
      classifyNewInstallerJob(job({ jobId: "d", createdAt: daysAgo(40), events: [ev(OFFICE_SEEN_EVENT)] }), now)!,
    ];
    const { fresh, stale } = sortNewInstallerJobs(items);
    expect(fresh.map((i) => i.jobId)).toEqual(["b", "a"]);
    expect(stale.map((i) => i.jobId)).toEqual(["d", "c"]);
  });

  test("every installer source has a plain label", () => {
    expect(howAdded("installer_import")).toBe("Added in portal");
    expect(howAdded("installer_onsite")).toBe("Added on site");
    expect(howAdded(null)).toBe("Added by installer");
  });

  test("the reader is office-only, read-only apart from the seen record, and isolates practice jobs", () => {
    const fns = readFileSync("src/lib/installer-new-jobs.functions.ts", "utf8");
    expect(fns.match(/await requireAdmin\(context\.supabase\)/g)?.length).toBe(2);
    expect(fns).toContain('const practice = j.source === "qa_test" || isTestPartner(');
    expect(fns).toContain("if (practice !== !!data?.showTestJobs) continue;");
    expect(fns).not.toMatch(/\.update\(|\.delete\(|sendMessage|logEvent\(/);
    for (const page of ["src/components/portal/JobsWorkspace.tsx", "src/routes/_authenticated/admin.today.tsx"]) expect(readFileSync(page, "utf8")).toContain("<NewFromInstallers />");
  });
});
