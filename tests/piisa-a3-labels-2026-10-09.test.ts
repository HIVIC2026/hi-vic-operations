import { describe, expect, test } from "bun:test";
import { A3_NATIVE_IDS, a3AcceptedLabels, a3CrewNativeItems, STOP_BANNER } from "../src/lib/piisa-a3.core";
import { norm } from "../src/lib/mitti.core";
const NEW: [string, string, string][] = [
  ["p3.swms", "1be8ebff-a754-4a2a-83f0-9561708ffb85", "Has the Safe Work Method Statement (SWMS) been completed for this job and all risks identified?"],
  ["p3.table1", "ac43a81a-7576-4b2e-885c-389585fbded5", "Have all Table 1 hazards been assessed and controlled in the SWMS?"],
  ["p5.reviewed", "1c9258de-d3a0-4dd4-a372-388bf725b2af", "Has the lead installer read the electrical safety assessment (PIESA) and confirmed it is safe to start work?"],
  ["p4.instructions", "d4298abc-7302-4555-a15b-ef4dc83e75e3", "Are safe shutdown, isolation and restart instructions available for every alternative power supply?"],
  ["p4.isolator", "e840fc02-6eea-415f-94dd-e5a5073845e5", "Is the ground-level AC/DC isolator accessible, working and safe to isolate?"],
  ["p6.suitable", "99f56c12-846d-4bac-bf89-d095e2cf16fe", "Is the existing insulation suitable to lay new insulation over?"],
  ["p5.noAccess", "ad9e1f51-6957-44cc-aaa1-1c41306b6f24", "Has the owner or occupier confirmed that nobody has entered or worked in the ceiling since the PIESA?"],
];
describe("PIISA clearer labels (Jo 9 Oct 2026)", () => {
  for (const [id, native, label] of NEW) test(`${id} keeps its stable ID and accepts the new label`, () => {
    expect(A3_NATIVE_IDS[id]).toEqual([native]);
    expect(a3AcceptedLabels(id)).toContain(norm(label));
  });
  test("prior approved labels still accepted", () => {
    expect(a3AcceptedLabels("p3.swms")).toContain(norm("Has the SWMS been completed for this job and all risks identified?"));
    expect(a3AcceptedLabels("p5.noAccess")).toContain(norm("Has the owner or occupier confirmed no one has accessed or worked in the ceiling since the PIESA?"));
  });
  test("banner heading exact", () => expect(STOP_BANNER).toBe("🛑 STOP WORK — INSTALLATION CANNOT PROCEED."));
  test("crew prefill refuses a staff member still waiting for office approval", () => {
    const tpl = { items: [] };
    const r = a3CrewNativeItems(tpl, { lead: "w1", additional: [] }, [{ workerId: "w1", name: "A B", eec: "EEC1", eecVerified: true, approved: false } as never], "Co");
    expect(r.problems.length).toBeGreaterThan(0);
  });
});
