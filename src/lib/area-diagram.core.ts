// Decision 211 (Jo 24 Oct 2026): the portal draws the Activity Guide Table 4 "Diagram/floor plan of insulated ceiling
// space(s)" from the measured Ready Check areas — one labelled box per upgrade area (name, length × width, m², product and
// R-value, total m²) — and regenerates the final plan from the install-day per-zone confirmations (decision 210 d/e).
// Pure: no database, no clock (the caller passes generatedAt), deterministic output for the same input.
import { stableJson } from "./assignment.core";
import { excludedAreaName } from "./excluded-areas.core";
import { insulationProduct } from "./insulation-product.core";

export const AREA_DIAGRAM_KIND = "area_diagram";
export const FINAL_AREA_DIAGRAM_KIND = "final_area_diagram";
export const AREA_DIAGRAM_EVENT = "area_diagram_generated";
export const FINAL_AREA_DIAGRAM_EVENT = "final_area_diagram_generated";
/** Printed on every diagram: the schematic shows measured dimensions, never the real shape or position of the rooms. */
export const DIAGRAM_NOTE = "Diagram generated from measured dimensions — not a scaled floor plan";
export const GUIDE_CLAUSE = "Activity Guide v1.2 Table 4 — Diagram/floor plan of insulated ceiling space(s)";

export type DiagramKind = "ready_check" | "final";
export type DiagramArea = {
  name: string;
  lengthM: number | null;
  widthM: number | null;
  areaM2: number | null;
  /** The approved Mitti option as declared, e.g. "Bradford Gold R5" (brand + family; R-value separately). */
  productOption: string | null;
  /** "R5.0" etc. From the approved option when known. */
  rValue: string | null;
  /** Existing insulation / removal note shown on the box, e.g. "Existing insulation: remove 12 m²". */
  existingNote: string | null;
};
export type DiagramInput = {
  kind: DiagramKind;
  jobNumber: string | null;
  address: string | null;
  /** ISO time the diagram was generated (printed; excluded from the content hash). */
  generatedAt: string;
  areas: DiagramArea[];
  /** Where the dimensions came from (printed in the footer). */
  basis?: string | null;
};

/** Install-day per-zone confirmation (decision 210 d/e). The install-evidence module supplies these once the install form is read. */
export type InstallZoneConfirmation = {
  /** Zone name carried from the Ready Check (matched case/space-insensitively). */
  name: string;
  areaM2: number | null;
  productOption: string | null;
  lengthM?: number | null;
  widthM?: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
export const fmtNum = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? "—" : String(r2(n)));
const normLabel = (s: unknown) => String(s ?? "").split("\n")[0]!.toLowerCase().replace(/²/g, "2").replace(/[^a-z0-9]+/g, " ").trim();
export const normName = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const yes = (v: unknown) => /^\s*(yes|true)\s*$/i.test(String(v ?? ""));
const no = (v: unknown) => /^\s*(no|false)\s*$/i.test(String(v ?? ""));

const L = {
  heading: /^[\s─\-–—]*ceiling area \d+/i,
  name: ["Where is this area?", "Which part of the home does this ceiling area cover?"],
  length: ["Length (m)"],
  width: ["Width (m)"],
  m2: ["Enter the measured ceiling area (m²)", "Measured area m2"],
  existing: ["Is there existing insulation?", "Is there existing insulation in this ceiling area?"],
  action: ["What needs to happen to it?", "What is required for the existing insulation?"],
  removeM2: ["Area to remove (m2)", "How much existing insulation needs to be removed? (m²)"],
  product: ["Insulation product", "What insulation product will you be using on this job?"],
};
const is = (label: string, aliases: string[]) => aliases.some((a) => normLabel(a) === label);

/** R-value text from an approved option ("Bradford Gold R6" → "R6.0"); null for anything else. */
export function productRValue(option: string | null | undefined): string | null {
  return option ? insulationProduct(option)?.rValue ?? null : null;
}

export function existingNote(existing: boolean | null, action: string | null, removalM2: number | null): string | null {
  if (existing === false) return "No existing insulation";
  if (existing !== true) return null;
  const a = (action ?? "").toLowerCase();
  if (/^remove|must be removed/.test(a)) return `Existing insulation: remove${removalM2 != null ? ` ${fmtNum(removalM2)} m²` : ""}`;
  if (/^top up|can be topped up/.test(a)) return "Existing insulation: top up";
  if (/not sure/.test(a)) return "Existing insulation: office to decide";
  return "Existing insulation present";
}

