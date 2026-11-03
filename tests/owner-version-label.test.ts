// Jo's rule: no owner-facing document says "lawyer". The stored gate version id keeps its name; owner copies show a label.
import { expect, test } from "bun:test";
import { GATE_DOCS, LAWYER_V, fillTemplate, ownerVersionLabel, signedTextHeader } from "../src/lib/owner-gates.core";

test("ownerVersionLabel drops a leading lawyer- and leaves everything else alone", () => {
  expect(ownerVersionLabel("lawyer-2026-10-06-v1")).toBe("2026-10-06-v1");
  expect(ownerVersionLabel("Lawyer-2026-10-06-v1")).toBe("2026-10-06-v1");
  expect(ownerVersionLabel("v1.3")).toBe("v1.3");
  expect(ownerVersionLabel("")).toBe("");
  expect(ownerVersionLabel(null)).toBe("");
  expect(ownerVersionLabel(undefined)).toBe("");
});

test("the stored version id is unchanged", () => {
  expect(LAWYER_V).toBe("lawyer-2026-10-06-v1");
  for (const d of GATE_DOCS.filter((x) => x.version === LAWYER_V)) expect(d.version).toBe("lawyer-2026-10-06-v1");
});

test("a signed text header for a gate doc shows the version without lawyer", () => {
  for (const d of GATE_DOCS.filter((x) => x.version === LAWYER_V)) {
    const h = signedTextHeader(d.title, d.version, false);
    expect(h).toContain("version 2026-10-06-v1");
    expect(h).not.toMatch(/lawyer/i);
    const text = `${h}\n\n${fillTemplate(d.body, {})}\n\n[x] ${d.tick}`;
    expect(text.split("\n")[0]).not.toMatch(/lawyer/i);
  }
  expect(signedTextHeader("Contact and privacy", LAWYER_V, true)).toBe("Contact and privacy (version 2026-10-06-v1, DRAFT)");
});
