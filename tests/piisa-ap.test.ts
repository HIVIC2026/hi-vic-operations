import { expect, test } from "bun:test";
import { AP_LEGAL_ENTITY } from "../src/lib/authority";
import { PIISA_AP_ID, assertPiisaAp, ensurePiisaAp } from "../src/lib/piisa-ap.core";
const audit = (text = "", responses = {}) => ({ items: [{ item_id: PIISA_AP_ID, type: "textsingle", responses: { text } }, { item_id: "83caffa2-e9c8-4315-885f-5337a4389372", type: "signature", responses }] });
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