type Group = { name: string | null; lengthM: number | null; widthM: number | null; m2: number | null; existing: boolean | null; action: string | null; removeM2: number | null };

/**
 * Areas from a Ready Check answer list in form order (the stored raw snapshot: label + value, help text after a line break).
 * A new area starts at each "── Ceiling Area N ──" heading or name question, or when a dimension repeats. Template
 * placeholders (no name, no size) are dropped. The one job-level product question applies to every area.
 */
export function areasFromReadyCheckEntries(entries: { label: string; value: unknown }[], opts: { productOption?: string | null } = {}): DiagramArea[] {
  const groups: Group[] = [];
  const st: { cur: Group | null } = { cur: null }; // holder: assignments inside helpers keep TS narrowing honest
  let product: string | null = opts.productOption ?? null;
  const fresh = (): Group => { const g: Group = { name: null, lengthM: null, widthM: null, m2: null, existing: null, action: null, removeM2: null }; groups.push(g); st.cur = g; return g; };
  for (const e of entries) {
    const label = normLabel(e.label);
    const raw = String(e.label ?? "").split("\n")[0]!.trim();
    const v = e.value == null || String(e.value).trim() === "" || String(e.value) === "null" || String(e.value) === "<nil>" ? null : e.value;
    if (L.heading.test(raw)) { fresh(); continue; }
    if (is(label, L.product)) { if (v != null && !product) product = String(v).trim(); continue; }
    const cur = st.cur;
    if (is(label, L.name)) { const g = !cur || cur.name != null || cur.lengthM != null || cur.widthM != null || cur.m2 != null ? fresh() : cur; g.name = v == null ? null : String(v).trim() || null; continue; }
    const dim = is(label, L.length) ? "lengthM" : is(label, L.width) ? "widthM" : is(label, L.m2) ? "m2" : null;
    if (dim) { const g = !cur || cur[dim] != null ? fresh() : cur; g[dim] = num(v); continue; }
    if (!cur) continue;
    if (is(label, L.existing)) { if (v != null) cur.existing = yes(v) ? true : no(v) ? false : cur.existing; continue; }
    if (is(label, L.action)) { if (v != null) cur.action = String(v); continue; }
    if (is(label, L.removeM2)) { if (v != null) cur.removeM2 = num(v); continue; }
  }
  const kept = groups.filter((g) => g.name != null || g.m2 != null || g.lengthM != null || g.widthM != null);
  return kept.map((g, i) => {
    const area = g.m2 != null ? g.m2 : g.lengthM != null && g.widthM != null && g.lengthM > 0 && g.widthM > 0 ? r2(g.lengthM * g.widthM) : null;
    return {
      name: g.name ?? (kept.length === 1 ? "Main ceiling" : `Area ${i + 1}`),
      lengthM: g.lengthM, widthM: g.widthM, areaM2: area,
      productOption: product, rValue: productRValue(product),
      existingNote: existingNote(g.existing, g.action, g.removeM2),
    };
  });
}

/** Areas from the office-edited Ready Check areas record (`measure.areas_v1`) when no form snapshot exists. */
export function areasFromRecordAreas(rc: { label: string; areaM2: number | null; product: string | null; rValue: number | null; existing: "none" | "present" | "unknown" | null; removal: "yes" | "no" | "unknown" | null; removalM2: number | null }[], fallbackProduct: string | null = null): DiagramArea[] {
  return rc.map((a, i) => {
    const product = a.product ?? fallbackProduct;
    return {
      name: a.label?.trim() || (rc.length === 1 ? "Main ceiling" : `Area ${i + 1}`), lengthM: null, widthM: null, areaM2: a.areaM2,
      productOption: product, rValue: productRValue(product),
      existingNote: existingNote(a.existing === "present" ? true : a.existing === "none" ? false : null, a.removal === "yes" ? "Remove" : a.removal === "no" ? "Top up" : null, a.removalM2),
    };
  });
}

/** One box from the whole-job measurement when nothing per-area is stored (oldest records). */
export function singleAreaFallback(measuredAreaM2: number | null, productOption: string | null, existing: boolean | null, removal: boolean | null, removalM2: number | null): DiagramArea[] {
  if (measuredAreaM2 == null) return [];
  return [{ name: "Main ceiling", lengthM: null, widthM: null, areaM2: measuredAreaM2, productOption, rValue: productRValue(productOption), existingNote: existingNote(existing, removal === true ? "Remove" : removal === false ? "Top up" : null, removalM2) }];
}

