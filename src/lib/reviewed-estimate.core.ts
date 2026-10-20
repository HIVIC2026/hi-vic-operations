export type EstimateMediaReview = { id: string; outcome: string; occurredAt: string };
export type OfferReviewOutcome = 'below_r2' | 'no_insulation';
export type EstimateInsulation = 'none' | 'present' | 'unknown' | null;

/** A below-R2 review changes the estimate only on explicit Office preparation. Its provenance
 * is retained on later read-only refreshes while it is still the latest authoritative review. */
export function reviewedEstimateInsulation(declared: EstimateInsulation, latest: EstimateMediaReview | null, prepared: EstimateMediaReview | null, requested?: OfferReviewOutcome): { insulation: EstimateInsulation; review: EstimateMediaReview | null } {
  if (requested && (!latest || latest.outcome !== requested)) throw new Error('The Office photo review changed. Refresh this enquiry before preparing an estimate.');
  const retained = latest?.outcome === 'below_r2' && prepared?.id === latest.id && prepared.outcome === latest.outcome;
  if (latest?.outcome === 'below_r2' && (requested === 'below_r2' || retained)) return { insulation: 'present', review: latest };
  if (latest?.outcome === 'no_insulation') return { insulation: 'none', review: latest };
  return { insulation: declared, review: null };
}
