// Jo's published "A4 – Electrical safety check (PIESA)" (25 Oct 2026, modified 02:06 UTC) validates clean against the portal
// contract: decisions 294–298 (life support direct, appliance block, repair Yes/No, photos with their questions, no owner
// page, no after-repair page). The fixture is the definition as Mitti returned it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { flattenDefinition, validateTemplate } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";

const def = JSON.parse(readFileSync("tests/fixtures/mitti-piesa/a4-published-2026-10-25.json", "utf8"));

describe("published A4 PIESA", () => {
  test("validateTemplate and the saved-form health check report nothing", () => {
    expect(validateTemplate("piesa", flattenDefinition(def)).issues).toEqual([]);
    expect((validateSavedDefinition("piesa" as never, def) as { issues: string[] }).issues).toEqual([]);
  });
  test("pages in Jo's order and nothing after the declaration", () => {
    expect(def.template.items.map((s: { label: string }) => s.label)).toEqual(["Job", "Life support", "Mains power", "Solar, battery, generator", "Ceiling wiring", "Lights and appliances", "Repair work", "Electrician declaration"]);
  });
});
