// Decision 289 (Jo 25 Oct 2026): the electrician is chosen ONCE, at Add a job — "Electrical safety check by: Home
// Insulation Victoria's electrician / My usual electrician (<name>)" — and never asked again (not in Mitti, not on the
// price card). The second option exists only while a usual electrician is saved in My business, and is the default then.
// Stored on the job as the append-only `electrician_choice_set` workflow event (latest wins). An installer who wants
// another electrician sets them in My business; the retired "a different electrician" path is gone.
// PURE: options, default, validation, the event shape and the one resolver the quote pipeline reads. No I/O.
import type { UsualElectrician } from "./usual-electrician.core";

export const ELECTRICIAN_CHOICE_EVENT = "electrician_choice_set";
export type ElectricianChoice = "hivic" | "usual";
export const ELECTRICIAN_CHOICE_QUESTION = "Electrical safety check by";
export const ELECTRICIAN_CHOICE_HIVIC = "Home Insulation Victoria's electrician";
export const usualElectricianOptionLabel = (name: string) => `My usual electrician (${name})`;
export const ELECTRICIAN_CHOICE_ISSUES = {
  missing: "Choose who does the electrical safety check.",
  usual: "You have no usual electrician saved — add them under My business first, or choose Home Insulation Victoria's electrician.",
  notOnboarded: "Your usual electrician isn't onboarded with Home Insulation Victoria yet — choose Home Insulation Victoria's electrician.",
} as const;

/** A3: the usual electrician as Add a job sees it — saved, and whether they are onboarded. */
export type UsualStatus = { name: string; onboarded: boolean } | null;
/** Only an onboarded usual electrician can be offered, defaulted or chosen. */
export const addJobUsual = (s: UsualStatus): { name: string } | null => (s?.onboarded ? { name: s.name } : null);
/** Add a job's electrician problem: the usual rule, plus "usual" needs that electrician to be onboarded. */
export function addJobElectricianProblem(choice: ElectricianChoice | null | undefined, s: UsualStatus): string | null {
  const base = electricianChoiceProblem(choice, s ? { name: s.name } : null);
  if (base) return base;
  if (choice === "usual" && !s?.onboarded) return ELECTRICIAN_CHOICE_ISSUES.notOnboarded;
  return null;
}

/** The radio options Add a job shows: HIV always; "My usual electrician (<name>)" only when one is saved. */
export function electricianChoiceOptions(usual: Pick<UsualElectrician, "name"> | null | undefined): { value: ElectricianChoice; label: string }[] {
  const out: { value: ElectricianChoice; label: string }[] = [{ value: "hivic", label: ELECTRICIAN_CHOICE_HIVIC }];
  if (usual?.name) out.unshift({ value: "usual", label: usualElectricianOptionLabel(usual.name) });
  return out;
}

/** Default = the usual electrician when one is set, else Home Insulation Victoria's (also the bulk-upload rule). */
export const defaultElectricianChoice = (usual: Pick<UsualElectrician, "name"> | null | undefined): ElectricianChoice => (usual?.name ? "usual" : "hivic");

/** Why the choice cannot be saved (null = fine). Required; "usual" needs a saved usual electrician. */
export function electricianChoiceProblem(choice: ElectricianChoice | null | undefined, usual: Pick<UsualElectrician, "name"> | null | undefined): string | null {
  if (choice !== "hivic" && choice !== "usual") return ELECTRICIAN_CHOICE_ISSUES.missing;
  if (choice === "usual" && !usual?.name) return ELECTRICIAN_CHOICE_ISSUES.usual;
  return null;
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
  return defaultElectricianChoice(i.usual);
}

/** Plain read-only line for the job page / price card. */
export function electricianChoiceLine(choice: "hivic" | "usual" | "different", usual: Pick<UsualElectrician, "name"> | null | undefined, legacyName?: string | null): string {
  if (choice === "hivic") return ELECTRICIAN_CHOICE_HIVIC;
  if (choice === "usual") return usual?.name ? usualElectricianOptionLabel(usual.name) : "My usual electrician (not saved yet — add them under My business)";
  return `A different electrician${legacyName ? ` (${legacyName})` : ""}`;
}
