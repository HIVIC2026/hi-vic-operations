import { describe, expect, test } from "bun:test";
import { mittiFormId } from "../src/lib/mitti-form-link.core";
describe("trade Mitti form link", () => {
  test("Ready Check never falls back to the PIESA assessment audit id", () => {
    expect(mittiFormId("ready_check", "PIESA-AUDIT-1", null)).toBeNull();
    expect(mittiFormId("ready_check", "PIESA-AUDIT-1", { external_source: "installer_import", external_id: "X" })).toBeNull();
    expect(mittiFormId("ready_check", "PIESA-AUDIT-1", { external_source: "mitti", external_id: "RC-9" })).toBe("RC-9");
  });
  test("PIESA uses the assessment id only", () => {
    expect(mittiFormId("piesa", "PIESA-AUDIT-1", { external_source: "mitti", external_id: "RC-9" })).toBe("PIESA-AUDIT-1");
    expect(mittiFormId("piesa", null, { external_source: "mitti", external_id: "RC-9" })).toBeNull();
  });
});
