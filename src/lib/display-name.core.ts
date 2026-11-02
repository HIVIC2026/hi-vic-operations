import { capWord } from "./name-address-tidy.core";

/** Words that stay in capitals inside an all-caps name. */
export const DISPLAY_NAME_KEEP_UPPER: ReadonlySet<string> = new Set([
  "PTY", "LTD", "VIC", "ACT", "NSW", "QLD", "EEC", "REC", "HVAC", "AC", "ABN",
]);

/**
 * Display only (never stored, never on official forms): an entirely-capitals name shows in normal case.
 * "RAPID INSULATION" → "Rapid Insulation". Names with any lower case ("INSolation") are kept as typed.
 */
export function displayName(raw: string | null | undefined): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (/[a-z]/.test(collapsed) || !/[A-Z]/.test(collapsed)) return collapsed;
  return collapsed
    .split(" ")
    .map((w) => (DISPLAY_NAME_KEEP_UPPER.has(w) || !/[A-Z]/.test(w) ? w : capWord(w, 0)))
    .join(" ");
}
