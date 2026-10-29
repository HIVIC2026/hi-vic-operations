import { describe, expect, test } from "bun:test";
import { ownerCanCancel } from "../src/lib/owner-myjob.core";
import { gateDoc } from "../src/lib/owner-gates.core";
describe("Cancel my job (no cooling-off)", () => {
  test("allowed until the safety check is booked", () => {
    expect(ownerCanCancel("ready_check_ready_to_schedule", [], false)).toBe(true);
    expect(ownerCanCancel("ready_check_scheduled", ["ready_check"], false)).toBe(true);
    expect(ownerCanCancel("piesa_and_install_window_pending", [], false)).toBe(true);
    expect(ownerCanCancel("piesa_and_install_window_pending", ["assessment"], false)).toBe(false);
    for (const s of ["piesa_scheduled", "installation_booked", "complete", "cancelled", "on_hold"]) expect(ownerCanCancel(s, [], false)).toBe(false);
  });
  test("cooling-off stays pending (DRAFT) until Jo picks a variant", () => {
    expect(gateDoc("cooling_off_notice").body).toMatch(/^DRAFT/);
  });
});
