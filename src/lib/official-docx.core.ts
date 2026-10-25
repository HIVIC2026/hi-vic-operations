// Fills the official March 2026 DEECA Word forms (legacy FORMTEXT / FORMCHECKBOX fields) from expanded
// answers. PURE string surgery on word/document.xml — no I/O, no zip handling (that's official-docx.server.ts).
// Rules:
// - The form's wording is never altered; only field results (text) and check-box states are written.
// - A null/blank answer leaves the field exactly as the blank form has it.
// - Dates are written as DD/MM/YYYY text. A signature box gets the typed electronic signature
//   ("Name (signed electronically on DD/MM/YYYY)", official-forms.core `electronicSignature`) when the answers carry one.
//
// Decision 329 (25 Oct 2026) — how a field is found. The form is read ONCE into a layout map (item id → its own fields), from
// every item in form order, before anything is written:
// - each item's label is located in document order (cursor), then it CLAIMS the first unclaimed field(s) after the label of
//   the right kind. Claiming (not "first field after the label") is what keeps the three main-switch sub-rows apart: their
//   labels sit in one cell and their Yes/No pairs in the next, so every sub-row would otherwise land on the first pair;
// - a Yes/No (and N/A) group is a run of check boxes whose OWN following text is "Yes", "No", "N/A" — the text is read across
//   space and tab runs (the form puts a space run between the No box and the word "No", and a tab run between B1/B2/
//   declaration boxes and their wording);
// - a repeating table (Part 7, PIISA additional installers) takes rows × columns text fields after its first header in
//   row-major order, so Appliance / Location / Hazard each get their own cell;
// - "Is the main switch for the premises:" has no box on the Word form (WORD_FORM_NO_FIELD): it is derived and reported, never
//   written onto a sub-row.
// Check boxes are set through their own `w:default` + `w:checked` (the Section C declaration carries `w:checked="0"` in the
// original, which overrides `w:default`); no glyph run is inserted, so a run is never nested inside another run.
import { answerItems, splitSelections, type OfficialAnswers, type OfficialItem, type OfficialKey, type Value } from "./official-forms.core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&");
const norm = (s: string) => unesc(s).toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
const txt = (v: Value) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
const ticked = (v: Value) => v === true || /^(yes|true|ticked|checked)$/i.test(txt(v));
const dateOut = (v: Value) => { const s = txt(v); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

/** Items the Word form prints without a field of their own (derived answers): never written, reported in `notOnForm`. */
export const WORD_FORM_NO_FIELD: Record<OfficialKey, string[]> = {
  // "Is the main switch for the premises:" — the form has an empty line where a box would be; its answer is derived from the
  // three sub-items ("If any of the above items are marked NO, the overall question will be marked as NO").
  piesa: ["p2.switch"],
  piisa: [],
};

export type DocxField = {
  /** Order in the document (0-based). */ n: number;
  kind: "check" | "text";
  /** The `<w:checkBox>…</w:checkBox>` element (check) — replaced to set the state. */ cbStart: number; cbEnd: number;
  /** The field result between the separate and end runs (text) — replaced with the value. */ resStart: number; resEnd: number;
  /** Paragraph index the field begins in. */ para: number;
  /** The text right after the field (up to the next field or the paragraph end), across space/tab runs. */ after: string;
};
type Para = { start: number; end: number; text: string };

function paragraphs(xml: string): Para[] {
  const out: Para[] = [];
  const re = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ start: m.index, end: m.index + m[0].length, text: [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => unesc(t[1]!)).join("") });
  return out;
}
/** Start of the `<w:r>` / `<w:r …>` element that contains `idx` (never `<w:rPr>` / `<w:rFonts>`). */
function runStart(xml: string, idx: number): number {
  for (let i = xml.lastIndexOf("<w:r", idx); i >= 0; i = xml.lastIndexOf("<w:r", i - 1)) if (xml[i + 4] === ">" || xml[i + 4] === " ") return i;
  return -1;
}

