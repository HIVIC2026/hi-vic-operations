import { describe, expect, test } from "bun:test";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { A3_ALIASES, A3_EVIDENCE_LABELS, A3_MEDIA_IDS, A3_MEDIA_LABELS, A3_NATIVE_IDS, a3MediaCounts, PIISA_A3_MAPPING, a3EvidenceBlockers, a3EvidenceRequired, a3MissingFields, a3Occurrence, a3Signature, crewPrefill, crewSelectionProblems, mergeTreatment, parseA3Answers, readyCheckPartPrefill } from "../src/lib/piisa-a3.core";
import { a3Template } from "./helpers/a3-template";
import { OFFICIAL_ITEMS } from "../src/lib/official-forms.core";
import { piisaPrefill, seedAnswers } from "../src/lib/official-prefill.core";

const it = (label: string, id: string, extra: Record<string, unknown> = {}) => ({ item_id: id, label, type: "text", ...extra });
const fullTemplate = () => a3Template() as { items: unknown[] } & Record<string, unknown>;

describe("A5 aliases map to real official ids", () => {
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
  test("retired standalone certificate items are neither required nor written", () => {
    expect(Object.values(A3_NATIVE_IDS).flat()).not.toContain("647221f2-f74c-4da1-a8be-e44a20f0b08b");
    expect(a3MissingFields(fullTemplate())).toEqual([]);
  });
  test("API definition that disagrees fails closed: missing ID or a different question on a known ID", () => {
    const t = fullTemplate();
    (t.items as { item_id: string; label: string }[]).find((x) => x.item_id === "1be8ebff-a754-4a2a-83f0-9561708ffb85")!.label = "Something else";
    t.items = (t.items as { item_id: string }[]).filter((x) => x.item_id !== A3_MEDIA_IDS.isolation_photo);
    const m = a3MissingFields(t);
    expect(m.some((x) => /SWMS.*now reads "Something else"/.test(x))).toBe(true);
    expect(m).toContain(`${A3_EVIDENCE_LABELS.isolation_photo} (media)`);
  });
  test("parses answers by ID; media counted per evidence item", () => {
    const a = { items: [
      it("Additional installer", "726f9e46-8308-449e-822f-2280cd7affa7", { responses: { selected: [{ id: "8e9ba585-c0da-416a-90ab-d3cb09029b32", label: "Other" }] } }),
      it("Full legal name", "824af4ab-d764-403a-80eb-05b55f86d600", { responses: { text: "Bob" } }),
      it("EEC certification number", "d986b4c1-1d3d-414c-9a14-8be9c000fa26", { responses: { text: "B2" } }),
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
      it("Additional installer", "4bea475f-516e-46a2-8922-e85896c68402", { responses: { selected: [{ id: "8e9ba585-c0da-416a-90ab-d3cb09029b32", label: "Other" }] } }),
      it("Full legal name", "4ac27cb9-e588-4666-b5df-3e2172b60358", { responses: { text: "Ann" } }), it("EEC certification number", "b8daad98-4a63-480d-85a7-c0fb670b34c3", { responses: { text: "ANN-2" } }),
    ] };
    const r = parseA3Answers(a);
    expect(r.answers["p3.swms"]).toBe("Yes");
    expect(r.answers["p6.treatment"]).toEqual(["Removed", "Topped Up"]);
    expect(r.answers["p2.leadEec"]).toBeUndefined(); // no native certificate box any more
    expect(r.crew).toEqual([{ name: "Ann", eec: "ANN-2" }]);
    void audit;
  });
  test("signature needs its own timestamp; audit modified time is never used", () => {
    expect(a3Signature({ modified_at: "2026-10-08T01:00:00Z", items: [it("Signature", "s", { responses: { name: "Ann", image: "m1" } })] }).signedAt).toBeNull();
    expect(a3Signature({ items: [it("Signature", "805138fa-827e-4e25-8ca5-3871eeda1202", { responses: { name: "Ann", image: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", timestamp: "2026-10-08T00:10:00Z" } })] })).toEqual({ name: "Ann", signedAt: "2026-10-08T00:10:00Z", present: true, mediaId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", itemId: "805138fa-827e-4e25-8ca5-3871eeda1202" });
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
    for (const k of ["p3.swms", "p3.table1", "p3.isolated", "p5.reviewed", "p5.noAccess", "p5.electricianPresent", "p8.date", "p8.signature"]) expect(seed[k]).toBeUndefined();
    // Jo 8 Oct: completion defaults to the same day as the start (editable); both official dates carry the start.
    expect(seed["completionDate"]).toBe("2026-10-09"); expect(seed["startDate"]).toBe("2026-10-09"); expect(seed["p2.installDate"]).toBe("2026-10-09");
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
    expect(crewSelectionProblems({ lead: "x", additional: [] }, staff).problems[0]).toMatch(/not on your staff list/);
  });
  test("crew prefill carries verified certification numbers to rows", () => {
    expect(crewPrefill({ lead: "w1", additional: [{ workerId: "w2" }] }, staff)).toEqual([
      { itemId: "p2.lead", row: 0, value: "Ann" }, { itemId: "p8.name", row: 0, value: "Ann" }, { itemId: "p2.leadEec", row: 0, value: "E1" },
      { itemId: "p2.addName", row: 0, value: "Bob" }, { itemId: "p2.addEec", row: 0, value: "E2" },
    ]);
  });
});

describe("A5 evidence", () => {
  const ctx = { crewCount: 2, electricianRequiredAtStart: false, existingPlanMatchesInstall: true, lifeSupportConsentOnFile: false };
  test("electrician photo only when attendance required; plan only when no valid existing plan", () => {
    expect(a3EvidenceRequired({}, ctx).map((r) => r.key)).toEqual(["installer_photos", "isolation_photo", "before_video", "product_photos", "completed_video"]);
    expect(a3EvidenceRequired({ "p4.instructions": "No" }, { ...ctx, existingPlanMatchesInstall: false }).map((r) => r.key)).toContain("electrician_photo");
    expect(a3EvidenceRequired({}, { ...ctx, existingPlanMatchesInstall: false }).map((r) => r.key)).toContain("final_plan");
  });
  test("one photo per installer, geotags, before-work timing, life-support consent", () => {
    const media = [{ key: "installer_photos" as const, count: 1, geotagged: 1 }, { key: "isolation_photo" as const, count: 1, geotagged: 1, capturedAt: "2026-10-09T03:00:00Z" }, { key: "before_video" as const, count: 1, geotagged: 0 }, { key: "product_photos" as const, count: 1, geotagged: 0 }, { key: "completed_video" as const, count: 1, geotagged: 0 }];
    const b = a3EvidenceBlockers({ lifeSupport: "Yes" }, ctx, media, "2026-10-09T01:00:00Z");
    expect(b).toContain(`${A3_EVIDENCE_LABELS.installer_photos}: 1 of 2`);
    expect(b).toContain(`${A3_EVIDENCE_LABELS.product_photos}: location not recorded on 1 — office review`);
    expect(b).toContain(`${A3_EVIDENCE_LABELS.isolation_photo}: must be taken before work starts`);
    expect(b.some((x) => /Life support/.test(x))).toBe(true);
  });
});
