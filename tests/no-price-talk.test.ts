// Decision 323 (Jo 25 Oct 2026, replaces the conditional part of decision 312): the electrician confirms on EVERY A4
// that he won't discuss prices with the owner; "Whose customer is this?" is deleted. Decision 309: repairs always happen
// before installation.
import { describe, expect, test } from "bun:test";
import {
  CUSTOMER_OF_LEGACY_LABEL, NO_PRICE_TALK_ISSUE, NO_PRICE_TALK_LABEL, RECTIFICATION_OUTCOMES, REPAIR_LEGACY_NOT_BEFORE_FLAG,
  REPAIR_POSSIBLE_LEGACY_LABEL, SHORT_PIESA_FIELDS, noPriceTalkIssue, shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import { buildPrefill } from "../src/lib/mitti.core";
import { mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { readFileSync } from "node:fs";
import { FIXES_WORK_LABEL, ONSITE_START_HISTORY_TEXT } from "../src/lib/official-short.core";
import { fixesFormNeeded } from "../src/lib/fixes-day.core";
import { mittiOfficeItems } from "../src/lib/ready-check-chase.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";

const NEEDED = "Is any electrical repair work needed before insulation can be installed?";
const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-25", ownerConfirmation: null };

describe("decision 323: no price talk on every job, whose-customer deleted", () => {
  test("wording unchanged; a top-level Required tick with no condition; the question is gone", () => {
    expect(NO_PRICE_TALK_LABEL).toBe("I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.");
    const t = SHORT_PIESA_FIELDS.find((f) => f.id === "noPriceTalk")!;
    expect(t).toMatchObject({ type: "tick", required: true });
    expect(t.when).toBeUndefined();
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "customerOf")).toBeUndefined();
    expect(SHORT_PIESA_FIELDS.some((f) => f.label === CUSTOMER_OF_LEGACY_LABEL)).toBe(false);
    expect(mittiAiPrompt("piesa")).not.toContain(CUSTOMER_OF_LEGACY_LABEL);
    // on the Job page: before the date of inspection
    expect(SHORT_PIESA_FIELDS.findIndex((f) => f.id === "noPriceTalk")).toBeLessThan(SHORT_PIESA_FIELDS.findIndex((f) => f.id === "inspectionDate"));
  });
  test("the portal no longer prefills it (an old template with the question is left blank)", () => {
    const template = { template: {
      items: [{ id: "q1", label: `${CUSTOMER_OF_LEGACY_LABEL}\nFilled in by the portal. Don't change it.`, type: "question", question: { response_set_id: "rs1" } }],
      response_sets: [{ id: "rs1", responses: [{ id: "o1", label: "Home Insulation Victoria" }, { id: "o2", label: "The installer's customer" }] }],
    } };
    const p = buildPrefill(template, { jobNumber: "HV-1", address: "1 St", ownerName: "O", assessorName: "E" });
    expect(p.items.concat(p.header_items).find((i: { item_id: string }) => i.item_id === "q1")).toBeUndefined();
  });
  test("an old form that still has the question validates (extra question ignored) and its answer is ignored", () => {
    const items = [{ label: CUSTOMER_OF_LEGACY_LABEL, type: "question" }];
    expect(validateTemplate("piesa", items).issues).not.toContain(`Missing: ${CUSTOMER_OF_LEGACY_LABEL}`);
    expect(shortAnswersFromEntries("piesa", [{ label: CUSTOMER_OF_LEGACY_LABEL, value: "The installer's customer" }])).not.toHaveProperty("customerOf");
  });
  test("office item for ANY completed A4 that has the tick item but it isn't ticked", () => {
    expect(NO_PRICE_TALK_ISSUE).toBe("Electrician hasn't confirmed they won't discuss prices with the owner");
    const unticked = [{ label: NO_PRICE_TALK_LABEL, value: null }];
    expect(noPriceTalkIssue({ completed: true, entries: unticked })).toBe(NO_PRICE_TALK_ISSUE);
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: NO_PRICE_TALK_LABEL, value: "false" }] })).toBe(NO_PRICE_TALK_ISSUE);
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: NO_PRICE_TALK_LABEL, value: "true" }] })).toBeNull();
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: NO_PRICE_TALK_LABEL, value: "Yes" }] })).toBeNull();
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: NO_PRICE_TALK_LABEL, value: true }] })).toBeNull();
    expect(noPriceTalkIssue({ completed: false, entries: unticked })).toBeNull(); // not completed yet
    // installer customers too: an old form answering "The installer's customer" still needs the tick when the item is there
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: CUSTOMER_OF_LEGACY_LABEL, value: "The installer's customer" }, ...unticked] })).toBe(NO_PRICE_TALK_ISSUE);
    // forms without the item: nothing (even an old form that asked only the deleted question)
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: NEEDED, value: "No" }] })).toBeNull();
    expect(noPriceTalkIssue({ completed: true, entries: [{ label: CUSTOMER_OF_LEGACY_LABEL, value: "Home Insulation Victoria" }] })).toBeNull();
  });
  test("expandPiesa ignores both (not part of the official form)", () => {
    const base = { rectificationOutcome: RECTIFICATION_OUTCOMES[0], "b3.declaration": "true" };
    expect(expandPiesa({ ...base, customerOf: "Home Insulation Victoria", noPriceTalk: "true" }, ctx)).toEqual(expandPiesa(base, ctx));
  });
  test("docs carry the tick and tell Jo to delete the question", () => {
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_PIESA_FORM_SPEC.md"]) {
      const doc = readFileSync(f, "utf8");
      expect(doc, f).toContain(NO_PRICE_TALK_LABEL);
      expect(doc, f).toContain("Decision 323");
      expect(doc, f).not.toContain("only show when question 2a");
      expect(doc, f).not.toContain("Filled in by the portal. Don't change it.");
    }
  });
});

