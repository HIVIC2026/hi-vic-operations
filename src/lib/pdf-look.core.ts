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

export type PdfBlock = { id: string; keepTogether?: boolean;
  /** Jo's formatting rule (5 Nov 2026): a block that flows over pages (`keepTogether: false`) never leaves its heading or
   *  lead-in lines orphaned at the foot of a page — the first `keepFirst` children start together on one page (a
   *  section's first child already carries its heading; set it higher when lead-in lines sit before the first item). */
  keepFirst?: number;
  /** Page-1 sizes of the signed acceptance (the approved sample prints its first page smaller than the agreement). */ compact?: boolean } & (
  | { kind: "header"; eyebrow: string; withAddress?: boolean; /** Part 10 Task 7 (co-brand): a second logo drawn right of ours at the same height. */ partnerLogo?: { bytes: Uint8Array; width: number; height: number; alt: string } }
  | { kind: "title"; text: string; sub?: string }
  | { kind: "para"; text: string; muted?: boolean; small?: boolean; /** Bold lead-in drawn before `text` (wraps together). */ lead?: string }
  | { kind: "facts"; rows: [string, string][]; /** One cell per row, full width (compact grids only). */ full?: boolean; /** Compact grids: cells from this index on are full width (the first ones stay two to a row). */ fullFrom?: number;
      /** Compact grids: these cell indexes are full width, the others pair up in order between them. */ fullAt?: number[];
      /** Compact grids: "[x]" and "[ ]" inside a cell's text are drawn as ticked and empty check boxes. */ boxes?: boolean }
  | { kind: "section"; number?: string; title: string; children: PdfBlock[] }
  | { kind: "bullets"; items: string[]; /** Bold lead-in per item (same index; "" or missing = none). */ leads?: string[]; /** Compact bullets: nesting per item (0 = bullet, 1 = hollow sub-bullet). */ levels?: number[] }
  | { kind: "money"; rows: { label: string; amount: string; strong?: boolean; green?: boolean }[] }
  | { kind: "ticks"; items: string[] }
  | { kind: "signature"; label: string; name: string; at: string; sub?: string }
  | { kind: "box"; children: PdfBlock[] }
  | { kind: "image"; bytes: Uint8Array; width: number; height: number }
  | { kind: "heading"; text: string }
  | { kind: "signatures"; cells: { label: string; name: string; line: string }[] }
  | { kind: "noteBox"; label: string; text: string; sub?: string }
  | { kind: "paid"; label: string; line: string; amount: string }
  | { kind: "ledger"; head: { label: string; amount: string }; rows: { label: string; amount: string; /** Bold row (e.g. a subtotal). */ strong?: boolean }[]; total: { label: string; amount: string; /** Draw a tick after the amount. */ tick?: boolean }; note?: string }
  | { kind: "subheading"; text: string }
  | { kind: "sigRow"; cells: { label: string; weight: number; name?: string; text?: string; image?: { bytes: Uint8Array; width: number; height: number } }[] }
  /** Plain run of blocks (no chrome) that stays on one page; flows between children only when taller than a page. */
  | { kind: "group"; children: PdfBlock[] }
  | { kind: "pageBreak" }
  /** Vertical space in pt; negative pulls the next block up (CSS-style collapsed margins in the approved samples). Draws nothing. */
  | { kind: "spacer"; height: number }
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

/** Space between a money row's label and its right-aligned amount (pt). */
export const MONEY_AMOUNT_GAP = 9;
/** Jo 5 Nov 2026: a money row's label wraps inside the space left of the amount (never runs under it); the amount stays on
 *  the first line. A label that fits stays one line (so existing documents are unchanged). */
export function moneyLabelLines(label: string, amount: string, w: number, width: (s: string) => number): string[] {
  return wrapText(label, width, Math.max(w - width(amount) - MONEY_AMOUNT_GAP, w * 0.4));
}

const EPS = 0.01;

/** Pure: groups of child indexes per page. The first group has `firstSpace`, later ones `pageSpace`; a child taller than a page sits alone. */
export function packChildren(childHeights: number[], firstSpace: number, pageSpace: number, partOverhead = 0): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let left = firstSpace - partOverhead;
  childHeights.forEach((h, i) => {
    if (cur.length > 0 && h > left + EPS) { groups.push(cur); cur = []; left = pageSpace - partOverhead; }
    cur.push(i); left -= h;
  });
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export type PaginateItem = { id: string; height: number; keepTogether: boolean; childHeights?: number[]; pageBreak?: boolean;
  /** Leading children that must start together with the block (never a heading alone at a page foot). Default 1. */ keepFirst?: number;
  /** Extra height every split part takes besides its children (a box's padding and trailing gap). */ partOverhead?: number };
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
    // Flows over pages: split between children, starting here unless the heading and its first real item do not fit
    // together (Jo's rule: no heading or lead-in orphaned at the foot of a page).
    const oh = it.partOverhead ?? 0;
    const keepFirst = Math.max(1, Math.min(it.keepFirst ?? 1, kids!.length));
    const firstNeed = kids!.slice(0, keepFirst).reduce((s, h) => s + h, 0) + oh;
    if (firstNeed > left + EPS && !atTop()) fresh();
    const groups = packChildren(kids!, left, pageSpace, oh);
    groups.forEach((g, p) => {
      if (p > 0) fresh();
      out.push({ page, id: it.id, part: p, children: g });
      left -= g.reduce((s, i) => s + kids![i]!, 0) + oh;
    });
  }
  return out;
}

export function paginate(items: PaginateItem[], firstPageSpace: number, pageSpace: number): PaginateResult[] {
  return paginateDetailed(items, firstPageSpace, pageSpace).map(({ children: _c, ...r }) => r);
}
