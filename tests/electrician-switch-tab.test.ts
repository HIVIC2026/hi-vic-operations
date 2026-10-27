// Jo 28 Oct 2026 (spec rule 3): a job stuck on "electrician hasn't finished signing up" is the installer's move — it sits
// under Action needed, not In progress. Once switched to our electrician (the quote then goes to the office) it leaves.
import { describe, expect, test } from "bun:test";
import { installerHomeGroups, type InstallerHomeJob } from "../src/lib/installer-home.core";
import { readFileSync } from "node:fs";
import { NOT_ONBOARDED_NEXT_TITLE, installerStatusLine, jobNext, quoteStatusRow } from "../src/lib/installer-screens.core";
import { QUOTE_HELD_LINE, installerQuoteLine, quoteLineTab, quoteLineYours } from "../src/lib/installer-quote-status.core";
import { installerNotOnboardedNote, isInstallerNotOnboardedNote } from "../src/lib/rec-onboarded.core";

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

// Fix round 1 (CHECK 2): on the job page the business owner sees the price card with the note and the button, so the
// Next panel gives a short line instead — the note shows exactly once. Staff (no card) keep the note in the Next panel.
describe("job page: the note shows once", () => {
  const pageFacts = (boss: boolean) => ({ channel: "installer_sourced", stage: "ready_check_complete", ownerFirstName: "Sam", formLinked: true, formCompleted: true, formHasAnswers: true, priceEntered: true, boss,
    quoteLine: NOTE, needsFinishing: null, needsFinishingItems: [], readyCheckTurn: null, readyCheckBookedAt: null }) as never;
  /** Every text the job page shows for the quote (field.$jobId.tsx): the Next panel, the Quote status row and the price card. */
  const pageTexts = (boss: boolean) => {
    const next = jobNext(pageFacts(boss));
    const row = quoteStatusRow({ sent: false, accepted: false, declined: false, held: false, formCompleted: true }, { formLinked: true });
    const card = boss ? [installerNotOnboardedNote("TEST Sparky")] : []; // InstallerPriceCard renders for the boss only (canSet)
    return { next, texts: [next.title, next.sub, next.note, ...(next.items ?? []), row.label, ...card].filter((t): t is string => !!t) };
  };
  const count = (texts: string[]) => texts.filter((t) => t.includes(NOTE)).length;
  test("business owner: the note once (on the card with the button); the Next panel says the short line", () => {
    const { next, texts } = pageTexts(true);
    expect(NOT_ONBOARDED_NEXT_TITLE).toBe("Waiting on your electrician to sign up");
    expect(next.title).toBe(NOT_ONBOARDED_NEXT_TITLE);
    expect(next.panel).toBe("quote_status");
    expect(next.yours).toBe(true);
    expect(count(texts)).toBe(1);
  });
  test("staff (no price card): the note once, in the Next panel", () => {
    const { next, texts } = pageTexts(false);
    expect(next.title).toBe(NOTE);
    expect(count(texts)).toBe(1);
  });
  test("other quote lines are unchanged", () => {
    expect(jobNext({ ...(pageFacts(true) as object), quoteLine: "You: something" } as never).title).toBe("something");
  });
});

// Fix round 1 (MINOR 3): trade-view tradeHome's job list tab uses the one pure rule.
describe("job list tab rule (trade-view tradeHome)", () => {
  test("stuck → action; after the switch (held / no line) → not action; done stays done", () => {
    expect(quoteLineTab("progress", NOTE)).toBe("action");
    expect(quoteLineTab("progress", QUOTE_HELD_LINE)).toBe("progress");
    expect(quoteLineTab("progress", null)).toBe("progress");
    expect(quoteLineTab("done", NOTE)).toBe("done");
  });
  test("tradeHome uses it for the tab", () => {
    const src = readFileSync(new URL("../src/lib/trade-view.server.ts", import.meta.url), "utf8");
    expect(src).toContain("tab: quoteLineTab(j.tab, j.quoteLine)");
  });
});
