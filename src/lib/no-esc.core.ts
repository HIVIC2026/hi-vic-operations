// New job flow, Part 9, Task 14 (Jo 2 Nov 2026, answers 18–19): real end-to-end runs with real owners' details (Part 11)
// must never reach the ESC. ONE per-job marker — `jobs.external_refs.no_esc === true` (the same shape as `qa_no_delivery`,
// no SQL) — checked at every ESC boundary: the Registry robot (`jobMode` → off, `noticeWork` / `veecWork` skip),
// every Registry submission / update recorder (office and robot), VEEC creation (`veecCreationBlockers`, `updateVeec`)
// and the ESC reminder sweep. The GO check and the PIISA timing rule skip only the ESC-notice lines; every other gate
// still blocks. PURE: no I/O. Readers live in no-esc.server.ts; the marker is set by setNoEscMarker (office only, one-way).

/** The key inside jobs.external_refs. */
export const NO_ESC_REF = "no_esc" as const;

/** jobs.external_refs.no_esc === true. Anything else (missing refs, a string, null) = not marked. */
export function noEscMarked(refs: unknown): boolean {
  return !!refs && typeof refs === "object" && (refs as Record<string, unknown>)[NO_ESC_REF] === true;
}

/** Office-facing refusal (shown when a recorder, the robot or VEEC creation is tried on a marked job). */
export const NO_ESC_REFUSAL = "Real-run job marked “no ESC”: nothing goes to the ESC Registry and no certificates are created.";
/** Refusal when the marker is asked for after a notice already went to the Registry (office). */
export const NO_ESC_NOTICE_ALREADY_SENT = "An ESC notice was already sent for this job — withdraw it first.";
/** GO check note on a marked job (replaces the ESC-notice failure lines; never a failure). */
export const NO_ESC_PRESTART_NOTE = "No ESC (real-run job): ESC notice skipped";
/** Office job page badge. */
export const NO_ESC_BADGE = "Real run — no ESC";
/** Event written once when the marker is set (details: { reason }). */
export const NO_ESC_MARKER_SET_EVENT = "no_esc_marker_set" as const;

/** The patch a job writer applies: keeps every other key (writers that merge external_refs keep the marker). */
export function withNoEscMarker(refs: unknown): Record<string, unknown> {
  const prev = refs && typeof refs === "object" && !Array.isArray(refs) ? (refs as Record<string, unknown>) : {};
  return { ...prev, [NO_ESC_REF]: true };
}
