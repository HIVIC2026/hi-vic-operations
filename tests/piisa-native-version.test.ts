import { describe, expect, test } from "bun:test";
import { a3Template, OPT_OTHER } from "./helpers/a3-template";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_NATIVE_IDS, a3CrewChoices } from "../src/lib/piisa-a3.core";
import published from "../src/lib/piisa-direct-published.data.json";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
import { a3Signature, parseA3Answers } from "../src/lib/piisa-a3.core";
import { PIISA_DIRECT_SIGNATURE_ID, PIISA_DIRECT_VERSION, resolveDirectCrew, directCrewLabels, resolvePiisaNativeVersion, stagedDirectCrewChoices, stagedDirectCrewPrefill, stagedDirectSchemaProblems } from "../src/lib/piisa-native-version.core";

function directDraft() {
  const t = a3Template([OPT_OTHER]);
  const retired: string[] = [...A3_CREW_NAME_IDS, ...(A3_NATIVE_IDS["p7.products"] ?? [])];
  t.items = t.items.filter((item) => !retired.includes(String(item.item_id)));
  for (const [row, pair] of A3_CREW_OTHER_FIELDS.entries()) for (const key of ["name", "eec"] as const) {
    const item = t.items.find((i) => i.item_id === pair[key]);
    if (item) item.label = directCrewLabels(row)[key];
  }
  return t;
}
describe("versioned published direct native form", () => {
  test("existing published crew mapping remains active", () => {
    expect(resolvePiisaNativeVersion(a3Template([OPT_OTHER])).version).toBe("a3-published-choice");
    expect(resolvePiisaNativeVersion(a3Template([OPT_OTHER])).active).toBe(true);
  });
  test("Jo's reported direct fields cannot activate without verified full definition", () => {
    const draft = directDraft();
    expect(stagedDirectSchemaProblems(draft).length).toBeGreaterThan(0);
    expect(resolvePiisaNativeVersion(draft).active).toBe(false);
    expect(resolvePiisaNativeVersion(draft).mapping).toBeNull();
  });
  test("changed safety question still fails successor validation", () => {
    const draft = directDraft();
    const swms = draft.items.find((i) => i.item_id === A3_NATIVE_IDS["p3.swms"]?.[0]);
    if (swms) swms.label = "Skip safety";
    expect(stagedDirectSchemaProblems(draft).some((p) => p.includes("differ from verified revision"))).toBe(true);
  });
  test("direct rows preserve exact child IDs and blank optional rows", () => {
    const audit = { items: [{ item_id: A3_CREW_OTHER_FIELDS[0]?.name, label: directCrewLabels(0).name, responses: { text: "Test Installer" } }, { item_id: A3_CREW_OTHER_FIELDS[0]?.eec, label: directCrewLabels(0).eec, responses: { text: "CII-123" } }] };
    expect(stagedDirectCrewChoices(audit)[0]).toEqual({ row: 0, kind: "other", name: "Test Installer", eec: "CII-123" });
    expect(stagedDirectCrewChoices(audit)[1]).toEqual({ row: 1, kind: "none" });
    expect(a3CrewChoices(audit)[0]).toEqual({ row: 0, kind: "none" }); // historical reader unchanged
  });
  test("prefill uses only supplied company registry and refuses unknown workers", () => {
    const staff = [{ workerId: "our-worker", name: "Our Installer", eec: "CII-123", eecVerified: true, approved: true }];
    const result = stagedDirectCrewPrefill({ lead: "our-worker", additional: [] }, staff);
    expect(result.items.map((i) => i.item_id)).toEqual([A3_CREW_OTHER_FIELDS[0]?.name, A3_CREW_OTHER_FIELDS[0]?.eec]);
    expect(stagedDirectCrewPrefill({ lead: "other-company-worker", additional: [] }, staff).items).toEqual([]);
    expect(stagedDirectCrewPrefill({ lead: "our-worker", additional: [{ workerId: "our-worker" }] }, staff).problems.length).toBeGreaterThan(0);
  });
});
const staff = [{ workerId: "ours", name: "Our Installer", eec: "CII-123", eecVerified: true, approved: true }];
const directAudit = () => ({ items: [
  { item_id: A3_CREW_OTHER_FIELDS[0]?.name, label: "Lead installer — full legal name", responses: { text: "Our Installer" } },
  { item_id: A3_CREW_OTHER_FIELDS[0]?.eec, label: "Lead installer — CII certification number (issued by the EEC)", responses: { text: "CII-123" } },
  { item_id: PIISA_DIRECT_SIGNATURE_ID, label: "Signature", responses: { signature: { media_id: "sig", timestamp: "2026-10-08T08:00:00Z" } } },
] });
test("verified revision 18 activates with removed products/dates excluded and observed signature ID", () => {
  const r = resolvePiisaNativeVersion(published);
  expect(r.active).toBe(true); expect(r.version).toBe(PIISA_DIRECT_VERSION);
  expect(r.mapping?.["p8.signature"]?.itemIds).toEqual(["83caffa2-e9c8-4315-885f-5337a4389372"]);
  for (const id of ["p7.products", "completionDate", "p8.name", "p8.date"]) expect(r.mapping?.[id]).toBeUndefined();
  const crew = stagedDirectCrewPrefill({ lead: "ours", additional: [] }, staff);
  expect(crew.items.map((i) => i.item_id)).toEqual(["9e1a8b94-d3fc-492e-bb33-57b6bd4e85a8", "6fea5874-992b-476b-8f09-839abaa2d049"]);
  const pre = buildOfficialPrefill(published, [{ itemId: "startDate", label: "Installation date", value: "2026-10-09", kind: "date", row: 0 }], r.mapping ?? {});
  expect(pre.count).toBe(1); expect(pre.skipped).toEqual([]);
});
test("any changed required flag, condition or page order pauses current mapping", () => {
  for (const mutate of [(t: typeof published) => { t.template.items.reverse(); }, (t: typeof published) => { t.template.items[0] = { ...t.template.items[0], label: "Changed" } as typeof t.template.items[0]; }]) {
    const copy = structuredClone(published); mutate(copy);
    expect(resolvePiisaNativeVersion(copy).active).toBe(false);
  }
});
test("direct audit legal name and CII resolve only within supplied verified company roster", () => {
  const a = directAudit();
  expect(resolveDirectCrew(a, staff).answers["p2.lead"]).toBe("Our Installer");
  expect(resolveDirectCrew(a, []).blockers.length).toBeGreaterThan(0);
  expect(resolveDirectCrew(a, [{ ...staff[0], approved: false }]).blockers.length).toBeGreaterThan(0);
  a.items[1] = { ...a.items[1], responses: { text: "Wrong CII" } } as typeof a.items[1];
  expect(resolveDirectCrew(a, staff).blockers.length).toBeGreaterThan(0);
});
test("direct audit safety parse counts additional crew and recognizes current signature without changing legacy mapping", () => {
  const a = directAudit();
  expect(a3CrewChoices(a)[0]?.kind).toBe("other");
  expect(a3Signature(a).itemId).toBe(PIISA_DIRECT_SIGNATURE_ID);
  expect(parseA3Answers(a).answers["p7.products"]).toBeUndefined();
  expect(resolvePiisaNativeVersion(a3Template([OPT_OTHER])).version).toBe("a3-published-choice");
});
