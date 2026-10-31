import { describe, expect, test } from "bun:test";
import { GATE_DOCS, PAPERWORK_SCREENS } from "../src/lib/owner-gates.core";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("owner paperwork has no retired approval wording", () => {
  test("every document version, approval note, title and body", () => {
    for (const doc of GATE_DOCS) {
      for (const value of [doc.version, doc.approvalNote ?? "", doc.title, doc.body]) {
        expect(value).not.toMatch(/lawyer/i);
      }
    }
  });
  test("every paperwork screen string", () => {
    for (const value of strings(PAPERWORK_SCREENS)) expect(value).not.toMatch(/lawyer/i);
  });
});