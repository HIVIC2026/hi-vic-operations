// Jo's published "A4 – Electrical safety check (PIESA)" (25 Oct 2026, modified 02:06 UTC) validates against the portal
// contract: decisions 294–298 (life support direct, appliance block, repair Yes/No, photos with their questions, no owner
// page, no after-repair page). The fixture is the definition as Mitti returned it.
// Decisions 305/308/312/323/324 (Jo 25 Oct 2026) changed the form AFTER this template was published: on the Repair work page
// ONE list — the ticks of what the electrician will do (with the downlight / RCD counts and Other), then his one total price
// LAST (decision 324, which also retired "Please tick the repair work that is required." / "Please describe the other repair
// work.": the official B2 ticks are derived from the plain list); and on the Job page the no-price-talk tick, on every job
// (decision 323 deleted "Whose customer is this?"). Until Jo republishes A4, the published fixture reports EXACTLY the new
// questions as missing — nothing else. The retired questions still on the published form (309's "Can the repair work be
// done before installation?", 324's two official-tick questions) are legacy: never reported, their answers still read.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import {
  FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_INCLUDED_HELP, FIXES_INCLUDED_LABEL, FIXES_OTHER_HELP, FIXES_OTHER_LABEL, FIXES_PRICE_LABEL,
  FIXES_RCD_COUNT_LABEL, FIXES_WORK_LABEL, NO_PRICE_TALK_LABEL, REPAIR_OTHER_LEGACY_LABEL, REPAIR_TICKS_LEGACY_LABEL, shortAnswersFromEntries,
} from "../src/lib/official-short.core";

const def = JSON.parse(readFileSync("tests/fixtures/mitti-piesa/a4-published-2026-10-25.json", "utf8"));
const NOT_YET_PUBLISHED = [NO_PRICE_TALK_LABEL, FIXES_WORK_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, FIXES_PRICE_LABEL].map((l) => `Missing: ${l}`);
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
    text("d305-price", FIXES_PRICE_LABEL, "NUMBER"),
  );
  const job = d.template.items.find((s: { label: string }) => s.label === "Job");
  job.children.push({ id: "d323-tick", label: NO_PRICE_TALK_LABEL, children: [], checkbox: { options: { weighting: null, is_mandatory: true } } });
  return d;
}

describe("published A4 PIESA", () => {
  test("validateTemplate and the saved-form health check report only the new 305/308/323/324 questions (republish needed)", () => {
    expect(validateTemplate("piesa", flattenDefinition(def)).issues).toEqual(NOT_YET_PUBLISHED);
    expect((validateSavedDefinition("piesa" as never, def) as { issues: string[] }).issues).toEqual(NOT_YET_PUBLISHED);
  });
  test("once republished with them (help text on its own line) it validates clean", () => {
    const d = republished();
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
    expect(logic.children.map((c: { label: string }) => c.label.split("\n")[0])).toEqual([FIXES_WORK_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, FIXES_PRICE_LABEL]);
  });
  test("pages in Jo's order and nothing after the declaration", () => {
    expect(def.template.items.map((s: { label: string }) => s.label)).toEqual(["Job", "Life support", "Mains power", "Solar, battery, generator", "Ceiling wiring", "Lights and appliances", "Repair work", "Electrician declaration"]);
  });
});
