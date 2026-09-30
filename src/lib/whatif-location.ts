// What-if calculator location: pure, client-only. Exact official VEU v25 lookup; never persisted, never approximated.
import { lookupLocation, type LocationVariables } from "./activity48.core";

export const WHATIF_ADDRESS_COPY = {
  heading: "Another Victorian property address",
  change: "CHANGE ADDRESS →",
  revert: "USE MY ENQUIRY ADDRESS",
  notice: "This address is used only for this calculator comparison. It does not change the property on your enquiry.",
  unlisted: "We can’t calculate a VEU estimate for that postcode from the current official location list.",
} as const;

/** Last 4-digit group in the address (Australian postcodes follow the state). */
export function postcodeFromAddress(address: string): string | null {
  const m = address.match(/\b(\d{4})\b(?!.*\b\d{4}\b)/);
  return m ? m[1]! : null;
}

export type WhatIfLocation = { status: "original"; location: LocationVariables } | { status: "alternate"; location: LocationVariables } | { status: "invalid" } | { status: "unlisted"; postcode: string };

export function resolveWhatIfLocation(original: LocationVariables, alternatePostcode: string | null): WhatIfLocation {
  if (alternatePostcode == null) return { status: "original", location: original };
  const p = alternatePostcode.trim();
  if (!/^\d{4}$/.test(p)) return { status: "invalid" };
  const loc = lookupLocation(p);
  return loc ? { status: "alternate", location: loc } : { status: "unlisted", postcode: p };
}

export const locationBasisLine = (loc: LocationVariables) => `VEU estimate based on postcode ${loc.postcode}.`;
