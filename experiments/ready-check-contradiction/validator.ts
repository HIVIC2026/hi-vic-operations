// EXPERIMENT ONLY. No production imports of this module, gates, I/O or writes.
// Explicit adapter boundary: ReturnType of the real Mitti parseAudit function.
import type { parseAudit } from '../../src/lib/mitti.core';

type ParsedReadyCheck = ReturnType<typeof parseAudit>;
export type Freshness = 'current' | 'stale' | 'unsynced' | 'unknown';
type Correction = {
  area: string;
  areaKey: string;
  reason: 'disqualifying_band' | 'numeric_at_or_above_2';
  message: string;
};
export type ContradictionResult = {
  status: 'correction_needed' | 'unable_to_verify' | 'already_failed' | 'no_contradiction';
  corrections: Correction[];
  unknownAreas: string[];
  freshness: Freshness;
  notes: string[];
};
const OUTCOME = 'Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?';

/** Checks one contradiction only; no_contradiction NEVER means eligible or cleared.
 * Caller must explicitly supply freshness; timestamps alone cannot prove phone sync.
 * The existing parser groups/filter areas and maps Above R2.0 to at_or_above_r2.
 * That band is lossy: it does NOT prove the Above option captured equality.
 * Numeric >= 2 is checked independently; existing mappings remain untouched.
 */
export function checkReadyCheckContradiction(parsed: ParsedReadyCheck, freshness: Freshness): ContradictionResult {
  const corrections: Correction[] = [];
  const unknownAreas: string[] = [];
  const notes: string[] = ['Sample check only; not eligibility, completion or quote clearance.'];
  const outcomes = parsed.snapshot.filter(e => e.label.trim() === OUTCOME);
  const outcome = outcomes.length === 1 ? outcomes[0]?.value : null;
  const passed = outcome === 'Yes - Ready Check passed';
  const failed = outcome === 'No - Ready Check failed';

  for (const area of parsed.areas) {
    // Explicit no insulation overrides stale hidden R; unknown presence cannot pass.
    if (area.present === false) continue;
    if (area.present !== true) { unknownAreas.push(area.label); continue; }
    const numericKnown = area.rValue !== null && Number.isFinite(area.rValue) && area.rValue >= 0;
    const numericHigh = numericKnown && (area.rValue ?? 0) >= 2;
    const bandHigh = area.rValueBand === 'at_or_above_r2';
    if (passed && (numericHigh || bandHigh)) {
      const reason = numericHigh ? 'numeric_at_or_above_2' : 'disqualifying_band';
      corrections.push({
        area: area.label, areaKey: area.key, reason,
        message: `${area.label}: existing insulation ${numericHigh ? `is recorded as R${area.rValue}` : 'has a disqualifying R-value answer'}, but the Ready Check is marked passed. Check and correct this area's R-value answer or the final Ready Check outcome.`,
      });
    }
    if (!numericKnown && area.rValueBand !== 'below_r2' && !bandHigh) unknownAreas.push(area.label);
  }
  if (freshness !== 'current') notes.push('Unable to verify: these answers are not confirmed current and synced.');
  if (!passed && !failed) notes.push('Unable to verify: final Ready Check outcome is missing, unknown or repeated.');
  if (parsed.areas.length === 0) notes.push('Unable to verify: no active repeated ceiling areas were read.');
  if (unknownAreas.length) notes.push('Unable to verify the existing insulation R-value in every active area.');

  const status = corrections.length ? 'correction_needed'
    : freshness !== 'current' || unknownAreas.length || !parsed.areas.length || (!passed && !failed) ? 'unable_to_verify'
    : failed ? 'already_failed' : 'no_contradiction';
  return { status, corrections, unknownAreas, freshness, notes };
}