/**
 * Manufacturer's installation instructions on file (VEU Code cl 26 / Activity Guide: given to the consumer on completion).
 * Part 4 attaches the right one to the owner's "All done" email. Families come from product-warranty.core (ECOWOOL excluded).
 *
 * A family only counts as "on file" when its real PDF is bundled in `product-instructions.data.ts` (regenerated from
 * docs/product-instructions/ by `bun scripts/embed-product-instructions.ts`). A missing file returns null plus a hold
 * reason; nothing here blocks, fakes or invents a document. Part 4 decides how to hold.
 */
import { warrantyFamilyForOption, type WarrantyFamily } from "./product-warranty.core";
import { PRODUCT_INSTRUCTION_PDFS } from "./product-instructions.data";

export const INSTRUCTIONS_DIR = "docs/product-instructions";

export type ProductInstructions = { family: WarrantyFamily; title: string; pdfPath: string; attachmentName: string; sourceUrl: string };

/** Every family's expected document. Whether the PDF is actually on file is decided by the bundled data. */
export const PRODUCT_INSTRUCTIONS: readonly ProductInstructions[] = [
  {
    family: "bradford_gold", title: "Bradford Gold ceiling batts installation guide",
    pdfPath: `${INSTRUCTIONS_DIR}/bradford-ceiling-batt-B0328-rev3.pdf`, attachmentName: "Bradford-Gold-installation-instructions.pdf",
    sourceUrl: "https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts",
  },
  {
    family: "pink_batts", title: "Installation Guide – Pink Batts – Wall and Ceiling (IG06 Rev5)",
    pdfPath: `${INSTRUCTIONS_DIR}/pink-batts-IG06-rev5.pdf`, attachmentName: "Pink-Batts-installation-instructions.pdf",
    sourceUrl: "https://insulation.com.au/wp-content/uploads/2024/IG06-Pink-Batts-Wall-and-Ceiling-Rev5-300924-.pdf",
  },
  {
    family: "earthwool", title: "Knauf Insulation Installation Instructions – Earthwool Ceiling batts",
    pdfPath: `${INSTRUCTIONS_DIR}/earthwool-ceiling-batts.pdf`, attachmentName: "Earthwool-installation-instructions.pdf",
    sourceUrl: "https://knauf.com/en-AU/p/product/earthwool-ceiling-batts-26909_4225",
  },
];

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
    if (!i || !onFile(i.pdfPath)) { missing.push(p); continue; }
    if (!attach.some((a) => a.family === i.family)) attach.push(i);
  }
  return { attach, missing };
}
