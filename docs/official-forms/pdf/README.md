# DEECA PIESA / PIISA as PDFs

`src/lib/official-pdf-piesa.data.ts` and `src/lib/official-pdf-piisa.data.ts` are generated. Do not edit them by hand.

Each exports `OFFICIAL_BLANK_PDF = { sourceSha256, fieldCount, pdfBase64, fields }`:

- `pdfBase64`: the blank form. LibreOffice converts the untouched DEECA `.docx` from `docs/official-forms/`, so the wording is DEECA's.
- `sourceSha256`: the SHA-256 of that `.docx`. It must match `OFFICIAL_TEMPLATES[key].sha256`.
- `fields`: one box per Word form field, in `docxFields` order, named `hiv{n}` as in `uniqueFieldNames`. Each box is `{ name, kind: "text" | "check", page, x, y, w, h }`. Sizes are in pt and use PDF coordinates: the origin is the bottom-left of the page, and `page` counts from 0.

Task 12 draws the text and ticks into these boxes with pdf-lib at run time. LibreOffice is never needed at run time.

## Why the positions are measured

LibreOffice 24.2 does not turn the forms' old Word fields (FORMTEXT and FORMCHECKBOX) into PDF form fields. It exports 0 widgets, with or without Tagged PDF. So the script measures where each field lands on the page instead.

## How the script measures the fields

1. **Blank PDF.** `soffice --headless --convert-to pdf` runs on the untouched `.docx`. It uses a throwaway LibreOffice profile with a font replacement table (`FONT_REPLACEMENTS` in the script) for fonts the forms name but this machine lacks:
   - Aptos (the footer "OFFICIAL" label) and Calibri → Carlito
   - Cambria → Caladea
   - "Arial Bold" and "VIC SemiBold" → Liberation Sans
   - Tahoma and Lucida Handwriting → DejaVu Sans

   Without the table, LibreOffice falls back to Inter, which wraps "OFFICIAL" to "OFFICIA / L".
2. **Marker PDF.** The script makes a copy of the `.docx` with `uniqueFieldNames` applied. Every field becomes a marker `#nnn#`, where `nnn` is the field number with leading zeros. Each marker is squeezed with Word character scaling to about the width of its field:
   - A text field's blank result is 5 en spaces, so its marker is scaled to the same width.
   - A checkbox is replaced by its marker, scaled to the width of the box LibreOffice draws.

   The line height does not change. The copy is then converted the same way as the blank.
3. **Boxes.** `pdftotext -bbox` finds each marker's page and box in the marker PDF.
4. **Checks.** The script writes nothing if any of these is true:
   - A field has no marker.
   - A marker is found more than once.
   - The marker PDF and the blank PDF have different page counts.
   - The form's own words hold different words on a page in the two PDFs, or any word moved more than 1 pt.

   Each word is compared with the nearest word with the same text. The last run moved words by at most 0.2 pt.

## How to regenerate

You need LibreOffice (`soffice`) and poppler (`pdftotext`). Run:

```
bun scripts/official-form-blank-pdf.ts
bun test tests/official-pdf-blank.test.ts
```

Regenerate after any change to the bundled DEECA `.docx` or to the LibreOffice version. `pdfBase64` changes on every run because of the PDF creation date. The boxes should not change.

## Known differences from Word

- **PIESA page count.** LibreOffice lays out the PIESA on 8 pages. Word recorded 7 when DEECA saved it:
  - Part 2 starts on page 2.
  - B1 sits alone on page 5.

  The font replacements do not change this; the cause is layout, not fonts. The PIISA matches Word at 5 pages. The test pins both counts.
- **"OFFICIAL" label overlaps the footer line.** "OFFICIAL" now prints whole on every page, and the test checks this. But on every page after page 1 it overlaps the start of "VEU Pre-installation …". On the last page it is hidden behind the logos.
  - The label is a bottom-anchored text box. The footer line runs through the page centre, so the two share a line.
  - By the form's own geometry, the label would touch the footer text in Word too, but LibreOffice draws it about 5 pt higher.
  - On the last page, the footer text also overlaps the DEECA logos.
