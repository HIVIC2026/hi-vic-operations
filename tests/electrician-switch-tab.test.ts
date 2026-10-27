// Jo 28 Oct 2026 (spec rule 3): a job stuck on "electrician hasn't finished signing up" is the installer's move — it sits
// under Action needed, not In progress. Once switched to our electrician (the quote then goes to the office) it leaves.
import { describe, expect, test } from "bun:test";
import { installerHomeGroups, type InstallerHomeJob } from "../src/lib/installer-home.core";
import { installerStatusLine, jobNext } from "../src/lib/installer-screens.core";
import { QUOTE_HELD_LINE, installerQuoteLine, quoteLineYours } from "../src/lib/installer-quote-status.core";
import { isInstallerNotOnboardedNote } from "../src/lib/rec-onboarded.core";

const NOTE = installerQuoteLine({ sent: false, accepted: false, declined: false, held: true, formCompleted: true, electricianNotOnboarded: { name: "TEST Sparky" } });
const job = (quoteLine: string | null): InstallerHomeJob => ({
  jobId: "j1", jobNumber: "HV-3129", street: "1 Test Street", suburb: "Testville", channel: "installer_sourced", stage: "ready_check_complete", place: "moving", placeTitle: null,
  nextAction: null, quoteLine, status: null, upcoming: null, installDeadline: null, endedAt: null,
  formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, boss: true,
} as InstallerHomeJob);

describe("stuck on a not-signed-up electrician → Action needed", () => {
  test("the note is recognised", () => {
    expect(NOTE).toBe("We can't send the owner's quote yet. TEST Sparky hasn't finished signing up with us. Ask them to finish, or use our electrician ($349) instead.");
    expect(isInstallerNotOnboardedNote(NOTE)).toBe(true);
    expect(isInstallerNotOnboardedNote(QUOTE_HELD_LINE)).toBe(false);
    expect(isInstallerNotOnboardedNote(null)).toBe(false);
  });
  test("job list tab: the stuck job is yours (action); after the switch it isn't", () => {
    expect(quoteLineYours(NOTE)).toBe(true);
    expect(quoteLineYours(QUOTE_HELD_LINE)).toBe(false);
    expect(quoteLineYours("You: something")).toBe(true);
    expect(quoteLineYours(null)).toBe(false);
  });
  test("installer home: the stuck job is under Action needed; after the switch it is In progress", () => {
    const before = installerHomeGroups([job(NOTE)]);
    expect(before.action.map((r) => r.jobId)).toEqual(["j1"]);
    expect(before.progress).toEqual([]);
    expect(before.action[0]!.next).toBe(NOTE);
    const after = installerHomeGroups([job(QUOTE_HELD_LINE)]);
    expect(after.action).toEqual([]);
    expect(after.progress.map((r) => r.jobId)).toEqual(["j1"]);
  });
  test("job page: the status and next panel say it's yours", () => {
    const facts = { channel: "installer_sourced", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, boss: true, quoteLine: NOTE };
    expect(installerStatusLine(facts).yours).toBe(true);
    expect(jobNext({ ...facts, stage: "ready_check_complete", ownerFirstName: "Sam", needsFinishing: null, needsFinishingItems: [], readyCheckTurn: null, readyCheckBookedAt: null } as never).yours).toBe(true);
  });
});
