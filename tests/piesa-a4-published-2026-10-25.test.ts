// Jo's published "A3 – Electrical safety check (PIESA)" (25 Oct 2026, modified 02:06 UTC) validates against the portal
// contract: decisions 294–298 (life support direct, appliance block, repair Yes/No, photos with their questions, no owner
// page, no after-repair page). The fixture is the definition as Mitti returned it.
// Decisions 305/308/312/323/324 (Jo 25 Oct 2026) changed the form AFTER this template was published: on the Repair work page
// ONE list — the ticks of what the electrician will do (with the downlight / RCD counts and Other), then his one total price
// LAST (decision 324, which also retired "Please tick the repair work that is required." / "Please describe the other repair
// work.": the official B2 ticks are derived from the plain list); and on the Job page the no-price-talk tick, on every job
// (decision 323 deleted "Whose customer is this?"). Until Jo republishes A3, the published fixture reports EXACTLY the new
// questions as missing — nothing else. The retired questions still on the published form (309's "Can the repair work be
// done before installation?", 324's two official-tick questions) are legacy: never reported, their answers still read.
// Decision 336 (Jo 25 Oct 2026): the hazard block asks type / what / where / photo / safe / problem / action (the decision-295
// "What is it and where is it?" is legacy, still read); decision 338: "Does an electrician need to be on site at the start of the
// install?" is its own question and the tick list is no longer Required — so the published form also lacks those questions.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import {
  FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_INCLUDED_HELP, FIXES_INCLUDED_LABEL, FIXES_OTHER_HELP, FIXES_OTHER_LABEL, FIXES_PRICE_LABEL,
  FIXES_RCD_COUNT_LABEL, FIXES_WORK_LABEL, NO_PRICE_TALK_LABEL, REPAIR_OTHER_LEGACY_LABEL, REPAIR_TICKS_LEGACY_LABEL, shortAnswersFromEntries,
  APPLIANCE_PRESENT_LABEL, APPLIANCE_Q, APPLIANCE_WHAT_WHERE_LEGACY_LABEL, ONSITE_START_LABEL, applianceRows,
} from "../src/lib/official-short.core";

const def = JSON.parse(readFileSync("tests/fixtures/mitti-piesa/a4-published-2026-10-25.json", "utf8"));
// Decision 404: "What is it?" is retired, not a missing required question.
const NOT_YET_PUBLISHED = [NO_PRICE_TALK_LABEL, APPLIANCE_Q.type, APPLIANCE_Q.where, APPLIANCE_Q.problem, APPLIANCE_Q.action, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, ONSITE_START_LABEL, FIXES_PRICE_LABEL].map((l) => `Missing: ${l}`);
const APPLIANCE_BLOCK_LABEL = "Add an appliance or flue";
const APPLIANCE_PARENT_OLD = "Are there any appliances, exhaust fans or flues in the ceiling space?";
const RETIRED = ["Can the repair work be done before installation?", "No means an electrician must be present on installation day instead.", REPAIR_TICKS_LEGACY_LABEL, REPAIR_OTHER_LEGACY_LABEL];

/** The published fixture as Jo republishes it (decisions 323/324): retired repair questions deleted, the plain list in the
 *  new order with the price last (help text on its own line, as Mitti stores it), the no-price tick on the Job page. */
function republished() {
  const d = JSON.parse(JSON.stringify(def));
  const repair = d.template.items.find((s: { label: string }) => s.label === "Repair work");
  const logic = repair.children[0].children[0];
  logic.children = logic.children.filter((c: { label: string }) => !RETIRED.includes(c.label));
  const text = (id: string, label: string, fmt = "TEXT") => ({ id, label, children: [], textsingle: { options: { weighting: null, is_mandatory: true }, text_format: fmt, calculation_data: null, reading_config_id: "" } });
  const list = (id: string, label: string, multiple: boolean) => ({ id, label, children: [], list: { options: { weighting: null, is_mandatory: true }, response_set_id: `${id}-rs`, calculation_data: null, failed_responses: [], multiple_selection: multiple } });
  logic.children.push(
    list("d308-work", FIXES_WORK_LABEL, true),
    text("d308-dl", FIXES_DOWNLIGHT_COUNT_LABEL, "NUMBER"),
    text("d308-rcd", FIXES_RCD_COUNT_LABEL, "NUMBER"),
    text("d308-other", `${FIXES_OTHER_LABEL}\n${FIXES_OTHER_HELP}`),
    list("d338-onsite", ONSITE_START_LABEL, false),
    text("d305-price", FIXES_PRICE_LABEL, "NUMBER"),
  );
  // Decision 336: the parent question renamed; the block asks type / what / where / photo / safe / problem / action.
  const walk = (x: { label?: string; children?: unknown[] }): { label?: string; children?: unknown[] } | null => {
    if (x.label === APPLIANCE_BLOCK_LABEL) return x;
    for (const c of (x.children ?? []) as { label?: string; children?: unknown[] }[]) { const hit = walk(c); if (hit) return hit; }
    return null;
  };
  const parent = JSON.stringify(d).includes(APPLIANCE_PARENT_OLD) ? d.template.items.flatMap((s: { children: unknown[] }) => s.children).find((c: { label: string }) => c.label === APPLIANCE_PARENT_OLD) : null;
  if (parent) parent.label = APPLIANCE_PRESENT_LABEL;
  const block = d.template.items.map(walk).find(Boolean)!;
  const kids = block.children as { label: string }[];
  const at = kids.findIndex((c) => c.label === APPLIANCE_WHAT_WHERE_LEGACY_LABEL);
  kids.splice(at, 1, list("d336-type", APPLIANCE_Q.type, false), text("d336-what", APPLIANCE_Q.what), text("d336-where", APPLIANCE_Q.where));
  kids.push(text("d336-problem", APPLIANCE_Q.problem), text("d336-action", APPLIANCE_Q.action));
  const job = d.template.items.find((s: { label: string }) => s.label === "Job");
  // Jo's 27 Oct published A3 includes Owner name; retain the historical 25 Oct fixture unchanged.
  job.children.push(text("published-owner-name", "Owner name"));
  job.children.push({ id: "d323-tick", label: NO_PRICE_TALK_LABEL, children: [], checkbox: { options: { weighting: null, is_mandatory: true } } });
  return d;
}

