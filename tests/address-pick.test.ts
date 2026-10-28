// Jo 28 Oct (HV-3554): wrong-state pick must not freeze the address page; the next VIC pick saves once.
import { expect, test } from "bun:test";
import { createAddressPicker, SAVE_FAILED, type PickResult } from "../src/lib/address-pick.core";

const VIC_ERR = "The postcode must be a Victorian postcode.";
function setup(save: (id: string) => Promise<PickResult>, timeoutMs?: number) {
  const busy: boolean[] = []; const done: PickResult[] = []; const saves: string[] = [];
  const pick = createAddressPicker((id) => { saves.push(id); return save(id); }, { setBusy: (b) => busy.push(b), onDone: (r) => done.push(r) }, timeoutMs);
  return { pick, busy, done, saves };
}

test("wrong state then a VIC pick → error shown, Saving cleared, then saved once", async () => {
  const s = setup(async (id) => (id === "nsw" ? { ok: false, error: VIC_ERR } : { ok: true }));
  await s.pick("nsw");
  expect(s.done).toEqual([{ ok: false, error: VIC_ERR }]);
  expect(s.busy.at(-1)).toBe(false);
  await s.pick("vic");
  expect(s.done.at(-1)).toEqual({ ok: true });
  expect(s.saves).toEqual(["nsw", "vic"]);
  expect(s.busy.at(-1)).toBe(false);
});

test("double tap while saving → only one save", async () => {
  let release!: () => void;
  const s = setup(() => new Promise((r) => { release = () => r({ ok: true }); }));
  const first = s.pick("vic");
  expect(await s.pick("vic")).toBe(false);
  release(); await first;
  expect(s.saves).toEqual(["vic"]);
});

test("a save that never answers → Saving clears with an error and the page is usable again", async () => {
  const s = setup(() => new Promise(() => {}), 20);
  await s.pick("vic");
  expect(s.done).toEqual([{ ok: false, error: SAVE_FAILED }]);
  expect(s.busy.at(-1)).toBe(false);
  expect(await s.pick("vic")).toBe(true);
});
