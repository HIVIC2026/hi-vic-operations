/**
 * Address autofill helpers for the public calculator.
 *
 * Pure only — no fetch, no DOM. The browser-side search lives in
 * address-combobox.tsx so these rules stay testable and server-safe.
 */

export type AddressParts = {
  streetNumber: string;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

export type AddressSuggestion = AddressParts & {
  /** "34 Watsons Road, Bundoora VIC 3757" */
  full: string;
  /** Stable key for list rendering. */
  key: string;
};

function asText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

/** "34 Watsons Road, Bundoora VIC 3757" */
export function formatAddress(parts: AddressParts): string {
  const street = [parts.streetNumber, parts.street].filter(Boolean).join(" ").trim();
  const town = [parts.suburb, parts.state, parts.postcode].filter(Boolean).join(" ").trim();
  return [street, town].filter(Boolean).join(", ");
}

/** Last standalone 4-digit run: "8 Yarra Street, Richmond VIC 3121" -> "3121". */
export function extractPostcode(text: string): string {
  const runs = text.match(/(?:^|\D)(\d{4})(?=\D|$)/g);
  if (!runs?.length) return "";
  const last = runs[runs.length - 1].match(/(\d{4})/);
  return last?.[1] ?? "";
}

function stateShort(value: unknown): string {
  const raw = asText(value);
  if (!raw) return "";
  if (/victoria/i.test(raw)) return "VIC";
  return raw.slice(0, 3).toUpperCase();
}

/**
 * Turn an address-search response into clean suggestions.
 * Anything without a street, a suburb and a 4-digit postcode is dropped, as is
 * anything outside Australia.
 */
export function parseAddressSuggestions(payload: unknown): AddressSuggestion[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of features) {
    const p = (item as { properties?: Record<string, unknown> })?.properties ?? {};
    const countrycode = asText(p.countrycode).toUpperCase();
    if (countrycode && countrycode !== "AU") continue;
    const postcode = asText(p.postcode);
    if (!/^\d{4}$/.test(postcode)) continue;
    const street = asText(p.street) || asText(p.name);
    const suburb =
      asText(p.suburb) ||
      asText(p.city) ||
      asText(p.town) ||
      asText(p.village) ||
      asText(p.district) ||
      asText(p.locality);
    if (!street || !suburb) continue;
    const parts: AddressParts = {
      streetNumber: asText(p.housenumber),
      street,
      suburb,
      state: stateShort(p.state),
      postcode,
    };
    const full = formatAddress(parts);
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ ...parts, full, key: `${postcode}:${street}:${parts.streetNumber}:${suburb}` });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Fallback when the person just types an address without picking a suggestion:
 * keep their text, pull the postcode out of it so pricing still works.
 */
export function addressFromTyped(text: string): { line: string; postcode: string } {
  const line = text.replace(/\s+/g, " ").trim();
  return { line, postcode: extractPostcode(line) };
}

/** Best-effort suburb for the lead record: the words before the postcode/state. */
export function suburbFromLine(line: string): string {
  const withoutPostcode = line.replace(/(?:\s+VIC)?\s+\d{4}\s*$/i, "");
  const tail = withoutPostcode.split(",").pop() ?? "";
  return tail.replace(/\bVIC\b/gi, "").replace(/\s+/g, " ").trim();
}
