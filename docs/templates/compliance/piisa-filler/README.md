# Official PIISA through the fixed Word filler (piisa-map-2.0.0, approved) — sample

SAMPLE ONLY: one realistic install, answers keyed exactly as the live A5 path hands them to `renderOfficialDocx` (`piisa-declaration.server`). Made by `bun scripts/render-piisa-filler-sample.ts`; nothing stored or sent; names and numbers made up.

Form: VEU pre-installation installer safety assessment form (© DEECA March 2026), original `docs/official-forms/VEU-pre-installation-installer-safety-assessment-form-_3.docx`, SHA-256 `bea62330fa766d3da29137a494d01f9e3e80a883cb5126b2fffb6fa07ad46dea`.

Files: `piisa-sample.docx` (the filled official Word form), `piisa-sample-word.pdf` (that file printed by LibreOffice), `piisa-sample-word-1.png`, `piisa-sample-word-2.png`, `piisa-sample-word-3.png`, `piisa-sample-word-4.png`, `piisa-sample-word-5.png`.

## Why the PIISA needed the same fix

The approved PIISA uses the same Word filler (`official-docx.core.ts`) as the PIESA. The f001aeba filler, given these exact answers and read back the same way: life support **No** printed unanswered (no "No" box is ever ticked — a space run sits between the box and the word); Part 5 electrician present **N/A** printed unanswered; Part 6 "average height" showed **1.5** (the R-value overwrote the height field) and the R-value line stayed blank; "Topped Up" was not ticked (`p6.treatment` not placed — the box text is "Removed and/or" / "Topped Up" across runs); the Part 8 signature box was blank; and all 18 ticks were written as a run inside another run (`<w:r><w:r>`, not valid Word XML). Now every box and text field is placed through the form's layout map and read back below.

## Read back from the filled Word file

- Filler: 40 items placed; not placed: none; no field on the Word form: none.
- Word XML: well-formed (tags balanced, no run nested in a run); xmllint clean.
- Decision 336: Part 8 "Signature" box = the A5 lead installer's signature PICTURE (inline image `word/media/hiv-signature-1.png`, relationship `rIdHivSignature1`) with "Signed in Mitti on 12/11/2026" under it. Sample picture only (made up).
- Word form vs answers: every box and text field matches the answers.
- Printed-rule blockers (`evaluatePiisa`): none.

| Official item | Answer | Word form shows |
|---|---|---|
| `jobRef` | HV-SAMPLE-4 | HV-SAMPLE-4 |
| `address` | 9 Grevillea Way, Cranbourne VIC 3977 | 9 Grevillea Way, Cranbourne VIC 3977 |
| `startDate` | 2026-11-12 | 12/11/2026 |
| `completionDate` | 2026-11-12 | 12/11/2026 |
| `p1.powerInformed` | Yes | Yes |
| `lifeSupport` | No | No |
| `p2.installDate` | 2026-11-12 | 12/11/2026 |
| `p2.ap` | Home Insulation Victoria | Home Insulation Victoria |
| `p2.company` | Bayside Insulation Pty Ltd | Bayside Insulation Pty Ltd |
| `p2.lead` | Daniel Moore | Daniel Moore |
| `p2.leadEec` | EEC-104552 | EEC-104552 |
| `p2.addName#0` | Ruby Tran | Ruby Tran |
| `p2.addEec#0` | EEC-118870 | EEC-118870 |
| `p3.swms` | Yes | Yes |
| `p3.table1` | Yes | Yes |
| `p3.isolated` | Yes | Yes |
| `p4.present` | Yes | Yes |
| `p4.instructions` | Yes | Yes |
| `p4.isolator` | Yes | Yes |
| `p5.reviewed` | Yes | Yes |
| `p5.electricianPresent` | N/A | N/A |
| `p5.recessed` | Yes | Yes |
| `p5.count` | 6 | 6 |
| `p5.icConfirmed` | Yes | Yes |
| `p5.safeToCover` | Yes | Yes |
| `p5.rcd` | Yes | Yes |
| `p5.tps` | Yes | Yes |
| `p5.basic` | Yes | Yes |
| `p5.noAccess` | Yes | Yes |
| `p6.present` | Yes | Yes |
| `p6.height` | 60 | 60 |
| `p6.rValue` | 1.5 | 1.5 |
| `p6.treatment` | Topped Up | Topped Up |
| `p6.suitable` | Yes | Yes |
| `p6.reason` | Existing glasswool batts are dry, evenly laid and not foil-backed; topped up to reach the required R-value. | Existing glasswool batts are dry, evenly laid and not foil-backed; topped up to reach the required R-value. |
| `p7.products` | Bradford Gold Hi-Performance Ceiling Batts R5.0 (BCB50) — 118 m² | Bradford Gold Hi-Performance Ceiling Batts R5.0 (BCB50) — 118 m² |
| `p8.declaration` | ticked | ticked |
| `p8.signature` | Daniel Moore (signed electronically on 12/11/2026) | Signed in Mitti on 12/11/2026 |
| `p8.name` | Daniel Moore | Daniel Moore |
| `p8.date` | 2026-11-12 | 12/11/2026 |

