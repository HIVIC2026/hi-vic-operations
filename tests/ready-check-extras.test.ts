// Ready Check extras section (Jo 8 Oct 2026) — RETIRED by decision 222 (Jo 24 Oct 2026, lean Ready Check): the
// installer's price covers the works and the office prices anything else from the notes; the three extras questions
// are gone from both build sheets and the Mitti build prompt must never ask for them again. Pure spec checks, no network.
import { describe, expect, test } from "bun:test";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";

const YES_NO = "Are any extras needed beyond the standard install and removal?";
const DESCRIBE = "Describe each extra and why it is needed";
const PHOTOS = "Photos of each extra";

for (const key of ["ready_check", "ready_check_priced"] as const) {
  describe(`extras section retired on ${key} (decision 222)`, () => {
    const labels = FORMS[key].fields.map((f) => f.label);
    test("none of the three extras questions is on the build sheet", () => {
      for (const l of [YES_NO, DESCRIBE, PHOTOS]) expect(labels).not.toContain(l);
      expect(labels.some((l) => l.toLowerCase().includes("extra"))).toBe(false);
    });
    test("the Mitti build prompt no longer asks for an extras section", () => {
      const prompt = mittiAiPrompt(key);
      expect(prompt).not.toContain(YES_NO);
      expect(prompt).toContain("Do NOT add an extras section");
    });
    test("an old template that still carries the extras questions is not failed for them", () => {
      const items = FORMS[key].fields.map((f) => ({ label: f.label, type: f.type === "choice" || f.type === "yesno" ? "question" : f.type === "multichoice" || f.type === "tick" ? "checkbox" : f.type }));
      const withExtras = [...items, { label: YES_NO, type: "question" }, { label: DESCRIBE, type: "textsingle" }, { label: PHOTOS, type: "media" }];
      expect(validateTemplate(key, withExtras).ok).toBe(true);
    });
  });
}