describe("published A3 PIESA", () => {
  test("validateTemplate and the saved-form health check report only the new 305/308/323/324 questions (republish needed)", () => {
    expect(validateTemplate("piesa", flattenDefinition(def)).issues).toEqual(NOT_YET_PUBLISHED);
    expect((validateSavedDefinition("piesa" as never, def) as { issues: string[] }).issues).toEqual(NOT_YET_PUBLISHED);
  });
  test("once republished with them (help text on its own line) it validates clean", () => {
    const d = republished();
    expect(d.template.items.find((s: { label: string }) => s.label === "Job").children.some((c: { label: string }) => c.label === "Owner name")).toBe(true);
    expect(validateTemplate("piesa", flattenDefinition(d)).issues).toEqual([]);
    expect((validateSavedDefinition("piesa" as never, d) as { issues: string[] }).issues).toEqual([]);
  });
  test("the answers map by label even with Mitti's appended help text", () => {
    const short = shortAnswersFromEntries("piesa", [
      { label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" },
      { label: FIXES_PRICE_LABEL, value: "$1,234.50" },
      { label: `${FIXES_INCLUDED_LABEL}\n${FIXES_INCLUDED_HELP}`, value: "Replace 6 downlights with IC-4 LEDs" },
    ]);
    expect(short["fixesPriceIncGst"]).toBe("$1,234.50");
    expect(short["fixesIncluded"]).toBe("Replace 6 downlights with IC-4 LEDs");
  });
  test("decision 308 answers map by label too", () => {
    const short = shortAnswersFromEntries("piesa", [
      { label: FIXES_WORK_LABEL, value: "Install RCD safety switches, Other" },
      { label: FIXES_RCD_COUNT_LABEL, value: "2" },
      { label: `${FIXES_OTHER_LABEL}\n${FIXES_OTHER_HELP}`, value: "Fit a junction box" },
    ]);
    expect(short).toMatchObject({ fixesWork: "Install RCD safety switches, Other", fixesRcdCount: "2", fixesOtherDetail: "Fit a junction box" });
  });
  test("decision 324: the republished repair page asks the plain list first and the price LAST, without the retired questions", () => {
    const logic = republished().template.items.find((s: { label: string }) => s.label === "Repair work").children[0].children[0];
    expect(logic.children.map((c: { label: string }) => c.label.split("\n")[0])).toEqual([FIXES_WORK_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, ONSITE_START_LABEL, FIXES_PRICE_LABEL]); // decision 338: the on-site question before the price
  });
  test("pages in Jo's order and nothing after the declaration", () => {
    expect(def.template.items.map((s: { label: string }) => s.label)).toEqual(["Job", "Life support", "Mains power", "Solar, battery, generator", "Ceiling wiring", "Lights and appliances", "Repair work", "Electrician declaration"]);
  });
});

describe("decision 336: the published (old) hazard block is still read", () => {
  test("the old parent label and 'What is it and where is it?' still map; the row keeps the old wording", () => {
    const short = shortAnswersFromEntries("piesa", [
      { label: APPLIANCE_PARENT_OLD, value: "Yes" },
      { label: APPLIANCE_WHAT_WHERE_LEGACY_LABEL, value: "Exhaust fan above the bathroom" },
      { label: APPLIANCE_Q.photo, value: "1 photo" },
      { label: APPLIANCE_Q.safe, value: "Yes" },
    ]);
    expect(short["appliancesPresent"]).toBe("Yes");
    expect(applianceRows(short)).toEqual([{ type: null, what: "Exhaust fan above the bathroom", where: "", safe: "Yes", photo: true, problem: "", action: "", legacy: true }]);
  });
});
