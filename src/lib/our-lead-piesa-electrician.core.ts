// Decision 157 (Jo, 24 Oct 2026): on OUR leads (A2) the PIESA is done by the quoted installer's usual electrician —
// the one saved under My business (`installer_usual_electrician_saved` config events: name, licence, price inc GST) —
// at the rate entered at onboarding. If none is saved, or that electrician is not an approved REC on the portal, the
// office sends the PIESA to any approved REC in the area through the existing Choose trades / offer path.
// The owner's quote is NOT changed by this: the owner pays HIV's standard safety-check price either way
// (retail_estimator_settings.piesa_assessment_inc_gst); only what we pay the electrician follows the onboarding rate.
// Pure rules only. A1 (installer's own customers) keeps `resolveMittiElectrician`; this never applies to them.
import type { UsualElectrician } from "./usual-electrician.core";

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
export const usualAppliedNote = (u: UsualElectrician) => `${USUAL_ELECTRICIAN_BADGE}: ${u.name} at their onboarding rate of $${u.priceIncGst.toFixed(2)} inc GST.`;

/**
 * Who should do the PIESA on this job and what we pay them.
 * `revision` = id of the config event the usual electrician came from (kept on the offer as the rate reference).
 */
export function ourLeadPiesaElectrician(i: { channel: string | null | undefined; usual: UsualElectrician | null; revision?: string | null; candidates: UsualMatchCandidate[] }): OurLeadPiesaSelection {
  if (i.channel === "installer_sourced") return { mode: "not_our_lead", businessId: null, rateIncGst: null, note: null };
  if (!i.usual) return { mode: "office_pick", businessId: null, rateIncGst: null, note: NO_USUAL_ELECTRICIAN_NOTE };
  const m = matchUsualElectrician(i.usual, i.candidates);
  if (!m) return { mode: "usual_not_onboarded", businessId: null, rateIncGst: null, note: usualNotOnboardedNote(i.usual) };
  if (m.blocker) return { mode: "usual_not_onboarded", businessId: null, rateIncGst: null, note: usualBlockedNote(i.usual, m.blocker) };
  return { mode: "usual", businessId: m.business_id, rateIncGst: i.usual.priceIncGst, note: usualAppliedNote(i.usual), rateId: `${USUAL_ELECTRICIAN_RATE_ID_PREFIX}${i.revision ?? "unknown"}` };
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

/** Owner-facing safety-check line on an our-lead quote: always HIV's standard price, whoever does the PIESA. */
export function ownerPiesaLineIncGst(standardIncGst: number, _sel: OurLeadPiesaSelection): number {
  return standardIncGst;
}
