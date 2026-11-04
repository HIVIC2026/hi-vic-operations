// The installed product's manufacturer instructions as an email attachment (Part 4 Task 9). Server-only; bytes come from the bundled
// `product-instructions.data.ts` (real PDFs only). null = not an approved family or its PDF is not on file; nothing is invented.
import type { EmailAttachment } from "./email-kit.core";
import { looksLikePdf } from "./product-warranty.core";
import { instructionsForOption } from "./product-instructions.core";
import { PRODUCT_INSTRUCTION_PDFS } from "./product-instructions.data";

export async function productInstructionsFor(product: string): Promise<EmailAttachment | null> {
  const i = instructionsForOption(product);
  const uri = i ? PRODUCT_INSTRUCTION_PDFS[i.pdfPath] : undefined;
  if (!i || !uri) return null;
  const bytes = new Uint8Array(Buffer.from(uri.replace(/^data:[^,]*,/, ""), "base64"));
  return looksLikePdf(bytes) ? { filename: i.attachmentName, content: Buffer.from(bytes).toString("base64"), contentType: "application/pdf" } : null;
}
