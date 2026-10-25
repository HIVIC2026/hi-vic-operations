// Decision 312 (Jo 25 Oct 2026): on our leads (A2) the electrician confirms on the A4 that he won't discuss prices with
// the owner; not on installer-supplied jobs (A1). Decision 309: repairs always happen before installation.
import { describe, expect, test } from "bun:test";
import {
  CUSTOMER_OF_HELP, CUSTOMER_OF_LABEL, NO_PRICE_TALK_ISSUE, NO_PRICE_TALK_LABEL, RECTIFICATION_OUTCOMES, REPAIR_LEGACY_NOT_BEFORE_FLAG,
  REPAIR_POSSIBLE_LEGACY_LABEL, SHORT_PIESA_FIELDS, customerOfOption, noPriceTalkIssue, shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import { buildPrefill } from "../src/lib/mitti.core";
import { mittiAiPrompt } from "../src/lib/mitti-forms.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { readFileSync } from "node:fs";
import { FIXES_WORK_LABEL, ONSITE_START_OFFICE_TEXT } from "../src/lib/official-short.core";
import { fixesFormNeeded } from "../src/lib/fixes-day.core";
import { mittiOfficeItems } from "../src/lib/ready-check-chase.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";

const NEEDED = "Is any electrical repair work needed before insulation can be installed?";
const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-25", ownerConfirmation: null };

describe("decision 312: whose customer + no price talk", () => {
  test("wording exactly as given to Jo", () => {
    expect(CUSTOMER_OF_LABEL).toBe("Whose customer is this?");
    expect(CUSTOMER_OF_HELP).toBe("Filled in by the portal. Don't change it.");
    expect(NO_PRICE_TALK_LABEL).toBe("I will not discuss any prices with the owner. Home Insulation Victoria sends the owner all prices.");
    const q = SHORT_PIESA_FIELDS.find((f) => f.id === "customerOf")!;
    expect(q).toMatchObject({ type: "choice", required: true, prefill: true, choices: ["Home Insulation Victoria", "The installer's customer"] });
    const t = SHORT_PIESA_FIELDS.find((f) => f.id === "noPriceTalk")!;
    expect(t).toMatchObject({ type: "tick", required: true, when: "Whose customer is this? = Home Insulation Victoria" });
    // on the Job page: before the date of inspection
    expect(SHORT_PIESA_FIELDS.findIndex((f) => f.id === "customerOf")).toBeLessThan(SHORT_PIESA_FIELDS.findIndex((f) => f.id === "inspectionDate"));
  });
  test("prefill answer uses the quote code's A1/A2 classifier", () => {
    expect(customerOfOption("installer_sourced")).toBe("The installer's customer");
    expect(customerOfOption("hivic_sourced")).toBe("Home Insulation Victoria");
    expect(customerOfOption(null)).toBe("Home Insulation Victoria");
  });
  test("buildPrefill fills the choice by its option (help text after the label is fine)", () => {
    const template = { template: {
      items: [{ id: "q1", label: `${CUSTOMER_OF_LABEL}\n${CUSTOMER_OF_HELP}`, type: "question", question: { response_set_id: "rs1" } }],
      response_sets: [{ id: "rs1", responses: [{ id: "o1", label: "Home Insulation Victoria" }, { id: "o2", label: "The installer's customer" }] }],
    } };
    const p = buildPrefill(template, { jobNumber: "HV-1", address: "1 St", ownerName: "O", assessorName: "E", customerOf: customerOfOption("installer_sourced") });
    expect(p.items.concat(p.header_items).find((i: { item_id: string }) => i.item_id === "q1")).toMatchObject({ responses: { selected: [{ id: "o2", label: "The installer's customer" }] } });
  });
  test("office item only for a completed A4 on our lead that asked the question and lacks the tick", () => {
    const asked = [{ label: CUSTOMER_OF_LABEL, value: "Home Insulation Victoria" }];
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: true, entries: asked })).toBe(NO_PRICE_TALK_ISSUE);
    expect(NO_PRICE_TALK_ISSUE).toBe("Electrician hasn't confirmed they won't discuss prices with the owner");
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: true, entries: [...asked, { label: NO_PRICE_TALK_LABEL, value: null }] })).toBe(NO_PRICE_TALK_ISSUE);
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: true, entries: [...asked, { label: NO_PRICE_TALK_LABEL, value: "true" }] })).toBeNull();
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: true, entries: [...asked, { label: NO_PRICE_TALK_LABEL, value: "Yes" }] })).toBeNull();
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: false, entries: asked })).toBeNull(); // not completed yet
    expect(noPriceTalkIssue({ channel: "installer_sourced", completed: true, entries: asked })).toBeNull(); // A1: never
    expect(noPriceTalkIssue({ channel: "hivic_sourced", completed: true, entries: [{ label: NEEDED, value: "No" }] })).toBeNull(); // old form
  });
  test("expandPiesa ignores both (not part of the official form)", () => {
    const base = { rectificationOutcome: RECTIFICATION_OUTCOMES[0], "b3.declaration": "true" };
    expect(expandPiesa({ ...base, customerOf: "Home Insulation Victoria", noPriceTalk: "true" }, ctx)).toEqual(expandPiesa(base, ctx));
  });
  test("docs carry the wording", () => {
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_PIESA_FORM_SPEC.md"]) {
      const doc = readFileSync(f, "utf8");
      for (const s of [CUSTOMER_OF_LABEL, CUSTOMER_OF_HELP, NO_PRICE_TALK_LABEL, "The installer's customer"]) expect(doc, `${f}: ${s}`).toContain(s);
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
  test("one Needs me line, exact wording, cleared by the clear event", () => {
    expect(ONSITE_START_OFFICE_TEXT).toBe("Electrician must be on site at the start of the install day — tell the installer and electrician the day once booked");
    expect(NEEDS_TEXT.electrician_onsite_install_start.why).toBe(ONSITE_START_OFFICE_TEXT);
    const raise = { job_id: "j1", event_type: "electrician_onsite_install_start", created_at: "2026-10-25T01:00:00Z" };
    expect(mittiOfficeItems([raise], new Date("2026-10-25T02:00:00Z")).map((i) => i.code)).toEqual(["electrician_onsite_install_start"]);
    expect(mittiOfficeItems([raise, { job_id: "j1", event_type: "electrician_onsite_install_start_cleared", created_at: "2026-10-25T01:30:00Z" }], new Date("2026-10-25T02:00:00Z"))).toEqual([]);
  });
});
