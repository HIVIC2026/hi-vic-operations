// Task 12 (Review Focus 5): officialPiesaPdf — the PIESA copy owners, installers and electricians get — is built by flag.
// Flag off (default): today's plain-text copy, byte for byte. Flag on: the filled DEECA form (official-form-pdf.server).
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { officialPiesaPdfBytes } from "../src/lib/official-piesa-pdf.server";
import { officialPiesaPdfHeader, officialPiesaPdfText } from "../src/lib/electrician-piesa-copy.core";
import { textToPdf } from "../src/lib/signed-pdf.server";
import { answersFromDocument, buildSignedSnapshot } from "../src/lib/official-forms.core";
import { PDF_LOOK_APPROVED } from "../src/lib/pdf-approvals.core";
import { OFFICIAL_BLANK_PDF } from "../src/lib/official-pdf-piesa.data";
import { fullAnswers } from "../scripts/official-form-samples";
import { sampleSignaturePng } from "../scripts/sample-signature-png";

const snap = buildSignedSnapshot({ key: "piesa", answers: fullAnswers("piesa"), signer: { userId: "u1", name: "Sam Sparks", role: "electrician" }, enteredDate: "2026-11-07", serverTimestamp: "2026-11-07T03:00:00Z", jobFacts: {}, acknowledgementIds: [], signature: "Sam Sparks" });
const answers = answersFromDocument(snap.document) as Record<string, unknown>;
const png = sampleSignaturePng("Sam Sparks");
const sigs = { "b3.signature": { images: [{ bytes: png, contentType: "image/png", signedOn: "2026-11-07" }] } };

afterEach(() => { PDF_LOOK_APPROVED.officialFormPdf = false; setSystemTime(); });

test("flag off: the plain-text copy is exactly what it was", async () => {
  expect(PDF_LOOK_APPROVED.officialFormPdf).toBe(false);
  setSystemTime(new Date("2026-11-07T05:00:00Z"));
  const today = await textToPdf(officialPiesaPdfHeader("HV-1234"), officialPiesaPdfText(snap, { "b3.signature": { signedOn: "2026-11-07" } }), { "b3.signature": { bytes: png, contentType: "image/png" } });
  const now = await officialPiesaPdfBytes(snap, "HV-1234", answers, sigs);
  expect(Buffer.from(now).equals(Buffer.from(today))).toBe(true);
  // No signature pictures (the signature read failed or none kept): still today's copy.
  const plain = await textToPdf(officialPiesaPdfHeader("HV-1234"), officialPiesaPdfText(snap, {}), {});
  expect(Buffer.from(await officialPiesaPdfBytes(snap, "HV-1234", answers, {})).equals(Buffer.from(plain))).toBe(true);
});

test("flag on: the filled DEECA form", async () => {
  PDF_LOOK_APPROVED.officialFormPdf = true;
  const bytes = await officialPiesaPdfBytes(snap, "HV-1234", answers, sigs);
  const d = await PDFDocument.load(bytes);
  expect(d.getPageCount()).toBe((await PDFDocument.load(Buffer.from(OFFICIAL_BLANK_PDF.pdfBase64, "base64"))).getPageCount());
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const p1 = ((await (await doc.getPage(1)).getTextContent()).items as any[]).map((i) => i.str).join(" ");
  expect(p1).toContain("Pre-installation electrical");
  expect(p1).toContain("12 Example Street, Box Hill VIC 3128");
  const p6 = ((await (await doc.getPage(6)).getTextContent()).items as any[]).map((i) => i.str).join(" ");
  expect(p6).toContain("Signed in Mitti on 07/11/2026");
});
