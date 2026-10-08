import { describe, expect, test } from "bun:test";
import { a3Template, OPT_OTHER } from "./helpers/a3-template";
import { A3_CREW_NAME_IDS, A3_CREW_OTHER_FIELDS, A3_NATIVE_IDS, a3CrewChoices } from "../src/lib/piisa-a3.core";
import { directCrewLabels, resolvePiisaNativeVersion, stagedDirectCrewChoices, stagedDirectCrewPrefill, stagedDirectSchemaProblems } from "../src/lib/piisa-native-version.core";

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
describe("dormant direct native version", () => {
  test("existing published crew mapping remains active", () => {
    expect(resolvePiisaNativeVersion(a3Template([OPT_OTHER])).version).toBe("a3-published-choice");
    expect(resolvePiisaNativeVersion(a3Template([OPT_OTHER])).active).toBe(true);
  });
  test("Jo's reported direct fields cannot activate without verified full definition", () => {
    const draft = directDraft();
    expect(stagedDirectSchemaProblems(draft)).toEqual([]);
    expect(resolvePiisaNativeVersion(draft).active).toBe(false);
    expect(resolvePiisaNativeVersion(draft).mapping).toBeNull();
  });
  test("changed safety question still fails successor validation", () => {
    const draft = directDraft();
    const swms = draft.items.find((i) => i.item_id === A3_NATIVE_IDS["p3.swms"]?.[0]);
    if (swms) swms.label = "Skip safety";
    expect(stagedDirectSchemaProblems(draft).some((p) => p.includes("Skip safety"))).toBe(true);
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