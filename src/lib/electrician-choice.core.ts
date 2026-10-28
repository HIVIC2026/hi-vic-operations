// Decision 289 (Jo 25 Oct 2026): the electrician is chosen ONCE, at Add a job — "Electrical safety check by: Home
// Insulation Victoria's electrician / My usual electrician (<name>)" — and never asked again (not in Mitti, not on the
// price card). The second option exists only while a usual electrician is saved in My business; since Jo 28 Oct 2026
// (spec rule 3) it can be picked, and is the default, only once that electrician has finished signing up.
// Stored on the job as the append-only `electrician_choice_set` workflow event (latest wins). An installer who wants
// another electrician sets them in My business; the retired "a different electrician" path is gone.
// PURE: options, default, validation, the event shape and the one resolver the quote pipeline reads. No I/O.
import type { UsualElectrician } from "./usual-electrician.core";
import { approvedRecFor, type ApprovedRecCandidate } from "./rec-onboarded.core";

export const ELECTRICIAN_CHOICE_EVENT = "electrician_choice_set";
export type ElectricianChoice = "hivic" | "usual";
export const ELECTRICIAN_CHOICE_QUESTION = "Electrical safety check by";
export const ELECTRICIAN_CHOICE_HIVIC = "Home Insulation Victoria's electrician";
export const usualElectricianOptionLabel = (name: string) => `My usual electrician (${name})`;
export const ELECTRICIAN_CHOICE_ISSUES = {
  missing: "Choose who does the electrical safety check.",
  usual: "You have no usual electrician saved — add them under My business first, or choose Home Insulation Victoria's electrician.",
} as const;

/** Jo 28 Oct 2026 (spec rule 3): what Add a job knows about the usual electrician — the name, and whether they have
 *  finished signing up with us with an agreed rate. Never a rate or price (crew rule). Missing `onboarded` = not yet. */
export type AddJobUsualElectrician = { name: string; onboarded?: boolean | null };
/** The exact greyed text shown under a usual electrician who hasn't finished signing up. */
export const usualNotSignedUpText = (name: string) => `${name} — not signed up with us yet. They need to finish before you can choose them.`;
export type ElectricianChoiceOption = { value: ElectricianChoice; label: string; disabled?: boolean; note?: string };

/** The radio options Add a job shows: HIV always; "My usual electrician (<name>)" only when one is saved, greyed out
 *  (disabled, with the exact text) until they have finished signing up. */
export function electricianChoiceOptions(usual: AddJobUsualElectrician | null | undefined): ElectricianChoiceOption[] {
  const out: ElectricianChoiceOption[] = [{ value: "hivic", label: ELECTRICIAN_CHOICE_HIVIC }];
  if (usual?.name) out.unshift(usual.onboarded ? { value: "usual", label: usualElectricianOptionLabel(usual.name) } : { value: "usual", label: usualElectricianOptionLabel(usual.name), disabled: true, note: usualNotSignedUpText(usual.name) });
  return out;
}

/** Add a job default = the usual electrician only once they have finished signing up, else Home Insulation Victoria's. */
export const defaultElectricianChoice = (usual: AddJobUsualElectrician | null | undefined): ElectricianChoice => (usual?.name && usual.onboarded ? "usual" : "hivic");

/** Bulk upload / quote pipeline default, unchanged by rule 3 (bulk upload is not used): usual when saved, else HIV. */
export const savedUsualDefault = (usual: Pick<UsualElectrician, "name"> | null | undefined): ElectricianChoice => (usual?.name ? "usual" : "hivic");

/** The saved-electrician check only (no onboarding check): bulk upload and the record step. */
export function savedElectricianChoiceProblem(choice: ElectricianChoice | null | undefined, usual: Pick<UsualElectrician, "name"> | null | undefined): string | null {
  if (choice !== "hivic" && choice !== "usual") return ELECTRICIAN_CHOICE_ISSUES.missing;
  if (choice === "usual" && !usual?.name) return ELECTRICIAN_CHOICE_ISSUES.usual;
  return null;
}

/** Why the Add a job choice cannot be saved (null = fine). Required; "usual" needs a saved usual electrician who has
 *  finished signing up (the greyed text otherwise). */
export function electricianChoiceProblem(choice: ElectricianChoice | null | undefined, usual: AddJobUsualElectrician | null | undefined): string | null {
  const saved = savedElectricianChoiceProblem(choice, usual);
  if (saved) return saved;
  if (choice === "usual" && usual && !usual.onboarded) return usualNotSignedUpText(usual.name);
  return null;
}

/** Onboarded = the usual electrician is an approved REC with an agreed rate (`approvedRecFor`, decision 303). An
 *  installer that pays its own electricians passes the same flat price the quote pipeline uses (no REC rate by design). */
export function usualElectricianOnboarded(usual: { name: string | null; licence: string | null }, candidates: ApprovedRecCandidate[], flatPiesaIncGst: number | null = null): boolean {
  const { rec } = approvedRecFor(usual, candidates, flatPiesaIncGst);
  return !!rec && rec.piesaRateIncGst > 0;
}

/** What the event stores: the choice, and the usual electrician's name/licence at the time (declared, not verified). */
export type ElectricianChoiceRecord = { choice: ElectricianChoice; usual_name: string | null; usual_licence: string | null; source: "add_job" | "bulk_upload" | "default" | "installer_switch" };
export function electricianChoiceRecord(choice: ElectricianChoice, usual: UsualElectrician | null, source: ElectricianChoiceRecord["source"]): ElectricianChoiceRecord {
  return { choice, usual_name: choice === "usual" ? usual?.name ?? null : null, usual_licence: choice === "usual" ? usual?.licence ?? null : null, source };
}
export const electricianChoiceSummary = (r: ElectricianChoiceRecord) => (r.choice === "usual" ? `Electrical safety check by the installer's usual electrician${r.usual_name ? ` (${r.usual_name})` : ""}` : "Electrical safety check by Home Insulation Victoria's electrician");

/** Reads a stored `electrician_choice_set` event back; anything else → null (never guessed). */
export function electricianChoiceFromEvent(details: unknown): ElectricianChoice | null {
  const c = details && typeof details === "object" ? (details as Record<string, unknown>)["choice"] : null;
  return c === "hivic" || c === "usual" ? c : null;
}

/** The ONE rule the quote pipeline uses: the job's recorded choice first; an old Mitti/price-card answer next (forms and
 *  `installer_price_set` records from before 25 Oct may still carry one, including "a different electrician"); otherwise
 *  the usual electrician when saved, else Home Insulation Victoria's. Never undecided. */
export function resolveElectricianChoice(i: { recorded: ElectricianChoice | null; legacy: "hivic" | "usual" | "different" | string | null | undefined; usual: UsualElectrician | null }): "hivic" | "usual" | "different" {
  if (i.recorded) return i.recorded;
  if (i.legacy === "hivic" || i.legacy === "usual" || i.legacy === "different") return i.legacy;
  return savedUsualDefault(i.usual);
}

/** Plain read-only line for the job page / price card. */
export function electricianChoiceLine(choice: "hivic" | "usual" | "different", usual: Pick<UsualElectrician, "name"> | null | undefined, legacyName?: string | null): string {
  if (choice === "hivic") return ELECTRICIAN_CHOICE_HIVIC;
  if (choice === "usual") return usual?.name ? usualElectricianOptionLabel(usual.name) : "My usual electrician (not saved yet — add them under My business)";
  return `A different electrician${legacyName ? ` (${legacyName})` : ""}`;
}
