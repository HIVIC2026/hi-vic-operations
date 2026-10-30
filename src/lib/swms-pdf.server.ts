// Decision 358 (Jo 25 Oct 2026): the filed SWMS PDF in the WorkSafe Victoria sample-template layout
// (Safe-work-method-statements-2023-07) — header box, bordered Tasks | Hazard | Control measures | How implemented |
// Responsible table (cells wrap, rows split across pages, header row repeated), "How these are put in place", "Specific to
// this house" and the sign-off table. Same words as `swmsRecordText` (swms.core.ts), which stays the content-hash source
// for `fileSwms`. No database, no network: pdf-lib standard fonts only, every string through `pdfSafeText`.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafeText } from "./pdf-text.core";
import {
  SWMS_COMPLIANCE_MEASURES, SWMS_HOW_IMPLEMENTED, SWMS_HOW_IN_PLACE, SWMS_RECORD_TASK, SWMS_REVIEW, SWMS_SIGN_STATEMENT,
  latestSignatures, swmsDate, swmsDateTime, swmsHouseSection, type SwmsPlan, type SwmsSignature,
} from "./swms.core";

/** A4 landscape. */
export const SWMS_PAGE = { width: 842, height: 595, margin: 28, footer: 18 } as const;
export const SWMS_TABLE_HEADERS = ["Tasks", "Hazard", "Control measures", "How implemented", "Responsible"] as const;
export const SWMS_SIGNOFF_HEADERS = ["Name", "Signature (typed name)", "Date"] as const;
const MAIN_WIDTHS = [128, 150, 252, 170, 86];
const SIGN_WIDTHS = [300, 300, 186];
const PAD = 4;
const SIZE = 8.5;
const LH = 10.5;
/** Rows of up to this many lines are never split across pages. */
const KEEP_TOGETHER = 10;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.35, 0.38, 0.44);
const LINE = rgb(0.45, 0.48, 0.53);
const HEAD_FILL = rgb(0.86, 0.9, 0.95);
const LABEL_FILL = rgb(0.95, 0.96, 0.98);
const BAND = rgb(0.11, 0.23, 0.4);

