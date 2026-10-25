// Decision 281 (Jo 25 Oct 2026: "automatically fix everything you can such as suburb etc, no stupid fix buttons").
// The portal completes an enquiry's address itself from the address lookup (the same Google Places AU provider Add a
// job uses): it fills ONLY the blanks — suburb, postcode, and the suburb baked into a one-line street — and never
// overwrites a value the owner gave. A lookup result is accepted only when it agrees with what is stored (same street
// number and street name, a Victorian postcode, the stored suburb/postcode when given) and only when exactly one
// suburb+postcode remains. PURE: no I/O. address-complete.server.ts does the lookups and the audited save.
import { splitAddress } from "./name-address-tidy.core";

export type StoredAddress = { addressLine: string | null; suburb: string | null; postcode: string | null };
/** One resolved lookup result (address-search "details" shape, or any provider's street / suburb / postcode / state). */
export type AddressCandidate = { label?: string | null; street?: string | null; suburb?: string | null; postcode?: string | null; state?: string | null };

export type AddressCompletion =
  | { kind: "complete"; street: string; suburb: string; postcode: string; filled: ("suburb" | "postcode" | "street")[]; candidate: string }
  | { kind: "unresolved"; reason: UnresolvedReason; candidates: string[] }
  | { kind: "nothing_missing" };
export type UnresolvedReason = "no_street" | "no_candidates" | "no_match" | "ambiguous";

export const ADDRESS_COMPLETED_EVENT = "address_completed";
export const ADDRESS_UNRESOLVED_EVENT = "address_lookup_unresolved";
/** One lookup per job per week: after an unresolved lookup the job is not looked up again until this many days pass. */
export const ADDRESS_LOOKUP_RETRY_DAYS = 7;
/** Backlog batch per 15-minute tick (oldest first). */
export const ADDRESS_COMPLETE_BATCH = 50;

export const isVicPostcode = (p: string | null | undefined) => /^(3\d{3}|8\d{3})$/.test((p ?? "").trim());

const STREET_TYPE_FULL: Record<string, string> = {
  st: "street", rd: "road", ave: "avenue", av: "avenue", ct: "court", dr: "drive", pde: "parade", cres: "crescent", cr: "crescent",
  hwy: "highway", pl: "place", tce: "terrace", blvd: "boulevard", bvd: "boulevard", gr: "grove", cl: "close", ln: "lane", cct: "circuit",
  sq: "square", esp: "esplanade", pkwy: "parkway", hts: "heights", gdns: "gardens", mt: "mount", nth: "north", sth: "south", e: "east", w: "west",
};
const NOISE = new Set(["vic", "victoria", "australia"]);

