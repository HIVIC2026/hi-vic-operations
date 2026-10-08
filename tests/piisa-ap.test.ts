import { expect, test } from "bun:test";
import { AP_LEGAL_ENTITY } from "../src/lib/authority";
import { PIISA_AP_ID, assertPiisaAp, ensurePiisaAp } from "../src/lib/piisa-ap.core";
import published from "../src/lib/piisa-final-postwork-published.data.json";
import { resolvePiisaNativeVersion } from "../src/lib/piisa-native-version.core";
import { buildOfficialPrefill } from "../src/lib/mitti.core";
const audit = (text = "", responses = {}) => ({ items: [{ item_id: PIISA_AP_ID, type: "textsingle", responses: { text } }, { item_id: "83caffa2-e9c8-4315-885f-5337a4389372", type: "signature", responses }] });
test("observed first-page AP receives fixed entity through actual official prefill builder", () => {
  const ids = published.template.items[0]?.children.map((i) => i.id) ?? [];
  expect(ids.indexOf(PIISA_AP_ID)).toBe(ids.indexOf("78e550a4-1c8b-4b59-be77-64a5c09ba848") + 1);
  const version = resolvePiisaNativeVersion(published);
  expect(version.active).toBe(true);
  if (!version.mapping) throw new Error("Inactive mapping");
  const result = buildOfficialPrefill(published, [{ itemId: "p2.ap", label: "Accredited Person", kind: "text", value: AP_LEGAL_ENTITY, occurrence: 0, row: 0 }], version.mapping);
  expect(result.items.find((i) => i.item_id === PIISA_AP_ID)?.responses).toEqual({ text: "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria" });
});
test("blank unsigned AP repaired with authoritative entity only and read back", async () => {
  let sent: unknown;
  await ensurePiisaAp(audit(), async (items) => { sent = items; }, async () => audit(AP_LEGAL_ENTITY));
  expect(sent).toEqual([{ item_id: PIISA_AP_ID, type: "textsingle", responses: { text: "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria" } }]);
});
test("signed, completed, unknown or different AP never mutated", async () => {
  for (const doc of [audit("", { image: "original" }), audit("", { name: "Lead" }), { ...audit(), completed: true }, { items: [] }, audit("Installer Company")]) {
    let calls = 0;
    await expect(ensurePiisaAp(doc, async () => { calls++; }, async () => doc)).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
test("failed AP readback blocks success; correct AP does not rewrite history", async () => {
  await expect(ensurePiisaAp(audit(), async () => {}, async () => audit())).rejects.toThrow("not confirmed");
  expect(() => assertPiisaAp(audit("Installer"))).toThrow();
  let calls = 0;
  await ensurePiisaAp(audit(AP_LEGAL_ENTITY, { image: "original" }), async () => { calls++; }, async () => audit());
  expect(calls).toBe(0);
});