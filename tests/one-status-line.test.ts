// Decision 279 (Jo 25 Oct 2026): ONE status line per job on the installer job page and My work. Never "quote prepared"
// and "nothing filled in" together. Every branch, on both screens, from the same pure rule.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DO_READY_CHECK_TITLE, ENTER_PRICE_TITLE, WAITING_BOSS_TITLE, installerStatusLine, jobNext, readyCheckRows, type JobNextFacts } from "../src/lib/installer-screens.core";
import { installerNext, type InstallerHomeJob } from "../src/lib/installer-home.core";
import { PRESS_COMPLETE_LINE, QUOTE_HELD_LINE, QUOTE_SENT_LINE } from "../src/lib/installer-quote-status.core";
import { PRICE_NEXT_ACTION } from "../src/lib/ready-check-basics.core";

const a1: JobNextFacts = {
  channel: "installer_sourced", stage: "ready_check_scheduled", ownerFirstName: "Mei", formLinked: true, formCompleted: false, quoteLine: PRESS_COMPLETE_LINE,
  needsFinishing: null, readyCheckTurn: null, readyCheckBookedAt: "2026-10-25T20:30:00Z", installTurn: "not_ready", installBookedAt: null,
  installDeadline: null, installDaysLeft: null, clearedOn: null, installFormComplete: false, installationRecorded: false, rebateSigned: false,
};
const home = (o: Partial<InstallerHomeJob>): InstallerHomeJob => ({
  jobId: "j", jobNumber: "HV-3066", street: "5 Somerset Court, Mulgrave", suburb: "Mulgrave", channel: "installer_sourced", stage: "ready_check_scheduled",
  place: "moving", placeTitle: null, nextAction: null, quoteLine: null, status: null, upcoming: null, installDeadline: null, endedAt: null, formLinked: true, ...o,
});

describe("installerStatusLine — the one rule", () => {
  const base = { channel: "installer_sourced", formLinked: true, formCompleted: false, boss: true };
  test("no answers on the form → only 'do the Ready Check', even when a quote (from intake) already exists", () => {
    expect(installerStatusLine({ ...base, formHasAnswers: false, priceEntered: false, quoteLine: PRESS_COMPLETE_LINE })).toEqual({ kind: "ready_check", title: DO_READY_CHECK_TITLE, home: "Next: do the Ready Check", yours: true });
    expect(installerStatusLine({ ...base, formHasAnswers: false, priceEntered: true, quoteLine: QUOTE_HELD_LINE }).kind).toBe("ready_check");
  });
  test("answers but no boss price (A1): boss → enter your price; staff → waiting on the business owner, no price word", () => {
    expect(installerStatusLine({ ...base, formHasAnswers: true, priceEntered: false, quoteLine: null })).toEqual({ kind: "price", title: ENTER_PRICE_TITLE, home: "Next: enter your price", yours: true });
    const staff = installerStatusLine({ ...base, boss: false, formHasAnswers: true, priceEntered: false, quoteLine: PRESS_COMPLETE_LINE });
    expect(staff).toEqual({ kind: "waiting_boss", title: WAITING_BOSS_TITLE, home: "Next: nothing yet — waiting on your business owner", yours: false });
    expect(JSON.stringify(staff)).not.toMatch(/price|\$/i);
    // A completed form counts as answers even when the older basics event never recorded the flag.
    expect(installerStatusLine({ ...base, formCompleted: true, formHasAnswers: null, priceEntered: false, quoteLine: null }).kind).toBe("price");
  });
  test("both in → the quote status; the price never gates our leads (A2)", () => {
    expect(installerStatusLine({ ...base, formHasAnswers: true, priceEntered: true, quoteLine: PRESS_COMPLETE_LINE })).toEqual({ kind: "quote", title: PRESS_COMPLETE_LINE.replace(/^You:\s*/, ""), home: PRESS_COMPLETE_LINE, yours: true });
    expect(installerStatusLine({ ...base, formHasAnswers: true, priceEntered: true, quoteLine: QUOTE_SENT_LINE }).yours).toBe(false);
    expect(installerStatusLine({ ...base, channel: "hivic_sourced", formHasAnswers: true, priceEntered: null, quoteLine: QUOTE_HELD_LINE }).kind).toBe("quote");
    expect(installerStatusLine({ ...base, formHasAnswers: true, priceEntered: true, quoteLine: null }).kind).toBe("none");
  });
  test("unknown facts (null) never change the old behaviour, so older data keeps its quote line", () => {
    expect(installerStatusLine({ ...base, formHasAnswers: null, priceEntered: null, quoteLine: PRESS_COMPLETE_LINE }).kind).toBe("quote");
  });
});

