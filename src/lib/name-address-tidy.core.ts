// Decision 216 / 238 (Jo 24 Oct): the portal tidies capitalisation itself and splits every address into
// street · suburb · postcode the same way for every source; the office only fixes what it cannot ("Fix details").
// PURE: no I/O. Used by the Enquiries Fix details pile (O4), the inline fix (applied on save) and intake.

const SMALL_PARTICLES = new Set(["de", "da", "di", "del", "della", "der", "den", "van", "von", "la", "le", "du", "dos", "das", "bin", "binti", "al"]);
const STREET_TYPES = [
  "street", "st", "road", "rd", "avenue", "ave", "av", "court", "ct", "drive", "dr", "parade", "pde", "crescent", "cres", "cr",
  "highway", "hwy", "place", "pl", "terrace", "tce", "boulevard", "blvd", "bvd", "grove", "gr", "close", "cl", "lane", "ln",
  "way", "circuit", "cct", "square", "sq", "rise", "walk", "esplanade", "esp", "parkway", "pkwy", "track", "trail", "view",
  "mews", "row", "glade", "green", "heights", "hts", "ridge", "vale", "loop", "link", "outlook", "promenade", "quay", "chase", "gardens", "gdns",
];
const STREET_TYPE_SET = new Set(STREET_TYPES);
const STATE_WORDS = new Set(["vic", "victoria"]);
/** Keyboard mashes and placeholder words the website has received instead of a name. */
const JUNK_WORDS = new Set(["asdf", "asdfg", "asdfgh", "qwerty", "qwer", "zxcv", "test", "testing", "abc", "aaa", "xxx", "na", "n/a", "none", "nil", "name", "unknown", "anon", "anonymous", "me", "owner", "homeowner", "customer", "hi", "hello"]);

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

export type NameProblem = "missing" | "one_word" | "junk";

/** Why the office must fix a name by hand (null = the portal's own tidy is enough). */
export function nameProblem(raw: string | null | undefined): NameProblem | null {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "missing";
  const words = name.split(" ").filter(Boolean);
  const lower = name.toLowerCase();
  const lettersOnly = lower.replace(/[^a-z]/g, "");
  if (/[@\d]/.test(name) || JUNK_WORDS.has(lower) || words.every((w) => JUNK_WORDS.has(w.toLowerCase()))) return "junk";
  if (lettersOnly.length < 2 || !/[aeiouy]/.test(lettersOnly) || /(.)\1\1/.test(lettersOnly)) return "junk";
  if (words.length < 2) return "one_word";
  if (words.some((w) => w.replace(/[^A-Za-z]/g, "").length === 0)) return "junk";
  return null;
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

export type DetailsProblem = "name_missing" | "name_one_word" | "name_junk" | "street_missing" | "suburb_missing" | "postcode_missing";
export const DETAILS_PROBLEM_LABEL: Record<DetailsProblem, string> = {
  name_missing: "No name", name_one_word: "First name only", name_junk: "Name looks wrong",
  street_missing: "No street", suburb_missing: "Suburb not split", postcode_missing: "No postcode",
};

export type TidiedDetails = { fullName: string; street: string; suburb: string; postcode: string; problems: DetailsProblem[]; changed: boolean };

/**
 * The automatic tidy (capitalisation + address split) and what is still wrong after it. `problems` empty = nothing for the
 * office (the tidy is applied when the record is saved, and at intake). `changed` = the tidy differs from what is stored.
 */
export function tidyEnquiryDetails(i: { fullName: string | null; addressLine: string | null; suburb: string | null; postcode: string | null }): TidiedDetails {
  const fullName = tidyPersonName(i.fullName);
  const split = splitAddress(i.addressLine, i.suburb, i.postcode);
  const problems: DetailsProblem[] = [];
  const np = nameProblem(fullName);
  if (np) problems.push(`name_${np}` as DetailsProblem);
  if (!split.street) problems.push("street_missing");
  if (!split.suburb) problems.push("suburb_missing");
  if (!/^[38]\d{3}$/.test(split.postcode)) problems.push("postcode_missing");
  const changed = fullName !== (i.fullName ?? "").trim() || split.street !== (i.addressLine ?? "").trim() || split.suburb !== (i.suburb ?? "").trim() || split.postcode !== (i.postcode ?? "").trim();
  return { fullName, street: split.street, suburb: split.suburb, postcode: split.postcode, problems, changed };
}

/** Fix details pile membership (decision 238/239): only what the automatic tidy cannot fix. */
export const needsFixDetails = (i: Parameters<typeof tidyEnquiryDetails>[0]) => tidyEnquiryDetails(i).problems.length > 0;

/** Office save: validates the hand-fixed values after tidying them. Returns errors (empty = may save). */
export function fixDetailsErrors(v: { fullName: string; street: string; suburb: string; postcode: string }): string[] {
  const t = tidyEnquiryDetails({ fullName: v.fullName, addressLine: v.street, suburb: v.suburb, postcode: v.postcode });
  return t.problems.map((p) => DETAILS_PROBLEM_LABEL[p]);
}