/**
 * Final plan areas: the install-day confirmations win on installed m² and product (decision 211); Ready Check length ×
 * width is kept for a matched zone (same name, decision 210 e) so the box still shows the measured dimensions. Zones the
 * Ready Check never had are appended; Ready Check areas with no confirmation stay as measured.
 */
export function applyInstallZones(readyCheck: DiagramArea[], zones: InstallZoneConfirmation[]): DiagramArea[] {
  const out = readyCheck.map((a) => ({ ...a }));
  for (const z of zones) {
    const hit = out.find((a) => normName(a.name) === normName(z.name));
    const product = z.productOption ?? hit?.productOption ?? null;
    const next: DiagramArea = {
      name: hit?.name ?? z.name.trim(),
      lengthM: z.lengthM ?? hit?.lengthM ?? null, widthM: z.widthM ?? hit?.widthM ?? null,
      areaM2: z.areaM2 ?? hit?.areaM2 ?? null,
      productOption: product, rValue: productRValue(product) ?? hit?.rValue ?? null,
      existingNote: hit?.existingNote ?? null,
    };
    if (hit) Object.assign(hit, next); else out.push(next);
  }
  return out;
}

/** Areas that count toward the eligible total (garage / carport / shed areas are drawn but not counted). */
const countedAreas = (areas: DiagramArea[]): number => areas.filter((a) => !excludedAreaName(a.name)).length;

export function totalAreaM2(areas: DiagramArea[]): number | null {
  const xs = areas.filter((a) => !excludedAreaName(a.name)).map((a) => a.areaM2).filter((x): x is number => x != null && Number.isFinite(x));
  return xs.length ? r2(xs.reduce((s, x) => s + x, 0)) : null;
}

/** Content hash (FNV-1a 64) of what the diagram shows — the same facts always file the same document. */
export function areaDiagramHash(input: Pick<DiagramInput, "kind" | "jobNumber" | "address" | "areas">): string {
  const s = stableJson({ kind: input.kind, jobNumber: input.jobNumber, address: input.address, areas: input.areas });
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}

// ---------- layout (shared by the SVG and the PDF) ----------
export type DiagramBox = { x: number; y: number; w: number; h: number; area: DiagramArea; lines: string[] };
export type DiagramLayout = {
  width: number; height: number;
  title: string; header: string[]; boxes: DiagramBox[]; footer: string[];
};
const PAGE_W = 800, MARGIN = 40, GAP = 24, MAX_BOX = 720, MIN_W = 150, MIN_H = 100;

/** Box edge lengths in metres: L × W when both measured, else a square of the m², else a default square. */
function edges(a: DiagramArea): { l: number; w: number } {
  if (a.lengthM != null && a.widthM != null && a.lengthM > 0 && a.widthM > 0) return { l: a.lengthM, w: a.widthM };
  if (a.areaM2 != null && a.areaM2 > 0) { const s = Math.sqrt(a.areaM2); return { l: s, w: s }; }
  return { l: 4, w: 3 };
}

export function boxLines(a: DiagramArea): string[] {
  const dims = a.lengthM != null && a.widthM != null ? `${fmtNum(a.lengthM)} × ${fmtNum(a.widthM)} m` : "Dimensions: measured m² only";
  // "Bradford Gold · R5.0": brand/family from the approved option, the R-value stated once (Table 4: products and R value).
  const product = a.productOption ? (a.rValue ? `${a.productOption.replace(/\s+R\d+(\.\d+)?$/i, "")} · ${a.rValue}` : a.productOption) : "Product: to be confirmed";
  return [a.name, dims, `${fmtNum(a.areaM2)} m²`, product, ...(a.existingNote ? [a.existingNote] : [])];
}

