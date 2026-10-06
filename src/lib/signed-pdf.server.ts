// One way to turn a signed record's exact text into a PDF copy for the job file. Server-only.
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function textToPdf(header: string, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]); let y = 800;
  for (const raw of [header, "", ...text.split("\n")]) {
    const words = raw.replace(/²/g, "2").replace(/[^\x20-\x7E]/g, "-").split(" "); let line = "";
    const flush = () => { if (y < 50) { page = pdf.addPage([595, 842]); y = 800; } page.drawText(line, { x: 48, y, size: 10, font }); y -= 14; line = ""; };
    for (const w of words) { if (font.widthOfTextAtSize(`${line} ${w}`, 10) > 500) flush(); line = line ? `${line} ${w}` : w; }
    flush();
  }
  return pdf.save();
}
