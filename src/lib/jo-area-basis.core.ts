// Which ceiling size a Jo T1–T6 preliminary quote may state, and how. Pure; tested in tests/manual-backlog-release.test.ts.
//
// Known size  -> the estimate MUST be priced on exactly the owner's own size (jobs.estimated_area_m2), and the email says
//                "based on the size you provided".
// No size     -> the estimate MUST be the clearly labelled 150 m² typical assumption, never presented as the owner's size.
// Anything else (research area, measurement, mismatch) is not a preliminary enquiry quote: fail closed, nothing sent.
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";

export type JoAreaBasis =
  | { ok: true; ceilingSizeKnown: boolean; areaEstimated: boolean; areaM2: number }
  | { ok: false; reason: string };

export const AREA_BASIS_MISMATCH =
  "The preliminary quote is not priced on the owner's ceiling size (or the labelled 150 m² assumption). Recalculate the estimate first; nothing sent.";

export function joAreaBasis(x: {
  areaSource: string | null | undefined;
  areaM2: number | null | undefined;
  ownerAreaM2: number | null | undefined;
}): JoAreaBasis {
  const area = Number(x.areaM2);
  const owner = x.ownerAreaM2 == null ? NaN : Number(x.ownerAreaM2);
  const ownerKnown = Number.isFinite(owner) && owner > 0;
  if (!Number.isFinite(area) || area <= 0) return { ok: false, reason: AREA_BASIS_MISMATCH };
  if (ownerKnown) {
    if (x.areaSource === "owner_estimate" && Math.abs(area - owner) < 0.005)
      return { ok: true, ceilingSizeKnown: true, areaEstimated: false, areaM2: owner };
    return { ok: false, reason: AREA_BASIS_MISMATCH };
  }
  if (x.areaSource === "typical_default" && area === DEFAULT_ESTIMATED_AREA_M2)
    return {
      ok: true,
      ceilingSizeKnown: false,
      areaEstimated: true,
      areaM2: DEFAULT_ESTIMATED_AREA_M2,
    };
  return { ok: false, reason: AREA_BASIS_MISMATCH };
}