describe("decision 309: repairs always before installation", () => {
  test("the question is no longer asked (legacy, read only)", () => {
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "rectificationPossible")).toMatchObject({ required: false, portalOnly: true });
    expect(mittiAiPrompt("piesa")).not.toContain(REPAIR_POSSIBLE_LEGACY_LABEL);
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md"]) expect(readFileSync(f, "utf8")).toContain("Do NOT ask `Can the repair work be done before installation?`");
  });
  test("repair needed → the before-installation outcome; old 'No' still reads the same, with one office flag", () => {
    expect(shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }])["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    const old = shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }, { label: REPAIR_POSSIBLE_LEGACY_LABEL, value: "No" }]);
    expect(old["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    const e = expandPiesa({ ...old, rectificationWork: "Other (indicate below):", rectificationOther: "x", "b3.declaration": "true" }, ctx);
    expect(e.answers["b1"]).toBe("Electrical rectification work is required before insulation is installed or upgraded.");
    expect(e.flagged.filter((f) => f === REPAIR_LEGACY_NOT_BEFORE_FLAG)).toHaveLength(1);
    const fresh = expandPiesa({ ...shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }]), rectificationWork: "Other (indicate below):", rectificationOther: "x", "b3.declaration": "true" }, ctx);
    expect(fresh.flagged).not.toContain(REPAIR_LEGACY_NOT_BEFORE_FLAG);
  });
  test("the old pick-one 'electrician present on installation day' answer is read as before installation too, flagged", () => {
    const old = shortAnswersFromEntries("piesa", [{ label: NEEDED, value: RECTIFICATION_OUTCOMES[2] }]);
    expect(old["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    const e = expandPiesa({ ...old, rectificationWork: "Other (indicate below):", rectificationOther: "x", "b3.declaration": "true" }, ctx);
    expect(e.answers["b1"]).toBe("Electrical rectification work is required before insulation is installed or upgraded.");
    expect(e.flagged).toContain(REPAIR_LEGACY_NOT_BEFORE_FLAG);
  });
  test("no repair → unchanged", () => {
    expect(shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "No" }])["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[0]);
  });
});

describe("decision 314: be on site at the start of the install day", () => {
  const ONSITE = "Be on site at the start of the install day";
  const sync = (work: string) => shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }, { label: FIXES_WORK_LABEL, value: work }]);
  test("ticked → the official third outcome (electrician present at the start of installation)", () => {
    const short = sync(`Install RCD safety switches, ${ONSITE}`);
    expect(short["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    const e = expandPiesa({ ...short, "b3.declaration": "true" }, ctx);
    expect(e.answers["b1"]).toBe("Electrical rectification work is not possible prior to insulation being installed or upgraded under parts 2 and 3");
    expect(e.flagged).not.toContain(REPAIR_LEGACY_NOT_BEFORE_FLAG);
    expect(sync("Install RCD safety switches")["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
  });
  test("the A5 fixes form is not needed when ONLY the on-site option is ticked", () => {
    expect(fixesFormNeeded(sync(ONSITE))).toBe(false);
    expect(fixesFormNeeded(sync(`${ONSITE}, Other`))).toBe(true);
    expect(fixesFormNeeded(sync(`Replace downlights with IC-4 rated LED downlights, ${ONSITE}`))).toBe(true);
    expect(fixesFormNeeded(sync("Install RCD safety switches"))).toBe(true);
  });
  test("decision 327 replaced the decision-314 office line: the tick is history only, no Needs me row from it", () => {
    expect(ONSITE_START_HISTORY_TEXT).not.toMatch(/tell the installer and electrician/);
    expect("electrician_onsite_install_start" in NEEDS_TEXT).toBe(false);
    expect(NEEDS_TEXT.electrician_install_attendance.why).toBe("Electrician can't attend / hasn't confirmed install-day attendance");
    const raise = { job_id: "j1", event_type: "electrician_onsite_install_start", created_at: "2026-10-25T01:00:00Z" };
    expect(mittiOfficeItems([raise], new Date("2026-10-25T02:00:00Z"))).toEqual([]);
    const mitti = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(mitti).toContain("ONSITE_START_HISTORY_TEXT");
    expect(mitti).not.toMatch(/ONSITE_START_EVENT, ONSITE_START_HISTORY_TEXT, \{ needs_office: true/);
  });
});
