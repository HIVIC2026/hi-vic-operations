// One way to turn a signed record's exact text into a PDF copy for the job file. Server-only.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfSafeText } from "./pdf-text.core";
import { LOGO_PNG } from "./email-hero-assets";

export type SignedAcceptanceCopy = {
  ownerName: string; address: string; totalIncGst: number; signedAt: string; jobNumber: string;
  items: { title: string; version: string; text: string }[];
};

/** Human-readable copy only; the immutable snapshot/hash remain in the signing record. */
export async function signedAcceptancePdf(copy: SignedAcceptanceCopy): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG);
  const supported = new Set(regular.getCharacterSet());
  let page = pdf.addPage([595, 842]); let y = 790;
  page.drawImage(logo, { x: 48, y: 735, width: 160, height: 160 * logo.height / logo.width });
  y = 712;
  const print = (text: string, size = 10, strong = false) => {
    const font = strong ? bold : regular;
    for (const raw of text.split("\n")) {
      let line = "";
      const flush = () => {
        if (y < 55) { page = pdf.addPage([595, 842]); y = 790; }
        page.drawText(line, { x: 48, y, size, font }); y -= size + 5; line = "";
      };
      for (const word of pdfSafeText(raw, supported).split(/\s+/)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > 499) flush();
        // Break unusually long recorded words rather than clipping them.
        for (const ch of word) {
          if (font.widthOfTextAtSize(line + ch, size) > 499) flush();
          line += ch;
        }
        line += " ";
      }
      flush();
    }
  };
  print("Home Insulation Victoria", 11, true);
  y -= 8;
  print("Your signed acceptance", 20, true); y -= 12;
  print(`Owner: ${copy.ownerName}`);
  print(`Property: ${copy.address}`);
  print(`Job: ${copy.jobNumber}`);
  print(`Quote total: ${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(copy.totalIncGst)} inc GST`, 11, true);
  const date = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" }).format(new Date(copy.signedAt));
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(new Date(copy.signedAt));
  print(`Signed: ${date}, ${time} (Melbourne time)`); y -= 18;
  for (const item of copy.items) {
    print(`${item.title} (version ${item.version})`, 11, true);
    print(item.text); y -= 16;
  }
  return pdf.save();
}

/** Decision 336: a picture for a `[[image:<slot>]]` line (PNG or JPEG bytes). */
export type PdfImage = { bytes: Uint8Array; contentType: string };
/** Printed instead of a picture the PDF helper can't embed (not PNG/JPEG, or unreadable). */
export const PDF_IMAGE_ON_WORD_COPY = "Signed in Mitti (image on the Word copy)";

export async function textToPdf(header: string, text: string, images: Record<string, PdfImage | null | undefined> = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Decision 329: keep every character the font can draw (’ “ ” – — • ² …); map the rest to the closest plain text.
  const charset = new Set(font.getCharacterSet());
  let page = pdf.addPage([595, 842]); let y = 800;
  for (const raw of [header, "", ...text.split("\n")]) {
    // Decision 336: a signature picture line.
    const marker = /^\[\[image:([^\]]+)\]\]$/.exec(raw.trim());
    if (marker) {
      const img = images[marker[1]!];
      let drawn = false;
      if (img?.bytes?.length) {
        try {
          const isPng = img.bytes[0] === 0x89 && img.bytes[1] === 0x50;
          const isJpg = img.bytes[0] === 0xff && img.bytes[1] === 0xd8;
          const emb = isPng ? await pdf.embedPng(img.bytes) : isJpg ? await pdf.embedJpg(img.bytes) : null;
          if (emb) {
            const s = Math.min(160 / emb.width, 50 / emb.height, 1);
            const w = emb.width * s, h = emb.height * s;
            if (y - h < 50) { page = pdf.addPage([595, 842]); y = 800; }
            page.drawImage(emb, { x: 48, y: y - h + 10, width: w, height: h });
            y -= h + 4;
            drawn = true;
          }
        } catch { drawn = false; }
      }
      if (!drawn) { if (y < 50) { page = pdf.addPage([595, 842]); y = 800; } page.drawText(PDF_IMAGE_ON_WORD_COPY, { x: 48, y, size: 10, font }); y -= 14; }
      continue;
    }
    const words = pdfSafeText(raw, charset).split(" "); let line = "";
    const flush = () => { if (y < 50) { page = pdf.addPage([595, 842]); y = 800; } page.drawText(line, { x: 48, y, size: 10, font }); y -= 14; line = ""; };
    for (const w of words) { if (font.widthOfTextAtSize(`${line} ${w}`, 10) > 500) flush(); line = line ? `${line} ${w}` : w; }
    flush();
  }
  return pdf.save();
}