describe("job page (jobNext): one line, never a contradiction", () => {
  test("empty form: 'Do the Ready Check' with the visit, no quote wording, no missing list", () => {
    const n = jobNext({ ...a1, formHasAnswers: false, priceEntered: false, boss: true, needsFinishingItems: ["Your price", "The ceiling area"] });
    expect(n).toMatchObject({ panel: "mitti_form", title: DO_READY_CHECK_TITLE, yours: true });
    expect(n.sub).toBe("Ready Check Mon 26 Oct at 7:30am. Fill in the Mitti form on site and press Complete when it's finished.");
    expect(JSON.stringify(n)).not.toMatch(/quote|prepared|missing/i);
  });
  test("answers, form items still missing → the Mitti list first (price never in it); then the boss's price", () => {
    const missing = jobNext({ ...a1, formHasAnswers: true, priceEntered: false, boss: true, needsFinishingItems: ["The ceiling area"] });
    expect(missing).toMatchObject({ panel: "mitti_form", title: "Add 1 thing in Mitti", items: ["The ceiling area"] });
    const price = jobNext({ ...a1, formHasAnswers: true, priceEntered: false, boss: true, needsFinishingItems: [] });
    expect(price).toMatchObject({ panel: "enter_price", title: ENTER_PRICE_TITLE, yours: true });
    expect(price.sub).toContain("$349 fee");
  });
  test("staff on an unpriced job: nothing about price, nothing to do", () => {
    const n = jobNext({ ...a1, formHasAnswers: true, priceEntered: false, boss: false });
    expect(n).toMatchObject({ panel: "waiting", title: WAITING_BOSS_TITLE, yours: false });
    expect(JSON.stringify(n)).not.toMatch(/price|\$/i);
  });
  test("both in → quote status as before (prepared / held / sent)", () => {
    expect(jobNext({ ...a1, formHasAnswers: true, priceEntered: true, boss: true })).toMatchObject({ panel: "quote_status", title: PRESS_COMPLETE_LINE.replace(/^You:\s*/, ""), yours: true });
    expect(jobNext({ ...a1, formHasAnswers: true, priceEntered: true, boss: true, formCompleted: true, quoteLine: QUOTE_HELD_LINE })).toMatchObject({ panel: "quote_status", yours: false });
  });
  test("Ready Check group row: 'Not started' for an empty form, never 'nothing filled in yet'", () => {
    expect(readyCheckRows({ bookedAt: null, done: false, formLinked: true, formCompleted: false, missing: 0, hasAnswers: false }).form).toEqual({ label: "Not started", tone: "sub" });
    expect(readyCheckRows({ bookedAt: null, done: false, formLinked: true, formCompleted: false, missing: 0, hasAnswers: true }).form).toEqual({ label: "In progress", tone: "sub" });
    expect(readyCheckRows({ bookedAt: null, done: false, formLinked: true, formCompleted: false, missing: 2, hasAnswers: null }).form?.label).toBe("2 things still missing");
  });
});

describe("My work (installerNext): the same line", () => {
  test("empty form → do the Ready Check (Action needed), even with a legacy 'Needs finishing' text and a quote line", () => {
    expect(installerNext(home({ formHasAnswers: false, priceEntered: false, boss: true, nextAction: "Needs finishing: price, ceiling area on the Mitti form", quoteLine: PRESS_COMPLETE_LINE }))).toEqual({ group: "action", next: "Next: do the Ready Check" });
  });
  test("answers, no price → boss: enter your price (Action needed); staff: waiting on the business owner (In progress)", () => {
    expect(installerNext(home({ formHasAnswers: true, priceEntered: false, boss: true, nextAction: PRICE_NEXT_ACTION }))).toEqual({ group: "action", next: "Next: enter your price" });
    expect(installerNext(home({ formHasAnswers: true, priceEntered: false, boss: false, nextAction: PRICE_NEXT_ACTION, quoteLine: PRESS_COMPLETE_LINE }))).toEqual({ group: "progress", next: "Next: nothing yet — waiting on your business owner" });
  });
  test("form items still missing come before the price", () => {
    expect(installerNext(home({ formHasAnswers: true, priceEntered: false, boss: true, nextAction: "Needs finishing: ceiling area on the Mitti form" }))).toEqual({ group: "action", next: "Next: finish the Mitti form (ceiling area missing)" });
  });
  test("both in → the quote lines as before", () => {
    expect(installerNext(home({ formHasAnswers: true, priceEntered: true, boss: true, quoteLine: PRESS_COMPLETE_LINE })).next).toBe("Next: press Complete in Mitti when the Ready Check is finished");
    expect(installerNext(home({ formHasAnswers: true, priceEntered: true, boss: true, quoteLine: QUOTE_SENT_LINE })).next).toBe("Next: nothing yet — owner has the quote");
  });
  test("every line starts with Next: and never carries a price", () => {
    for (const formHasAnswers of [false, true, null]) for (const priceEntered of [false, true, null]) for (const boss of [true, false]) {
      const n = installerNext(home({ formHasAnswers, priceEntered, boss, quoteLine: PRESS_COMPLETE_LINE }));
      expect(n.next.startsWith("Next: ")).toBe(true);
      expect(n.next).not.toMatch(/\$|margin|quoted price/i);
    }
  });
});

describe("the contradiction is gone from the page", () => {
  test("no 'nothing filled in yet'; the Quote status row shows only when the one line is a quote line", () => {
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).not.toContain("nothing filled in yet");
    expect(page).toContain("installerStatusLine({");
    expect(page).toContain('{showQuoteStatus && <Row label="Status"');
    expect(page).toContain("hasAnswers: page.form.hasAnswers");
    // The same facts travel to My work.
    const server = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(server).toContain("formHasAnswers: formFacts.get(j.jobId)?.hasAnswers ?? null");
    expect(server).toContain("priceEntered: j.channel === \"installer_sourced\" ? priced.has(j.jobId) : null, boss: c.boss");
  });
});
