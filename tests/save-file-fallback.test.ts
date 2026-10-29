import { afterEach, expect, test } from "bun:test";
import { saveFile } from "../src/components/trade/save-file";

const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, navigator: g.navigator, document: g.document };
const urlSaved = { c: URL.createObjectURL, r: URL.revokeObjectURL };

function setup(shareError: { name: string } | null) {
  const calls = { share: 0, clicks: 0, shareArgs: null as unknown };
  g.window = { matchMedia: () => ({ matches: true }) };
  g.navigator = {
    canShare: () => true,
    share: async (a: unknown) => { calls.share++; calls.shareArgs = a; if (shareError) throw Object.assign(new Error("x"), shareError); },
  };
  g.document = {
    createElement: () => ({ click: () => { calls.clicks++; }, remove: () => {} }),
    body: { appendChild: () => {} },
  };
  URL.createObjectURL = () => "blob:x";
  URL.revokeObjectURL = () => {};
  return calls;
}
afterEach(() => {
  g.window = saved.window; g.navigator = saved.navigator; g.document = saved.document;
  URL.createObjectURL = urlSaved.c; URL.revokeObjectURL = urlSaved.r;
});
const file = () => new File(["a"], "a.csv", { type: "text/csv" });

test("share fails with a non-abort error: falls back to the blob download", async () => {
  const c = setup({ name: "NotAllowedError" });
  await saveFile(file(), { title: "T" });
  expect(c.share).toBe(1);
  expect(c.clicks).toBe(1);
});
test("share closed (AbortError): returns without downloading", async () => {
  const c = setup({ name: "AbortError" });
  await saveFile(file());
  expect(c.clicks).toBe(0);
});
test("share works: no download, title passed only when given", async () => {
  const c = setup(null);
  await saveFile(file(), { title: "T" });
  expect(c.clicks).toBe(0);
  expect((c.shareArgs as { title?: string }).title).toBe("T");
});
