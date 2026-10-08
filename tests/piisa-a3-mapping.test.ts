import { describe, expect, test } from "bun:test";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { A3_ALIASES, PIISA_A3_MAPPING, a3EvidenceBlockers, a3EvidenceRequired, a3MissingFields, a3Occurrence, a3Signature, crewPrefill, crewSelectionProblems, mergeTreatment, parseA3Answers, readyCheckPartPrefill } from "../src/lib/piisa-a3.core";
import { OFFICIAL_ITEMS } from "../src/lib/official-forms.core";
import { piisaPrefill, seedAnswers } from "../src/lib/official-prefill.core";

const it = (label: string, id: string, extra: Record<string, unknown> = {}) => ({ item_id: id, label, type: "text", ...extra });
const fullTemplate = () => {
  const items: unknown[] = []; let n = 0;
  for (const [id, labels] of Object.entries(A3_ALIASES)) {
    if (id === "p2.addEec") continue; // shares "EEC certification number" — added per row below
    const rows = id === "p2.addName" ? 3 : 1;
    for (let r = 0; r < rows; r++) { items.push(it(labels[0]!, `n${n++}`)); if (id === "p2.addName") items.push(it("EEC certification number", `n${n++}`)); }
  }
  return { items };
};

describe("A3 aliases map to real official ids", () => {
  test("every alias key is an official PIISA item id", () => {
    const ids = new Set(OFFICIAL_ITEMS.piisa.map((i) => i.id));
    for (const k of Object.keys(A3_ALIASES)) expect(ids.has(k)).toBe(true);
  });
  test("complete native form has no missing fields; empty published draft reports every field", () => {
    expect(a3MissingFields(fullTemplate())).toEqual([]);
    expect(a3MissingFields({ items: [] }).length).toBeGreaterThan(40);
  });
});

describe("repeated labels resolve by occurrence, not first match", () => {
  test("lead EEC, then each additional installer's EEC go to their own fields", () => {
    const t = fullTemplate();
    const pre = [
      { itemId: "p2.leadEec", value: "EEC-LEAD", occurrence: a3Occurrence("p2.leadEec") },
      { itemId: "p2.addName", value: "Ann", occurrence: a3Occurrence("p2.addName", 0) },
      { itemId: "p2.addEec", value: "EEC-ANN", occurrence: a3Occurrence("p2.addEec", 0) },
      { itemId: "p2.addName", value: "Bob", occurrence: a3Occurrence("p2.addName", 1) },
      { itemId: "p2.addEec", value: "EEC-BOB", occurrence: a3Occurrence("p2.addEec", 1) },
    ].map((x) => ({ ...x, label: "x", kind: "text" }));
    const p = buildOfficialPrefill(t, pre as never, PIISA_A3_MAPPING);
    const ids = p.items.map((x: { item_id: string }) => x.item_id);
    expect(new Set(ids).size).toBe(5);
    const eecs = (t.items as { item_id: string; label: string }[]).filter((x) => x.label === "EEC certification number").map((x) => x.item_id);
    const got = Object.fromEntries(p.items.map((x: { item_id: string; responses: { text: string } }) => [x.item_id, x.responses.text]));
    expect([got[eecs[0]!], got[eecs[1]!], got[eecs[2]!]]).toEqual(["EEC-LEAD", "EEC-ANN", "EEC-BOB"]);
  });
});

describe("completed audit -> official answers", () => {
  const audit = (vals: Record<string, string>) => ({ items: Object.entries(vals).map(([label, v], i) => ({ item_id: `a${i}`, label, type: "text", responses: { text: v } })) });
  test("Removed/Topped up/Both merge into official ticks; unknown text is not guessed", () => {
    expect(mergeTreatment("Both")).toEqual(["Removed", "Topped Up"]);
    expect(mergeTreatment("Topped up")).toEqual(["Topped Up"]);
    expect(mergeTreatment("Removed, Topped up")).toEqual(["Removed", "Topped Up"]);
    expect(mergeTreatment("Not sure")).toBeNull();
  });
  test("parses yes/no, treatment and crew rows by occurrence", () => {
    const a = { items: [
      it("Has the SWMS been completed for this job and all risks identified?", "1", { responses: { selected: [{ label: "Yes" }] } }),
      it("Will the existing insulation be removed, topped up, or both?", "2", { responses: { selected: [{ label: "Both" }] } }),
      it("EEC certification number", "3", { responses: { text: "LEAD-1" } }),
      it("Additional installer", "4", { responses: { text: "Ann" } }), it("EEC certification number", "5", { responses: { text: "ANN-2" } }),
    ] };
    const r = parseA3Answers(a);
    expect(r.answers["p3.swms"]).toBe("Yes");
    expect(r.answers["p6.treatment"]).toEqual(["Removed", "Topped Up"]);
    expect(r.answers["p2.leadEec"]).toBe("LEAD-1");
    expect(r.crew).toEqual([{ name: "Ann", eec: "ANN-2" }]);
    void audit;
  });
  test("signature needs its own timestamp; audit modified time is never used", () => {
    expect(a3Signature({ modified_at: "2026-10-08T01:00:00Z", items: [it("Signature", "s", { responses: { name: "Ann", image: "m1" } })] }).signedAt).toBeNull();
    expect(a3Signature({ items: [it("Signature", "s", { responses: { name: "Ann", image: "m1", timestamp: "2026-10-08T00:10:00Z" } })] })).toEqual({ name: "Ann", signedAt: "2026-10-08T00:10:00Z", present: true });
  });
});

