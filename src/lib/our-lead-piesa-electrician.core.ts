// Decision 157 (Jo, 24 Oct 2026): on OUR leads (A2) the PIESA is done by the quoted installer's usual electrician —
// the one saved under My business (`installer_usual_electrician_saved` config events: name, licence, price inc GST) —
// at the rate entered at onboarding. If none is saved, or that electrician is not an approved REC on the portal, the
// office sends the PIESA to any approved REC in the area through the existing Choose trades / offer path.
// Decision 349 (Jo 25 Oct 2026, supersedes the "owner price unchanged" rule of decision 157): "we do not mark them up".
// When the installer's usual electrician does the PIESA the owner's safety-check line IS that electrician's onboarding
// rate (pass-through, e.g. $220); with OUR electrician (no usual one, or it can't take the job) the owner pays HIV's
// standard price (retail_estimator_settings.piesa_assessment_inc_gst, $349) and we pay that electrician their own agreed
// onboarding rate (electrician_rates PIESA row). `electricianSourceFor` keys the decision-142 fixes margin the same way.
// Decision 353 (Jo 25 Oct 2026): the usual electrician's REAL rate is THEIR OWN onboarding PIESA rate (their active
// `electrician_rates` PIESA row from REC onboarding) — never the price the installer typed on My business
// (`usual.priceIncGst`, kept only as a declared note). A usual electrician without an approved onboarding rate is not
// usable as "usual": the job falls back to our electrician at $349 (as decision 303 rules for unonboarded electricians).
// Decision 351 (Jo 25 Oct 2026): the fixes markup follows WHOSE electrician on BOTH routes (`electricianSourceFor` here,
// `electricianSourceForA1` for installer-supplied jobs). Decision 352: once the quote is out the owner's safety-check
// price is fixed — a later switch to our electrician never re-prices; we pay whoever does it their own onboarding rate.
// Pure rules only. A1 (installer's own customers) keeps `resolveMittiElectrician` for the PIESA line.
import type { UsualElectrician } from "./usual-electrician.core";

/** Rate ids on offers made before decision 353 (the My business price); new offers carry the electrician_rates row id. */
export const USUAL_ELECTRICIAN_RATE_ID_PREFIX = "usual_electrician:";
export const USUAL_ELECTRICIAN_APPLIED_EVENT = "piesa_usual_electrician_applied";
export const USUAL_ELECTRICIAN_BADGE = "Installer's usual electrician";

export type UsualMatchCandidate = {
  business_id: string;
  name: string | null;
  trading_name?: string | null;
  rec_number?: string | null;
  /** Licence numbers of the business's approved electricians (partner_workers.licence_number). */
  worker_licences?: (string | null | undefined)[];
  /** Existing eligibility blocker from `recEligibilityBlocker`; a blocked REC is never auto-selected. */
  blocker?: string | null;
  /** Decision 353: the business's ACTIVE onboarded PIESA rate (electrician_rates via selectAgreedRate), null = none. */
  piesa_rate?: { id: string; rate_inc_gst: number | string } | null;
};

export type OurLeadPiesaSelection =
  | { mode: "not_our_lead"; businessId: null; rateIncGst: null; note: null }
  | { mode: "office_pick"; businessId: null; rateIncGst: null; note: string }
  | { mode: "usual_not_onboarded"; businessId: null; rateIncGst: null; note: string }
  | { mode: "usual"; businessId: string; rateIncGst: number; note: string; rateId: string };

