// A48 batch 1 task 3: the install-day form pre-fills the PIISA Part 5 safety items "Yes" only when the electrician's PIESA
// really confirms them (Part 4-6 answers clear, or a signed Section C that confirms the item). Otherwise they stay blank.
import { describe, expect, test } from "bun:test";
import { B1_OPTIONS, buildSignedSnapshot, type OfficialAnswers } from "../src/lib/official-forms.core";
import { piesaPart5Answers } from "../src/lib/install-day.core";
import { piisaGate, type StoredCopy } from "../src/lib/piisa-workflow.core";

const ITEMS = ["p5.icConfirmed", "p5.safeToCover", "p5.rcd", "p5.tps", "p5.basic"] as const;
const NO_FIXES = B1_OPTIONS[0], FIXES = B1_OPTIONS[1], ONSITE = B1_OPTIONS[2];
const clear = (): Record<string, string> => ({
  "p4.conduit": "Yes", "p4.supported": "Yes", "p4.treatment": "Yes", "p4.tps": "Yes", "p4.terminations": "Yes", "p4.plugBases": "Yes", "p4.foil": "Yes",
  "p5.nonTps": "No", "p5.splitConduit": "No", "p5.damaged": "No", "p6.recessed": "Yes", "p6.count": "6", "p6.prohibited": "No",
});
const signedC = (): Record<string, string> => ({ "c.signature": "E Lec", "c.tick1": "Ticked", "c.tick2": "Ticked", "c.tick3": "Ticked", "c.tick4": "Ticked", "c.tick5": "Ticked", "c.tick6": "Ticked", "c.tick7": "Ticked" });
const yes = Object.fromEntries(ITEMS.map((k) => [k, "Yes"]));

describe("PIISA Part 5 pre-fill follows what the PIESA confirms", () => {
  test("Part 4-6 all clear: the five items are Yes (unchanged)", () => {
    for (const b1 of [NO_FIXES, ONSITE]) {
      const r = piesaPart5Answers({ ...clear(), b1 }, { electricianHere: "Yes", electricianPhoto: true });
      expect(r.answers).toMatchObject({ "p5.recessed": "Yes", "p5.count": "6", ...yes });
    }
  });
  test("downlights absent: the light items are Yes without a prohibited answer", () => {
    const { "p6.prohibited": _p, "p6.count": _c, ...rest } = clear();
    expect(piesaPart5Answers({ ...rest, "p6.recessed": "No", b1: NO_FIXES }).answers).toMatchObject(yes);
  });
  test("B1 'not required' but Part 4 has a No: the cable items are blank, not Yes", () => {
    const r = piesaPart5Answers({ ...clear(), "p4.terminations": "No", b1: NO_FIXES });
    expect(r.answers["p5.basic"]).toBeUndefined();
    expect(r.answers["p5.rcd"]).toBeUndefined();
    expect(r.answers["p5.icConfirmed"]).toBe("Yes");
    expect(r.answers["p5.tps"]).toBe("Yes");
  });
  test("a Part 5 Yes (not TPS) blanks the TPS item; a non-IC downlight blanks both light items", () => {
    expect(piesaPart5Answers({ ...clear(), "p5.nonTps": "Yes", b1: NO_FIXES }).answers["p5.tps"]).toBeUndefined();
    const r = piesaPart5Answers({ ...clear(), "p6.prohibited": "Yes", b1: NO_FIXES });
    expect(r.answers["p5.icConfirmed"]).toBeUndefined();
    expect(r.answers["p5.safeToCover"]).toBeUndefined();
    expect(r.answers["p5.tps"]).toBe("Yes");
  });
  test("a blank Part 4-6 answer is not confirmation", () => {
    const { "p4.plugBases": _x, ...rest } = clear();
    expect(piesaPart5Answers({ ...rest, b1: NO_FIXES }).answers["p5.basic"]).toBeUndefined();
  });
  test("B1 'not possible' with a Part 4-6 problem: Part 5 items are blank", () => {
    const r = piesaPart5Answers({ ...clear(), "p4.conduit": "No", "p4.terminations": "No", "p5.damaged": "Yes", "p6.prohibited": "Yes", b1: ONSITE }, { electricianHere: "Yes", electricianPhoto: true });
    for (const k of ITEMS) expect(r.answers[k]).toBeUndefined();
    expect(r.answers["p5.electricianPresent"]).toBe("Yes");
  });
  test("rectification with a signed Section C: each item is Yes when its tick is there", () => {
    const bad = { ...clear(), "p4.terminations": "No", "p5.nonTps": "Yes", "p6.prohibited": "Yes", b1: FIXES };
    expect(piesaPart5Answers({ ...bad, ...signedC() }).answers).toMatchObject(yes);
    const noBasic = { ...bad, ...signedC(), "c.tick5": "" };
    // A Section C with a tick missing is not signed off at all.
    for (const k of ITEMS) expect(piesaPart5Answers(noBasic).answers[k]).toBeUndefined();
  });
  test("rectification without Section C: items are blank (and not listed as missing, the office resolves them)", () => {
    const r = piesaPart5Answers({ ...clear(), "p4.terminations": "No", b1: FIXES, "c.tick2": "Ticked", "c.tick3": "Ticked", "c.tick4": "Ticked", "c.tick5": "Ticked" });
    expect(r.answers["p5.basic"]).toBeUndefined();
    expect(r.answers["p5.recessed"]).toBe("Yes");
    expect(r.missing).toEqual([]);
  });
  test("unknown or missing B1 is still listed as missing", () => {
    expect(piesaPart5Answers({ ...clear() }).missing).toEqual(["PIESA outcome (B1) not recorded"]);
  });
});