describe("Ready Check prefill (multi-area)", () => {
  test("agreeing areas prefill; differing depth/R left blank with a note; downlights summed", () => {
    const one = readyCheckPartPrefill([{ present: true, depthMm: 60, rValue: 1.5, downlights: 4 }, { present: true, depthMm: 60, rValue: 1.5, downlights: 2 }]);
    expect(one.values).toEqual({ "p6.present": "Yes", "p6.height": "60", "p6.rValue": "1.5", "p5.recessed": "Yes", "p5.count": "6" });
    const two = readyCheckPartPrefill([{ present: true, depthMm: 60, rValue: 1.5, downlights: null }, { present: true, depthMm: 120, rValue: 1.5, downlights: 0 }]);
    expect(two.values["p6.height"]).toBeUndefined(); expect(two.values["p5.count"]).toBeUndefined();
    expect(two.notes[0]).toMatch(/differs between ceiling areas/);
  });
});

describe("prefill never answers safety or day-of facts", () => {
  test("no Part 3/5 yes, no automatic N/A, no completion date or signature date", () => {
    const seed = seedAnswers(piisaPrefill({ today: "2026-10-08", jobNumber: "HV-1", address: "1 St", lifeSupportDeclared: "no", installDate: "2026-10-09", apName: "AP", installerBusinessName: "Co", leadInstaller: { name: "Ann", eecNumber: "E1", eecVerified: true }, piesaAnswers: { b1: "No rectification required" }, piesaLifeSupportAttachment: null, measuredInsulationPresent: true, acceptedQuoteProduct: "Earthwool R5" } as never));
    for (const k of ["p3.swms", "p3.table1", "p3.isolated", "p5.reviewed", "p5.noAccess", "p5.electricianPresent", "completionDate", "p8.date", "p8.signature"]) expect(seed[k]).toBeUndefined();
  });
});

describe("crew", () => {
  const staff = [{ workerId: "w1", name: "Ann", eec: "E1", eecVerified: true }, { workerId: "w2", name: "Bob", eec: "E2", eecVerified: true }, { workerId: "w3", name: "Cat", eec: null, eecVerified: false }];
  test("verified lead; duplicates rejected; Other needs verification", () => {
    expect(crewSelectionProblems({ lead: "w1", additional: [{ workerId: "w2" }] }, staff).problems).toEqual([]);
    expect(crewSelectionProblems({ lead: "w1", additional: [{ workerId: "w1" }] }, staff).problems[0]).toMatch(/twice/);
    expect(crewSelectionProblems({ lead: "w1", additional: [{ other: { name: "Ann", eec: "X" } }] }, staff).problems[0]).toMatch(/twice/);
    expect(crewSelectionProblems({ lead: "w3", additional: [] }, staff).problems[0]).toMatch(/not verified/);
    expect(crewSelectionProblems({ lead: "w1", additional: [{ other: { name: "Dan", eec: "E9" } }] }, staff).needsVerification).toHaveLength(1);
    expect(crewSelectionProblems({ lead: "x", additional: [] }, staff).problems[0]).toMatch(/verified staff/);
  });
  test("crew prefill carries verified certification numbers to rows", () => {
    expect(crewPrefill({ lead: "w1", additional: [{ workerId: "w2" }] }, staff)).toEqual([
      { itemId: "p2.lead", row: 0, value: "Ann" }, { itemId: "p8.name", row: 0, value: "Ann" }, { itemId: "p2.leadEec", row: 0, value: "E1" },
      { itemId: "p2.addName", row: 0, value: "Bob" }, { itemId: "p2.addEec", row: 0, value: "E2" },
    ]);
  });
});

describe("A3 evidence", () => {
  const ctx = { crewCount: 2, electricianRequiredAtStart: false, existingPlanMatchesInstall: true, lifeSupportConsentOnFile: false };
  test("electrician photo only when attendance required; plan only when no valid existing plan", () => {
    expect(a3EvidenceRequired({}, ctx).map((r) => r.key)).toEqual(["installer_photos", "isolation_photo", "before_video", "product_photos", "completed_video"]);
    expect(a3EvidenceRequired({ "p4.instructions": "No" }, { ...ctx, existingPlanMatchesInstall: false }).map((r) => r.key)).toContain("electrician_photo");
    expect(a3EvidenceRequired({}, { ...ctx, existingPlanMatchesInstall: false }).map((r) => r.key)).toContain("final_plan");
  });
  test("one photo per installer, geotags, before-work timing, life-support consent", () => {
    const media = [{ key: "installer_photos" as const, count: 1, geotagged: 1 }, { key: "isolation_photo" as const, count: 1, geotagged: 1, capturedAt: "2026-10-09T03:00:00Z" }, { key: "before_video" as const, count: 1, geotagged: 0 }, { key: "product_photos" as const, count: 1, geotagged: 0 }, { key: "completed_video" as const, count: 1, geotagged: 0 }];
    const b = a3EvidenceBlockers({ lifeSupport: "Yes" }, ctx, media, "2026-10-09T01:00:00Z");
    expect(b.some((x) => /Installer photos.*1 of 2/.test(x))).toBe(true);
    expect(b.some((x) => /Installed product.*location missing/.test(x))).toBe(true);
    expect(b.some((x) => /Power isolation.*before work starts/.test(x))).toBe(true);
    expect(b.some((x) => /Life support/.test(x))).toBe(true);
  });
});
