import { describe, expect, test } from "bun:test";
import { PDF_MAP, planOfficialFill } from "../src/lib/official-pdf.core";
import { FORMS, PIESA_OUTCOMES } from "../src/lib/mitti-forms.core";

describe("official DEECA PDF mapping", () => {
  test("every mapped label exists in the form spec (no invented questions)", () => {
    for (const k of ["piesa", "piisa"] as const) {
      const labels = new Set([...FORMS[k].fields.map((f) => f.label), "Property owner name"]);
      for (const m of PDF_MAP[k]) expect(labels.has(m.label)).toBe(true);
    }
  });
  test("PIESA covers all Part 2–7 yes/no radios once", () => {
    const radios = PDF_MAP.piesa.filter((m) => m.kind === "yn").map((m) => m.pdf);
    expect(new Set(radios).size).toBe(radios.length);
    expect(radios).toContain("Radio Button 30");
  });
  test("yes/no/N-A and outcome map to official choices; blanks reported, not guessed", () => {
    const p = planOfficialFill("piesa", {
      "Job Reference ID": "HV-1", "Is anyone at this property dependent on life support?": "No",
      "Have thermoplastic insulated and sheathed (TPS) cables present in the ceiling space been visually inspected and deemed safe?": "N/A",
      "B1 Assessment outcome": PIESA_OUTCOMES[1], "B2 Required rectifications": ["RCDs need to be installed for circuit/s within the ceiling insulation area"],
    });
    expect(p.text["Job reference ID"]).toBe("HV-1");
    expect(p.radio["Life support"]).toBe("Choice2");
    expect(p.radio["Radio Button 19"]).toBe("Choice3");
    expect(p.radio["Radio Button 31"]).toBe("Choice2");
    expect(p.check).toEqual(["Check Box 8"]);
    expect(p.missing.length).toBeGreaterThan(10);
  });
  test("unrecognised answer is never ticked", () => {
    const p = planOfficialFill("piisa", { "Is there insulation present in the ceiling?": "maybe" });
    expect(p.radio["Radio Button 39"]).toBeUndefined();
    expect(p.missing.some((m) => m.includes("unrecognised"))).toBe(true);
  });
});
