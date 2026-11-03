# Manufacturer's installation instructions

The owner must be given the manufacturer's installation instructions on completion (VEU Code of Conduct (completion information) / ESC Activity Guide Table 3). Part 4 attaches the
right one to the "All done" email. Code: `src/lib/product-instructions.core.ts`. A missing file never blocks or fakes anything:
`instructionsForOption` returns null and `instructionsHoldReason(product)` gives the reason.

## Add or replace a document

1. Drop the real manufacturer PDF in this folder using the exact file name below.
2. Run `bun scripts/embed-product-instructions.ts` (skips and reports non-PDFs and reseller hosts; if any present file is rejected it exits non-zero and writes nothing).
3. Commit the PDF and the regenerated `src/lib/product-instructions.data.ts`.

## Status (3 Nov 2026)

| Family | File name | Status | Source |
|---|---|---|---|
| Bradford Gold | `bradford-ceiling-batt-B0328-rev3.pdf` | On file. CSR "Installation Guide Bradford Ceiling Batt Residential Thermal Insulation", B0328 Rev 3, Sep 2024, 7 pages (supplied by Jo) | https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts |
| Pink Batts | `pink-batts-IG06-rev5.pdf` | On file. Fletcher "Pink Batts Wall and Ceiling Installation Guide" IG06 Rev 5, 9 pages (supplied by Jo 3 Nov 2026) | https://insulation.com.au/wp-content/uploads/2024/IG06-Pink-Batts-Wall-and-Ceiling-Rev5-300924-.pdf |
| Earthwool | `earthwool-ceiling-batts.pdf` | On file. Knauf "Earthwool Ceiling Batts Installation Guide", 3 pages (supplied by Jo 3 Nov 2026) | https://knauf.com/en-AU/p/product/earthwool-ceiling-batts-26909_4225 |

ECOWOOL is excluded. Use the manufacturer's own copy, not a reseller's.
