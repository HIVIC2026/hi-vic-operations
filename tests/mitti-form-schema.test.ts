import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { definitionReadable, flattenDefinition } from "../src/lib/mitti-forms.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { a3MissingFields } from "../src/lib/piisa-a3.core";
import { inspectSavedMittiForm } from "../src/lib/mitti-form-health.core";

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

// These are unsupported/malformed provider shapes, not claims about the current saved forms.
const UNREADABLE_SHAPES = [
  { name: "unknown explicit type", definition: { items: [{ item_id: "q1", label: "Metadata item", type: "future_custom_widget" }] } },
  { name: "partly unsupported body", definition: { header_items: [{ item_id: "h1", label: "Portal Job Number", type: "textsingle" }], items: [{ item_id: "q1", label: "Unreadable question", unknown_kind: {} }] } },
  { name: "malformed children", definition: { items: [{ item_id: "s1", label: "Section", type: "section", children: { q1: { label: "Question", type: "textsingle" } } }] } },
  { name: "malformed body beside a valid header", definition: { header_items: [{ item_id: "h1", label: "Portal Job Number", type: "textsingle" }], items: { q1: { label: "Question", type: "textsingle" } } } },
  { name: "null nested item", definition: { items: [{ item_id: "q1", label: "Question", type: "textsingle", children: [null] }] } },
  { name: "mixed tree unsupported by the native reader", definition: { header_items: [{ item_id: "h1", label: "Portal Job Number", type: "textsingle" }], items: [{ item_id: "s1", label: "Section", type: "section", children: [], items: [{ item_id: "q1", label: "Hidden question", type: "question" }] }] } },
];

describe("Mitti unsupported definition safety", () => {
  for (const { name, definition } of UNREADABLE_SHAPES) {
    test(`${name} stays unreadable through the saved-form health boundary`, async () => {
      expect(definitionReadable(definition)).toBe(false);
      const savedId = "template_11111111111111111111111111111111";
      const result = await inspectSavedMittiForm(
        { key: "ready_check", savedId, approvalBlocker: null },
        async () => ({ template: { template_id: savedId, ...definition } }),
        validateSavedDefinition,
      );
      expect(result.identity).toBe("verified");
      expect(result.schema).toBe("unreadable");
      expect(result.schemaBasis).toBe("none");
      expect(result.ok).toBe(false);
      expect(result.schemaIssues).toHaveLength(1);
      expect(result.schemaIssues[0]).toMatch(/does not prove any question is missing/);
    });
  }

  test("keeps the existing type aliases and known Mitti question kinds readable", () => {
    for (const type of ["text", "textsingle", "textmulti", "number", "slider", "list", "question", "choice", "multiselect", "checkbox", "yesno", "media", "attachment", "drawing", "signature", "datetime", "date", "site", "switch"]) {
      expect(definitionReadable({ items: [{ item_id: "q1", label: "Question", type }] })).toBe(true);
    }
  });

  test("keeps supported nested children/items and flat child-ID references", () => {
    const definition = { header_items: [{ item_id: "h1", label: "Portal Job Number", type: "textsingle" }], items: [
      { item_id: "s1", label: "Section", type: "section", children: ["q3", { item_id: "q1", label: "Photo", media: {} }] },
      { item_id: "s2", label: "Only if yes", type: "logicfield", items: [{ item_id: "q2", label: "Conditional question", type: "question", options: { label: "Not a question" } }] },
      { item_id: "q3", parent_id: "s1", label: "Date", type: "datetime" },
    ] };
    expect(definitionReadable(definition)).toBe(true);
    expect(flattenDefinition(definition)).toEqual([
      { label: "Portal Job Number", type: "textsingle" }, { label: "Photo", type: "media" },
      { label: "Conditional question", type: "question" }, { label: "Date", type: "datetime" },
    ]);
  });
});
