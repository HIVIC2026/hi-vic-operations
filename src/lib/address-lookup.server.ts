// The one server-side client for the Home Insulation Victoria website address-search service (Base44 → Google Places,
// AU-only). Used by the Add a job proxy (address-search.functions.ts) and by the automatic enquiry address completion
// (address-complete.server.ts, decision 281). Read-only lookups, bounded input and output, no secrets.
import type { AddressDetails, AddressSuggestion } from "./whatif-location";

const BASE44_ADDRESS_SEARCH = "https://base44.app/api/apps/6ab0c47ee6cd14456bf15362/functions/address-search";

async function call(body: unknown, timeoutMs: number) {
  const res = await fetch(BASE44_ADDRESS_SEARCH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Address search failed [${res.status}]`);
  return (await res.json()) as Record<string, unknown>;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type AddressLookup = { search: (query: string) => Promise<AddressSuggestion[]>; details: (placeId: string) => Promise<AddressDetails | null> };

/** Autocomplete: at most 6 { id, label } suggestions. */
export async function searchAddressSuggestions(query: string, timeoutMs = 8000): Promise<AddressSuggestion[]> {
  const r = await call({ action: "autocomplete", query: query.slice(0, 200) }, timeoutMs);
  const list = Array.isArray(r["suggestions"]) ? r["suggestions"] : [];
  return list.slice(0, 6).flatMap((s) => {
    const o = s as Record<string, unknown>;
    const id = str(o["id"], 600), label = str(o["label"]);
    return id && label ? [{ id, label }] : [];
  });
}

/** Details for one suggestion: street / suburb / postcode / state, or null when the service has nothing. */
export async function lookupAddressDetails(placeId: string, timeoutMs = 8000): Promise<AddressDetails | null> {
  const r = await call({ action: "details", placeId: placeId.slice(0, 600) }, timeoutMs);
  const a = (r["address"] ?? null) as Record<string, unknown> | null;
  if (!a) return null;
  return { label: str(a["label"]) ?? "", street: str(a["street"]), suburb: str(a["suburb"]), postcode: str(a["postcode"], 10), state: str(a["state"], 20), country: "AU" as const, provider: "google_places_au" as const, latitude: num(a["latitude"]), longitude: num(a["longitude"]) };
}

/** The provider as the completion sweep sees it (injectable in tests). */
export const serverAddressLookup = (timeoutMs = 8000): AddressLookup => ({
  search: (q) => searchAddressSuggestions(q, timeoutMs),
  details: (id) => lookupAddressDetails(id, timeoutMs),
});
