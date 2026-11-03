// New job flow Part 8 final review I2: a held VEEC Part B (Mitti signature not applied, or the portal image held) is ONE
// Needs me row near "VEEC Part A held", cleared by the Mitti signing event or by the installer signing in the portal.
// Run: bun test tests/new-flow-08-part-b-needs-me.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VEEC_PART_B_IMAGE_HELD_EVENT, VEEC_PART_B_MITTI_HELD_EVENT, VEEC_PART_B_SIGNED_MITTI_EVENT, veecPartBHeldOpen } from "../src/lib/veec-part-b-mitti.core";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

const ev = (event_type: string, created_at: string, details: Record<string, unknown> | null = null) => ({ event_type, created_at, details });
const REASON = "Rebate form facts changed after the Lead Installer signed in Mitti — a new Part B signature is needed.";

describe("veecPartBHeldOpen", () => {
  test("latest held event with needs_office stays open", () => {
    const r = veecPartBHeldOpen([ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: REASON, needs_office: true })], { installerSignedAt: null });
    expect(r).toEqual({ at: "2026-11-02T01:00:00Z", reason: REASON });
  });
  test("a hold that is not for the office (installer still to fix it) is not a row", () => {
    expect(veecPartBHeldOpen([ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: "No installer is assigned", needs_office: false })], { installerSignedAt: null })).toBeNull();
  });
  test("the portal image hold counts too", () => {
    const r = veecPartBHeldOpen([ev(VEEC_PART_B_IMAGE_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: "Signature image unreadable", needs_office: true })], { installerSignedAt: null });
    expect(r?.reason).toBe("Signature image unreadable");
  });
  test("cleared by a later Mitti signing event; an earlier one does not clear", () => {
    const held = ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: REASON, needs_office: true });
    expect(veecPartBHeldOpen([held, ev(VEEC_PART_B_SIGNED_MITTI_EVENT, "2026-11-02T02:00:00Z")], { installerSignedAt: null })).toBeNull();
    expect(veecPartBHeldOpen([ev(VEEC_PART_B_SIGNED_MITTI_EVENT, "2026-11-01T02:00:00Z"), held], { installerSignedAt: null })).not.toBeNull();
  });
  test("cleared when the assignment carries an installer signature (portal signing)", () => {
    const held = ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: REASON, needs_office: true });
    expect(veecPartBHeldOpen([held], { installerSignedAt: "2026-11-02T03:00:00Z" })).toBeNull();
  });
  test("latest event wins: a later hold not for the office closes an earlier office hold; no events = null", () => {
    expect(veecPartBHeldOpen([
      ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T01:00:00Z", { reason: REASON, needs_office: true }),
      ev(VEEC_PART_B_MITTI_HELD_EVENT, "2026-11-02T02:00:00Z", { reason: "No installer is assigned", needs_office: false }),
    ], { installerSignedAt: null })).toBeNull();
    expect(veecPartBHeldOpen([], { installerSignedAt: null })).toBeNull();
  });
});

describe("Needs me row", () => {
  const NOW = Date.parse("2026-11-03T03:00:00Z");
  const job = (id: string, extra: Partial<NeedsFacts>): NeedsFacts => ({ jobId: id, jobNumber: `HV-${id}`, surname: "Smith", suburb: "Croydon", ...extra });
  test("one row, This week, next to Part A held, Open job → final check", () => {
    const g = buildNeedsRows({ now: NOW, jobs: [
      job("1", { veecPartBHeld: { at: "2026-11-02T01:00:00Z", reason: REASON } }),
      job("2", { veecApHeld: { at: "2026-11-01T00:00:00Z", reasons: ["x"] } }),
    ] });
    expect(g.week.map((r) => r.kind)).toEqual(["veec_a_held", "veec_b_held"]);
    const r = g.week[1]!;
    expect(r.line).toBe(`VEEC Part B not signed · ${REASON}`);
    expect(r.button).toEqual({ label: "Open job", to: "job", section: "final-check" });
    expect(cardOf("veec_b_held")).toBe("veec");
  });
});

describe("wiring", () => {
  test("the server reader derives the row from the two held events and the assignment signature", () => {
    const s = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(s).toContain("veecPartBHeldOpen(");
    expect(s).toContain("VEEC_PART_B_MITTI_HELD_EVENT");
    expect(s).toContain("VEEC_PART_B_IMAGE_HELD_EVENT");
    expect(s).toContain("VEEC_PART_B_SIGNED_MITTI_EVENT");
    expect(readFileSync("src/lib/assignment.server.ts", "utf8")).toContain("VEEC_PART_B_IMAGE_HELD_EVENT");
  });
});
