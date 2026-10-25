// Decision 216 / 238 (Jo 24 Oct): the portal tidies capitalisation itself and splits every address into
// street · suburb · postcode the same way for every source. Decision 281 (Jo 25 Oct): what the split cannot read is
// completed by the address lookup (address-complete.core), never by an office button; a first-name-only, odd or
// missing name is tidied to what it is and blocks nothing. PURE: no I/O. Used by Enquiries (O4), the audited
// enquiry details save and intake.

const SMALL_PARTICLES = new Set(["de", "da", "di", "del", "della", "der", "den", "van", "von", "la", "le", "du", "dos", "das", "bin", "binti", "al"]);
const STREET_TYPES = [
  "street", "st", "road", "rd", "avenue", "ave", "av", "court", "ct", "drive", "dr", "parade", "pde", "crescent", "cres", "cr",
  "highway", "hwy", "place", "pl", "terrace", "tce", "boulevard", "blvd", "bvd", "grove", "gr", "close", "cl", "lane", "ln",
  "way", "circuit", "cct", "square", "sq", "rise", "walk", "esplanade", "esp", "parkway", "pkwy", "track", "trail", "view",
  "mews", "row", "glade", "green", "heights", "hts", "ridge", "vale", "loop", "link", "outlook", "promenade", "quay", "chase", "gardens", "gdns",
];
const STREET_TYPE_SET = new Set(STREET_TYPES);
const STATE_WORDS = new Set(["vic", "victoria"]);

/** One word with the first letter up; Mc/Mac, O', hyphenated and apostrophe parts handled. */
function capWord(word: string, index: number): string {
  if (!word) return word;
  if (/\d/.test(word)) return word.toUpperCase(); // "12a" → "12A", "3/22" unchanged
  const lower = word.toLowerCase();
  if (index > 0 && SMALL_PARTICLES.has(lower)) return lower;
  const up = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return lower
    .split("-")
    .map((part) =>
      part
        .split(/(['’])/)
        .map((p) => (p === "'" || p === "’" ? p : up(p)))
        .join("")
        .replace(/^Mc([a-z])/, (_m, c: string) => `Mc${c.toUpperCase()}`),
    )
    .join("-");
}

/** "MARGARET DOYLE" → "Margaret Doyle", "o'connell" → "O'Connell", "mcdonald" → "McDonald". Mixed-case input is kept. */
export function tidyPersonName(raw: string | null | undefined): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (!hasCaseProblem(collapsed)) return collapsed;
  return collapsed.split(" ").map((w, i) => capWord(w, i)).join(" ");
}

/** True when a name or address is ALL CAPS or all lower case (the 17 case problems in decision 216). */
export function hasCaseProblem(raw: string | null | undefined): boolean {
  const letters = (raw ?? "").replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase() || letters === letters.toLowerCase();
}

export type AddressSplit = { street: string; suburb: string; postcode: string; state: string };

const titleAddress = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (!hasCaseProblem(t)) return t;
  // Street and suburb words are all capitalised ("De Lacy Street", "Box Hill North"); unit numbers stay as typed.
  return t.split(" ").map((w) => capWord(w, 0)).join(" ");
};

/** Last standalone Victorian postcode (3000–3999 or 8000–8999) in the text. */
function postcodeIn(text: string): string {
  const runs = [...text.matchAll(/(?:^|\D)([38]\d{3})(?=\D|$)/g)].map((m) => m[1]!);
  return runs.at(-1) ?? "";
}

/**
 * Splits a website one-line address ("12 wattle st clayton", "8 Carrington Rd, Box Hill 3128", "8 Carrington Rd, Box Hill VIC 3128")
 * into street / suburb / postcode. Already-split values (suburb / postcode given) win. Never invents a suburb or postcode:
 * what it cannot read stays blank so the office fills it.
 */
export function splitAddress(line: string | null | undefined, suburb?: string | null, postcode?: string | null): AddressSplit {
  let text = (line ?? "").replace(/\s+/g, " ").trim().replace(/,\s*$/, "");
  const givenSuburb = (suburb ?? "").trim();
  const givenPostcode = (postcode ?? "").trim();
  const pc = givenPostcode || postcodeIn(text);
  // Remove a trailing "VIC 3128" / "3128" / "Victoria" from the line.
  text = text.replace(/[,\s]*\b(vic|victoria)\b\.?(?=[,\s]*(\d{4})?\s*$)/i, "").replace(new RegExp(`[,\\s]*${pc || "\\d{4}"}\\s*$`), "").replace(/[,\s]*\b(vic|victoria)\b\.?\s*$/i, "").trim().replace(/,\s*$/, "");
  let street = text;
  let sub = givenSuburb;
  if (!sub) {
    if (text.includes(",")) {
      const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) { sub = parts.pop()!; street = parts.join(", "); }
    } else {
      const words = text.split(" ");
      let idx = -1;
      const isType = (w: string | undefined) => !!w && STREET_TYPE_SET.has(w.toLowerCase().replace(/\.$/, ""));
      // The last street-type word that is NOT followed by another one ("High Street Road" has no suburb to split off).
      for (let i = words.length - 2; i >= 1; i--) if (isType(words[i]) && !isType(words[i + 1])) { idx = i; break; } else if (isType(words[i + 1])) break;
      if (idx > 0) { street = words.slice(0, idx + 1).join(" "); sub = words.slice(idx + 1).join(" "); }
    }
  } else {
    // Suburb stored separately: strip it from the end of the line if the website baked it in.
    const re = new RegExp(`[,\\s]+${givenSuburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    street = text.replace(re, "").trim();
  }
  sub = sub.split(" ").filter((w) => !STATE_WORDS.has(w.toLowerCase())).join(" ").trim();
  return { street: titleAddress(street), suburb: titleAddress(sub), postcode: pc, state: "VIC" };
}

/** What the address is still missing after the tidy (decision 281: the lookup fills these; names are never a problem). */
export type DetailsProblem = "street_missing" | "suburb_missing" | "postcode_missing";
export const DETAILS_PROBLEM_LABEL: Record<DetailsProblem, string> = { street_missing: "No street", suburb_missing: "No suburb yet", postcode_missing: "No postcode yet" };

export type TidiedDetails = { fullName: string; street: string; suburb: string; postcode: string; problems: DetailsProblem[]; changed: boolean };

/**
 * The automatic tidy (capitalisation + address split) and which address parts are still blank after it (the automatic
 * lookup fills them; the list shows them as stored meanwhile). `changed` = the tidy differs from what is stored.
 */
export function tidyEnquiryDetails(i: { fullName: string | null; addressLine: string | null; suburb: string | null; postcode: string | null }): TidiedDetails {
  const fullName = tidyPersonName(i.fullName);
  const split = splitAddress(i.addressLine, i.suburb, i.postcode);
  const problems: DetailsProblem[] = [];
  if (!split.street) problems.push("street_missing");
  if (!split.suburb) problems.push("suburb_missing");
  if (!/^[38]\d{3}$/.test(split.postcode)) problems.push("postcode_missing");
  const changed = fullName !== (i.fullName ?? "").trim() || split.street !== (i.addressLine ?? "").trim() || split.suburb !== (i.suburb ?? "").trim() || split.postcode !== (i.postcode ?? "").trim();
  return { fullName, street: split.street, suburb: split.suburb, postcode: split.postcode, problems, changed };
}
