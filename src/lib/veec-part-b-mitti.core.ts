// New job flow Part 8 Task 7 (Jo 2 Nov 2026): the Lead Installer signs VEEC Section 3 Part B on the A5 in Mitti; this pure
// decision says whether that signature may sign the VEEC assignment record. Old forms (no Part B) and an unsigned Part B are
// "skip" (nothing applied, nothing blocked); only a signature that can't be trusted is a "hold" for the office.
import type { ReadSignature } from "./install-day.core";

export const VEEC_PART_B_SIGNED_MITTI_EVENT = "veec_part_b_signed_mitti";
export const VEEC_PART_B_MITTI_HELD_EVENT = "veec_part_b_mitti_held";
/** assignment.server: the portal's Part B signature image could not be filed (needs_office). */
export const VEEC_PART_B_IMAGE_HELD_EVENT = "veec_part_b_image_held";

export type PartBApplyDecision = { action: "apply" } | { action: "skip"; reason: string } | { action: "hold"; reason: string };

/** Case- and spacing-insensitive name key. */
export const partBNameKey = (s: string | null | undefined): string => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function partBApplyDecision(i: {
  partB: { onForm: boolean; ticked: boolean; signature: ReadSignature };
  leadName: string | null;
  assignment: { status: string; installerSignedAt: string | null } | null;
}): PartBApplyDecision {
  if (!i.partB.onForm) return { action: "skip", reason: "This form has no VEEC Part B" };
  if (i.assignment?.installerSignedAt) return { action: "skip", reason: "Part B is already signed on the assignment" };
  const s = i.partB.signature;
  if (!i.partB.ticked || !s.present) return { action: "skip", reason: "Part B is not ticked and signed in Mitti yet" };
  if (!s.mediaId || !s.signedAt) return { action: "hold", reason: "The Part B signature in Mitti has no image or time, so it was not applied" };
  if (!i.leadName) return { action: "hold", reason: "No Lead Installer is chosen for this job, so the Part B signature was not applied" };
  if (partBNameKey(s.name) !== partBNameKey(i.leadName)) return { action: "hold", reason: `The Part B signature in Mitti (${s.name ?? "no name"}) isn't the Lead Installer (${i.leadName})` };
  return { action: "apply" };
}

/** Part 8 final review I2: the office's Needs me row for a held Part B. The LATEST of the two held events decides (a later
 *  hold that is not for the office closes an earlier one); cleared by a later Mitti signing event or by the assignment
 *  carrying an installer signature (portal signing). Events may be in any order. */
export function veecPartBHeldOpen(
  events: { event_type: string; created_at: string; details?: Record<string, unknown> | null }[],
  a: { installerSignedAt: string | null },
): { at: string; reason: string } | null {
  if (a.installerSignedAt) return null;
  const held = events
    .filter((e) => e.event_type === VEEC_PART_B_MITTI_HELD_EVENT || e.event_type === VEEC_PART_B_IMAGE_HELD_EVENT)
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0];
  if (!held || held.details?.["needs_office"] !== true) return null;
  if (events.some((e) => e.event_type === VEEC_PART_B_SIGNED_MITTI_EVENT && Date.parse(e.created_at) >= Date.parse(held.created_at))) return null;
  return { at: held.created_at, reason: String(held.details?.["reason"] ?? "Part B signature not applied") };
}
