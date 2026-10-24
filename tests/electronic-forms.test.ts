import { describe, expect, test } from "bun:test";
import { formFieldBlockers, NOT_READY, parseFormFields, pickFieldValues, prefillRows, resolveInstalledDetails, setupStatus, templateBlockers, type Template } from "../src/lib/assignment.core";

const T = (k: string, o: Partial<Template> = {}): Template => ({ template_key: k, version: "v1", body: "x".repeat(30), approved: true, is_active: true, required: true, ...o });

describe("electronic forms – prefill, no duplicate entry", () => {
  test("installed as quoted reuses the quoted product (installer types nothing)", () => {
    expect(resolveInstalledDetails({ asQuotedProduct: true, area: 110 }, { product: "R5.0 batts" })).toEqual({ product: "R5.0 batts", area: 110 });
  });
  test("different product must be entered; area must be positive", () => {
    expect("error" in resolveInstalledDetails({ asQuotedProduct: false, product: "", area: 110 }, { product: "R5.0" })).toBe(true);
    expect("error" in resolveInstalledDetails({ asQuotedProduct: true, area: 0 }, { product: "R5.0" })).toBe(true);
    expect(resolveInstalledDetails({ asQuotedProduct: false, product: "R6.0 batts", area: 90 }, { product: "R5.0" })).toEqual({ product: "R6.0 batts", area: 90 });
  });
  test("prefill rows show known facts and dash for unknown", () => {
    const r = prefillRows([["Job", "HV-1"], ["Licence", null]]);
    expect(r).toEqual([{ label: "Job", value: "HV-1" }, { label: "Licence", value: "—" }]);
  });
  test("form fields: only valid definitions kept; known fields never duplicated by config parsing", () => {
    const defs = parseFormFields([{ key: "batch_no", label: "Batch number", type: "text" }, { key: "bad key", label: "x" }, { key: "batch_no", label: "dup" }, { key: "qty", label: "Bags", type: "number", required: false }]);
    expect(defs.map((d) => d.key)).toEqual(["batch_no", "qty"]);
    expect(formFieldBlockers(defs, {})).toEqual(['Please complete "Batch number".']);
    expect(formFieldBlockers(defs, { batch_no: "B1", qty: "abc" })).toEqual(['"Bags" must be a number.']);
    expect(pickFieldValues(defs, { batch_no: "B1", stray: "x" })).toEqual({ batch_no: "B1" });
  });
  test("plain-English not-ready messages", () => {
    expect(templateBlockers([], "agreement")).toEqual([NOT_READY.consumer_rights]);
    expect(templateBlockers([], "installer")).toEqual([NOT_READY.installer_declaration]);
    expect(templateBlockers([], "final")).toEqual([NOT_READY.consumer_declaration]);
  });
  test("setup status cards", () => {
    const s = setupStatus([T("consumer_declaration"), T("consumer_rights")], false);
    // "installer" is always ready: the separate installer declaration is superseded (decision 118a) — PIISA before work, Part B after.
    expect(s.map((c) => [c.key, c.ready])).toEqual([["agreement", true], ["esc_consent", false], ["installer", true], ["final_assignment", true], ["ap", true], ["esc_config", false]]);
    expect(setupStatus([], false).filter((c) => c.ready).map((c) => c.key)).toEqual(["installer", "ap"]); // nothing else claims Ready without approved wording
  });
});
