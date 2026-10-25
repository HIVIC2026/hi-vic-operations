# Product warranty documents (VEU checklist G1)

The ESC requires the consumer to hold a copy of the **product warranty against defects, minimum 5 years from
installation**, before the Accredited Person signs Section 3 Part A of the VEEC assignment form (Activity 48 FAQ Q8;
assignment form Part A bullet 7). Jo, 25 Oct 2026: "look up the approved products' warranty and fix this gap".

How it works in the portal (`src/lib/product-warranty.core.ts`, `product-warranty.server.ts`, `completion-pack.server.ts`):

1. The completion pack email (O47) is sent once per job after the install is recorded complete and the invoice is paid in
   full (decision 103/133 wording: "Once it's paid, we'll send your completion pack"), behind `COMPLETION_EMAILS_APPROVED`
   and `customer_comms_enabled` like every other owner email; TEST jobs go through test-send.
2. The installed product(s) come from the Install day form's per-area answers (else the Ready Check product). The matching
   warranty PDF(s) from this folder are attached, a copy is filed on the job (documents kind `product_warranty`) and
   `warranty_copy_provided` is recorded automatically — the AP auto-signature prerequisite is met without an office step.
3. If a product's PDF is not on file, the pack still sends, **nothing is recorded**, and the AP signature holds with the
   reason "Warranty copy for <product> not on file". The office "Record: warranty copy given to the consumer" button
   remains as the manual fallback once a copy has been given another way.

The PDFs are bundled for the server by `bun scripts/embed-product-warranties.ts` → `src/lib/product-warranty.data.ts`.
The script refuses anything that is not a real PDF (`%PDF-` header) and warns when the text does not mention a warranty.
**Run it after adding or replacing any file here.**

## Status (25 Oct 2026)

Three PDFs are on file and embedded (fetched through the Lovable sandbox on 25 Oct 2026; the build container's proxy
blocks the manufacturer hosts): Pink Batts (insulation.com.au Rev2 29 Apr 2024), Earthwool unfaced (Knauf via the Bunnings
media mirror, KIAU08181747WA), Bradford (eboss.co.nz NZ-issued lifetime warranty certificate — replace with the current
Australian CSR Bradford 70-year document when the office has it). ECOWOOL is still missing (PGF to supply).

| Product option(s) | Manufacturer | Warranty | Expected file (exact name) | Source |
|---|---|---|---|---|
| Bradford Gold R5 / R6 / R7 | CSR Bradford (CSR Building Products Ltd) | 70-year product performance warranty (decision 148) | `bradford-gold-70-year-warranty.pdf` | Current CSR Bradford Australia warranty PDF from https://www.csrbradford.com.au/ (search "Bradford Gold warranty"); fallback certificate https://www.eboss.co.nz/assets/literature/25/24959/125414-BRI-Product-Lifetime-Warranty-PRESS.pdf (NZ-issued — prefer the Australian document) |
| Fletchers Pink Batts R5 / R6 / R7 | Fletcher Insulation Pty Ltd | Consumer lifetime product warranty (Rev 2, 29 Apr 2024) | `pink-batts-consumer-lifetime-warranty.pdf` | https://insulation.com.au/wp-content/uploads/2024/Warranty-Consumer-Lifetime-Product-Pink-Batts-Rev2-290424.pdf |
| Earthwool R5 | Knauf Insulation Pty Ltd | 50-year warranty — Earthwool unfaced products | `earthwool-unfaced-50-year-warranty.pdf` | https://www.knauf.com/en-AU → Earthwool Ceiling Batts → "Knauf Insulation Warranty - Earthwool unfaced products.PDF"; mirror https://media.bunnings.com.au/api/public/content/00dae20abf0b4b2dafd88941ae435043 |
| ECOWOOL R5 | PGF Insulation (PGF Australia) | **Not confirmed — no public warranty document found** | `ecowool-product-warranty.pdf` | To be requested from PGF Australia (sales@pgfinsulation.com.au). The term is recorded as unconfirmed, so ECOWOOL jobs hold on the warranty prerequisite until the office records a copy by hand; once the document arrives, set `warranty` in `product-warranty.core.ts` to the stated term (must be ≥ 5 years), add the file and run the embed script. |

Checks to make when adding a file: it opens as a PDF, it is the manufacturer's own document (not a reseller summary),
the warranty term is stated and is at least 5 years, and it covers the ceiling batt range we install. Record the download
date and URL in the commit message.
