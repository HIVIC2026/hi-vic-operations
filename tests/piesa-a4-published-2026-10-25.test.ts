// Jo's published "A4 – Electrical safety check (PIESA)" (25 Oct 2026, modified 02:06 UTC) validates against the portal
// contract: decisions 294–298 (life support direct, appliance block, repair Yes/No, photos with their questions, no owner
// page, no after-repair page). The fixture is the definition as Mitti returned it.
// Decisions 305/308/312 (Jo 25 Oct 2026) added questions AFTER this template was published: the electrician's one total
// price for the repair work + the ticks of what it includes (with the downlight / RCD counts and Other), and on the Job page
// "Whose customer is this?" + the no-price-talk tick. Until Jo republishes A4 with them, the published fixture reports
// EXACTLY those as missing — nothing else. Decision 305's free-text "What's included in that price?" is legacy (never
// asked) and decision 309 retired "Can the repair work be done before installation?": neither is reported.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import {
  CUSTOMER_OF_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_INCLUDED_HELP, FIXES_INCLUDED_LABEL, FIXES_OTHER_HELP, FIXES_OTHER_LABEL, FIXES_PRICE_LABEL,
  FIXES_RCD_COUNT_LABEL, FIXES_WORK_LABEL, NO_PRICE_TALK_LABEL, shortAnswersFromEntries,
} from "../src/lib/official-short.core";

const def = JSON.parse(readFileSync("tests/fixtures/mitti-piesa/a4-published-2026-10-25.json", "utf8"));
const NOT_YET_PUBLISHED = [CUSTOMER_OF_LABEL, NO_PRICE_TALK_LABEL, FIXES_PRICE_LABEL, FIXES_WORK_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL].map((l) => `Missing: ${l}`);

/** The published fixture with the new questions added (help text on its own line, as Mitti stores it). */
function republished() {
  const d = JSON.parse(JSON.stringify(def));
  const repair = d.template.items.find((s: { label: string }) => s.label === "Repair work");
  const logic = repair.children[0].children[0];
  const at = logic.children.findIndex((c: { label: string }) => c.label === "Please describe the other repair work.") + 1;
  const text = (id: string, label: string, fmt = "TEXT") => ({ id, label, children: [], textsingle: { options: { weighting: null, is_mandatory: true }, text_format: fmt, calculation_data: null, reading_config_id: "" } });
  const list = (id: string, label: string, multiple: boolean) => ({ id, label, children: [], list: { options: { weighting: null, is_mandatory: true }, response_set_id: `${id}-rs`, calculation_data: null, failed_responses: [], multiple_selection: multiple } });
  logic.children.splice(at, 0,
    text("d305-price", FIXES_PRICE_LABEL, "NUMBER"),
    list("d308-work", FIXES_WORK_LABEL, true),
    text("d308-dl", FIXES_DOWNLIGHT_COUNT_LABEL, "NUMBER"),
    text("d308-rcd", FIXES_RCD_COUNT_LABEL, "NUMBER"),
    text("d308-other", `${FIXES_OTHER_LABEL}\n${FIXES_OTHER_HELP}`),
    list("d312-customer", `${CUSTOMER_OF_LABEL}\nFilled in by the portal. Don't change it.`, false),
    { id: "d312-tick", label: NO_PRICE_TALK_LABEL, children: [], checkbox: { options: { weighting: null, is_mandatory: true } } },
  );
  return d;
}

describe("published A4 PIESA", () => {
  test("validateTemplate and the saved-form health check report only the new 305/308/312 questions (republish needed)", () => {
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
  test("pages in Jo's order and nothing after the declaration", () => {
    expect(def.template.items.map((s: { label: string }) => s.label)).toEqual(["Job", "Life support", "Mains power", "Solar, battery, generator", "Ceiling wiring", "Lights and appliances", "Repair work", "Electrician declaration"]);
  });
});