/** Pure word wrap: explicit newlines kept, words wider than the cell broken by character. */
export function wrapText(text: string, width: (s: string) => number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (width(cand) <= max) { line = cand; continue; }
      if (line) out.push(line);
      line = "";
      let w = word;
      while (width(w) > max && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && width(w.slice(0, n)) > max) n--;
        out.push(w.slice(0, n)); w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Pure: how many body lines of a row fit in `space` points (cell padding top+bottom included); 0 = start a new page. */
export function linesThatFit(space: number, lineH = LH, pad = PAD): number {
  return Math.max(0, Math.floor((space - 2 * pad) / lineH));
}

type Cell = { text: string; bold?: boolean; italic?: boolean; fill?: ReturnType<typeof rgb>; label?: string };
export type SwmsPdfLayout = { pages: number; mainHeaderPages: number[]; signoffHeaderPages: number[]; noteHeaderPages: number[] };

export async function buildSwmsPdf(plan: SwmsPlan, sigs: SwmsSignature[], opts: { recordRef?: string | null } = {}): Promise<{ bytes: Uint8Array; layout: SwmsPdfLayout }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Safe Work Method Statement — Job ${plan.jobNumber}`.replace("—", "-"));
  pdf.setSubject("SWMS — ceiling insulation (VEU Activity 48)".replace("—", "-"));
  pdf.setProducer("Home Insulation Victoria portal");
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const charset = new Set(reg.getCharacterSet());
  const safe = (s: string) => pdfSafeText(s, charset);
  const fontOf = (c: { bold?: boolean; italic?: boolean }): PDFFont => (c.bold ? bold : c.italic ? ital : reg);
  const { width: W, height: H, margin: M, footer: F } = SWMS_PAGE;
  const CW = W - 2 * M;
  const bottom = M + F;
  const layout: SwmsPdfLayout = { pages: 0, mainHeaderPages: [], signoffHeaderPages: [], noteHeaderPages: [] };
  const val = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
  const lead = plan.signers.find((s) => s.role === "lead")?.name ?? null;

  let page!: PDFPage;
  let y = 0;
  let onNewPage: (() => void) | null = null;
  const newPage = () => {
    page = pdf.addPage([W, H]); y = H - M; layout.pages++;
    // Running head on every page after the first.
    if (layout.pages > 1) {
      page.drawText(safe(`Safe Work Method Statement — Job ${plan.jobNumber} (continued)`), { x: M, y: y - 9, size: 9, font: bold, color: MUTED });
      y -= 18;
    }
    onNewPage?.();
  };
  const wrapCell = (c: Cell, w: number) => {
    const lines = wrapText(c.text.split("\n").map(safe).join("\n"),(s) => fontOf(c).widthOfTextAtSize(s, SIZE), w - 2 * PAD);
    return c.label ? [`\u0000${safe(c.label)}`, ...lines] : lines;
  };
  const drawCells = (cells: Cell[], widths: number[], lines: string[][], h: number) => {
    let x = M;
    cells.forEach((c, i) => {
      const w = widths[i]!;
      page.drawRectangle({ x, y: y - h, width: w, height: h, ...(c.fill ? { color: c.fill } : {}), borderColor: LINE, borderWidth: 0.6 });
      let ly = y - PAD - SIZE + 1;
      for (const ln of lines[i]!) {
        if (ln.startsWith("\u0000")) page.drawText(ln.slice(1).toUpperCase(), { x: x + PAD, y: ly + 1, size: 6.5, font: bold, color: MUTED });
        else page.drawText(ln, { x: x + PAD, y: ly, size: SIZE, font: fontOf(c), color: INK });
        ly -= LH;
      }
      x += w;
    });
    y -= h;
  };
  /** One table row; split line by line across pages when it doesn't fit (the page hook redraws the header row). */
  const row = (cells: Cell[], widths: number[]) => {
    let rest = cells.map((c, i) => wrapCell(c, widths[i]!));
    for (;;) {
      const need = Math.max(...rest.map((l) => l.length), 1);
      const fit = linesThatFit(y - bottom);
      if (fit >= need) { drawCells(cells, widths, rest, need * LH + 2 * PAD); return; }
      // A short row moves whole to the next page; a long one (e.g. a long site note) fills this page and carries on.
      if (fit < 2 || need <= KEEP_TOGETHER) { newPage(); if (linesThatFit(y - bottom) >= need) continue; }
      const n = Math.max(1, linesThatFit(y - bottom));
      drawCells(cells, widths, rest.map((l) => l.slice(0, n)), n * LH + 2 * PAD);
      rest = rest.map((l) => l.slice(n));
      newPage();
    }
  };
  const headerRow = (labels: readonly string[], widths: number[], track: number[]) => {
    track.push(layout.pages);
    const cells = labels.map((t) => ({ text: t, bold: true, fill: HEAD_FILL }));
    drawCells(cells, widths, cells.map((c, i) => wrapCell(c, widths[i]!)), LH + 2 * PAD);
  };
  const table = (labels: readonly string[], widths: number[], track: number[], rows: Cell[][]) => {
    if (y - bottom < 3 * (LH + 2 * PAD)) newPage();
    const hook = () => headerRow(labels, widths, track);
    hook();
    onNewPage = hook;
    for (const r of rows) row(r, widths);
    onNewPage = null;
  };
  const gap = (h: number) => { y -= h; };
  const heading = (t: string) => {
    if (y - bottom < 40) newPage();
    page.drawText(safe(t), { x: M, y: y - 10, size: 10, font: bold, color: BAND });
    y -= 15;
  };

  // ── Title band ──
  newPage();
  page.drawRectangle({ x: M, y: y - 34, width: CW, height: 34, color: BAND });
  page.drawText(safe("Safe Work Method Statement (SWMS)"), { x: M + 10, y: y - 21, size: 15, font: bold, color: rgb(1, 1, 1) });
  const sub = safe(`Ceiling insulation (VEU Activity 48) — Job ${plan.jobNumber}`);
  page.drawText(sub, { x: W - M - 10 - reg.widthOfTextAtSize(sub, 10), y: y - 21, size: 10, font: reg, color: rgb(1, 1, 1) });
  y -= 42;

  // ── Header box (WorkSafe sample template order) ──
  const half = [CW / 2, CW / 2];
  const pair = (a: string, av: string, b: string, bv: string): Cell[] => [{ label: a, text: av }, { label: b, text: bv }];
  row(pair("Business (direct employer)", val(plan.businessName), "Principal contractor", plan.principalContractor), half);
  row(pair("Work supervisor", val(lead), "Install date", swmsDate(plan.installDate)), half);
  row(pair("Site location / address", val(plan.address), "Work activity", plan.workActivity), half);
  row([{ label: "High-risk construction work", text: plan.highRiskWork.map((h) => `• ${h}`).join("\n") }], [CW]);
  row(pair("Person responsible for ensuring compliance with SWMS", val(lead), "Measures to ensure compliance", SWMS_COMPLIANCE_MEASURES), half);
  row([{ label: "How control measures will be reviewed", text: SWMS_REVIEW }], [CW]);
  gap(12);

  // ── Hazard / control table ──
  heading("Tasks, hazards and control measures");
  table(SWMS_TABLE_HEADERS, MAIN_WIDTHS, layout.mainHeaderPages, plan.hazards.map((h) => [
    { text: SWMS_RECORD_TASK }, { text: h.name, bold: true }, { text: `${h.short}: ${h.control}.` }, { text: SWMS_HOW_IMPLEMENTED }, { text: `${val(lead)} (lead installer)` },
  ]));
  gap(8);
  row([{ text: SWMS_HOW_IN_PLACE, fill: LABEL_FILL }], [CW]);
  gap(12);

  // ── Specific to this house ──
  // Jo 30 Oct 2026: house facts, then "Safety step:" lines, then the installer's note — one row each (rows split across pages).
  const house = swmsHouseSection(plan);
  table(["Specific to this house"], [CW], layout.noteHeaderPages, house.length ? house.map((t) => [{ text: t, bold: t.startsWith("Safety step:") }]) : [[{ text: "None recorded" }]]);
  gap(12);

  // ── Sign-off ──
  heading(`Worker sign-off (${SWMS_SIGN_STATEMENT})`);
  const by = latestSignatures(sigs);
  table(SWMS_SIGNOFF_HEADERS, SIGN_WIDTHS, layout.signoffHeaderPages, plan.signers.map((s) => {
    const g = by.get(s.key);
    return [
      { text: `${s.name} (${s.role === "lead" ? "lead installer" : "installer"})` },
      g ? { text: `signed — typed "${g.typedName}"`, italic: true } : { text: "NOT SIGNED", bold: true },
      { text: g ? `${swmsDateTime(g.signedAt)} (Melbourne time)` : "—" },
    ];
  }));

  // ── Footer: page n of N ──
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const left = safe(`Job ${plan.jobNumber} · Safe Work Method Statement · ${plan.rule}${opts.recordRef ? ` · ${opts.recordRef}` : ""}`);
    const right = `Page ${i + 1} of ${pages.length}`;
    p.drawLine({ start: { x: M, y: M + 10 }, end: { x: W - M, y: M + 10 }, thickness: 0.5, color: LINE });
    p.drawText(left, { x: M, y: M, size: 7, font: reg, color: MUTED });
    p.drawText(right, { x: W - M - reg.widthOfTextAtSize(right, 7), y: M, size: 7, font: reg, color: MUTED });
  });
  return { bytes: await pdf.save(), layout };
}
