// Part 9 Task 13 (4 Nov 2026): pin the gates that are already right — "try to break it" tests, no behaviour change.
// Records kept 6 years (+1 margin, never deleted outside the TEST journey path), non-IC downlights = rectification (no
// clearance), the 30-day rule (window deadline, start after the deadline refused, repeat-PIESA payer), and the ESC
// notice refused before consent / outside the 5-day–24h window.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RETENTION_MIN_YEARS, retentionFor } from "../src/lib/jobfile.core";
import { RECTIFICATION_OUTCOMES, deriveRectificationOutcome, part4to6Problem } from "../src/lib/official-short.core";
import { electricalClearance, installEntryElectricalBlockers, PASSING_PIESA_BLOCKER } from "../src/lib/allocation.core";
import { onsiteStartOnly } from "../src/lib/fixes-times.core";
import { INSTALL_WINDOW_DAYS, installWindowDeadline } from "../src/lib/install-days.core";
import { repeatPiesaPayer } from "../src/lib/thirty-day-rule.core";
import { EARLIEST_MS, LEAD_MS, PIISA_FROM_PIESA_DAYS, readyToInstall, submissionBlockers } from "../src/lib/esc.core";
import type { ConsentRecord } from "../src/lib/consent.core";

const ROOT = join(import.meta.dir, "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

describe("records are kept 6 years", () => {
  test("RETENTION_MIN_YEARS is 6 and retainUntil runs 6 years (+1 margin) from completion", () => {
    expect(RETENTION_MIN_YEARS).toBe(6);
    const r = retentionFor({ assignmentRetainUntil: null, jobCreatedAt: "2026-11-02T00:00:00Z", completedAt: "2026-11-20T00:00:00Z" });
    expect(r.retainUntil >= "2032-11-20").toBe(true);
    expect(r.rule).toContain("never deleted");
  });
  test("an unfinished job counts from creation, never shorter than 6 years", () => {
    const r = retentionFor({ assignmentRetainUntil: null, jobCreatedAt: "2026-11-02T00:00:00Z", completedAt: null });
    expect(r.retainUntil >= "2032-11-02").toBe(true);
  });
  test("a shorter assignment retain_until cannot cut the 6 years", () => {
    const r = retentionFor({ assignmentRetainUntil: "2027-01-01", jobCreatedAt: "2026-11-02T00:00:00Z", completedAt: "2026-11-20T00:00:00Z" });
    expect(r.retainUntil >= "2032-11-20").toBe(true);
  });
  test("source scan: job files are only ever removed on the TEST journey path", () => {
    const hits = walk(join(ROOT, "src")).filter((f) => readFileSync(f, "utf8").includes('storage.from("job-files").remove('));
    expect(hits.map((f) => f.replace(`${ROOT}/`, ""))).toEqual(["src/lib/journey.server.ts"]);
  });
});

describe("downlights: a non-IC downlight means rectification, never clearance", () => {
  const short = { rectificationNeeded: "Yes", downlightsPresent: "Yes", downlightsNonIc: "Yes", onsiteStartNeeded: "Yes" } as Record<string, string>;
  test("part4to6Problem sees it, even when the electrician ticked 'on site at the start'", () => {
    expect(part4to6Problem(short)).toBe(true);
    expect(onsiteStartOnly(short)).toBe(false);
    const out = { ...short };
    deriveRectificationOutcome(out);
    expect(out["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]); // repair work needed — not the on-site-at-start outcome
  });
  test("IC-rated downlights alone are not a Part 4–6 problem", () => {
    expect(part4to6Problem({ downlightsPresent: "Yes", downlightsNonIc: "No" })).toBe(false);
    expect(part4to6Problem({ downlightsPresent: "No" })).toBe(false);
  });
  test("clearance is withheld until the upgrades are done (Part C) — a passing outcome alone is not enough", () => {
    const c = electricalClearance({ piesaOutcome: "pass", piesaCompletedAt: "2026-11-01", rectificationRequired: true, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null });
    expect(c.cleared).toBe(false);
    expect(c.blocker).toBeTruthy();
    const done = electricalClearance({ piesaOutcome: "pass", piesaCompletedAt: "2026-11-01", rectificationRequired: true, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null, partCRecorded: true });
    expect(done.cleared).toBe(true);
    expect(done.timingDate).toBe("2026-11-01"); // the 30 days still run from the PIESA date
  });
  test("install entry: open upgrades items or a failed PIESA block", () => {
    expect(installEntryElectricalBlockers({ openRectItems: 1, piesaDate: "2026-11-01", piesaOutcome: "pass" })).toHaveLength(1);
    expect(installEntryElectricalBlockers({ openRectItems: 0, piesaDate: "2026-11-01", piesaOutcome: "fail" })).toEqual([PASSING_PIESA_BLOCKER]);
    expect(installEntryElectricalBlockers({ openRectItems: 0, piesaDate: null, piesaOutcome: null, onsiteStartCleared: true })).toEqual([PASSING_PIESA_BLOCKER]);
  });
});

describe("30-day rule", () => {
  test("the window is 30 days from the PIESA date and the same count the PIISA gate uses", () => {
    expect(INSTALL_WINDOW_DAYS).toBe(30);
    expect(PIISA_FROM_PIESA_DAYS).toBe(30);
    expect(installWindowDeadline("2026-10-01")).toBe("2026-10-31");
    expect(installWindowDeadline("2026-10-01", "2026-10-20")).toBe("2026-10-20"); // an earlier stored deadline wins
    expect(installWindowDeadline(null, null)).toBeNull();
  });
  const consent: ConsentRecord = { status: "valid", scheduled_start: "2026-10-31T21:00:00Z", owner_signed_at: "2026-10-20T00:00:00Z", ap_signed_at: "2026-10-20T00:00:00Z" };
  const base = {
    consent, deliveries: { owner: "2026-10-20T00:00:00Z", installer: "2026-10-20T00:00:00Z" },
    notification: { status: "sent", sent_at: "2026-10-29T00:00:00Z", submission_reference: "ESC-1", scheduled_start: "2026-10-31T21:00:00Z" },
  };
  test("an install starting after the PIESA deadline is not ready", () => {
    const start = "2026-11-01T21:00:00Z"; // Mon 2 Nov 08:00 AEDT, deadline 31 Oct
    const r = readyToInstall({ ...base, scheduledStart: start, consent: { ...consent!, scheduled_start: start }, notification: { ...base.notification, sent_at: "2026-10-30T00:00:00Z", scheduled_start: start }, piesa: { date: "2026-10-01", deadline: "2026-10-31", outcome: "pass" } });
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("Installation start is after the PIESA 30-day deadline (2026-10-31)");
  });
  test("the same facts inside the window are ready; a failed PIESA never is", () => {
    const start = "2026-10-30T21:00:00Z"; // Sat 31 Oct 08:00 AEDT
    const ok = readyToInstall({ ...base, scheduledStart: start, consent: { ...consent!, scheduled_start: start }, notification: { ...base.notification, sent_at: "2026-10-28T00:00:00Z", scheduled_start: start }, piesa: { date: "2026-10-01", deadline: "2026-10-31", outcome: "pass" } });
    expect(ok.ready).toBe(true);
    const fail = readyToInstall({ ...base, scheduledStart: start, consent: { ...consent!, scheduled_start: start }, notification: { ...base.notification, sent_at: "2026-10-28T00:00:00Z", scheduled_start: start }, piesa: { date: "2026-10-01", deadline: "2026-10-31", outcome: "fail" } });
    expect(fail.blockers).toContain("A current passing PIESA is required");
  });
  describe("who pays the repeat PIESA when the window lapses", () => {
    const deadline = "2026-10-31", clearanceDate = "2026-10-01";
    test("not lapsed, or an install is booked → undetermined, nobody charged", () => {
      expect(repeatPiesaPayer({ clearanceDate, deadline, expired: false, booked: false, events: [] }).payer).toBe("undetermined");
      expect(repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: true, events: [] }).payer).toBe("undetermined");
    });
    test("installer never offered days → installer pays", () => {
      const d = repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: false, events: [] });
      expect(d).toMatchObject({ payer: "installer", basis: "installer_never_offered" });
    });
    test("owner sat on the installer's offer → owner pays", () => {
      const d = repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: false, events: [{ type: "install_days_offered_by_installer", at: "2026-10-03T00:00:00Z" }] });
      expect(d).toMatchObject({ payer: "owner", basis: "owner_no_answer" });
    });
    test("owner suggested only days after the last allowed day → owner pays", () => {
      const d = repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: false, events: [
        { type: "install_days_offered_by_installer", at: "2026-10-03T00:00:00Z" },
        { type: "install_days_offered", at: "2026-10-05T00:00:00Z", details: { days: ["2026-11-05", "2026-11-06"] } },
      ] });
      expect(d).toMatchObject({ payer: "owner", basis: "owner_days_outside_window" });
    });
    test("whoever changed a booked day and never re-agreed pays", () => {
      const d = repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: false, events: [
        { type: "install_days_offered_by_installer", at: "2026-10-03T00:00:00Z" },
        { type: "install_day_taken", at: "2026-10-04T00:00:00Z" },
        { type: "install_day_changed", at: "2026-10-28T00:00:00Z", details: { who: "installer" } },
      ] });
      expect(d).toMatchObject({ payer: "installer", basis: "changed_booked_day" });
    });
    test("no deadline on the job → undetermined (office decides)", () => {
      expect(repeatPiesaPayer({ clearanceDate, deadline: null, expired: true, booked: false, events: [] }).basis).toBe("no_deadline");
    });
  });
});