export function areaDiagramLayout(input: DiagramInput): DiagramLayout {
  const areas = input.areas;
  const es = areas.map(edges);
  const maxDim = Math.max(1, ...es.flatMap((e) => [e.l, e.w]));
  const minDim = Math.min(...es.flatMap((e) => [e.l, e.w]), maxDim);
  // Proportional: one scale for every box. Largest edge fits the page; the smallest box stays readable.
  let scale = 360 / maxDim;
  if (minDim * scale < MIN_W) scale = Math.min(MIN_W / minDim, MAX_BOX / maxDim);
  const sized = es.map((e) => ({ w: Math.max(MIN_W, Math.min(MAX_BOX, e.l * scale)), h: Math.max(MIN_H, Math.min(MAX_BOX, e.w * scale)) }));
  const title = input.kind === "final" ? "Final installation plan — insulated ceiling areas" : "Upgrade area diagram — ceiling areas to insulate";
  const header = [
    `Job ${input.jobNumber ?? "—"} · ${input.address ?? "address not recorded"}`,
    `Generated ${input.generatedAt.slice(0, 10)} · ${GUIDE_CLAUSE}`,
  ];
  const boxes: DiagramBox[] = [];
  let x = MARGIN, y = MARGIN + 70, rowH = 0;
  areas.forEach((a, i) => {
    const { w, h } = sized[i]!;
    if (x > MARGIN && x + w > PAGE_W - MARGIN) { x = MARGIN; y += rowH + GAP; rowH = 0; }
    boxes.push({ x, y, w, h, area: a, lines: boxLines(a) });
    x += w + GAP; rowH = Math.max(rowH, h);
  });
  if (!areas.length) boxes.push({ x: MARGIN, y, w: 360, h: 120, area: { name: "No ceiling areas recorded", lengthM: null, widthM: null, areaM2: null, productOption: null, rValue: null, existingNote: null }, lines: ["No ceiling areas recorded"] });
  const bottom = (boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : y) + GAP;
  const total = totalAreaM2(areas);
  const footer = [
    `Total area to insulate: ${total == null ? "—" : `${fmtNum(total)} m²`} across ${countedAreas(areas)} upgrade area${countedAreas(areas) === 1 ? "" : "s"}`,
    input.basis ?? (input.kind === "final" ? "Installed m² and products as confirmed by the installer on install day" : "Dimensions as measured by the installer at the Ready Check"),
    DIAGRAM_NOTE,
  ];
  return { width: PAGE_W, height: bottom + 16 * footer.length + MARGIN, title, header, boxes, footer };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The schematic as a standalone SVG document (also embedded inline on the office job page). */
export function areaDiagramSvg(input: DiagramInput): string {
  const l = areaDiagramLayout(input);
  const t = (x: number, y: number, s: string, o: { size?: number; bold?: boolean; fill?: string; anchor?: string } = {}) =>
    `<text x="${x}" y="${y}" font-size="${o.size ?? 12}"${o.bold ? ' font-weight="700"' : ""} fill="${o.fill ?? "#0f1f3d"}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}>${esc(s)}</text>`;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" font-family="Helvetica, Arial, sans-serif" role="img" aria-label="${esc(l.title)}">`,
    `<title>${esc(l.title)}</title>`,
    `<rect x="0" y="0" width="${l.width}" height="${l.height}" fill="#ffffff"/>`,
    t(MARGIN, MARGIN, l.title, { size: 18, bold: true }),
    ...l.header.map((h, i) => t(MARGIN, MARGIN + 20 + i * 16, h, { size: 11, fill: "#4a5568" })),
  ];
  for (const b of l.boxes) {
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#eef6f1" stroke="#1f6f4a" stroke-width="2" rx="4"/>`);
    // Edge labels (length along the top, width down the left) when both are measured.
    if (b.area.lengthM != null && b.area.widthM != null) {
      parts.push(t(b.x + b.w / 2, b.y - 5, `${fmtNum(b.area.lengthM)} m`, { size: 10, fill: "#1f6f4a", anchor: "middle" }));
      parts.push(`<text x="${b.x - 5}" y="${b.y + b.h / 2}" font-size="10" fill="#1f6f4a" text-anchor="middle" transform="rotate(-90 ${b.x - 5} ${b.y + b.h / 2})">${esc(`${fmtNum(b.area.widthM)} m`)}</text>`);
    }
    b.lines.forEach((line, i) => parts.push(t(b.x + 10, b.y + 18 + i * 15, line, { size: i === 0 ? 13 : 11, bold: i === 0 })));
  }
  const fy = l.height - MARGIN - 16 * (l.footer.length - 1) + 4;
  l.footer.forEach((f, i) => parts.push(t(MARGIN, fy + i * 16, f, { size: i === 0 ? 12 : 10, bold: i === 0, fill: i === 0 ? "#0f1f3d" : "#4a5568" })));
  parts.push("</svg>");
  return parts.join("\n");
}

/** Short office line, e.g. "3 areas · 86.5 m² · Bradford Gold R5". */
export function areaDiagramSummary(areas: DiagramArea[]): string {
  const products = [...new Set(areas.filter((a) => !excludedAreaName(a.name)).map((a) => a.productOption).filter((x): x is string => !!x))];
  const total = totalAreaM2(areas);
  return [`${countedAreas(areas)} area${countedAreas(areas) === 1 ? "" : "s"}`, total == null ? null : `${fmtNum(total)} m²`, products.join(" / ") || null].filter(Boolean).join(" · ");
}
