// Firm quote Task 8 (Jo 6 Nov 2026): the size check line on the installer's Quote from photos box.
// "Owner said {m²} m² · Aerial {m²} m² · Floor plan" — any missing value reads "Not found". Never a price.
export type SizeCheck = { ownerM2: number | null; aerialM2: number | null; floorplanUrl: string | null };
export const SOLAR_FOOTPRINT_METHOD = "Google Solar building ground footprint estimate";
const m2 = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null; };
/** Builds the read-only size check from the intake estimate, the CURRENT Google Solar footprint row and a signed plan URL. */
export function sizeCheckFrom(i: { ownerEstimate: unknown; areaRows: { method: string; net_m2: unknown; is_current: boolean }[]; floorplanUrl: string | null }): SizeCheck {
  const aerial = i.areaRows.find((r) => r.is_current && r.method === SOLAR_FOOTPRINT_METHOD);
  return { ownerM2: m2(i.ownerEstimate), aerialM2: aerial ? m2(aerial.net_m2) : null, floorplanUrl: i.floorplanUrl || null };
}
export type SizeCheckPart = { label: string; text: string; href?: string };
/** The three parts of the line, in order. */
export function sizeCheckParts(s: SizeCheck): SizeCheckPart[] {
  return [
    { label: "Owner said", text: s.ownerM2 != null ? `Owner said ${s.ownerM2} m²` : "Owner said: Not found" },
    { label: "Aerial", text: s.aerialM2 != null ? `Aerial ${s.aerialM2} m²` : "Aerial: Not found" },
    s.floorplanUrl ? { label: "Floor plan", text: "Floor plan", href: s.floorplanUrl } : { label: "Floor plan", text: "Floor plan: Not found" },
  ];
}