/** Every legacy form field (FORMCHECKBOX / FORMTEXT) in document order. */
export function docxFields(xml: string): DocxField[] {
  const paras = paragraphs(xml);
  const paraOf = (o: number) => { let lo = 0, hi = paras.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (paras[mid]!.start <= o) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };
  const out: DocxField[] = [];
  const BEGIN = '<w:fldChar w:fldCharType="begin">';
  for (let b = xml.indexOf(BEGIN); b >= 0; b = xml.indexOf(BEGIN, b + 1)) {
    const ffEnd = xml.indexOf("</w:fldChar>", b);
    const ff = xml.slice(b, ffEnd);
    const kind = ff.includes("<w:checkBox>") ? "check" : ff.includes("<w:textInput") ? "text" : null;
    if (!kind) continue;
    const sep = xml.indexOf('w:fldCharType="separate"', b);
    const end = xml.indexOf('w:fldCharType="end"', b);
    if (sep < 0 || end < 0 || sep > end) continue;
    const resStart = xml.indexOf("</w:r>", sep) + "</w:r>".length;
    const resEnd = runStart(xml, end);
    const cbStart = kind === "check" ? xml.indexOf("<w:checkBox>", b) : -1;
    const cbEnd = kind === "check" ? xml.indexOf("</w:checkBox>", b) + "</w:checkBox>".length : -1;
    const para = paraOf(b);
    const afterEnd = xml.indexOf("</w:r>", end) + "</w:r>".length;
    const next = xml.indexOf(BEGIN, afterEnd);
    const stop = Math.min(paras[para]?.end ?? xml.length, next < 0 ? xml.length : next);
    const after = [...xml.slice(afterEnd, stop).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => unesc(t[1]!)).join("");
    out.push({ n: out.length, kind, cbStart, cbEnd, resStart, resEnd, para, after });
  }
  return out;
}

/** Item id (or `id#row` for table cells) → the field numbers that carry it. Yes/No groups map option → field. */
export type DocxSlot = { id: string; fields: { option: string | null; n: number }[] };
export type DocxLayout = { slots: Map<string, DocxSlot>; unplaced: string[]; notOnForm: string[] };

const optionMatches = (fieldText: string, option: string) => {
  const a = norm(fieldText), b = norm(option);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
};

/** Reads the form's layout once: which field(s) belong to which official item. Pure; independent of any answers. */
export function officialDocxLayout(xml: string, key: OfficialKey): DocxLayout {
  const paras = paragraphs(xml);
  const fields = docxFields(xml);
  const claimed = new Set<number>();
  const slots = new Map<string, DocxSlot>();
  const unplaced: string[] = [];
  const notOnForm: string[] = [];
  let cursor = 0;
  const locate = (label: string): number => {
    const wanted = norm(label);
    const probe = wanted.length > 48 ? wanted.slice(0, 48) : wanted;
    for (let i = cursor; i < paras.length; i++) if (norm(paras[i]!.text).includes(probe)) { cursor = i + 1; return i; }
    return -1;
  };
  const free = (from: number, kind: DocxField["kind"], ok: (f: DocxField) => boolean = () => true) => fields.find((f) => f.para >= from && f.kind === kind && !claimed.has(f.n) && ok(f));
  const claim = (id: string, fs: { option: string | null; f: DocxField }[]) => { for (const x of fs) claimed.add(x.f.n); slots.set(id, { id, fields: fs.map((x) => ({ option: x.option, n: x.f.n })) }); };
  const groups = new Set<string>();
  const items = answerItems(key);
  for (const item of items) {
    if (WORD_FORM_NO_FIELD[key].includes(item.id)) { locate(item.label); notOnForm.push(item.id); continue; }
    if (item.kind === "attachment") { notOnForm.push(item.id); continue; }
    if (item.row) {
      if (groups.has(item.row.group)) { locate(item.label); continue; }
      groups.add(item.row.group);
      const cols = items.filter((i) => i.row?.group === item.row!.group);
      const p = locate(item.label);
      if (p < 0) { unplaced.push(...cols.flatMap((c) => Array.from({ length: item.row!.rows }, (_, r) => `${c.id}#${r}`))); continue; }
      const cells: DocxField[] = [];
      for (let k = 0; k < item.row.rows * cols.length; k++) { const f = free(p, "text"); if (!f) break; claimed.add(f.n); cells.push(f); }
      cells.forEach((f, k) => { const c = cols[k % cols.length]!; const r = Math.floor(k / cols.length); slots.set(`${c.id}#${r}`, { id: `${c.id}#${r}`, fields: [{ option: null, n: f.n }] }); });
      for (let k = cells.length; k < item.row.rows * cols.length; k++) unplaced.push(`${cols[k % cols.length]!.id}#${Math.floor(k / cols.length)}`);
      continue;
    }
    // An item the form prints only through another line (b2.other: the box under "Other (indicate below):") is found there.
    let p = locate(item.label);
    if (p < 0 && item.derivedFrom) p = locate(item.derivedFrom);
    if (p < 0) { unplaced.push(item.id); continue; }
    const k = item.kind;
    if (k === "yesno" || k === "yesno_na") {
      const want = k === "yesno_na" ? ["Yes", "No", "N/A"] : ["Yes", "No"];
      const first = free(p, "check", (f) => norm(f.after) === "yes");
      const group = first ? want.map((o, i) => fields[first.n + i]).filter((f): f is DocxField => !!f && f.kind === "check" && !claimed.has(f.n)) : [];
      if (!first || group.length !== want.length || group.some((f, i) => norm(f.after) !== norm(want[i]!))) { unplaced.push(item.id); continue; }
      claim(item.id, group.map((f, i) => ({ option: want[i]!, f })));
    } else if (k === "choice" || k === "ticks") {
      const fs: { option: string; f: DocxField }[] = [];
      for (const o of item.options ?? []) {
        const f = free(p, "check", (x) => optionMatches(x.after, o) && !fs.some((y) => y.f.n === x.n));
        if (f) fs.push({ option: o, f });
      }
      if (fs.length !== (item.options ?? []).length) { unplaced.push(item.id); continue; }
      claim(item.id, fs);
    } else if (k === "tick") {
      const f = free(p, "check", (x) => optionMatches(x.after, item.label)) ?? free(p, "check");
      if (!f) { unplaced.push(item.id); continue; }
      claim(item.id, [{ option: null, f }]);
    } else if (k === "text" || k === "number" || k === "date" || k === "signature") {
      const f = free(p, "text");
      if (!f) { unplaced.push(item.id); continue; }
      claim(item.id, [{ option: null, f }]);
    }
  }
  return { slots, unplaced, notOnForm };
}

