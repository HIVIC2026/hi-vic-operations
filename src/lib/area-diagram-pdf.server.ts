// The generated area diagram as a PDF for the private job file (the job-files bucket accepts PDF/JPEG/PNG, not SVG).
// Draws the SAME layout model as the SVG (area-diagram.core.ts) so screen and file never disagree. Server-only.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { areaDiagramLayout, fmtNum, type DiagramInput } from "./area-diagram.core";

/** Helvetica (WinAnsi) cannot show every character; keep ², ×, dashes and ASCII, replace the rest. */
const safe = (s: string) => s.replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, "-");

export async function areaDiagramPdf(input: DiagramInput): Promise<Uint8Array> {
  const l = areaDiagramLayout(input);
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(l.title));
  pdf.setProducer("Home Insulation Victoria portal");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // A4 portrait; the layout is scaled uniformly to fit the printable area.
  const PW = 595, PH = 842, M = 28;
  const k = Math.min((PW - 2 * M) / l.width, (PH - 2 * M) / l.height, 1);
  const page = pdf.addPage([PW, PH]);
  const X = (x: number) => M + x * k;
  const Y = (y: number) => PH - M - y * k; // layout y is the text baseline / top edge measured from the top
  const text = (x: number, y: number, s: string, size: number, b = false, color = rgb(0.06, 0.12, 0.24)) => page.drawText(safe(s), { x: X(x), y: Y(y), size: size * k, font: b ? bold : font, color });
  const ink = rgb(0.06, 0.12, 0.24), grey = rgb(0.29, 0.33, 0.41), green = rgb(0.12, 0.44, 0.29);
  text(40, 40, l.title, 18, true);
  l.header.forEach((h, i) => text(40, 60 + i * 16, h, 11, false, grey));
  for (const b of l.boxes) {
    page.drawRectangle({ x: X(b.x), y: Y(b.y + b.h), width: b.w * k, height: b.h * k, color: rgb(0.93, 0.96, 0.95), borderColor: green, borderWidth: 2 * k });
    if (b.area.lengthM != null && b.area.widthM != null) {
      const top = `${fmtNum(b.area.lengthM)} m`, side = `${fmtNum(b.area.widthM)} m`;
      page.drawText(safe(top), { x: X(b.x + b.w / 2) - font.widthOfTextAtSize(top, 10 * k) / 2, y: Y(b.y - 5), size: 10 * k, font, color: green });
      page.drawText(safe(side), { x: X(b.x - 8), y: Y(b.y + b.h / 2) - font.widthOfTextAtSize(side, 10 * k) / 2, size: 10 * k, font, color: green, rotate: { type: "degrees", angle: 90 } as never });
    }
    b.lines.forEach((line, i) => text(b.x + 10, b.y + 18 + i * 15, line, i === 0 ? 13 : 11, i === 0, ink));
  }
  const fy = l.height - 40 - 16 * (l.footer.length - 1) + 4;
  l.footer.forEach((f, i) => text(40, fy + i * 16, f, i === 0 ? 12 : 10, i === 0, i === 0 ? ink : grey));
  return pdf.save();
}
