// Website-look PDF kit: tokens, block types and pure layout rules. PURE (no pdf-lib): drawing lives in pdf-look.server.ts.
// Sizes are points; the approved samples (docs/approved-samples/2026-11-02) are 600px wide, so 1px = 0.75pt.

export const PDF_PAGE = { width: 450, height: 636.96, top: 22.5, side: 30, bottom: 34.5, firstTop: 0 } as const;
export const PDF_COLOURS = { blue: "#3c51c4", navy: "#22376b", green: "#07bf61", box: "#eef0fc", muted: "#5d6785", ink: "#22376b" } as const;
export const PDF_FOOTER_LEFT = "Home Insulation Victoria · Accredited Person A003654 under the Victorian Energy Upgrades program";
export const BUSINESS_LINES: readonly string[] = [
  "DC Construction Solutions Pty Ltd",
  "trading as Home Insulation Victoria",
  "ABN 44 671 613 979 · Accredited Person A003654",
  "info@homeinsulationvictoria.com.au",
];
export const BUSINESS_ADDRESS = "1/33 Altree Court, Phillip ACT 2606";

export type PdfBlock = { id: string; keepTogether?: boolean } & (
  | { kind: "header"; eyebrow: string; withAddress?: boolean }
  | { kind: "title"; text: string; sub?: string }
  | { kind: "para"; text: string; muted?: boolean; small?: boolean }
  | { kind: "facts"; rows: [string, string][] }
  | { kind: "section"; number?: string; title: string; children: PdfBlock[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "money"; rows: { label: string; amount: string; strong?: boolean; green?: boolean }[] }
  | { kind: "ticks"; items: string[] }
  | { kind: "signature"; label: string; name: string; at: string; sub?: string }
  | { kind: "box"; children: PdfBlock[] }
  | { kind: "image"; bytes: Uint8Array; width: number; height: number }
  | { kind: "pageBreak" }
);
export type PdfDoc = { title: string; blocks: PdfBlock[] };
export type PdfLayoutReport = {
  pages: number;
  blockPage: Record<string, number>;
  split: string[];
  topBarPages: number[];
  /** Every embedded picture except the logo. */
  images: { block: string; page: number }[];
};

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

const EPS = 0.01;

/** Pure: groups of child indexes per page. The first group has `firstSpace`, later ones `pageSpace`; a child taller than a page sits alone. */
export function packChildren(childHeights: number[], firstSpace: number, pageSpace: number): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let left = firstSpace;
  childHeights.forEach((h, i) => {
    if (cur.length > 0 && h > left + EPS) { groups.push(cur); cur = []; left = pageSpace; }
    cur.push(i); left -= h;
  });
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export type PaginateItem = { id: string; height: number; keepTogether: boolean; childHeights?: number[]; pageBreak?: boolean };
export type PaginateResult = { page: number; id: string; part?: number };
/** Same as PaginateResult, plus the child indexes drawn on this page for a split block (the renderer draws exactly these). */
export type PaginatePlacement = PaginateResult & { children?: number[] };

/**
 * Pure page assignment. A block that does not fit the rest of the page moves whole to the next page when `keepTogether`
 * is true (the default); with `keepTogether: false` it starts on the current page and flows onto the next ones between
 * its children. A block taller than a full page always splits only between its children (one entry per page, `part`
 * 0..n-1). `pageBreak` items start a new page (unless already at the top of one) and produce no entry.
 * The renderer uses this function so layout and drawing cannot drift.
 */
export function paginateDetailed(items: PaginateItem[], firstPageSpace: number, pageSpace: number): PaginatePlacement[] {
  const out: PaginatePlacement[] = [];
  let page = 1;
  let left = firstPageSpace;
  const fresh = () => { page++; left = pageSpace; };
  const atTop = () => (page === 1 ? left >= firstPageSpace - EPS : left >= pageSpace - EPS);
  for (const it of items) {
    if (it.pageBreak) { if (!atTop()) fresh(); continue; }
    if (it.height <= left + EPS) { out.push({ page, id: it.id }); left -= it.height; continue; }
    const kids = it.childHeights;
    const canSplit = !!kids && kids.length > 0;
    if (!canSplit || (it.keepTogether && it.height <= pageSpace + EPS)) {
      // Cannot be split, or fits a whole page and must stay together: move it whole.
      if (!atTop()) fresh();
      out.push({ page, id: it.id }); left -= it.height;
      continue;
    }
    // Flows over pages: split between children, starting here unless the first child does not fit.
    if (kids![0]! > left + EPS && !atTop()) fresh();
    const groups = packChildren(kids!, left, pageSpace);
    groups.forEach((g, p) => {
      if (p > 0) fresh();
      out.push({ page, id: it.id, part: p, children: g });
      left -= g.reduce((s, i) => s + kids![i]!, 0);
    });
  }
  return out;
}

export function paginate(items: PaginateItem[], firstPageSpace: number, pageSpace: number): PaginateResult[] {
  return paginateDetailed(items, firstPageSpace, pageSpace).map(({ children: _c, ...r }) => r);
}
