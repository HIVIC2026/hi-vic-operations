// Decision 398 (Jo 26 Oct 2026, box: "Yes, automatic"): the electrician's A3 PIESA Mitti form is created automatically
// when the owner's PIESA time is booked (confirmBooking kind "assessment"). Creation is the office "Create Mitti form"
// path itself (mitti.server createAssignMittiAudit, with its per-job claim and reuse), so the form is never made twice;
// the office button stays as the backup. A failure raises ONE Needs me row per booking, cleared once the job has its
// PIESA form. PURE: no I/O. I/O lives in piesa-autoform.server.ts.

export const PIESA_AUTOFORM_FAILED_EVENT = "piesa_autoform_failed";

/** Should the booking try to make the form? Only a live job without a PIESA form yet. */
export function piesaAutoFormDecision(f: { deleted: boolean; archived: boolean; businessUnit: string | null; hasPiesaForm: boolean }): { action: "create" } | { action: "skip"; reason: string } {
  if (f.deleted || f.archived) return { action: "skip", reason: "job removed" };
  if (f.businessUnit !== "hivic") return { action: "skip", reason: "not a Home Insulation Victoria job" };
  if (f.hasPiesaForm) return { action: "skip", reason: "PIESA form already created" };
  return { action: "create" };
}

/** Needs me line for a failed automatic creation. */
export const piesaFormFailedLine = (why: string | null | undefined) =>
  `Safety check (A3 PIESA) Mitti form not created automatically${why?.trim() ? ` · ${why.trim().slice(0, 120)}` : ""} · press Create Mitti form on the job`;

/** The one open row: the latest failure, unless the job now has its PIESA form or the PIESA visit is no longer booked. */
export function piesaFormFailedOpen(i: { events: { created_at: string; details?: { reason?: string | null } | null }[]; hasPiesaForm: boolean; stage: string | null }): { at: string; text: string } | null {
  if (i.hasPiesaForm || i.stage !== "piesa_scheduled") return null;
  const last = [...i.events].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!last) return null;
  return { at: last.created_at, text: piesaFormFailedLine(last.details?.reason ?? null) };
}
