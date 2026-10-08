import { describe, expect, test } from "bun:test";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { A3_ALIASES, A3_MEDIA_IDS, A3_NATIVE_IDS, a3MediaCounts, PIISA_A3_MAPPING, a3EvidenceBlockers, a3EvidenceRequired, a3MissingFields, a3Occurrence, a3Signature, crewPrefill, crewSelectionProblems, mergeTreatment, parseA3Answers, readyCheckPartPrefill } from "../src/lib/piisa-a3.core";
import { OFFICIAL_ITEMS } from "../src/lib/official-forms.core";
import { piisaPrefill, seedAnswers } from "../src/lib/official-prefill.core";

const it = (label: string, id: string, extra: Record<string, unknown> = {}) => ({ item_id: id, label, type: "text", ...extra });
const fullTemplate = () => {
  const items: unknown[] = [];
  for (const [id, nids] of Object.entries(A3_NATIVE_IDS)) nids.forEach((nid) => items.push(it(A3_ALIASES[id]?.[0] ?? (id === "p8.declaration" ? "I acknowledge" : "Life support document"), nid)));
  for (const nid of Object.values(A3_MEDIA_IDS)) items.push(it("media", nid!, { type: "media" }));
  return { items };
};
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

describe("stable native IDs (draft-observed)", () => {
  test("every crew row binds to its own native ID, never the first", () => {
    const t = fullTemplate();
    const pre = [
      { itemId: "p2.leadEec", value: "EEC-LEAD", row: 0 },
      { itemId: "p2.addName", value: "Ann", row: 0 }, { itemId: "p2.addEec", value: "EEC-ANN", row: 0 },
      { itemId: "p2.addName", value: "Bob", row: 1 }, { itemId: "p2.addEec", value: "EEC-BOB", row: 1 },
      { itemId: "p2.addName", value: "Cy", row: 2 }, { itemId: "p2.addEec", value: "EEC-CY", row: 2 },
    ].map((x) => ({ ...x, label: "x", kind: "text", occurrence: a3Occurrence(x.itemId, x.row) }));
    const p = buildOfficialPrefill(t, pre as never, PIISA_A3_MAPPING);
    const got = Object.fromEntries([...p.header_items, ...p.items].map((x: { item_id: string; responses: { text: string } }) => [x.item_id, x.responses.text]));
    expect(got).toEqual({
      "647221f2-f74c-4da1-a8be-e44a20f0b08b": "EEC-LEAD",
      "4bea475f-516e-46a2-8922-e85896c68402": "Ann", "24e41e61-a490-4bdc-bd34-002fb6ae1089": "EEC-ANN",
      "726f9e46-8308-449e-822f-2280cd7affa7": "Bob", "65d9d9d5-b87e-4d81-b92a-fa877e5a4f98": "EEC-BOB",
      "c0c2178e-e872-4c70-a260-78aecde3d01e": "Cy", "3681131a-dee1-429a-ba34-6e066ef07152": "EEC-CY",
    });
  });
  test("a row whose ID is absent is skipped (visible), never written to another row", () => {
    const t = fullTemplate(); t.items = (t.items as { item_id: string }[]).filter((x) => x.item_id !== "726f9e46-8308-449e-822f-2280cd7affa7");
    const p = buildOfficialPrefill(t, [{ itemId: "p2.addName", value: "Bob", row: 1, label: "x", kind: "text", occurrence: 1 }] as never, PIISA_A3_MAPPING);
    expect(p.count).toBe(0); expect(p.skipped[0]).toMatch(/p2.addName row 2/);
  });
  test("API definition that disagrees fails closed: missing ID or a different question on a known ID", () => {
    const t = fullTemplate();
    (t.items as { item_id: string; label: string }[]).find((x) => x.item_id === "1be8ebff-a754-4a2a-83f0-9561708ffb85")!.label = "Something else";
    t.items = (t.items as { item_id: string }[]).filter((x) => x.item_id !== A3_MEDIA_IDS.before_video);
    const m = a3MissingFields(t);
    expect(m.some((x) => /SWMS.*now reads "Something else"/.test(x))).toBe(true);
    expect(m.some((x) => /Before-work video.*\(media\)/.test(x))).toBe(true);
  });
  test("parses answers by ID; media counted per evidence item", () => {
    const a = { items: [
      it("Additional installer", "726f9e46-8308-449e-822f-2280cd7affa7", { responses: { text: "Bob" } }),
      it("EEC certification number", "65d9d9d5-b87e-4d81-b92a-fa877e5a4f98", { responses: { text: "B2" } }),
      it("x", A3_MEDIA_IDS.product_photos!, { media: [{ id: 1 }, { id: 2 }] }),
    ] };
    expect(parseA3Answers(a).crew).toEqual([{ name: "Bob", eec: "B2" }]);
    expect(a3MediaCounts(a).find((x) => x.key === "product_photos")!.count).toBe(2);
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
      it("Has the SWMS been completed for this job and all risks identified?", "1be8ebff-a754-4a2a-83f0-9561708ffb85", { responses: { selected: [{ label: "Yes" }] } }),
      it("Will the existing insulation be removed, topped up, or both?", "8dadd5c5-e8d7-431e-b65a-a5dc4d174864", { responses: { selected: [{ label: "Both" }] } }),
      it("EEC certification number", "647221f2-f74c-4da1-a8be-e44a20f0b08b", { responses: { text: "LEAD-1" } }),
      it("Additional installer", "4bea475f-516e-46a2-8922-e85896c68402", { responses: { text: "Ann" } }), it("EEC certification number", "24e41e61-a490-4bdc-bd34-002fb6ae1089", { responses: { text: "ANN-2" } }),
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
    expect(a3Signature({ items: [it("Signature", "805138fa-827e-4e25-8ca5-3871eeda1202", { responses: { name: "Ann", image: "m1", timestamp: "2026-10-08T00:10:00Z" } })] })).toEqual({ name: "Ann", signedAt: "2026-10-08T00:10:00Z", present: true });
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
