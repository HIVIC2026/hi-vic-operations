/** Static list of the expected instruction documents. NO data import, so the embed script can import it too. */
import type { WarrantyFamily } from "./product-warranty.core";

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

