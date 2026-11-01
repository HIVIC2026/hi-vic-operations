import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import * as renderer from "../src/lib/signed-pdf.server";
import { LOGO_PNG } from "../src/lib/email-hero-assets";

export const fixture = {
  ownerName: "Alex Fixture", address: "12 Example Street, Richmond VIC 3121",
  totalIncGst: 2349, signedAt: "2026-11-01T07:16:00.000Z", jobNumber: "HV-FIXTURE",
  items: [{ title: "The agreement", version: "fixture-v1", text: "I accept this quote and the Customer Agreement with DC Construction Solutions Pty Ltd trading as Home Insulation Victoria." }],
};
async function generate() {
  const fn = (renderer as Record<string, unknown>).signedAcceptancePdf as ((v: typeof fixture) => Promise<Uint8Array>) | undefined;
  return fn ? fn(fixture) : renderer.textToPdf("Home Insulation Victoria", `Machine-readable snapshot:\n${JSON.stringify(fixture)}`);
}
const extract = (bytes: Uint8Array) => execFileSync("pdftotext", ["-", "-"], { input: bytes }).toString().replace(/\s+/g, " ");
test("acceptance PDF contains readable owner, address, total, signed Melbourne date and brand", async () => {
  const text = extract(await generate());
  for (const expected of [fixture.ownerName, fixture.address, "$2,349.00", "1 November 2026", "6:16 pm", "AEDT", "Home Insulation Victoria", "Your signed acceptance", "fixture-v1", fixture.items[0]?.text ?? ""]) expect(text).toContain(expected);
});
test("acceptance PDF contains no raw snapshot, markup, undefined or null", async () => {
  expect(extract(await generate())).not.toMatch(/[{}<>]|=>|\b(?:undefined|null)\b|Machine-readable snapshot/);
});
test("acceptance PDF embeds the same base64 email logo", async () => {
  const pdf = await PDFDocument.load(await generate());
  const logo = await PDFDocument.create(); const img = await logo.embedPng(LOGO_PNG);
  const images = pdf.context.enumerateIndirectObjects().filter(([, o]) => "dict" in o && o.dict instanceof PDFDict && o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image");
  expect(images.some(([, o]) => "dict" in o && o.dict instanceof PDFDict && o.dict.get(PDFName.of("Width"))?.toString() === String(img.width) && o.dict.get(PDFName.of("Height"))?.toString() === String(img.height))).toBe(true);
});