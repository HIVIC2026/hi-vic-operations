// Which Mitti inspection a trade's form button opens (pure). A Ready Check link uses ONLY the Ready Check
// measurement's own Mitti id — never the PIESA assessment's audit id (different form, wrong job record).
export function mittiFormId(which: "ready_check" | "piesa", assessmentMittiId: string | null | undefined, measurement: { external_source: string | null; external_id: string | null } | null | undefined): string | null {
  if (which === "piesa") return assessmentMittiId || null;
  return measurement?.external_source === "mitti" && measurement.external_id ? measurement.external_id : null;
}
