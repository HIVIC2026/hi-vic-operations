// One way to turn a signed record's exact text into a PDF copy for the job file. Server-only.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfSafeText } from "./pdf-text.core";

export async function textToPdf(header: string, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Decision 329: keep every character the font can draw (’ “ ” – — • ² …); map the rest to the closest plain text.
  const charset = new Set(font.getCharacterSet());
  let page = pdf.addPage([595, 842]); let y = 800;
  for (const raw of [header, "", ...text.split("\n")]) {
    const words = pdfSafeText(raw, charset).split(" "); let line = "";
    const flush = () => { if (y < 50) { page = pdf.addPage([595, 842]); y = 800; } page.drawText(line, { x: 48, y, size: 10, font }); y -= 14; line = ""; };
    for (const w of words) { if (font.widthOfTextAtSize(`${line} ${w}`, 10) > 500) flush(); line = line ? `${line} ${w}` : w; }
    flush();
  }
  return pdf.save();
}