/** Lower-case word tokens with street-type abbreviations expanded ("Wattle St" and "wattle street" compare equal). */
export function addressTokens(text: string | null | undefined): string[] {
  return (text ?? "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean).map((w) => STREET_TYPE_FULL[w] ?? w).filter((w) => !NOISE.has(w));
}

export type ParsedStreet = { number: string; name: string[] };
/**
 * "12 wattle st", "Unit 3/22 High Street Road", "3/22 High St", "12A Wattle St" → the lot/house number and the street words
 * that follow it. Null when there is no street number (a lookup cannot be trusted without one).
 */
export function parseStreet(line: string | null | undefined): ParsedStreet | null {
  const text = (line ?? "").replace(/\s+/g, " ").trim();
  const m = text.match(/^(?:(?:unit|apt|apartment|flat|u|shop|lot)\s*\d+[a-z]?\s*[/,-]?\s*|\d+[a-z]?\s*\/\s*)?(\d+[a-z]?)(?:\s*-\s*\d+[a-z]?)?\s+(.+)$/i);
  if (!m) return null;
  const name = addressTokens(m[2]).filter((w) => !/^\d{4}$/.test(w));
  if (!name.length) return null;
  return { number: m[1]!.toLowerCase(), name };
}

const startsWith = (xs: string[], prefix: string[]) => prefix.length > 0 && prefix.length <= xs.length && prefix.every((w, i) => xs[i] === w);
const sameWords = (a: string | null | undefined, b: string | null | undefined) => addressTokens(a).join(" ") === addressTokens(b).join(" ");

/**
 * Does this lookup candidate agree with what is stored? Same street number, the candidate's street name at the start
 * of the stored line (anything after it must be the candidate's suburb — the website often bakes the suburb into the
 * street line), a Victorian postcode, VIC, and the stored suburb / postcode when the owner gave one.
 */
export function candidateAgrees(stored: StoredAddress, c: AddressCandidate): boolean {
  const mine = parseStreet(stored.addressLine);
  if (!mine) return false;
  const theirs = parseStreet(c.street) ?? parseStreet((c.label ?? "").split(",")[0]);
  if (!theirs || theirs.number !== mine.number) return false;
  const suburb = (c.suburb ?? "").trim();
  const postcode = (c.postcode ?? "").trim();
  const state = (c.state ?? "").trim().toUpperCase();
  if (!suburb || !isVicPostcode(postcode) || (state && state !== "VIC" && state !== "VICTORIA")) return false;
  if (!startsWith(mine.name, theirs.name)) return false;
  const rest = mine.name.slice(theirs.name.length).filter((w) => w !== postcode);
  if (rest.length && rest.join(" ") !== addressTokens(suburb).join(" ")) return false;
  if ((stored.suburb ?? "").trim() && !sameWords(stored.suburb, suburb)) return false;
  if ((stored.postcode ?? "").trim() && (stored.postcode ?? "").trim() !== postcode) return false;
  return true;
}

/** Autocomplete labels worth a details call: they start with the stored street number and name. */
export function shortlistLabels(stored: StoredAddress, labels: string[], max = 3): string[] {
  const mine = parseStreet(stored.addressLine);
  if (!mine) return [];
  return labels.filter((l) => { const p = parseStreet(l); return !!p && p.number === mine.number && (startsWith(p.name, mine.name) || startsWith(mine.name, p.name)); }).slice(0, max);
}

/** The lookup query: the stored street with whatever suburb / postcode the owner gave. */
export function lookupQuery(stored: StoredAddress): string {
  return [(stored.addressLine ?? "").replace(/\s+/g, " ").trim(), (stored.suburb ?? "").trim(), (stored.postcode ?? "").trim()].filter(Boolean).join(" ");
}

export const addressMissing = (s: StoredAddress) => !(s.suburb ?? "").trim() || !isVicPostcode(s.postcode);

/**
 * Decide the completion. Fills only the blanks: the stored suburb and postcode win when given; the street keeps the
 * owner's words (only the suburb/postcode/VIC baked into the line are split off, capitalisation tidied as decision 216).
 */
export function decideAddressCompletion(stored: StoredAddress, candidates: AddressCandidate[]): AddressCompletion {
  if (!addressMissing(stored)) return { kind: "nothing_missing" };
  const labels = candidates.map((c) => (c.label ?? [c.street, c.suburb, c.postcode].filter(Boolean).join(" ")).trim()).filter(Boolean);
  if (!parseStreet(stored.addressLine)) return { kind: "unresolved", reason: "no_street", candidates: labels };
  if (!candidates.length) return { kind: "unresolved", reason: "no_candidates", candidates: labels };
  const agreeing = candidates.filter((c) => candidateAgrees(stored, c));
  if (!agreeing.length) return { kind: "unresolved", reason: "no_match", candidates: labels };
  const distinct = new Map<string, AddressCandidate>();
  for (const c of agreeing) distinct.set(`${addressTokens(c.suburb).join(" ")}|${(c.postcode ?? "").trim()}`, c);
  if (distinct.size > 1) return { kind: "unresolved", reason: "ambiguous", candidates: labels };
  const c = [...distinct.values()][0]!;
  const suburb = (stored.suburb ?? "").trim() || (c.suburb ?? "").trim();
  const postcode = isVicPostcode(stored.postcode) ? (stored.postcode ?? "").trim() : (c.postcode ?? "").trim();
  const split = splitAddress(stored.addressLine, suburb, postcode);
  const street = split.street || (stored.addressLine ?? "").trim();
  const filled: ("suburb" | "postcode" | "street")[] = [];
  if (!(stored.suburb ?? "").trim()) filled.push("suburb");
  if (!isVicPostcode(stored.postcode)) filled.push("postcode");
  if (street !== (stored.addressLine ?? "").trim()) filled.push("street");
  return { kind: "complete", street, suburb, postcode, filled, candidate: (c.label ?? "").trim() || [c.street, c.suburb, c.postcode].filter(Boolean).join(" ") };
}

/** Jobs looked up within the retry window are skipped (one lookup per job per week, never repeated spam). */
export function lookupDue(lastLookupAt: string | null | undefined, now: number, days = ADDRESS_LOOKUP_RETRY_DAYS): boolean {
  if (!lastLookupAt) return true;
  const t = Date.parse(lastLookupAt);
  return !Number.isFinite(t) || now - t >= days * 86_400_000;
}
