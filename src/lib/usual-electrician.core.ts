import { num, norm } from "./mitti.core";

export const MITTI_ELECTRICIAN_OPTIONS = ["Home Insulation Victoria electrician", "My usual electrician", "A different electrician"] as const;
export type MittiElectricianOption = "hivic" | "usual" | "different";
/** Declared by the installer under My business (decisions 157/173); email/phone (decision 303) let the portal invite that
 *  electrician to onboard when they are not an approved REC yet. Declared, not verified. Decision 369 (Jo 25 Oct 2026):
 *  My business no longer asks for the electrician's price — decision 353 made the electrician's own onboarding rate the
 *  only rate. `priceIncGst` is kept only on records saved before then (history / legacy reads); new saves have none. */
export type UsualElectrician = { name: string; licence: string; priceIncGst?: number | null; email?: string | null; phone?: string | null };
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
  // Decision 369: the price is optional (old records keep theirs); a price that is present must still be sane.
  const rawPrice = v['priceIncGst'];
  const priceIncGst = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" && rawPrice.trim() ? num(rawPrice) : null;
  if (!name || !licence) return null;
  if (priceIncGst != null && (!Number.isFinite(priceIncGst) || priceIncGst < 0 || priceIncGst > 1_000_000)) return null;
  const email = typeof v['email'] === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v['email'].trim()) ? v['email'].trim().toLowerCase() : null;
  const phone = typeof v['phone'] === "string" && v['phone'].replace(/\D/g, "").length >= 8 ? v['phone'].trim() : null;
  return { name, licence, ...(priceIncGst != null ? { priceIncGst: Math.round(priceIncGst * 100) / 100 } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

export type MittiElectricianSource = "hivic" | "installer_profile" | "mitti_form" | "approved_rec";
/** The one electrician record the quote pipeline snapshots per quote (`mitti_quote_electrician_snapshot`). Decision 303 adds
 *  `approved_rec` (price = that REC's onboarded PIESA rate, `recBusinessId`/`rateId` set) and `notOnboarded` (held). */
export type MittiElectricianResolution = {
  ready: boolean; choice: MittiElectricianOption | null; priceIncGst: number | null; name: string | null; licence: string | null;
  source: MittiElectricianSource; reasons: string[]; needsProfile: boolean;
  recBusinessId?: string | null; rateId?: string | null;
  notOnboarded?: { name: string; licence: string | null; email: string | null } | null;
};

/** Legacy declared-price resolution (kept so records saved before 25 Oct 2026 still read); the live pipeline wraps it with
 *  `onboardedElectricianResolution` (rec-onboarded.core, decision 303). `standardPiesaIncGst` = HIV's standard owner line. */
export function resolveMittiElectrician(input: {
  choice: MittiElectricianOption | null; usual: UsualElectrician | null;
  different: { name: string | null; licence: string | null; priceIncGst: string | null };
  standardPiesaIncGst?: number | null;
}): MittiElectricianResolution {
  const standard = input.standardPiesaIncGst != null && Number.isFinite(input.standardPiesaIncGst) && input.standardPiesaIncGst > 0 ? Math.round(input.standardPiesaIncGst * 100) / 100 : MITTI_HIV_ELECTRICIAN_INC_GST;
  if (input.choice === "hivic") return { ready: true, choice: input.choice, priceIncGst: standard, name: null, licence: null, source: "hivic", reasons: [], needsProfile: false };
  // Decision 369 only stops My business asking for the usual electrician's price; the Mitti "different electrician"
  // answers keep their legacy shape (name, licence and price) unchanged.
  const diff = input.choice === "different" ? usualElectrician(input.different) : null;
  const saved = input.choice === "usual" ? usualElectrician(input.usual) : diff && diff.priceIncGst != null ? diff : null;
  const reason = input.choice === "usual" ? MISSING_USUAL_ELECTRICIAN : input.choice === "different" ? "Different electrician name, licence number and price are required" : "Electrician arrangement is not decided";
  return { ready: !!saved, choice: input.choice, priceIncGst: saved?.priceIncGst ?? null, name: saved?.name ?? null, licence: saved?.licence ?? null,
    source: input.choice === "usual" ? "installer_profile" : "mitti_form", reasons: saved ? [] : [reason], needsProfile: input.choice === "usual" && !saved };
}
/** Approved by Jo 24 Oct 2026 (decision 83; kept unchanged by decision 113). The brand prefix is added by brandSmsBody. */
export const usualElectricianReminderBody = (jobNumber: string, url: string) =>
  `To send the quote for ${jobNumber}, we need your usual electrician: name, licence number and price (inc GST). Add them once in My business: ${url}`;