type Edit = { start: number; end: number; text: string };
function checkBoxXml(original: string, on: boolean): string {
  const v = on ? 1 : 0;
  let x = original.replace(/<w:checked(?: w:val="[^"]*")?\/>/g, "");
  x = /<w:default w:val="[^"]*"\/>/.test(x) ? x.replace(/<w:default w:val="[^"]*"\/>/, `<w:default w:val="${v}"/>`) : x.replace(/(<w:size [^>]*\/>|<w:sizeAuto\/>)/, `$1<w:default w:val="${v}"/>`);
  return x.replace(/(<w:default w:val="\d"\/>)/, `$1<w:checked w:val="${v}"/>`);
}
function textRunsXml(xml: string, f: DocxField, value: string): string {
  const res = xml.slice(f.resStart, f.resEnd);
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(res)?.[0] ?? "<w:rPr><w:noProof/></w:rPr>";
  return value.split(/\r?\n/).map((line, i) => `<w:r>${rPr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join("");
}

export type FillResult = { xml: string; filled: string[]; missed: string[]; notOnForm: string[] };

/**
 * Fills word/document.xml for `key` with `answers`. Items are placed through the form's layout map (officialDocxLayout).
 * Answered items the map could not place are reported in `missed`, never guessed; derived items with no field of their own
 * are reported in `notOnForm`.
 */
export function fillOfficialDocxXml(input: string, key: OfficialKey, answers: OfficialAnswers): FillResult {
  const layout = officialDocxLayout(input, key);
  const fields = docxFields(input);
  const edits: Edit[] = [];
  const filled: string[] = [];
  const missed: string[] = [];
  const notOnForm: string[] = [];
  const setBox = (n: number, on: boolean) => { const f = fields[n]!; edits.push({ start: f.cbStart, end: f.cbEnd, text: checkBoxXml(input.slice(f.cbStart, f.cbEnd), on) }); };
  const setText = (n: number, value: string) => { const f = fields[n]!; edits.push({ start: f.resStart, end: f.resEnd, text: textRunsXml(input, f, value) }); };

  const place = (item: OfficialItem, id: string, value: Value) => {
    if (layout.notOnForm.includes(item.id)) { notOnForm.push(id); return; }
    const slot = layout.slots.get(id);
    if (!slot) { missed.push(id); return; }
    const k = item.kind;
    if (k === "text" || k === "number" || k === "date" || k === "signature") {
      const v = k === "date" ? dateOut(value) : txt(value);
      if (!v) return;
      setText(slot.fields[0]!.n, v);
    } else if (k === "yesno" || k === "yesno_na") {
      const v = txt(value);
      const chosen = slot.fields.find((f) => f.option && f.option.toLowerCase() === v.toLowerCase());
      if (!chosen) { missed.push(id); return; }
      for (const f of slot.fields) setBox(f.n, f === chosen);
    } else if (k === "tick") {
      if (!ticked(value)) return;
      setBox(slot.fields[0]!.n, true);
    } else if (k === "choice" || k === "ticks") {
      const { selected, unknown } = splitSelections(value, item.options ?? []);
      if (!selected.length || unknown.length || (k === "choice" && selected.length !== 1)) { missed.push(id); return; }
      for (const f of slot.fields) setBox(f.n, selected.includes(f.option ?? ""));
    } else return;
    filled.push(id);
  };

  for (const item of answerItems(key)) {
    if (item.row) {
      for (let r = 0; r < item.row.rows; r++) { const v = answers[`${item.id}#${r}`]; if (txt(v)) place(item, `${item.id}#${r}`, v); }
      continue;
    }
    const v = answers[item.id];
    if (v == null || txt(v) === "" || (item.kind === "tick" && !ticked(v))) continue;
    place(item, item.id, v);
  }
  edits.sort((a, b) => b.start - a.start);
  let xml = input;
  for (const e of edits) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  return { xml, filled, missed, notOnForm };
}

