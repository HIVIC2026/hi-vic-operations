// Ready Check extras section (Jo 8 Oct 2026): the installer can report extras beyond the
// agreed install and removal rates; the office prices them. Pure spec checks, no network.
import { describe, expect, test } from "bun:test";
import { FORMS, validateTemplate, type FormField } from "../src/lib/mitti-forms.core";

const YES_NO = "Are any extras needed beyond the standard install and removal?";
const DESCRIBE = "Describe each extra and why it is needed";
const PHOTOS = "Photos of each extra";

for (const key of ["ready_check", "ready_check_priced"] as const) {
  describe(`extras section on ${key}`, () => {
    const fields = FORMS[key].fields;
    const byLabel = (l: string) => fields.find((f: FormField) => f.label === l);

    test("has the Yes/No extras question, required, before the finish section", () => {
      const q = byLabel(YES_NO);
      expect(q).toBeDefined();
      expect(q!.type).toBe("choice");
      expect(q!.required).toBe(true);
      expect(q!.choices).toEqual(["Yes", "No"]);
      const finish = fields.findIndex((f) => f.label === "Anything else the office should know?");
      expect(fields.indexOf(q!)).toBeLessThan(finish);
    });

    test("description and photos are required only when Yes", () => {
      const d = byLabel(DESCRIBE);
      const p = byLabel(PHOTOS);
      expect(d).toBeDefined();
      expect(p).toBeDefined();
      expect(d!.required).toBe(true);
      expect(p!.required).toBe(true);
      expect(d!.when).toBe("Yes");
      expect(p!.when).toBe("Yes");
    });

    test("the installer never enters a price for extras", () => {
      const extras = fields.filter((f) => f.label.toLowerCase().includes("extra"));
      for (const f of extras) expect(f.type).not.toBe("number");
    });
  });
}

describe("extras template validation", () => {
  test("a template missing the extras questions fails validation", () => {
    const items = FORMS.ready_check.fields
      .filter((f) => ![YES_NO, DESCRIBE, PHOTOS].includes(f.label))
      .map((f) => ({ label: f.label, type: f.type === "choice" ? "list" : f.type }));
    const r = validateTemplate("ready_check", items);
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toContain(YES_NO);
  });
});
