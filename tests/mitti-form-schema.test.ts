import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { definitionReadable, flattenDefinition } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { a3MissingFields } from "../src/lib/piisa-a3.core";

// Sanitized shape of a v1 template definition: header items, flat parent_id children, a metadata object
// before the type key, and a labelled option object inside a question.
const DEF = { template: { template_id: "template_x", name: "T",
  header_items: [{ item_id: "h1", label: "Portal Job Number", type: "textsingle" }],
  items: [
    { item_id: "s1", label: "Ceiling", type: "section" },
    { item_id: "q1", parent_id: "s1", label: "Insulation present?", metadata: { label: "meta", note: {} }, question: { response_set: "rs1" }, options: { label: "Yes", config: {} } },
    { item_id: "q2", parent_id: "s1", label: "Photo", media: {} },
  ] } };

describe("Mitti definition reading (repair)", () => {
  test("includes header items; types come from known keys, not metadata; option objects aren't questions", () => {
    expect(flattenDefinition(DEF)).toEqual([{ label: "Portal Job Number", type: "textsingle" }, { label: "Insulation present?", type: "question" }, { label: "Photo", type: "media" }]);
  });
  test("metadata-only / unsupported envelopes are unreadable, not missing questions", () => {
    expect(definitionReadable({ template: { template_id: "x", name: "n" } })).toBe(false);
    expect(definitionReadable({ items: [{ label: "A", weird: {} }] })).toBe(false);
    const r = validateSavedDefinition("ready_check" as never, { template: { template_id: "x" } });
    expect(r.unreadable).toBe(true); expect(r.issues[0]).toMatch(/does not prove/);
    expect(definitionReadable(DEF)).toBe(true);
  });
  test("generic pass is labelled as labels/counts/types only", () => {
    expect(validateSavedDefinition("ready_check" as never, DEF).basis).toMatch(/labels, counts and types only/);
  });
  test("saved native A3 PIISA is compared against its own stable-ID contract", () => {
    const live = JSON.parse(readFileSync("tests/fixtures/piisa-a3-live-audit-shape.json", "utf8"));
    const r = validateSavedDefinition("piisa", live);
    expect(r.basis).toMatch(/native A3/);
    expect(r.issues).toEqual(a3MissingFields(live).map((m) => `Native A3: ${m}`));
  });
});
