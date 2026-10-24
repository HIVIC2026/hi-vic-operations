import { describe, expect, test } from "bun:test";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_CREW_OTHER_OPTION, A3_NATIVE_IDS, PIISA_A3_MAPPING, a3CrewChoices, a3CrewNativeItems, a3CrewSchemaProblems, a3MissingFields, a3ResolveCrewChoices, a3RosterStatus, readyCheckPartPrefill, type StaffOption } from "../src/lib/piisa-a3.core";
import { OPT_BHAVDEEP, OPT_DOMINIC, OPT_OTHER, a3Template } from "./helpers/a3-template";

// Current records as stored (name lower-case "singh"); Dominic verified but not yet cleared (decision 153: no recorded level/expiry).
const BH: StaffOption = { workerId: "db4727ae-f390-4136-9c22-3242a806cc0b", name: "Bhavdeep singh", eec: "CII-027", eecVerified: true, approved: true, cleared: true };
const DOM: StaffOption = { workerId: "d22a6ed2-7a47-4bbd-b293-9636c5e74740", name: "Dominic Doherty", eec: "4546", eecVerified: true, approved: false, cleared: false, clearanceReason: "CII certificate verified but the level and expiry date haven't been recorded yet." };
const NEW: StaffOption = { workerId: "w-new", name: "Nia New", eec: "EEC-77", eecVerified: true, approved: true, cleared: true };
const sel = (items: { item_id: string; responses: unknown }[]) => ({ items });
const pick = (id: string, label: string) => ({ selected: [{ id, label }] });

describe("schema checker", () => {
  test("saved schema passes; old standalone certificate items not required", () => expect(a3MissingFields(a3Template())).toEqual([]));
  test("missing Other branch field, missing Other option or a name item off the crew list fail closed", () => {
    const t = a3Template(); t.items = t.items.filter((x) => x.item_id !== A3_CREW_OTHER_FIELDS[2]!.eec);
    expect(a3CrewSchemaProblems(t).join()).toContain("Additional installer (row 2) — Other: EEC certification number");
    expect(a3CrewSchemaProblems(a3Template([OPT_BHAVDEEP])).join()).toContain("no Other option");
    const t2 = a3Template(); (t2.items.find((x) => x.item_id === A3_CREW_NAME_IDS[1]) as { question: { response_set_id: string } }).question.response_set_id = "x";
    expect(a3CrewSchemaProblems(t2).join()).toContain("not a single choice on the crew list");
  });
});

describe("native prefill uses REAL option ids", () => {
  test("PRIVACY: even when a named option exists on the shared list, a verified worker goes in as Other + recorded facts", () => {
    const r = a3CrewNativeItems(a3Template(), { lead: BH.workerId, additional: [] }, [BH], "Reinsulate");
    expect(r.problems).toEqual([]);
    expect(r.items).toEqual([
      { item_id: A3_CREW_NAME_IDS[0], type: "question", responses: { selected: [OPT_OTHER] } },
      { item_id: A3_CREW_OTHER_FIELDS[0]!.name, type: "text", responses: { text: BH.name } },
      { item_id: A3_CREW_OTHER_FIELDS[0]!.eec, type: "text", responses: { text: BH.eec } },
    ]);
  });
  test("verified worker with no native option -> Other + required branch fields seeded", () => {
    const r = a3CrewNativeItems(a3Template(), { lead: BH.workerId, additional: [{ workerId: NEW.workerId }] }, [BH, NEW], "Reinsulate");
    expect(r.items.slice(3)).toEqual([
      { item_id: A3_CREW_NAME_IDS[1], type: "question", responses: { selected: [OPT_OTHER] } },
      { item_id: A3_CREW_OTHER_FIELDS[1]!.name, type: "text", responses: { text: "Nia New" } },
      { item_id: A3_CREW_OTHER_FIELDS[1]!.eec, type: "text", responses: { text: "EEC-77" } },
    ]);
  });
  test("same name but different company: option is NOT used (company is part of the match)", () => {
    const r = a3CrewNativeItems(a3Template(), { lead: BH.workerId, additional: [] }, [BH], "Some Other Co");
    expect((r.items[0] as { responses: { selected: { id: string }[] } }).responses.selected[0]!.id).toBe(A3_CREW_OTHER_OPTION);
  });
  test("portal Other lead -> native Other on the lead row", () => {
    const r = a3CrewNativeItems(a3Template(), { lead: { other: { name: "Zed New", eec: "Z-1" } }, additional: [] }, [BH], "Reinsulate");
    expect(r.items.map((x) => x.item_id)).toEqual([A3_CREW_NAME_IDS[0], A3_CREW_OTHER_FIELDS[0]!.name, A3_CREW_OTHER_FIELDS[0]!.eec]);
  });
  test("named choices on the shared template raise a privacy alert; Other-only list raises none", () => {
    expect(a3RosterStatus(a3Template(), [BH, NEW], "Reinsulate").alert).toContain("Privacy");
    expect(a3RosterStatus(a3Template([OPT_BHAVDEEP, OPT_OTHER]), [BH], "Reinsulate").alert).toContain("Privacy");
    expect(a3RosterStatus(a3Template([OPT_OTHER]), [BH, NEW], "Reinsulate").alert).toBeNull();
  });
});

