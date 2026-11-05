// Jo 5 Nov 16:10: the "View quote (PDF)" layout — clear insulation / removal rows, both logos (installer top-left, ours and
// our details on the right), quote date and validity under the status, the standard footer, nothing overflowing.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownQuotePdfBlocks } from "../src/lib/own-photo-quote.core";
import { renderPdf } from "../src/lib/pdf-look.server";
import { PDF_FOOTER_LEFT } from "../src/lib/pdf-look.core";
import { signaturePng } from "./helpers/sample-signature-png";

const items = [
  { code: "INSTALLER_PRICE", description: "Bradford Gold R5 supplied and installed, removal of existing insulation (20 m²)", line_total_inc_gst: 2400 },
  { code: "AP_FEE", description: "Home Insulation Victoria fee", line_total_inc_gst: 349 },
  { code: "PIESA", description: "Electrical safety check (PIESA)", line_total_inc_gst: 349 },
];
const base = { jobNumber: "HV-9001", owner: "Helen Yang", address: "18 Dixie Street, Richmond VIC 3121", items, rebateIncGst: 1200, totalIncGst: 1898, status: "Sent to the owner",
  product: "Bradford Gold R5", installM2: 84, removeM2: 20, quoteDate: "2026-11-05T23:00:00Z" };
const money = (b: ReturnType<typeof ownQuotePdfBlocks>) => (b.find((x) => x.kind === "money") as { rows: { label: string; amount: string }[] }).rows;

test("insulation line split: product + m² with the installer's price; removal 'included' when not priced separately", () => {
  const rows = money(ownQuotePdfBlocks(base, null));
  expect(rows[0]).toEqual({ label: "R5.0 glasswool batts supplied and installed · 84 m²", amount: "$2,400" });
  expect(rows[1]).toEqual({ label: "Old insulation removed · 20 m²", amount: "included" });
  expect(rows.map((r) => r.label)).toContain("Home Insulation Victoria fee");
  expect(rows.at(-1)).toMatchObject({ amount: "$1,898" });
});
test("removal priced separately in the quote items → its own amount; no removal → no removal row", () => {
  const priced = [{ ...items[0]!, line_total_inc_gst: 2200 }, { code: "INSTALLER_REMOVAL", description: "Removal of existing insulation", line_total_inc_gst: 200 }, items[1]!, items[2]!];
  const rows = money(ownQuotePdfBlocks({ ...base, items: priced }, null));
  expect(rows[0]).toMatchObject({ amount: "$2,200" });
  expect(rows[1]).toEqual({ label: "Old insulation removed · 20 m²", amount: "$200" });
  expect(rows.filter((r) => /removal/i.test(r.label))).toEqual([]);
  expect(money(ownQuotePdfBlocks({ ...base, removeM2: 0 }, null)).some((r) => /Old insulation/.test(r.label))).toBe(false);
});
test("quote date and 'Valid for 30 days, until {date}' sit under the status", () => {
  const facts = ownQuotePdfBlocks(base, null).find((x) => x.kind === "facts") as { rows: [string, string][] };
  const status = facts.rows.find((r) => r[0] === "Status")![1];
  expect(status).toBe("Sent to the owner\nQuote date 6 November 2026\nValid for 30 days, until 6 December 2026");
});

const words = (pdf: Uint8Array) => {
  const dir = mkdtempSync(join(tmpdir(), "own-quote-")); const f = join(dir, "x.pdf"); writeFileSync(f, pdf);
  const html = execFileSync("pdftotext", ["-bbox", f, "-"], { encoding: "utf8" });
  return [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, t: m[5]! }));
};
test("rendered with the installer's logo: our details stay right-aligned under our logo, the eyebrow below both; the standard footer is there", async () => {
  const logo = { bytes: signaturePng(), width: 240, height: 80, alt: "No Gap" };
  const withLogo = await renderPdf({ title: "Quote", blocks: ownQuotePdfBlocks(base, logo) });
  const without = await renderPdf({ title: "Quote", blocks: ownQuotePdfBlocks(base, null) });
  expect(withLogo.layout.images).toContainEqual({ block: "q-head", page: 1 });
  expect(withLogo.layout.pages).toBe(1);
  const w = words(withLogo.bytes), n = words(without.bytes);
  const biz = (ws: typeof w) => ws.find((x) => x.t === "DC")!;
  // Without a logo: unchanged (our details at the top right). With one: our logo takes the top right, details under it.
  expect(biz(n).y0).toBeLessThan(40);
  expect(biz(w).y0).toBeGreaterThan(biz(n).y0 + 25);
  expect(w.find((x) => x.t === "info@homeinsulationvictoria.com.au")!.x1).toBeGreaterThan(415);
  const eyebrow = w.find((x) => x.t === "QUOTE")!;
  expect(eyebrow.y0).toBeGreaterThan(w.find((x) => x.t === "info@homeinsulationvictoria.com.au")!.y1);
  const text = w.map((x) => x.t).join(" ");
  expect(text).toContain(PDF_FOOTER_LEFT.split(" ").slice(0, 4).join(" "));
  expect(text).toContain("Page 1 of 1");
  for (const x of w) expect(x.x1).toBeLessThanOrEqual(450 - 30 + 0.5);
});
