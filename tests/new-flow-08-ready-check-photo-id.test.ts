import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAN_Q, PRODUCT_OPTIONS } from "../src/lib/ready-check-lean.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { readyCheckFactsFromEntries, readyCheckCompletionChecks } from "../src/lib/ready-check-complete.core";
import { installerMissing } from "../src/lib/ready-check-chase.core";
import { warrantyFamilyForOption, PRODUCT_WARRANTIES } from "../src/lib/product-warranty.core";
const opts = { formComplete: true, electricianDecided: true, priceKnown: true };
const base = [{ label: LEAN_Q.contactPermission, value: "Yes" }, { label: "Is there existing insulation in this ceiling area?", value: "No" }];

test("approved wording, required tick on A1 and A2", () => {
  expect(LEAN_Q.photoIdShown).toBe("I showed my photo ID (name + business)");
  for (const k of ["ready_check", "ready_check_priced"] as const)
    expect(FORMS[k].fields.find((f) => f.label === LEAN_Q.photoIdShown)).toMatchObject({ type: "tick", required: true });
});
test("ticked → true; unticked on a form that asks → false and chased; old form → null, never chased", () => {
  expect(readyCheckFactsFromEntries([...base, { label: LEAN_Q.photoIdShown, value: "true" }], opts).photoIdShown).toBe(true);
  const unticked = readyCheckFactsFromEntries([...base, { label: LEAN_Q.photoIdShown, value: "" }], opts);
  expect(unticked.photoIdShown).toBe(false);
  expect(installerMissing(unticked)).toContain("the photo ID tick");
  expect(readyCheckCompletionChecks(unticked).reasons).toContain("Office needs to: the installer hasn't ticked that they showed their photo ID");
  const old = readyCheckFactsFromEntries(base, opts);
  expect(old.photoIdShown).toBeNull();
  expect(installerMissing(old)).not.toContain("the photo ID tick");
  expect(readyCheckCompletionChecks(old).reasons.join("|")).not.toContain("photo ID");
});
test("ECOWOOL removed: no option, no warranty family, still not a valid product", () => {
  expect(PRODUCT_OPTIONS).not.toContain("ECOWOOL R5");
  expect(warrantyFamilyForOption("ECOWOOL R5")).toBeNull();
  expect(PRODUCT_WARRANTIES.some((w) => /ecowool/i.test(w.productName))).toBe(false);
  expect(readFileSync("docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md", "utf8")).not.toMatch(/ECOWOOL/);
  expect(readFileSync("docs/MITTI_PIESA_CHATGPT_PROMPT.md", "utf8")).not.toMatch(/ECOWOOL/);
});
test("paste file: both templates, exact tick wording, deletes the ECOWOOL R5 option, publishes", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-02-A1-A2-photo-id.md", "utf8");
  expect(doc).toContain('"A1 – Ready Check | Installer-Supplied Customer"');
  expect(doc).toContain('"A2 – Ready Check | HIVIC Sourced Customer"');
  expect(doc).toContain(`"${LEAN_Q.photoIdShown}" — Checkbox — Required`);
  expect(doc).toContain('Delete the option "ECOWOOL R5"');
  expect(doc).toMatch(/Change nothing else[\s\S]*Publish/);
});
