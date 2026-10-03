// Fills the official March 2026 DEECA Word forms (legacy FORMTEXT / FORMCHECKBOX fields) from expanded
// answers. PURE string surgery on word/document.xml — no I/O, no zip handling (that's official-docx.server.ts).
// Rules:
// - The form's wording is never altered; only field results are written.
// - A null/blank answer leaves the field exactly as the blank form has it.
// - Signatures are never written (they live in the signed snapshot); dates are written as DD/MM/YYYY text.
import { answerItems, type OfficialAnswers, type OfficialItem, type OfficialKey, type Value } from "./official-forms.core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, " ");
const norm = (s: string) => unesc(s).toLowerCase().replace(/[  ]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const txt = (v: Value) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
const ticked = (v: Value) => v === true || /^(yes|true|ticked|checked)$/i.test(txt(v));
const dateOut = (v: Value) => { const s = txt(v); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

const CHECKED_RUN = `<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/><w:noProof/></w:rPr><w:t>þ</w:t></w:r>`;

type Seg = { start: number; end: number; text: string };

/** Paragraph/cell segments in document order with their plain text. */
function segments(xml: string): Seg[] {
  const out: Seg[] = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const raw = m[0];
    const text = [...raw.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => unesc(t[1]!)).join("");
    out.push({ start: m.index, end: m.index + raw.length, text });
  }
  return out;
}

/** Fills the first FORMTEXT result at/after `from`; returns the end of the filled field or -1. */
function fillText(xml: string, from: number, value: string): { xml: string; at: number } {
  const re = /<w:fldChar w:fldCharType="begin">\s*<w:ffData>(?:(?!<w:fldChar)[\s\S])*?<w:textInput\/>(?:(?!<w:fldChar)[\s\S])*?<\/w:fldChar>\s*<\/w:r>(?:<w:bookmarkStart[^/]*\/>)?<w:r[^>]*>\s*<w:instrText[^>]*>\s*FORMTEXT\s*<\/w:instrText>\s*<\/w:r>\s*<w:r[^>]*>\s*<w:fldChar w:fldCharType="separate"\/>\s*<\/w:r>([\s\S]*?)<w:r[^>]*>\s*<w:fldChar w:fldCharType="end"\/>\s*<\/w:r>/g;
  re.lastIndex = from;
  const m = re.exec(xml);
  if (!m) return { xml, at: -1 };
  const replacement = `<w:r><w:rPr><w:noProof/></w:rPr><w:t xml:space="preserve">${esc(value)}</w:t></w:r>`;
  const xml2 = xml.slice(0, m.index) + m[0].replace(m[1]!, replacement) + xml.slice(m.index + m[0].length);
  return { xml: xml2, at: m.index + m[0].length };
}

/** Sets the FORMCHECKBOX whose result is immediately followed by `label` (e.g. " Yes"). Returns end offset or -1. */
function setCheckbox(xml: string, from: number, label: string, on: boolean): { xml: string; at: number } {
  const re = /(<w:fldChar w:fldCharType="begin">\s*<w:ffData>(?:(?!<w:fldChar)[\s\S])*?<w:checkBox>(?:(?!<w:fldChar)[\s\S])*?<\/w:checkBox>(?:(?!<w:fldChar)[\s\S])*?<\/w:ffData>\s*<\/w:fldChar>\s*<\/w:r>)(?:<w:bookmarkStart[^/]*\/>)?(?:<w:r[^>]*>\s*<w:instrText[^>]*>\s*FORMCHECKBOX\s*<\/w:instrText>\s*<\/w:r>)?\s*<w:r[^>]*>\s*<w:fldChar w:fldCharType="separate"\/>\s*<\/w:r>([\s\S]*?)(<w:r[^>]*>\s*<w:fldChar w:fldCharType="end"\/>\s*<\/w:r>)(?:<w:bookmarkEnd[^/]*\/>)?\s*<w:r[^>]*>\s*<w:t[^>]*>([^<]*)<\/w:t>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  const wanted = norm(label);
  while ((m = re.exec(xml))) {
    if (norm(m[4]!) !== wanted) continue;
    let block = m[0];
    block = block.replace(/<w:default w:val="\d"\/>/, `<w:default w:val="${on ? 1 : 0}"/>`);
    if (on) block = block.replace(m[2]!, m[2]! + CHECKED_RUN);
    const xml2 = xml.slice(0, m.index) + block + xml.slice(m.index + m[0].length);
    return { xml: xml2, at: m.index + block.length };
  }
  return { xml, at: -1 };
}

/** Ticks the first FORMCHECKBOX at/after `from` (for standalone tick declarations). */
function tickBox(xml: string, from: number, on: boolean): { xml: string; at: number } {
  const re = /<w:fldChar w:fldCharType="begin">\s*<w:ffData>(?:(?!<w:fldChar)[\s\S])*?<w:checkBox>(?:(?!<w:fldChar)[\s\S])*?<\/w:checkBox>(?:(?!<w:fldChar)[\s\S])*?<\/w:ffData>\s*<\/w:fldChar>\s*<\/w:r>(?:<w:bookmarkStart[^/]*\/>)?(?:<w:r[^>]*>\s*<w:instrText[^>]*>\s*FORMCHECKBOX\s*<\/w:instrText>\s*<\/w:r>)?\s*<w:r[^>]*>\s*<w:fldChar w:fldCharType="separate"\/>\s*<\/w:r>([\s\S]*?)(<w:r[^>]*>\s*<w:fldChar w:fldCharType="end"\/>\s*<\/w:r>)/g;
  re.lastIndex = from;
  const m = re.exec(xml);
  if (!m) return { xml, at: -1 };
  let block = m[0].replace(/<w:default w:val="\d"\/>/, `<w:default w:val="${on ? 1 : 0}"/>`);
  if (on) block = block.replace(m[1]!, m[1]! + CHECKED_RUN);
  return { xml: xml.slice(0, m.index) + block + xml.slice(m.index + m[0].length), at: m.index + block.length };
}

export type FillResult = { xml: string; filled: string[]; missed: string[] };

/**
 * Fills word/document.xml for `key` with `answers`. Items are located in document order by their
 * verbatim labels (duplicate labels are matched in order). Missed items are reported, never guessed.
 */
export function fillOfficialDocxXml(input: string, key: OfficialKey, answers: OfficialAnswers): FillResult {
  let xml = input;
  const filled: string[] = [];
  const missed: string[] = [];
  let segs = segments(xml);
  let segCursor = 0;
  let charCursor = 0;

  const locate = (label: string): number => {
    const wanted = norm(label);
    const probe = wanted.length > 48 ? wanted.slice(0, 48) : wanted;
    for (let i = segCursor; i < segs.length; i++) {
      if (norm(segs[i]!.text).includes(probe)) { segCursor = i + 1; return segs[i]!.start; }
    }
    return -1;
  };

  const fillOne = (item: OfficialItem, id: string, value: Value) => {
    const at = locate(item.label);
    if (at < 0) { missed.push(id); return; }
    const from = Math.max(at, 0);
    const kind = item.kind;
    if (kind === "text" || kind === "number" || kind === "date") {
      const v = kind === "date" ? dateOut(value) : txt(value);
      if (!v) return; // blank stays blank
      const r = fillText(xml, from, v);
      if (r.at < 0) missed.push(id); else { xml = r.xml; filled.push(id); charCursor = r.at; segs = segments(xml); }
    } else if (kind === "yesno" || kind === "yesno_na") {
      const v = txt(value);
      if (!/^(yes|no|n\/a)$/i.test(v)) return;
      // Yes/No checkboxes follow the label; N/A is a third checkbox when present.
      const r1 = setCheckbox(xml, from, " Yes", /^yes$/i.test(v));
      if (r1.at < 0) { missed.push(id); return; }
      xml = r1.xml;
      const r2 = setCheckbox(xml, r1.at, "No", /^no$/i.test(v));
      if (r2.at >= 0) xml = r2.xml;
      if (kind === "yesno_na") { const r3 = setCheckbox(xml, r2.at >= 0 ? r2.at : r1.at, "N/A", /^n\/a$/i.test(v)); if (r3.at >= 0) xml = r3.xml; }
      filled.push(id);
      segs = segments(xml);
    } else if (kind === "tick") {
      if (!ticked(value)) return;
      const r = tickBox(xml, from, true);
      if (r.at < 0) missed.push(id); else { xml = r.xml; filled.push(id); }
    } else if (kind === "ticks" || kind === "choice") {
      const chosen = Array.isArray(value) ? value.map(String) : txt(value) ? [txt(value)] : [];
      if (!chosen.length) return;
      let ok = true;
      for (const opt of chosen) {
        const r = setCheckbox(xml, from, ` ${opt}`.replace(/\s+/g, " ").trimEnd() === opt ? opt : opt, true);
        // options in the form follow their checkbox; match on the option's own text
        const rr = r.at >= 0 ? r : setCheckbox(xml, from, opt, true);
        if (rr.at < 0) { ok = false; } else xml = rr.xml;
      }
      if (ok) filled.push(id); else missed.push(id);
      segs = segments(xml);
    } else if (kind === "attachment" || kind === "signature") {
      // Attachments live in private storage; signatures in the signed snapshot. The Word form keeps its blank line.
    }
  };

  for (const item of answerItems(key)) {
    if (item.row) {
      // Repeating table: fill each answered row's cell under this column.
      for (let r = 0; r < item.row.rows; r++) {
        const v = answers[`${item.id}#${r}`];
        if (!txt(v)) continue;
        const at = locate(item.label);
        if (at < 0) { missed.push(`${item.id}#${r}`); break; }
        const res = fillText(xml, at, txt(v));
        if (res.at < 0) missed.push(`${item.id}#${r}`); else { xml = res.xml; filled.push(`${item.id}#${r}`); segs = segments(xml); }
      }
      continue;
    }
    const v = answers[item.id];
    // Unanswered items are skipped WITHOUT touching the document cursor — locating them would
    // advance past their labels and break later lookups (and they must stay blank anyway).
    if (v == null || txt(v) === "") continue;
    fillOne(item, item.id, v);
  }
  return { xml, filled, missed };
}
