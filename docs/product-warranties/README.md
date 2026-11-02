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
   reason "Warranty copy for <product> not on file" (Bradford with no building class: "Building class not recorded — can't choose the Bradford warranty"). The office "Record: warranty copy given to the consumer" button
   remains as the manual fallback once a copy has been given another way.

The PDFs are bundled for the server by `bun scripts/embed-product-warranties.ts` → `src/lib/product-warranty.data.ts`.
The script refuses anything that is not a real PDF (`%PDF-` header) and warns when the text does not mention a warranty.
**Run it after adding or replacing any file here.**

## Status (3 Nov 2026)

Four PDFs are on file and embedded: Bradford Class 1, Bradford Class 2 to 10, Pink Batts (insulation.com.au Rev2 29 Apr 2024)
and Earthwool unfaced (Knauf via the Bunnings media mirror, KIAU08181747WA).
ECOWOOL is excluded (Jo, 2 Nov 2026): no warranty file, not in the product map. An old job that still holds an ECOWOOL answer
sends the completion pack without a warranty and the AP signature holds with "ECOWOOL is an excluded product — no warranty copy on file."

**Bradford depends on the building class.** CSR issues one certificate per class group, and each says it does not apply to the
other. The job's class comes from the Ready Check answer (`building_class`, else the property type via installer-led.core
`classFromPropertyType`: house/townhouse = Class 1, unit = Class 2), else the owner's declared property type.
House or townhouse → Class 1 certificate; unit → Class 2 to 10 certificate. Ceiling batts are un-faced, so the un-faced term applies.
Class not recorded → no Bradford attachment and the AP signature holds with "Building class not recorded — can't choose the Bradford warranty".

Provenance (Bradford): CSR's current clean certificates, supplied by Jo on 3 Nov 2026 (originals kept byte for byte in `_incoming/`):

- `bradford-glasswool-warranty-class-1.pdf` — "Glasswool Insulation Warranty — Faced & Un-Faced Glasswool Products — Class 1 Building
  Applications", Version A, last revision June 2023: 70 years un-faced, 10 years faced. From `_incoming/Bradford_Glasswool_Insulation_-_Class_1_Warranty_Certificate.pdf`,
  sha256 `6c0c39b5f42f749188e37ed63b5e00be5492d575b9efaf0a265d32234b18e3be`.
- `bradford-glasswool-warranty-class-2-10.pdf` — "… Class 2 to 10 Building Applications", Version A, last revision March 2022: 25 years
  un-faced, 10 years faced. From `_incoming/Bradford_Glasswool_Insulation_-_Class_2-10_Warranty_Certificate.pdf`,
  sha256 `da15a2f66aa865376f0f9ecbcef8af6b76f2e19ff71b4004ca21edf9c152b870`.

The 2010 CSR print proof (`bradford-au-lifetime-warranty.pdf`, used until 3 Nov 2026) is retired from this folder; it stays in
`_incoming/bradford-lifetime-warranty-proof-2010.pdf` for the record only.

| Product option(s) | Manufacturer | Warranty | Expected file (exact name) | Source |
|---|---|---|---|---|
| Bradford Gold R5 / R6 / R7 — Class 1 (house, townhouse) | CSR Bradford (CSR Building Products Ltd) | Glasswool Insulation Warranty, Class 1 buildings: 70 years un-faced | `bradford-glasswool-warranty-class-1.pdf` | https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts (Australian document only) |
| Bradford Gold R5 / R6 / R7 — Class 2 to 10 (unit) | CSR Bradford (CSR Building Products Ltd) | Glasswool Insulation Warranty, Class 2 to 10 buildings: 25 years un-faced | `bradford-glasswool-warranty-class-2-10.pdf` | https://www.csrbradford.com.au/products/ceiling-insulation/insulation/goldceilingbatts (Australian document only) |
| Fletchers Pink Batts R5 / R6 / R7 | Fletcher Insulation Pty Ltd | Consumer lifetime product warranty (Rev 2, 29 Apr 2024) | `pink-batts-consumer-lifetime-warranty.pdf` | https://insulation.com.au/wp-content/uploads/2024/Warranty-Consumer-Lifetime-Product-Pink-Batts-Rev2-290424.pdf |
| Earthwool R5 | Knauf Insulation Pty Ltd | 50-year warranty — Earthwool unfaced products | `earthwool-unfaced-50-year-warranty.pdf` | https://www.knauf.com/en-AU → Earthwool Ceiling Batts → "Knauf Insulation Warranty - Earthwool unfaced products.PDF"; mirror https://media.bunnings.com.au/api/public/content/00dae20abf0b4b2dafd88941ae435043 |

Checks to make when adding a file: it opens as a PDF, it is the manufacturer's own document (not a reseller summary),
the warranty term is stated and is at least 5 years, and it covers the ceiling batt range we install. Record the download
date and URL in the commit message.