describe("ESC notice: refused before consent and outside the 5-day / 24h window", () => {
  const start = "2026-11-11T21:00:00Z"; // Thu 12 Nov 08:00 AEDT
  const consent: ConsentRecord = { status: "valid", scheduled_start: start, owner_signed_at: "2026-11-08T00:00:00Z", ap_signed_at: "2026-11-08T01:00:00Z" };
  test("window constants: 24h lead, 5 days earliest", () => {
    expect(LEAD_MS).toBe(24 * 3_600_000);
    expect(EARLIEST_MS).toBe(5 * 24 * 3_600_000);
  });
  test("sent inside the window, after consent → no blockers", () => {
    expect(submissionBlockers({ consent, scheduledStart: start, sentAt: "2026-11-09T00:00:00Z" })).toEqual([]);
  });
  test("sent one minute before the consent was completed → refused", () => {
    const b = submissionBlockers({ consent, scheduledStart: start, sentAt: "2026-11-08T00:59:00Z" });
    expect(b).toContain("Cannot notify ESC before the owner consent was completed.");
  });
  test("sent 6 days before the start → too early", () => {
    const b = submissionBlockers({ consent: { ...consent!, owner_signed_at: "2026-11-01T00:00:00Z", ap_signed_at: "2026-11-01T00:00:00Z" }, scheduledStart: start, sentAt: "2026-11-05T21:00:00Z" });
    expect(b.some((x) => x.startsWith("ESC notification is too early"))).toBe(true);
  });
  test("sent 23h before the start → too late", () => {
    const b = submissionBlockers({ consent, scheduledStart: start, sentAt: "2026-11-10T22:00:00Z" });
    expect(b).toContain("ESC notification was sent less than 24h before start – reschedule.");
  });
  test("no consent at all, or consent not signed by both → refused", () => {
    expect(submissionBlockers({ consent: null, scheduledStart: start, sentAt: "2026-11-09T00:00:00Z" }).some((x) => x.startsWith("Cannot notify ESC:"))).toBe(true);
    const half: ConsentRecord = { ...consent!, ap_signed_at: null };
    expect(submissionBlockers({ consent: half, scheduledStart: start, sentAt: "2026-11-09T00:00:00Z" }).some((x) => x.startsWith("Cannot notify ESC:"))).toBe(true);
  });
  test("consent completed less than 24h before the start → refused even if the notice went in time", () => {
    const late: ConsentRecord = { ...consent!, owner_signed_at: "2026-11-11T00:00:00Z", ap_signed_at: "2026-11-11T00:00:00Z" };
    expect(submissionBlockers({ consent: late, scheduledStart: start, sentAt: "2026-11-10T00:00:00Z" }).some((x) => x.includes("less than 24h before start"))).toBe(true);
  });
});
