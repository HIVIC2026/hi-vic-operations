import { describe, it, expect } from "bun:test";
import { validateTemplate } from "@/lib/mitti-forms.core";
import { SHORT_PIESA_FIELDS } from "@/lib/official-short.core";
import { expandPiesa } from "@/lib/official-expand.core";

const ctx = { lifeSupportDeclared: "no", today: "2026-10-27" } as never;
const base = { appliancesPresent: "Yes" };
describe("decision 404: A3 'What is it?' deleted", () => {
  it("'What is it?' is optional and not expected on the form", () => {
    const f = SHORT_PIESA_FIELDS.find((x) => x.id === "applianceWhat")!;
    expect(f.required).toBe(false);
    expect(f.portalOnly).toBe(true);
  });
  it("a form without 'What is it?' raises no Missing issue for it", () => {
    const items = SHORT_PIESA_FIELDS.filter((f) => f.id !== "applianceWhat").map((f) => ({ label: f.label, type: "text" }));
    expect(validateTemplate("piesa", items).issues).not.toContain("Missing: What is it?");
  });
  it("Part 7 Appliance column comes from the type, with no 'not described' flag", () => {
    const r = expandPiesa({ ...base, applianceType: "Flue", applianceWhere: "Above kitchen", applianceSafe: "Yes", "applianceType#1": "Appliance", "applianceWhere#1": "Hallway", "applianceSafe#1": "Yes" } as never, ctx);
    expect(r.answers["p7.appliance#0"]).toBe("Flue");
    expect(r.answers["p7.appliance#1"]).toBe("Appliance");
    expect(r.flagged.join(" ")).not.toMatch(/not described/);
  });
  it("older forms with 'What is it?' still use that answer", () => {
    const r = expandPiesa({ ...base, applianceType: "Flue", applianceWhat: "Gas heater flue", applianceWhere: "Lounge", applianceSafe: "Yes" } as never, ctx);
    expect(r.answers["p7.appliance#0"]).toBe("Gas heater flue");
  });
});
