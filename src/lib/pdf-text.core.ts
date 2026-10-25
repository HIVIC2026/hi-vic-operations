// Decision 329: text for the built-in PDF font (Helvetica, WinAnsi). PURE. A character the font can draw is kept as it is
// (’ “ ” – — • ² …); anything else maps to the closest plain text, so "don’t" never prints as "don-t".
const CLOSEST: Record<string, string> = {
  "‘": "'", "’": "'", "‛": "'", "′": "'", "“": '"', "”": '"', "„": '"', "″": '"',
  "–": "-", "—": "-", "‐": "-", "‑": "-", "−": "-",
  "✓": "[x]", "✔": "[x]", "☑": "[x]", "☐": "[ ]", "✗": "x", "✘": "x",
  "…": "...", "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "×": "x", "²": "2", "³": "3", "•": "-", "·": "-",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "\t": " ",
};
/** `supported` = the font's code points (pdf-lib `font.getCharacterSet()`); omitted = plain ASCII only. */
export function pdfSafeText(s: string, supported?: Set<number>): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (supported?.has(cp) && cp >= 0x20)) { out += ch; continue; }
    const m = CLOSEST[ch];
    if (m != null && [...m].every((c) => { const p = c.codePointAt(0)!; return (p >= 0x20 && p <= 0x7e) || !!supported?.has(p); })) { out += m; continue; }
    if (m != null) { out += pdfSafeText(m); continue; }
    out += cp < 0x20 ? " " : "?";
  }
  return out;
}
