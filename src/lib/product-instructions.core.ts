/**
 * Manufacturer's installation instructions on file (VEU Code of Conduct (completion information) / ESC Activity Guide Table 3: given to the consumer on completion).
 * Part 4 attaches the right one to the owner's "All done" email. Families come from product-warranty.core (ECOWOOL excluded).
 *
 * A family only counts as "on file" when its real PDF is bundled in `product-instructions.data.ts` (regenerated from
 * docs/product-instructions/ by `bun scripts/embed-product-instructions.ts`). A missing file returns null plus a hold
 * reason; nothing here blocks, fakes or invents a document. Part 4 decides how to hold.
 */
import { warrantyFamilyForOption } from "./product-warranty.core";
import { PRODUCT_INSTRUCTION_PDFS } from "./product-instructions.data";
import { INSTRUCTIONS_DIR, PRODUCT_INSTRUCTIONS, type ProductInstructions } from "./product-instructions.list";

export { INSTRUCTIONS_DIR, PRODUCT_INSTRUCTIONS, type ProductInstructions };

/** Only the documents whose PDF is bundled. */
export const INSTRUCTIONS_ON_FILE: readonly ProductInstructions[] = PRODUCT_INSTRUCTIONS.filter((i) => i.pdfPath in PRODUCT_INSTRUCTION_PDFS);

/** The instructions for one Mitti option; null when the option is not an approved family or its PDF is not on file. */
export function instructionsForOption(option: string | null | undefined): ProductInstructions | null {
  const f = warrantyFamilyForOption(option);
  return f ? INSTRUCTIONS_ON_FILE.find((i) => i.family === f) ?? null : null;
}

export const instructionsHoldReason = (product: string) => `Manufacturer's instructions for ${product} not on file`;

/** What the "All done" email can attach. `onFile(pdfPath)` says whether that copy is bundled. One attachment per family. */
export function decideInstructionsAttachment(products: readonly string[], onFile: (p: string) => boolean): { attach: ProductInstructions[]; missing: string[] } {
  const attach: ProductInstructions[] = [];
  const missing: string[] = [];
  for (const p of products) {
    const f = warrantyFamilyForOption(p);
    const i = f ? PRODUCT_INSTRUCTIONS.find((x) => x.family === f) : undefined;
    if (!i || !onFile(i.pdfPath)) { if (!missing.includes(p)) missing.push(p); continue; }
    if (!attach.some((a) => a.family === i.family)) attach.push(i);
  }
  return { attach, missing };
}
