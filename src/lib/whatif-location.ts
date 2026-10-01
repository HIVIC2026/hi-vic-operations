// What-if calculator location: pure, client-only. Exact official VEU v25 lookup; never persisted, never approximated.
import { lookupLocation, type LocationVariables } from "./activity48.core";

export const WHATIF_ADDRESS_COPY = {
  label: "Victorian property address",
  placeholder: "Start typing the property address",
  change: "CHANGE ADDRESS →",
  revert: "USE MY ENQUIRY ADDRESS",
  notice: "This address is used only for this calculator comparison. It does not change the property on your enquiry.",
  unlisted: "We can’t calculate a VEU estimate for that postcode from the current official location list.",
  notVic: "Please choose a Victorian property address.",
  noResults: "No matching addresses found. Keep typing or check the spelling.",
  providerError: "Address search isn’t available right now. Your enquiry address estimate is still shown.",
  selectPrompt: "Select an address from the list to compare it.",
} as const;

export const ADDRESS_MIN_CHARS = 4;
export const ADDRESS_DEBOUNCE_MS = 350;
export const ADDRESS_MAX_SUGGESTIONS = 6;

export type AddressSuggestion = { id: string; label: string };
export type AddressDetails = { label: string; street?: string | null; suburb?: string | null; postcode?: string | null; state?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null };
/** A selected, verified what-if address (local state only). */
export type SelectedAddress = { label: string; postcode: string; state: "VIC"; latitude: number | null; longitude: number | null };

export const isVicPostcode = (p: string) => /^(3\d{3}|8\d{3})$/.test(p);

/** Accept only a resolved selection whose state is VIC and postcode is a Victorian postcode. */
export function acceptSelectedAddress(d: AddressDetails | null | undefined): { ok: true; address: SelectedAddress } | { ok: false; reason: "not_vic" } {
  const state = (d?.state ?? "").trim().toUpperCase();
  const postcode = (d?.postcode ?? "").trim();
  if (!d || (state !== "VIC" && state !== "VICTORIA") || !isVicPostcode(postcode)) return { ok: false, reason: "not_vic" };
  const fin = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  return { ok: true, address: { label: d.label.trim(), postcode, state: "VIC", latitude: fin(d.latitude), longitude: fin(d.longitude) } };
}

export type WhatIfLocation = { status: "original"; location: LocationVariables } | { status: "alternate"; location: LocationVariables } | { status: "invalid" } | { status: "unlisted"; postcode: string };

/** Alternate location only from a selected, verified address; otherwise the enquiry location. */
export function resolveWhatIfLocation(original: LocationVariables, selected: SelectedAddress | null): WhatIfLocation {
  if (selected == null) return { status: "original", location: original };
  if (selected.state !== "VIC" || !isVicPostcode(selected.postcode)) return { status: "invalid" };
  const loc = lookupLocation(selected.postcode);
  return loc ? { status: "alternate", location: loc } : { status: "unlisted", postcode: selected.postcode };
}

export const locationBasisLine = (loc: LocationVariables) => `VEU estimate based on postcode ${loc.postcode}.`;
