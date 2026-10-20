import { describe, expect, test } from "bun:test";
import { installerReadyCheckAction } from "../src/lib/installer-ready-check.core";
import { installerProgress } from "../src/lib/installer-progress.core";

const rc = (quoted: "yes" | "no" | null, attended: "yes" | "no" | null) =>
  installerReadyCheckAction({ channel: "installer_sourced", stage: "ready_check_ready_to_schedule", quoted, attended, timesRequested: false, openWindows: 0, booked: false });

describe("attendance drives Ready Check handoff", () => {
  test("quoted but not visited still needs the visit", () => expect(rc("yes", "no")).toBe("book"));
  test("visited but not quoted does not force a repeat visit", () => expect(rc("no", "yes")).toBe("none"));
  test("not visited, not quoted needs the visit", () => expect(rc("no", "no")).toBe("book"));
  test("visited and quoted needs no visit", () => expect(rc("yes", "yes")).toBe("none"));
  test("unknown attendance is asked, never assumed yes or no", () => { expect(rc("no", null)).toBe("confirm_attendance"); expect(rc("yes", null)).toBe("confirm_attendance"); });
});

const base = { coordination: "hivic_managed" as const, quoteAmountKnown: true, eligibility: "eligible" as const, quoteHeld: [], quoteStatus: "none", quoteDelivery: null, quoteHoldReason: null, reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, electricalExpired: false, rectificationOpen: false, installBooking: null, installBlockers: [], installationCompleted: false, evidenceApprovedAt: null, veecStatus: null, stage: "new_enquiry", evidence: [] } as never as Parameters<typeof installerProgress>[0];
const next = (quoted: "yes" | "no" | null, attended: "yes" | "no" | null) => installerProgress({ ...base, quoted, attended }).next;

describe("attendance drives progress next action", () => {
  test("visited + unquoted: installer prices the same job", () => { const n = next("no", "yes"); expect(n.who).toBe("You"); expect(n.text).not.toMatch(/Ready Check/); });
  test("quoted + not visited: preliminary, Ready Check required", () => { const n = next("yes", "no"); expect(n.text).toMatch(/preliminary/); expect(n.text).toMatch(/Ready Check/); });
  test("not visited + unquoted: arrange Ready Check", () => expect(next("no", "no").text).toMatch(/Ready Check/));
  test("unknown attendance asks the installer, never assumes", () => { const n = next("no", null); expect(n.who).toBe("You"); expect(n.text).toMatch(/attended and assessed/); });
});
