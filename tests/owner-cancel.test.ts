import { describe, expect, test } from "bun:test";
import { ownerCanCancel } from "../src/lib/owner-myjob.core";
import { gateDoc } from "../src/lib/owner-gates.core";
describe("Cancel my job (no cooling-off)", () => {
  test("allowed until the safety check is booked", () => {
    expect(ownerCanCancel("ready_check_ready_to_schedule", [])).toBe(true);
    expect(ownerCanCancel("ready_check_scheduled", ["ready_check"])).toBe(true);
    expect(ownerCanCancel("piesa_and_install_window_pending", [])).toBe(true);
    expect(ownerCanCancel("piesa_and_install_window_pending", ["assessment"])).toBe(false);
    for (const s of ["piesa_scheduled", "installation_booked", "complete", "cancelled", "on_hold"]) expect(ownerCanCancel(s, [])).toBe(false);
  });
  test("Gate B box 4 is the approved doesn't-apply line, no cooling-off wording", () => {
    const d = gateDoc("cooling_off_notice");
    expect(d.body).toBe("You can ask us questions or change your mind before your safety check is booked.");
    expect(d.body).not.toMatch(/DRAFT|cooling|business day/i);
  });
});
