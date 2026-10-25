// Jo's published "A4 – Electrical safety check (PIESA)" (25 Oct 2026, modified 02:06 UTC) validates against the portal
// contract: decisions 294–298 (life support direct, appliance block, repair Yes/No, photos with their questions, no owner
// page, no after-repair page). The fixture is the definition as Mitti returned it.
// Decision 305 (Jo 25 Oct 2026) added two questions to the Repair work page AFTER this template was published (the
// electrician's one total price for the repair work + what it includes). Until Jo republishes A4 with them, the published
// fixture reports EXACTLY those two as missing — nothing else. The template must be republished (docs/MITTI_PIESA_CHATGPT_PROMPT.md
// questions 22a/22b) before the form-health check passes again.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { FIXES_INCLUDED_HELP, FIXES_INCLUDED_LABEL, FIXES_PRICE_LABEL, shortAnswersFromEntries } from "../src/lib/official-short.core";

const def = JSON.parse(readFileSync("tests/fixtures/mitti-piesa/a4-published-2026-10-25.json", "utf8"));
const DECISION_305_MISSING = [`Missing: ${FIXES_PRICE_LABEL}`, `Missing: ${FIXES_INCLUDED_LABEL}`];

/** The published fixture with the two decision-305 questions added right after "Please describe the other repair work." */
function republished() {
  const d = JSON.parse(JSON.stringify(def));
  const repair = d.template.items.find((s: { label: string }) => s.label === "Repair work");
  const logic = repair.children[0].children[0];
  const at = logic.children.findIndex((c: { label: string }) => c.label === "Please describe the other repair work.") + 1;
  const text = (id: string, label: string) => ({ id, label, children: [], textsingle: { options: { weighting: null, is_mandatory: true }, text_format: "TEXT", calculation_data: null, reading_config_id: "" } });
  logic.children.splice(at, 0, text("d305-price", FIXES_PRICE_LABEL), text("d305-included", `${FIXES_INCLUDED_LABEL}\n${FIXES_INCLUDED_HELP}`));
  return d;
}

describe("published A4 PIESA", () => {
  test("validateTemplate and the saved-form health check report only the two decision-305 questions (republish needed)", () => {
    expect(validateTemplate("piesa", flattenDefinition(def)).issues).toEqual(DECISION_305_MISSING);
    expect((validateSavedDefinition("piesa" as never, def) as { issues: string[] }).issues).toEqual(DECISION_305_MISSING);
  });
  test("once republished with the two questions (help text on its own line) it validates clean", () => {
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
  test("pages in Jo's order and nothing after the declaration", () => {
    expect(def.template.items.map((s: { label: string }) => s.label)).toEqual(["Job", "Life support", "Mains power", "Solar, battery, generator", "Ceiling wiring", "Lights and appliances", "Repair work", "Electrician declaration"]);
  });
});