export const normaliseLicence = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normaliseName = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\b(pty|ltd|p\/l|electrical|electrician|electrics|services?|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/** The approved REC business that IS the installer's usual electrician: licence/REC number first, then an exact business name. */
export function matchUsualElectrician(usual: UsualElectrician, candidates: UsualMatchCandidate[]): UsualMatchCandidate | null {
  const lic = normaliseLicence(usual.licence);
  if (lic) {
    const byLicence = candidates.find((c) => normaliseLicence(c.rec_number) === lic || (c.worker_licences ?? []).some((w) => normaliseLicence(w) === lic));
    if (byLicence) return byLicence;
  }
  const nm = normaliseName(usual.name);
  if (!nm) return null;
  return candidates.find((c) => normaliseName(c.name) === nm || normaliseName(c.trading_name) === nm) ?? null;
}

export const NO_USUAL_ELECTRICIAN_NOTE = "The installer has no usual electrician saved — send the PIESA to any approved electrician in the area.";
export const usualNotOnboardedNote = (u: UsualElectrician) => `The installer's usual electrician (${u.name}, licence ${u.licence}) is not an approved electrician on the portal — send the PIESA to any approved electrician in the area.`;
export const usualBlockedNote = (u: UsualElectrician, blocker: string) => `The installer's usual electrician (${u.name}) can't take this job right now: ${blocker} Send the PIESA to any approved electrician in the area.`;
export const usualAppliedNote = (u: UsualElectrician, rateIncGst: number) => `${USUAL_ELECTRICIAN_BADGE}: ${u.name} at their onboarding rate of $${rateIncGst.toFixed(2)} inc GST.`;
export const usualNoRateNote = (u: UsualElectrician) => `The installer's usual electrician (${u.name}) has no approved onboarding PIESA rate — send the PIESA to any approved electrician in the area (owner pays the standard price).`;
/** Decision 353: the matched REC's own onboarded PIESA rate (inc GST, 2 dp), or null when it has none. */
export function onboardedPiesaRate(c: Pick<UsualMatchCandidate, "piesa_rate"> | null | undefined): { id: string; rateIncGst: number } | null {
  const r = c?.piesa_rate;
  const n = r ? Number(r.rate_inc_gst) : NaN;
  return r && Number.isFinite(n) && n > 0 ? { id: r.id, rateIncGst: Math.round(n * 100) / 100 } : null;
}

/**
 * Who should do the PIESA on this job and what we pay them.
 * `revision` = id of the config event the usual electrician came from (identity only since decision 353; the rate
 * reference kept on the offer is the electrician's own `electrician_rates` row id).
 */
export function ourLeadPiesaElectrician(i: { channel: string | null | undefined; usual: UsualElectrician | null; revision?: string | null; candidates: UsualMatchCandidate[] }): OurLeadPiesaSelection {
  if (i.channel === "installer_sourced") return { mode: "not_our_lead", businessId: null, rateIncGst: null, note: null };
  if (!i.usual) return { mode: "office_pick", businessId: null, rateIncGst: null, note: NO_USUAL_ELECTRICIAN_NOTE };
  const m = matchUsualElectrician(i.usual, i.candidates);
  if (!m) return { mode: "usual_not_onboarded", businessId: null, rateIncGst: null, note: usualNotOnboardedNote(i.usual) };
  if (m.blocker) return { mode: "usual_not_onboarded", businessId: null, rateIncGst: null, note: usualBlockedNote(i.usual, m.blocker) };
  // Decision 353: their own onboarding rate (electrician_rates), never the My business price; none → not usable as usual.
  const rate = onboardedPiesaRate(m);
  if (!rate) return { mode: "usual_not_onboarded", businessId: null, rateIncGst: null, note: usualNoRateNote(i.usual) };
  return { mode: "usual", businessId: m.business_id, rateIncGst: rate.rateIncGst, note: usualAppliedNote(i.usual, rate.rateIncGst), rateId: rate.id };
}

/**
 * The electrician's payable PIESA rate for one offer: the usual electrician's onboarding rate when the offer goes to
 * them on an our-lead job; otherwise that REC's office-agreed rate (HIV's standard rate for that electrician) unchanged.
 * Never the owner's price.
 */
export function piesaPayableRate(sel: OurLeadPiesaSelection, businessId: string, agreed: { id: string; rate: number } | null | undefined): { id: string; rate: number; source: "installer_usual_electrician" | "agreed_rate" } | null {
  if (sel.mode === "usual" && sel.businessId === businessId) return { id: sel.rateId, rate: sel.rateIncGst, source: "installer_usual_electrician" };
  return agreed ? { ...agreed, source: "agreed_rate" } : null;
}

/** Owner-facing safety-check line on an our-lead quote. Decision 373 (Jo 25 Oct 2026: "our leads we always charge
 *  $349 for the PIESA regardless") replaces 349 here: always HIV's standard price, whoever does it; the electrician is
 *  still paid their own onboarding rate (`piesaPayableRate`). `_sel` is kept so callers record which electrician was planned. */
export function ownerPiesaLineIncGst(standardIncGst: number, _sel: OurLeadPiesaSelection): number {
  return standardIncGst;
}

/** Decisions 349/351: whose electrician is doing the electrical work, on BOTH routes. `installer_usual` = the
 *  installer's own (usual / nominated) electrician (pass-through: no PIESA margin, no fixes margin); `ours` = Home
 *  Insulation Victoria's / an approved REC we chose (owner pays $349 for the PIESA and the decision-142 $100 on fixes). */
export type ElectricianSource = "installer_usual" | "ours";

/** Is the assigned electrician business the installer's usual electrician? Same identity rule as decision 157
 *  (`matchUsualElectrician`: licence/REC number first, then exact business name). No usual saved / no assignment → ours. */
export function electricianSourceFor(i: { usual: UsualElectrician | null; assigned: UsualMatchCandidate | null }): ElectricianSource {
  if (!i.usual || !i.assigned) return "ours";
  return matchUsualElectrician(i.usual, [i.assigned]) ? "installer_usual" : "ours";
}

/** Decision 351 (Jo 25 Oct 2026), installer-supplied jobs (A1): whose electrician is doing the work. The job's electrician
 *  choice (decision 289, `resolveElectricianChoice`: recorded → legacy answer → usual → HIV) of "hivic" → ours. "usual"
 *  (or a legacy "different" electrician the installer nominated) → `installer_usual` ONLY when the electrician actually
 *  assigned IS that nominated electrician (the approved REC the quote resolved — `nominatedBusinessIds` — or the My
 *  business usual electrician by licence/REC number, then exact name); anyone else doing it (HIV stepped in) → ours. */
export function electricianSourceForA1(i: { choice: "hivic" | "usual" | "different"; usual: UsualElectrician | null; nominatedBusinessIds: (string | null | undefined)[]; assigned: UsualMatchCandidate | null }): ElectricianSource {
  if (i.choice === "hivic" || !i.assigned) return "ours";
  if (i.nominatedBusinessIds.some((id) => !!id && id === i.assigned!.business_id)) return "installer_usual";
  if (i.choice === "usual") return electricianSourceFor({ usual: i.usual, assigned: i.assigned });
  return "ours";
}