/** What a filled Word form SHOWS for each item, read back from the XML (tests + the sample read-back). */
export function readOfficialDocx(xml: string, key: OfficialKey, layoutXml: string = xml): Record<string, Value> {
  const layout = officialDocxLayout(layoutXml, key);
  const fields = docxFields(xml);
  const boxOn = (n: number) => {
    const f = fields[n]!;
    const cb = xml.slice(f.cbStart, f.cbEnd);
    const c = /<w:checked(?: w:val="([^"]*)")?\/>/.exec(cb);
    if (c) return c[1] == null || c[1] === "1" || c[1] === "true";
    return /<w:default w:val="1"\/>/.test(cb);
  };
  const textOf = (n: number) => { const f = fields[n]!; return [...xml.slice(f.resStart, f.resEnd).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)].map((t) => (t[0] === "<w:br/>" ? "\n" : unesc(t[1]!))).join("").replace(/^[ \s]+$/, ""); };
  const items = answerItems(key);
  const out: Record<string, Value> = {};
  for (const [id, slot] of layout.slots) {
    const item = items.find((i) => i.id === id.split("#")[0]);
    if (!item) continue;
    if (item.kind === "yesno" || item.kind === "yesno_na" || item.kind === "choice") { const on = slot.fields.filter((f) => boxOn(f.n)); out[id] = on.length === 1 ? on[0]!.option : on.length ? on.map((f) => f.option!) : null; }
    else if (item.kind === "ticks") { const on = slot.fields.filter((f) => boxOn(f.n)).map((f) => f.option!); out[id] = on.length ? on : null; }
    else if (item.kind === "tick") out[id] = boxOn(slot.fields[0]!.n);
    else { const t = textOf(slot.fields[0]!.n); out[id] = t || null; }
  }
  return out;
}

/** Well-formedness problems of an XML string (tags balanced, nothing a run can't hold). Empty = fine. Used by tests/samples. */
export function xmlProblems(xml: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("<?") || m[0].startsWith("<!")) continue;
    if (m[2] == null) { out.push(`malformed tag at ${m.index}: ${m[0].slice(0, 40)}`); if (out.length > 20) break; continue; }
    const name = m[2];
    if (m[1]) {
      const open = stack.pop();
      if (open !== name) { out.push(`</${name}> closes <${open ?? "nothing"}> at ${m.index}`); if (out.length > 20) break; }
    } else if (!m[4]) {
      if (name === "w:r" && stack.includes("w:r")) out.push(`<w:r> nested inside <w:r> at ${m.index}`);
      stack.push(name);
    }
  }
  if (stack.length) out.push(`unclosed: ${stack.slice(-5).join(", ")}`);
  const stray = xml.replace(/<[^>]*>/g, "").match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g);
  if (stray) out.push(`${stray.length} unescaped "&"`);
  return out;
}