describe("completed audit crew resolved against CURRENT records", () => {
  const audit = sel([
    { item_id: A3_CREW_NAME_IDS[0], responses: pick(OPT_BHAVDEEP.id, OPT_BHAVDEEP.label) },
    { item_id: A3_CREW_NAME_IDS[1], responses: pick(A3_CREW_OTHER_OPTION, "Other") },
    { item_id: A3_CREW_OTHER_FIELDS[1]!.name, responses: { text: "Ann Extra" } }, { item_id: A3_CREW_OTHER_FIELDS[1]!.eec, responses: { text: "A-9" } },
  ]);
  test("known option -> official lead + certificate from the DB record; Other -> branch values + office verification", () => {
    const r = a3ResolveCrewChoices(a3CrewChoices(audit), a3Template(), [BH], "Reinsulate");
    expect(r.answers).toEqual({ "p2.lead": "Bhavdeep singh", "p2.leadEec": "CII-027", "p2.addName#0": "Ann Extra", "p2.addEec#0": "A-9" });
    expect(r.blockers).toEqual([]);
    expect(r.needsVerification[0]).toContain("Ann Extra");
  });
  test("forged client label, uncleared worker, stale option and certificate change all block", () => {
    const forged = sel([{ item_id: A3_CREW_NAME_IDS[0], responses: pick("not-a-real-option", "Bhavdeep Singh — EEC CII-027 — Reinsulate") }]);
    expect(a3ResolveCrewChoices(a3CrewChoices(forged), a3Template(), [BH], "Reinsulate").blockers.length).toBe(1);
    const dom = sel([{ item_id: A3_CREW_NAME_IDS[0], responses: pick(OPT_DOMINIC.id, OPT_DOMINIC.label) }]);
    expect(a3ResolveCrewChoices(a3CrewChoices(dom), a3Template(), [DOM], "Hic").blockers.join()).toContain("current verified, cleared");
    const changed = { ...BH, eec: "CII-999" };
    expect(a3ResolveCrewChoices(a3CrewChoices(audit), a3Template(), [changed], "Reinsulate").blockers.join()).toContain("Lead installer");
  });
  test("Other with a missing branch field blocks; no lead blocks", () => {
    const bad = sel([{ item_id: A3_CREW_NAME_IDS[0], responses: pick(A3_CREW_OTHER_OPTION, "Other") }, { item_id: A3_CREW_OTHER_FIELDS[0]!.name, responses: { text: "X" } }]);
    expect(a3ResolveCrewChoices(a3CrewChoices(bad), a3Template(), [], "R").blockers.join()).toContain("Other needs");
    expect(a3ResolveCrewChoices(a3CrewChoices(sel([])), a3Template(), [], "R").blockers).toContain("Lead installer not chosen on the PIISA");
  });
});

describe("multi-select seed merges into ONE response", () => {
  const pre = (value: string) => ({ itemId: "p6.treatment", label: "x", kind: "choice", value, occurrence: 0, row: 0 });
  // Published form (read 8 Oct 2026): this item is a single-choice "question", so both answers can't be written.
  test("Removed + Topped up on the single-choice question -> not written, visible single-choice note", () => {
    const p = buildOfficialPrefill(a3Template(), [pre(readyCheckPartPrefill([{ present: true, removal: true }, { present: true, removal: false }]).values["p6.treatment"]!)] as never, PIISA_A3_MAPPING);
    expect(p.items).toEqual([]);
    expect(p.skipped[0]).toContain("single choice on the Mitti form");
  });
  test("two different separate seeds on the single-choice question -> dropped, never overwritten silently", () => {
    const p = buildOfficialPrefill(a3Template(), [pre("Removed"), pre("Topped up")] as never, PIISA_A3_MAPPING);
    expect(p.items.length).toBe(0);
    expect(p.skipped[0]).toContain("single choice");
    const same = buildOfficialPrefill(a3Template(), [pre("Removed"), pre("Removed")] as never, PIISA_A3_MAPPING);
    expect(same.items[0].responses.selected.map((o: { id: string }) => o.id)).toEqual(["t-rem"]);
  });
  test("an unknown option in a multi seed skips visibly", () => {
    expect(buildOfficialPrefill(a3Template(), [pre("Removed, Burnt")] as never, PIISA_A3_MAPPING).skipped[0]).toContain("no \"Removed, Burnt\" option");
  });
});
