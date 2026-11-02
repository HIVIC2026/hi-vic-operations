// Task 12: the filled DEECA PIESA / PIISA as a PDF. Server-only (pdf-lib).
// The DEECA blank (official-pdf-{piesa,piisa}.data.ts, Task 11) has no form widgets, so the answers are DRAWN onto it:
// - a tick centred in each box the placement rule checks (official-docx.core `officialFieldValues`, shared with the Word copy:
//   same placement, follow-up conditions and `skipped`);
// - each text inside its field's free area (official-pdf-areas.data.ts) by official-form-pdf.core `fitText`
//   (shrink to 6 pt, then wrap; never cut; `overflow` lists what still did not fit);
// - typed signatures in Open Sans Bold Italic; Mitti signature pictures (decision 336) inside the signature area with
//   "Signed in Mitti on DD/MM/YYYY" under them. PIESA B3 prints no signature box: its picture goes in the band under the B3
//   declaration, or only the caption when the band is too short for a picture.
// DEECA's printed wording is never touched: nothing is drawn outside a field's box or free area.
import { LineCapStyle, PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { OPEN_SANS_400, OPEN_SANS_700_ITALIC } from "./pdf-fonts.data";
import { pdfSafeText } from "./pdf-text.core";
import { OFFICIAL_BLANK_PDF as PIESA_BLANK, type FieldBox } from "./official-pdf-piesa.data";
import { OFFICIAL_BLANK_PDF as PIISA_BLANK } from "./official-pdf-piisa.data";
import { OFFICIAL_PDF_AREAS } from "./official-pdf-areas.data";
import { answerItems, OFFICIAL_TEMPLATES, officialFormUseBlocker, type OfficialAnswers, type OfficialKey } from "./official-forms.core";
import { imagePixelSize, officialFieldValues, SIGNATURE_SLOTS, signedInMittiCaption, type SignatureInput, type SignatureSlot } from "./official-docx.core";
import { officialDocxLayoutFor } from "./official-docx.server";
import { boxFontSize, fitText, type Rect } from "./official-form-pdf.core";

const BLANKS = { piesa: PIESA_BLANK, piisa: PIISA_BLANK } as const;
const INK = rgb(0, 0, 0);
/** Signature pictures: at most 5.5 cm × 2 cm (as in the Word copy); B3 shows the caption only below this height. */
const PIC_MAX_W = 156, PIC_MAX_H = 56, PIC_MIN_H = 12, CAPTION_SIZE = 7, CAPTION_LH = 8.4;
/** Typed signatures never start larger than this (the form's signature field is set in a large handwriting face). */
const SIGNATURE_START = 11;

export type OfficialFormPdf = {
  bytes: Uint8Array;
  filled: string[]; missed: string[]; skipped: string[];
  /** Item ids whose text did not fit its free area even at 6 pt wrapped (still drawn in full). */
  overflow: string[];
  /** Signature slots drawn as pictures / left as typed text because no usable picture was given. */
  embedded: SignatureSlot[]; notEmbedded: SignatureSlot[];
};

const rectOf = (f: FieldBox): Rect => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h });

function drawTick(page: PDFPage, f: FieldBox) {
  const s = Math.min(f.w, f.h), cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  // SVG y runs down from (cx, cy).
  page.drawSvgPath(`M ${-0.3 * s} ${0.02 * s} L ${-0.08 * s} ${0.25 * s} L ${0.32 * s} ${-0.28 * s}`, { x: cx, y: cy, borderColor: INK, borderWidth: 1.1, borderLineCap: LineCapStyle.Round });
}

