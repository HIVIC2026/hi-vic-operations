// The installed product's manufacturer instructions as an email attachment (Part 4 Task 9). Server-only; the bytes are the
// stored copy named in `product-instructions.data.ts` (real PDFs only). null = not an approved family or its PDF is not on
// file; nothing is invented.
// Speed (Jo 7 Nov 2026): the PDFs are fetched from the file store instead of being built into the server program. A copy
// whose SHA-256/size does not match, or that cannot be fetched, THROWS (never null): the All done email then waits for the
// next try instead of going out without the instructions.
import { createHash } from "node:crypto";
import type { EmailAttachment } from "./email-kit.core";
import { looksLikePdf } from "./product-warranty.core";
import { instructionsForOption } from "./product-instructions.core";
import { PRODUCT_INSTRUCTION_FILES, type InstructionFile } from "./product-instructions.data";

/** The published portal serves the stored copies at `/__l5e/assets-v1/…` (also on the preview and custom hosts). */
export const INSTRUCTIONS_ORIGIN = "https://hi-vic-operations.lovable.app";

const cache = new Map<string, Promise<Uint8Array>>();

async function fetchVerified(file: InstructionFile, fetcher: typeof fetch): Promise<Uint8Array> {
  const res = await fetcher(`${INSTRUCTIONS_ORIGIN}${file.url}`);
  if (!res.ok) throw new Error(`Manufacturer's instructions could not be read (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== file.size || sha !== file.sha256 || !looksLikePdf(bytes)) throw new Error("Manufacturer's instructions copy does not match the file on record");
  return bytes;
}

/** The verified bytes for one stored instructions PDF (cached per server process; a failure is not cached). */
export function instructionPdfBytes(pdfPath: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const file = PRODUCT_INSTRUCTION_FILES[pdfPath];
  if (!file) return Promise.reject(new Error(`No stored copy for ${pdfPath}`));
  let p = cache.get(pdfPath);
  if (!p) {
    p = fetchVerified(file, fetcher);
    cache.set(pdfPath, p);
    p.catch(() => cache.delete(pdfPath));
  }
  return p;
}

export async function productInstructionsFor(product: string, fetcher: typeof fetch = fetch): Promise<EmailAttachment | null> {
  const i = instructionsForOption(product);
  if (!i || !PRODUCT_INSTRUCTION_FILES[i.pdfPath]) return null;
  const bytes = await instructionPdfBytes(i.pdfPath, fetcher);
  return { filename: i.attachmentName, content: Buffer.from(bytes).toString("base64"), contentType: "application/pdf" };
}
