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
  const last = (runs[runs.length - 1] ?? "").match(/(\d{4})/);
  return last?.[1] ?? "";
}

const STATE_SHORT: Record<string, string> = {
  victoria: "VIC",
  "new south wales": "NSW",
  queensland: "QLD",
  "western australia": "WA",
  "south australia": "SA",
  tasmania: "TAS",
  "australian capital territory": "ACT",
  "northern territory": "NT",
};

function stateShort(value: unknown): string {
  const raw = asText(value);
  if (!raw) return "";
  const mapped = STATE_SHORT[raw.trim().toLowerCase()];
  if (mapped) return mapped;
  const letters = raw
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return letters || raw.slice(0, 3).toUpperCase();
}

/**
 * Turn an address-search response into clean suggestions.
 *
 * Victorian properties only — that's the only program we can claim under. A row
 * survives when it has a 4-digit postcode and at least a street or a suburb, so
 * the person never picks a suggestion that loses the suburb (the old free
 * service returned "Melbourne" for everything, which made Bundoora look wrong).
 * When the person has typed a suburb, suggestions from other suburbs are
 * dropped so "Smith Street, Fitzroy" can't offer a Collingwood street.
 */
/** The address fields we care about, exactly as the service sends them. */
type NominatimAddress = {
  state?: unknown;
  postcode?: unknown;
  house_number?: unknown;
  road?: unknown;
  pedestrian?: unknown;
  footway?: unknown;
  suburb?: unknown;
  quarter?: unknown;
  town?: unknown;
  municipality?: unknown;
  city?: unknown;
  county?: unknown;
};

export function parseNominatimSuggestions(payload: unknown, typed = ""): AddressSuggestion[] {
  if (!Array.isArray(payload)) return [];
  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of payload) {
    const a = (item as { address?: NominatimAddress })?.address;
    if (!a) continue;
    const stateRaw = asText(a.state).trim().toLowerCase();
    // Victorian properties only. A row that does not name its state is not proof
    // of anything, so it is dropped rather than guessed as VIC.
    if (stateRaw !== "victoria") continue;
    const postcode = asText(a.postcode);
    if (!/^\d{4}$/.test(postcode)) continue;
    const street = asText(a.road) || asText(a.pedestrian) || asText(a.footway);
    const suburb =
      asText(a.suburb) ||
      asText(a.quarter) ||
      asText(a.town) ||
      asText(a.municipality) ||
      asText(a.city) ||
      asText(a.county);
    if (!suburb) continue;
    const parts: AddressParts = {
      streetNumber: asText(a.house_number),
      street,
      suburb,
      state: "VIC",
      postcode,
    };
    const full = formatAddress(parts);
    if (!full || seen.has(full)) continue;
    seen.add(full);
    out.push({ ...parts, full, key: `${postcode}:${street}:${parts.streetNumber}:${suburb}` });
  }
  const words = new Set(typed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const narrowed = out.filter((s) => words.has(s.suburb.toLowerCase()));
  return (narrowed.length ? narrowed : out).slice(0, 6);
}

/**
 * The search usually knows the street but not the number, so the number the
 * person already typed must survive the pick: typing "125 Plenty Road Bundoora"
 * and choosing "Plenty Road, Bundoora VIC 3083" must stay "125 Plenty Road",
 * never "1251 Plenty Road" and never a bare street.
 */
export function mergeTypedNumber(typed: string, suggestion: AddressSuggestion): AddressSuggestion {
  if (suggestion.streetNumber) return suggestion;
  const match = typed.trim().match(/^(\d{1,5}[A-Za-z]?)\s/);
  const number = match?.[1];
  if (!number) return suggestion;
  const parts: AddressParts = { ...suggestion, streetNumber: number };
  return { ...parts, full: formatAddress(parts), key: `${suggestion.key}:${number}` };
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
  if (!line.includes(",")) return "";
  const withoutPostcode = line.replace(/(?:\s+VIC)?\s+\d{4}\s*$/i, "");
  const tail = withoutPostcode.slice(withoutPostcode.lastIndexOf(",") + 1);
  return tail.replace(/\bVIC\b/gi, "").replace(/\s+/g, " ").trim();
}

// ---------- Decision 282 (Jo 25 Oct 2026): the property address is the ONLY duplicate key. ----------
// Pure normalisation shared by Add a job, Upload jobs, the website and Mitti pickup: unit / number / street /
// suburb / postcode, case- and abbreviation-insensitive ("Unit 2, 5 Smith St" = "2/5 smith street").
const STREET_WORDS: [RegExp, string][] = [
  [/\bst\b/g, "street"], [/\brd\b/g, "road"], [/\bave?\b/g, "avenue"], [/\bdr\b/g, "drive"], [/\bcr?t\b/g, "court"],
  [/\bcres\b/g, "crescent"], [/\bcr\b/g, "crescent"], [/\bpl\b/g, "place"], [/\bhwy\b/g, "highway"], [/\bblvd\b/g, "boulevard"],
  [/\bpde\b/g, "parade"], [/\btce\b/g, "terrace"], [/\bgr\b/g, "grove"], [/\bgrv\b/g, "grove"], [/\bcl\b/g, "close"], [/\bln\b/g, "lane"],
  [/\bcct\b/g, "circuit"], [/\besp\b/g, "esplanade"], [/\bsq\b/g, "square"], [/\bgdns\b/g, "gardens"],
];
const addrNorm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").replace(/\s+/g, " ").trim();

/** "Unit 2, 5 Smith St" / "U2 5 Smith Street" / "2 / 5 smith st" → "2/5 smith street". Empty when no street text. */
export function normaliseStreetLine(line: string | null | undefined): string {
  const raw = String(line ?? "");
  // "Unit 2, 5 Smith St, Bundoora VIC 3083": the unit's own comma is kept, everything after the street part goes.
  const unitLead = raw.match(/^\s*(?:unit|apt|apartment|flat|shop|u)\s*([0-9]+[a-z]?)\s*,\s*/i);
  const street = unitLead ? `${unitLead[1]}/${raw.slice(unitLead[0].length).split(",")[0]}` : raw.split(",")[0]!;
  let k = addrNorm(street);
  k = k.replace(/^(?:unit|apt|apartment|flat|shop|u)\s*([0-9]+[a-z]?)\s+(?=[0-9])/, "$1/");
  k = k.replace(/^([0-9]+[a-z]?)\s*\/\s*/, "$1/");
  for (const [re, full] of STREET_WORDS) k = k.replace(re, full);
  return k.replace(/\s+/g, " ").trim();
}

export type AddressKeyInput = { address_line: string | null | undefined; suburb: string | null | undefined; postcode: string | null | undefined };
/**
 * The duplicate key: street line + postcode (the postcode names the place more reliably than typed suburb spellings);
 * the suburb stands in only when no postcode is known anywhere. Null when there is no street to compare.
 */
export function addressKey(a: AddressKeyInput): string | null {
  const street = normaliseStreetLine(a.address_line);
  if (!street) return null;
  const postcode = String(a.postcode ?? "").match(/\d{4}/)?.[0] ?? extractPostcode(String(a.address_line ?? ""));
  const suburb = addrNorm(a.suburb).replace(/\bvic(toria)?\b/g, "").replace(/\s+/g, " ").trim();
  const place = postcode || suburb;
  return place ? `${street}|${place}` : null;
}
