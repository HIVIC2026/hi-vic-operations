import { describe, expect, test } from "bun:test";
import { B1_OPTIONS } from "../src/lib/official-forms.core";
import { crossCheckWarnings, declaredLifeSupport, piesaPrefill, piisaPrefill, seedAnswers, type OfficialPrefillContext } from "../src/lib/official-prefill.core";
import { buildPrefill } from "../src/lib/mitti.core";

const full: OfficialPrefillContext = {
  today: "2026-10-02", jobNumber: "HV-1128", address: "1 Test St, Preston VIC 3072", lifeSupportDeclared: "no",
  installDate: "2026-10-20", apName: "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", installerBusinessName: "Test Insulation Co",
  leadInstaller: { name: "Sam Lead", eecNumber: "EEC-123", eecVerified: true },
  piesaAnswers: { b1: B1_OPTIONS[0], "p3.present": "Yes", "p6.recessed": "No", "c.tick2": true, "c.tick3": true },
  piesaLifeSupportAttachment: null, measuredInsulationPresent: true, acceptedQuoteProduct: "Brand X R5.0 batts", ownerName: "Olive Owner", electrician: { name: "Eli Spark", licence: "L-1", recName: "Spark Pty Ltd", recNo: "REC-9", phone: "0400000000" },
};
const empty: OfficialPrefillContext = { today: "2026-10-02", jobNumber: null, address: null, lifeSupportDeclared: null, installDate: null, apName: null, installerBusinessName: null, leadInstaller: null, piesaAnswers: null, piesaLifeSupportAttachment: null, measuredInsulationPresent: null, acceptedQuoteProduct: null };
const by = (h: ReturnType<typeof piisaPrefill>) => Object.fromEntries(h.map((x) => [x.itemId, x]));

describe("LR-003 pre-fills", () => {
  test("covers all 26 change requests exactly once", () => {
    const ids = [...piesaPrefill(full).map((h) => `piesa:${h.itemId}`), ...piisaPrefill(full).map((h) => `piisa:${h.itemId}`)];
    expect(new Set(ids).size).toBe(40);
    expect(ids.length).toBe(40);
  });
  test("PIESA seeds job, address, today and declared life support", () => {
    expect(seedAnswers(piesaPrefill(full))).toMatchObject({ jobRef: "HV-1128", address: "1 Test St, Preston VIC 3072", inspectionDate: "2026-10-02", lifeSupport: "No", "b3.licence": "L-1", "c.recNo": "REC-9", "c.completionDate": "2026-10-02", "o.name": "Olive Owner", "o.date": "2026-10-02" });
    expect(piesaPrefill(full).find((h) => h.itemId === "lifeSupport")!.basis).toBe("declared");
  });
  test("empty sources stay blank — never No", () => {
    const seed = seedAnswers(piisaPrefill(empty));
    expect(Object.keys(seed).sort()).toEqual(["p8.date"]);
    expect(Object.keys(seedAnswers(piesaPrefill(empty))).sort()).toEqual(["c.completionDate", "inspectionDate", "o.date"]);
    expect(seedAnswers(piesaPrefill({ ...full, electrician: { name: "E", licence: null, recName: null, recNo: null, phone: null } }))["b3.licence"]).toBeUndefined();
    expect(seedAnswers(piesaPrefill({ ...empty, lifeSupportDeclared: "unknown" }))["lifeSupport"]).toBeUndefined();
  });
  test("reminders and cross-checks never become answers", () => {
    const seed = seedAnswers(piisaPrefill(full));
    for (const id of ["p4.present", "p5.recessed", "p5.icConfirmed", "p5.safeToCover", "p5.rcd", "p5.tps", "p5.basic", "p6.present"]) expect(seed[id]).toBeUndefined();
    const h = by(piisaPrefill(full));
    expect(h["p4.present"]!.value).toBe("Yes");
    expect(h["p5.icConfirmed"]!.value).toBe("Ticked");
    expect(h["p5.tps"]!.value).toBeNull();
  });
  test("electrician-present N/A only when PIESA says no rectification", () => {
    expect(seedAnswers(piisaPrefill(full))["p5.electricianPresent"]).toBe("N/A");
    expect(seedAnswers(piisaPrefill({ ...full, piesaAnswers: { b1: B1_OPTIONS[1] } }))["p5.electricianPresent"]).toBeUndefined();
  });
  test("EEC number only from a verified certification", () => {
    expect(seedAnswers(piisaPrefill({ ...full, leadInstaller: { name: "Sam", eecNumber: "EEC-1", eecVerified: false } }))["p2.leadEec"]).toBeUndefined();
    expect(seedAnswers(piisaPrefill(full))["p2.leadEec"]).toBe("EEC-123");
  });
  test("cross-check warns on mismatch, not on match", () => {
    const h = piisaPrefill(full);
    expect(crossCheckWarnings(h, { "p4.present": "Yes", "p5.recessed": "No" })).toEqual([]);
    expect(crossCheckWarnings(h, { "p4.present": "No", "p6.present": "No" }).length).toBe(2);
  });
  test("declared life-support mapping", () => {
    expect([declaredLifeSupport("yes"), declaredLifeSupport("no"), declaredLifeSupport("unknown"), declaredLifeSupport(null)]).toEqual(["yes", "no", "unknown", null]);
  });
  test("Mitti PIESA template receives the date and life-support pre-fills", () => {
    const template = { template: { items: [
      { id: "d", label: "Date of inspection", datetime: {} },
      { id: "l", label: "Is anyone at this property dependent on life support?", question: { response_set_id: "rs" } },
    ], response_sets: [{ id: "rs", responses: [{ id: "y", label: "Yes" }, { id: "n", label: "No" }] }] } };
    const p = buildPrefill(template, { jobNumber: "J", address: "A", ownerName: "O", assessorName: "E", inspectionDate: "2026-10-02", lifeSupportDeclared: "No" });
    const items = [...p.header_items, ...p.items];
    expect(items.find((i: { item_id: string }) => i.item_id === "d")?.responses).toEqual({ datetime: "2026-10-02" });
    expect(items.find((i: { item_id: string }) => i.item_id === "l")?.responses).toEqual({ selected: [{ id: "n", label: "No" }] });
  });
});

import { buildOfficialPrefill } from "../src/lib/mitti.core";
describe("PIISA Mitti pre-fill", () => {
  test("repeated labels match in form order; attachments and unknown options are skipped", () => {
    const template = { template: { items: [
      { id: "eec1", label: "EEC certification number:", text: {} },
      { id: "eec2", label: "EEC certification number:", text: {} },
      { id: "na", label: "If the Pre-installation electrical safety assessment recommends an electrician is present at the start of the installation to ensure the area is electrically safe, has this occurred?", question: { response_set_id: "rs" } },
    ], response_sets: [{ id: "rs", responses: [{ id: "y", label: "Yes" }, { id: "n", label: "No" }] }] } };
    const p = buildOfficialPrefill(template, [
      { itemId: "p2.leadEec", label: "EEC certification number:", kind: "text", value: "EEC-1", occurrence: 0 },
      { itemId: "p5.electricianPresent", label: template.template.items[2]!.label, kind: "yesno_na", value: "N/A", occurrence: 0 },
      { itemId: "lifeSupportAttachment", label: "x", kind: "attachment", value: "f", occurrence: 0 },
    ]);
    expect(p.items.map((i: { item_id: string; responses: unknown }) => [i.item_id, i.responses])).toEqual([["eec1", { text: "EEC-1" }]]);
    expect(p.skipped.length).toBe(2);
  });
});
