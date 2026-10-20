import { reviewedInsulationOffer, type ReviewedOfferResult } from './reviewed-insulation-offer.server';

export type NoInsulationOfferResult = ReviewedOfferResult;
/** Existing entry point; Office preparation verifies the actual saved estimate and secure link. */
export function noInsulationOffer(jobId: string, actorId: string | null, mode: 'preview' | 'prepare' | 'send'): Promise<NoInsulationOfferResult> {
  return reviewedInsulationOffer(jobId, actorId, 'no_insulation', mode);
}