describe("a blank Part 5 item can still stop the job (piisaGate)", () => {
  const facts = { installDate: "2026-10-10", lifeSupport: "false", leadInstallerId: "i1", piesaCopyId: "pe1", piesaCompletionDate: "2026-10-01", existingInsulation: "false" };
  const copy = (key: "piesa" | "piisa", answers: OfficialAnswers, date: string): StoredCopy => ({ id: key === "piesa" ? "pe1" : "pi1", status: "current", signatureDate: date,
    snapshot: buildSignedSnapshot({ key, answers, signer: { userId: "u", name: "N", role: key === "piesa" ? "electrician" : "installer" }, enteredDate: date, serverTimestamp: "2026-10-10T00:00:00Z", jobFacts: facts, acknowledgementIds: [], signature: "N" }) });
  const piisaBase = (): OfficialAnswers => ({ jobRef: "HV-1", address: "1 Test St", startDate: "2026-10-10", completionDate: "2026-10-10", "p1.powerInformed": "Yes", lifeSupport: "No",
    "p2.installDate": "2026-10-10", "p2.ap": "DC", "p2.company": "Co", "p2.lead": "Lead", "p2.leadEec": "E1", "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes", "p4.present": "No",
    "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.noAccess": "Yes", "p6.present": "Yes", "p6.height": 50, "p6.treatment": ["Removed"], "p6.suitable": "Yes", "p7.products": "Brand R5.0",
    "p8.declaration": true, "p8.signature": "Lead", "p8.name": "Lead", "p8.date": "2026-10-10" } as OfficialAnswers);
  const gate = (piesa: Record<string, string>, installer: Record<string, string>) => {
    const pre = piesaPart5Answers(piesa).answers;
    const piisa = { ...piisaBase(), ...pre, ...installer } as OfficialAnswers;
    return piisaGate({ today: "2026-10-10", installDate: "2026-10-10", piisa: copy("piisa", piisa, "2026-10-10"), piesa: copy("piesa", piesa as OfficialAnswers, "2026-10-01"),
      facts, piesaReceivedAt: "2026-10-02T00:00:00Z", conductiveExistingInsulation: false, conductivityEvidence: "f1", hazardResolution: null, formUse: { piesa: null, piisa: null } });
  };
  const cannot = (p: { blockers: string[] }) => p.blockers.some((b) => b.includes("CANNOT commence"));
  test("clear PIESA: pre-filled Yes, the gate passes with nothing typed by the installer", () => {
    expect(gate({ ...clear(), b1: NO_FIXES }, {}).blockers).toEqual([]);
  });
  test("Part 4 No + B1 'not required': the installer's honest No stops the job (P5-CANNOT-COMMENCE)", () => {
    const bad = { ...clear(), "p4.terminations": "No", b1: NO_FIXES };
    expect(cannot(gate(bad, { "p5.basic": "No", "p5.rcd": "No" }))).toBe(true);
    // Left unanswered, it is not silently passed either.
    const g = gate(bad, {});
    expect(g.blockers.length).toBeGreaterThan(0);
  });
  test("B1 'not possible' with Part 4-6 problems: Part 5 is blank, the job stops, not 'Yes'", () => {
    const bad = { ...clear(), "p5.damaged": "Yes", b1: ONSITE };
    expect(cannot(gate(bad, { "p5.tps": "No", "p5.electricianPresent": "Yes" }))).toBe(true);
  });
  test("signed Section C confirming the items: the gate passes; without it, a No still stops", () => {
    const bad = { ...clear(), "p4.terminations": "No", b1: FIXES };
    expect(gate({ ...bad, ...signedC() }, {}).blockers).toEqual([]);
    expect(cannot(gate(bad, { "p5.basic": "No" }))).toBe(true);
  });
});
