import { num, norm } from "./mitti.core";

export const MITTI_ELECTRICIAN_OPTIONS = ["Home Insulation Victoria electrician", "My usual electrician", "A different electrician"] as const;
export type MittiElectricianOption = "hivic" | "usual" | "different";
export type UsualElectrician = { name: string; licence: string; priceIncGst: number };
export const USUAL_ELECTRICIAN_EVENT = "installer_usual_electrician_saved";
export const MISSING_USUAL_ELECTRICIAN = "Installer has no usual electrician saved";
export const MITTI_INSTALLER_FEE_INC_GST = 349;
export const MITTI_HIV_ELECTRICIAN_INC_GST = 349;

export function electricianOption(value: string | null | undefined): MittiElectricianOption | null {
  const v = norm(value);
  const i = MITTI_ELECTRICIAN_OPTIONS.findIndex((o) => norm(o) === v);
  return i === 0 ? "hivic" : i === 1 ? "usual" : i === 2 ? "different" : null;
}

export function usualElectrician(value: unknown): UsualElectrician | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = typeof v['name'] === "string" ? v['name'].trim() : "";
  const licence = typeof v['licence'] === "string" ? v['licence'].trim() : "";
  const priceIncGst = typeof v['priceIncGst'] === "number" ? v['priceIncGst'] : num(typeof v['priceIncGst'] === "string" ? v['priceIncGst'] : null);
  if (!name || !licence || priceIncGst == null || !Number.isFinite(priceIncGst) || priceIncGst < 0 || priceIncGst > 1_000_000) return null;
  return { name, licence, priceIncGst: Math.round(priceIncGst * 100) / 100 };
}

export function resolveMittiElectrician(input: {
  choice: MittiElectricianOption | null; usual: UsualElectrician | null;
  different: { name: string | null; licence: string | null; priceIncGst: string | null };
}) {
  if (input.choice === "hivic") return { ready: true, choice: input.choice, priceIncGst: MITTI_HIV_ELECTRICIAN_INC_GST, name: null, licence: null, source: "hivic" as const, reasons: [] as string[], needsProfile: false };
  const saved = input.choice === "usual" ? usualElectrician(input.usual) : input.choice === "different" ? usualElectrician(input.different) : null;
  const reason = input.choice === "usual" ? MISSING_USUAL_ELECTRICIAN : input.choice === "different" ? "Different electrician name, licence number and price are required" : "Electrician arrangement is not decided";
  return { ready: !!saved, choice: input.choice, priceIncGst: saved?.priceIncGst ?? null, name: saved?.name ?? null, licence: saved?.licence ?? null,
    source: input.choice === "usual" ? "installer_profile" as const : "mitti_form" as const, reasons: saved ? [] : [reason], needsProfile: input.choice === "usual" && !saved };
}

export type MittiElectricianResolution = ReturnType<typeof resolveMittiElectrician>;
/** Approved by Jo 24 Oct 2026 (decision 83; kept unchanged by decision 113). The brand prefix is added by brandSmsBody. */
export const usualElectricianReminderBody = (jobNumber: string, url: string) =>
  `To send the quote for ${jobNumber}, we need your usual electrician: name, licence number and price (inc GST). Add them once in My business: ${url}`;