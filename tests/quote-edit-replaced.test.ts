// Jo 28 Oct 2026: an office-edited draft rebuilt from the installer's price shows ONE plain "check this quote" line on
// the Active jobs status line, the Job page Next panel and the Needs me quote row. Pure rules; it never blocks Send.
import { describe, expect, test } from "bun:test";
import { QUOTE_EDIT_REPLACED_NOTICE, withEditReplacedNotice } from "../src/lib/quote-edit-replaced.core";
import { officeStatus, type JobFacts } from "../src/lib/office-status.core";
import { needsCandidates } from "../src/lib/office-needs.core";
import { nextAction } from "../src/lib/job-next-action.core";
import { A2_CORRECTION_EVENT, FLAG_EVENTS, FORM_CREATED_EVENTS, FORM_PROBLEM_EVENTS, FORM_STARTED_EVENTS, HELD_EVENTS, QUOTE_SENT_EVENTS, QUOTE_DECLINE_EVENTS } from "../src/lib/installer-new-jobs.core";
import { readdirSync, readFileSync } from "node:fs";
import { QUOTE_EDIT_REPLACED_EVENT } from "../src/lib/quote-edit-replaced.core";

const NOW = Date.parse("2026-10-28T00:00:00Z");
const held = (editReplaced?: boolean): JobFacts => ({ id: "j", stage: "measured_estimate_ready", createdAt: "2026-10-20T00:00:00Z", lastActivityAt: null, enteredStageAt: "2026-10-27T00:00:00Z",
  quote: { releaseState: "held", holdReason: "Waiting for office review before sending", sentAt: null, status: "draft", acceptedAt: null, ...(editReplaced === undefined ? {} : { editReplaced }) } });

describe("office-edited quote rebuilt", () => {
  test("wording is Jo's plain line", () => {
    expect(QUOTE_EDIT_REPLACED_NOTICE).toBe("The quote your office edited was rebuilt with new figures. Check it before sending.");
    expect(withEditReplacedNotice("x", false)).toBe("x");
    expect(withEditReplacedNotice(null, true)).toBe(QUOTE_EDIT_REPLACED_NOTICE);
    expect(withEditReplacedNotice("x", true)).toBe(`${QUOTE_EDIT_REPLACED_NOTICE} x`);
  });
  test("Active jobs status line: held quote detail starts with the alert", () => {
    expect(officeStatus(held(true), NOW).detail).toBe(`${QUOTE_EDIT_REPLACED_NOTICE} Waiting for office review before sending`);
    expect(officeStatus(held(false), NOW).detail).toBe("Waiting for office review before sending");
    expect(officeStatus(held(), NOW).detail).toBe("Waiting for office review before sending");
  });
  test("Needs me quote row and Job page Next panel carry the alert; a ready quote stays sendable", () => {
    const facts = { jobId: "j", jobNumber: "HV-1", surname: null, suburb: null, quoteToCheck: { at: "2026-10-27T00:00:00Z", reason: null, ready: true, editReplaced: true } };
    const row = needsCandidates(facts, NOW).find((c) => c.kind === "quote_check")!;
    expect(row.line).toBe(`${QUOTE_EDIT_REPLACED_NOTICE} Quote ready · all checks passed · press Send`);
    const next = nextAction({ facts, status: null, stage: "quote" }, NOW);
    expect(next.sentence).toBe(`${QUOTE_EDIT_REPLACED_NOTICE} The quote is drafted and every check passed — check it and press Send.`);
    const plain = { ...facts, quoteToCheck: { ...facts.quoteToCheck, editReplaced: false } };
    expect(needsCandidates(plain, NOW).find((c) => c.kind === "quote_check")!.line).toBe("Quote ready · all checks passed · press Send");
    expect(nextAction({ facts: plain, status: null, stage: "quote" }, NOW).sentence).toBe("The quote is drafted and every check passed — check it and press Send.");
  });
  test("office only: the alert is not in any installer-facing event list or installer file", () => {
    const lists: readonly string[] = [A2_CORRECTION_EVENT, ...FLAG_EVENTS, ...FORM_CREATED_EVENTS, ...FORM_PROBLEM_EVENTS, ...FORM_STARTED_EVENTS, ...HELD_EVENTS, ...QUOTE_SENT_EVENTS, ...QUOTE_DECLINE_EVENTS];
    expect(lists).not.toContain(QUOTE_EDIT_REPLACED_EVENT);
    const users = readdirSync("src/lib").filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(`src/lib/${f}`, "utf8").includes("quote-edit-replaced"));
    expect(users.sort()).toEqual(["job-next-action.core.ts", "installer-quote.server.ts", "office-needs.core.ts", "office-status.core.ts", "office.server.ts"].sort());
  });
});
