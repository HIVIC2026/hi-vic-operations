// New job flow Part 8 Task 9: pin the day-2+ re-check, Lead Installer whole install and premises type, and the ESC records checklist.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ESC_RECORDS_CHECKLIST, recordsChecklistGaps } from "../src/lib/esc-records-checklist.core";
import { INSTALL_DAY_Q, INSTALL_DAY_QUESTIONS, INSTALL_DAY_RULER_Q, installDayMissingQuestions } from "../src/lib/install-day.core";
import { LEAN_Q, PREMISES_TYPE_OPTIONS } from "../src/lib/ready-check-lean.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";
import { afterInstallBlockers, readInstallEvidence } from "../src/lib/install-evidence.core";

const defs = () => ({
  a1a2: FORMS.ready_check.fields.map((f) => f.label),
  a3: [...SHORT_PIESA_FIELDS.map((f) => f.label), PIESA_EVIDENCE_BY_ID.onsite_photo.label],
  a5: [...INSTALL_DAY_QUESTIONS.map((q) => q.label), ...Object.values(INSTALL_DAY_RULER_Q)],
});
const live = JSON.parse(readFileSync("tests/fixtures/a3-published-2026-10-25-read-first.json", "utf8"));

describe("ESC records checklist", () => {
  test("every record is pinned to a label on the live form definitions", () => {
    expect(recordsChecklistGaps(defs())).toEqual([]);
    expect(ESC_RECORDS_CHECKLIST.map((r) => r.record)).toEqual(expect.arrayContaining([
      "Electrician at the PIESA", "Each installer on site", "Old R-values", "New R-values", "Power isolated", "Products",
      "Before video", "After video incl. waste removed", "Floor plan with m² and products", "Day-2+ PIISA re-check",
      "Lead Installer whole install", "Premises type",
    ]));
  });

  test("removing Q41 from the A5 list is reported as a gap", () => {
    const d = defs();
    d.a5 = d.a5.filter((l) => l !== INSTALL_DAY_Q.dailyRecheck);
    expect(recordsChecklistGaps(d)).toEqual(["Day-2+ PIISA re-check: I checked every item on this form again before starting each day"]);
  });

  test("the day-2+ re-check, whole-install and premises-type items are on the live forms", () => {
    const n = (label: string) => INSTALL_DAY_QUESTIONS.find((q) => q.label === label)?.n;
    expect(n("Did the install take more than one day?")).toBe(40);
    expect(n("I checked every item on this form again before starting each day")).toBe(41);
    expect(n("I was here the whole time and supervised everyone")).toBe(46);
    expect(INSTALL_DAY_QUESTIONS.at(-1)?.n).toBe(48);
    expect(INSTALL_DAY_QUESTIONS.find((q) => q.n === 41)?.showWhen).toEqual({ n: 40, is: ["Yes"] });
    for (const k of ["ready_check", "ready_check_priced"] as const) {
      const f = FORMS[k].fields.find((x) => x.label === "Who lives at the property?");
      expect(f?.choices).toEqual([...PREMISES_TYPE_OPTIONS]);
      expect(f?.required).toBe(true);
    }
    expect(LEAN_Q.premisesType).toBe("Who lives at the property?");
  });

  test("the 25 Oct live A5 fixture already carries Q40, Q41 and Q46", () => {
    const missing = installDayMissingQuestions(live);
    for (const q of [INSTALL_DAY_Q.multiDay, INSTALL_DAY_Q.dailyRecheck, INSTALL_DAY_Q.supervised]) expect(missing).not.toContain(q);
  });

  test("a form without the Lead Installer whole-install tick is blocked", () => {
    const a = readInstallEvidence({ items: [{ item_id: "x", label: "Is the lock-out off and the power back on?", responses: { selected: [{ label: "Yes" }] } }] }).after;
    expect(afterInstallBlockers(a, {})).toContain("Lead installer has not confirmed being on site for the whole installation");
  });
});
