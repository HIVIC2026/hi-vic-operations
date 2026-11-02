// Task 12: where filled text goes on the DEECA blank PDFs. PURE (measuring is passed in).
// Rule (controller ruling, 3 Nov 2026): a value is drawn on its field's own line at the form's field size; if it is too long
// it wraps inside the field's free area when that area has room for 2+ lines, else it shrinks (6 pt minimum) and then wraps (the right edge of its
// table cell or the page margin, never over DEECA's printed text, see official-pdf-areas.data.ts). Text is never cut: if even
// 6 pt wrapped does not fit, it is drawn anyway at 6 pt and reported as overflow.
import { wrapText } from "./pdf-look.core";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type FieldRect = { x: number; y: number; w: number; h: number };
export type TextFit = { size: number; lines: { text: string; x: number; y: number }[]; overflow: boolean };

export const MIN_TEXT_SIZE = 6;
/** Glyph extent above / below the baseline (em) used to keep drawn text inside its area; one line = 1.2 em. */
export const ASCENT = 0.8, DESCENT = 0.25, LINE = 1.2;
const PAD = (LINE - ASCENT - DESCENT) / 2;
/** The Word field's own font size, from its measured line box (the forms' Arial/Liberation Sans line = 1.117 em). */
export const boxFontSize = (h: number) => Math.round((h / 1.117) * 2) / 2;
/** Baseline of the field's own line: the measured box bottom plus the font's descent (0.212 of 1.117). */
const boxBaseline = (box: FieldRect) => box.y + box.h * 0.19;

export function fitText(text: string, box: FieldRect, area: Rect, width: (s: string, size: number) => number, start: number): TextFit {
  const W = area.x1 - area.x0, H = area.y1 - area.y0;
  const sizes: number[] = [];
  for (let s = Math.max(start, MIN_TEXT_SIZE); s >= MIN_TEXT_SIZE - 1e-9; s -= 0.5) sizes.push(s);
  // One-line rows: shrink first. Areas with room for 2+ lines at the starting size: wrap first (below), then shrink.
  const multiLine = H >= 2 * LINE * Math.max(start, MIN_TEXT_SIZE);
  if (!multiLine && !text.includes("\n")) {
    for (const s of sizes) {
      if (width(text, s) > W) continue;
      let y = boxBaseline(box);
      if (y + ASCENT * s > area.y1) y = area.y1 - ASCENT * s;
      if (y - DESCENT * s < area.y0) y = area.y0 + DESCENT * s;
      if (y + ASCENT * s > area.y1 + 1e-6) continue;
      return { size: s, lines: [{ text, x: area.x0, y }], overflow: false };
    }
  }
  const stack = (s: number, lines: string[], top: number) => lines.map((t, i) => ({ text: t, x: area.x0, y: top - (ASCENT + PAD) * s - i * LINE * s }));
  for (const s of sizes) {
    const lines = wrapText(text, (t) => width(t, s), W);
    const need = lines.length * LINE * s;
    if (need > H) continue;
    const top = Math.min(area.y1, Math.max(boxBaseline(box) + (ASCENT + PAD) * s, area.y0 + need));
    return { size: s, lines: stack(s, lines, top), overflow: false };
  }
  return { size: MIN_TEXT_SIZE, lines: stack(MIN_TEXT_SIZE, wrapText(text, (t) => width(t, MIN_TEXT_SIZE), W), area.y1), overflow: true };
}