/** Fills the DEECA form `key` with `answers` as a PDF. `signatures` = the Mitti signature pictures (official-signature.server). */
export async function officialFormPdf(key: OfficialKey, answers: OfficialAnswers, signatures: Partial<Record<SignatureSlot, SignatureInput>> = {}): Promise<OfficialFormPdf> {
  const block = officialFormUseBlocker(key);
  if (block) throw new Error(block);
  const blank = BLANKS[key];
  if (blank.sourceSha256 !== OFFICIAL_TEMPLATES[key].sha256) throw new Error(`The bundled ${key.toUpperCase()} blank PDF was not made from the recorded official original.`);
  const layout = officialDocxLayoutFor(key);
  const v = officialFieldValues(key, layout, answers);
  const filled = [...v.filled], missed = [...v.missed], overflow: string[] = [], embedded: SignatureSlot[] = [], notEmbedded: SignatureSlot[] = [];

  const pdf = await PDFDocument.load(Buffer.from(blank.pdfBase64, "base64"));
  pdf.registerFontkit(fontkit);
  let regular: PDFFont | null = null, signed: PDFFont | null = null;
  const font = async (sig: boolean) => (sig ? (signed ??= await pdf.embedFont(Buffer.from(OPEN_SANS_700_ITALIC, "base64"), { subset: true })) : (regular ??= await pdf.embedFont(Buffer.from(OPEN_SANS_400, "base64"), { subset: true })));
  const pages = pdf.getPages();
  const areas = OFFICIAL_PDF_AREAS[key];

  const draw = async (page: PDFPage, text: string, box: FieldBox | { x: number; y: number; w: number; h: number }, area: Rect, opts: { sig?: boolean; start?: number; id: string }) => {
    const f = await font(!!opts.sig);
    const charset = new Set(f.getCharacterSet());
    const safe = text.split("\n").map((l) => pdfSafeText(l, charset)).join("\n");
    const fit = fitText(safe, box, area, (t, s) => f.widthOfTextAtSize(t, s), opts.start ?? boxFontSize(box.h));
    if (fit.overflow) overflow.push(opts.id);
    for (const l of fit.lines) if (l.text) page.drawText(l.text, { x: l.x, y: l.y, size: fit.size, font: f, color: INK });
  };

  // Ticks.
  for (const [n, on] of v.boxes) if (on) drawTick(pages[blank.fields[n]!.page]!, blank.fields[n]!);

  // Signature pictures (decision 336). A slot whose item is skipped (its condition is false) shows nothing.
  const fieldOf = (id: string) => layout.slots.get(id)?.fields[0]?.n;
  for (const slot of SIGNATURE_SLOTS[key]) {
    const sig = signatures[slot];
    if (!sig || v.skipped.includes(slot)) continue;
    const isB3 = slot === "b3.signature";
    const n = isB3 ? fieldOf("b3.declaration") : fieldOf(slot);
    if (n == null) { missed.push(slot); continue; }
    const page = pages[blank.fields[n]!.page]!;
    const area = isB3 ? areas["b3.signature"]! : areas[`hiv${n}`]!;
    const pics: { img: PDFImage; w: number; h: number }[] = [];
    let signedOn = "";
    for (const im of sig.images) {
      const size = imagePixelSize(im.bytes);
      if (!size) continue;
      const img = size.type === "png" ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes);
      pics.push({ img, w: size.w, h: size.h });
      signedOn = signedOn || im.signedOn;
    }
    const maxH = Math.min(PIC_MAX_H, area.y1 - area.y0 - CAPTION_LH - 1);
    if (!pics.length) {
      notEmbedded.push(slot);
      if (isB3 && sig.fallbackText) await draw(page, sig.fallbackText, { x: area.x0, y: area.y1 - 10, w: 0, h: 10 }, area, { id: slot, start: 8 });
      continue;
    }
    const caption = signedInMittiCaption(signedOn);
    let bottom = area.y1;
    if (maxH >= PIC_MIN_H) {
      const each = Math.min(PIC_MAX_W, (area.x1 - area.x0 - 4 * (pics.length - 1)) / pics.length);
      let x = area.x0 + 1;
      for (const p of pics) {
        const s = Math.min(each / p.w, maxH / p.h);
        const w = p.w * s, h = p.h * s;
        page.drawImage(p.img, { x, y: area.y1 - 0.5 - h, width: w, height: h });
        bottom = Math.min(bottom, area.y1 - 0.5 - h);
        x += w + 4;
      }
    } else if (!isB3) { notEmbedded.push(slot); continue; }
    // The caption replaces any typed text for the same box (as in the Word copy).
    if (!isB3) v.texts.delete(n);
    await draw(page, caption, { x: area.x0, y: bottom - CAPTION_LH, w: 0, h: CAPTION_LH }, { ...area, y1: bottom }, { id: slot, start: CAPTION_SIZE });
    if (!isB3 && !filled.includes(slot)) filled.push(slot);
    embedded.push(slot);
  }

  // Text fields (typed signatures in bold italic).
  const items = answerItems(key);
  const itemAt = new Map<number, { id: string; signature: boolean }>();
  for (const [id, s] of layout.slots) itemAt.set(s.fields[0]!.n, { id, signature: items.find((i) => i.id === id.split("#")[0])?.kind === "signature" });
  for (const [n, text] of v.texts) {
    const f = blank.fields[n]!, it = itemAt.get(n);
    await draw(pages[f.page]!, text, f, areas[`hiv${n}`] ?? rectOf(f), { id: it?.id ?? `hiv${n}`, sig: !!it?.signature, ...(it?.signature ? { start: Math.min(SIGNATURE_START, boxFontSize(f.h)) } : {}) });
  }

  const bytes = await pdf.save();
  return { bytes, filled, missed, skipped: v.skipped, overflow, embedded, notEmbedded };
}
