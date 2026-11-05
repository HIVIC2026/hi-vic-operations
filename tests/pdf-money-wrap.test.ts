// Jo 5 Nov 16:10 (View quote PDF rejected): money rows never overflow — a long description wraps onto further lines and the
// amount stays right-aligned on the first line. Fixed in the shared money block, so every PDF using it benefits.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MONEY_AMOUNT_GAP, moneyLabelLines } from "../src/lib/pdf-look.core";
import { renderPdf } from "../src/lib/pdf-look.server";

test("pure: the label wraps inside the space left of the amount; a short label stays one line", () => {
  const width = (s: string) => s.length * 5; // 5pt per character
  expect(moneyLabelLines("Short label", "$349", 300, width)).toEqual(["Short label"]);
  const ls = moneyLabelLines("A long insulation description that cannot possibly fit beside the amount on one line", "$2,400", 200, width);
  expect(ls.length).toBeGreaterThan(1);
  for (const l of ls) expect(width(l)).toBeLessThanOrEqual(200 - width("$2,400") - MONEY_AMOUNT_GAP);
});

const long = "Bradford Gold R5 supplied and installed, removal of existing insulation (20 m²) — a deliberately long description that used to run under the amount";
const words = (pdf: Uint8Array) => {
  const dir = mkdtempSync(join(tmpdir(), "money-wrap-")); const f = join(dir, "x.pdf"); writeFileSync(f, pdf);
  const html = execFileSync("pdftotext", ["-bbox", f, "-"], { encoding: "utf8" });
  return [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, t: m[5]! }));
};
for (const compact of [false, true]) test(`rendered (${compact ? "compact" : "standard"}): no word of the long label overlaps the amount or leaves the page; the amount sits on the first line`, async () => {
  const { bytes } = await renderPdf({ title: "t", blocks: [{ id: "m", kind: "money", ...(compact ? { compact: true } : {}), rows: [{ label: long, amount: "$2,400" }, { label: "Your price", amount: "$1,898", strong: true }] }] });
  const w = words(bytes);
  const amount = w.find((x) => x.t === "$2,400")!;
  expect(amount).toBeTruthy();
  const labelWords = w.filter((x) => long.includes(x.t) && x.t !== "$2,400" && x.y0 < amount.y1 + 40);
  for (const x of labelWords) {
    expect(x.x1).toBeLessThanOrEqual(450 - 30 + 0.5);
    if (Math.abs(x.y0 - amount.y0) < 2) expect(x.x1).toBeLessThan(amount.x0);
  }
  const first = labelWords.find((x) => x.t === "Bradford")!;
  expect(Math.abs(first.y0 - amount.y0)).toBeLessThan(2); // amount on the first line
  expect(new Set(labelWords.map((x) => Math.round(x.y0))).size).toBeGreaterThan(1); // wrapped
  const total = w.find((x) => x.t === "$1,898")!;
  expect(total.y0).toBeGreaterThan(Math.max(...labelWords.map((x) => x.y1))); // the next row starts below the wrapped lines
});
