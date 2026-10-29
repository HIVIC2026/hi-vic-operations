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
// Decision 374 (Jo 25 Oct 2026: "we ALWAYS choose the electrician – not the installer choosing") REPLACES 157/349/353
// for our leads (A2): the installer's usual electrician no longer gets first go. The PIESA offer goes to the nearest
// approved REC covering the postcode (decision 246 automatic offers, `auto-offer.core`), the office steps in only if
// nobody takes it, so on A2 the electrician is always OURS (`electricianSourceForJob` → "ours": owner pays $349 for the
// PIESA (decision 373) and +$100 on fixes (decision 351), we pay that REC their own `electrician_rates` onboarding rate).
// 29 Oct 2026 replaces decision 374 for routing: Ready Check installer's approved usual electrician gets the first offer;
// money unchanged ($349 owner line, the electrician is paid their own onboarding rate).
// Old offers/quotes made under 157/349 keep their snapshots as history. A1 (installer's own customers) is unchanged:
// the electrician chosen at Add a job (decision 289), `electricianSourceForA1`, `resolveMittiElectrician`.
// Pure rules only.
import type { UsualElectrician } from "./usual-electrician.core";

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

export const normaliseLicence = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normaliseName = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\b(pty|ltd|p\/l|electrical|electrician|electrics|services?|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/** The approved REC business that IS the installer's usual electrician: licence/REC number first, then an exact business
 *  name. Used for installer-supplied jobs (A1, decision 351) and REC onboarding (decision 303) only — never to route an
 *  our-lead PIESA (decision 374). */
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

/** Owner-facing safety-check line on an our-lead quote. Decision 373 (Jo 25 Oct 2026: "our leads we always charge
 *  $349 for the PIESA regardless"): always HIV's standard price; since decision 374 the electrician is always ours and is
 *  paid their own onboarding rate (`electrician_rates`, snapshotted on the offer). */
export function ownerPiesaLineIncGst(standardIncGst: number): number {
  return standardIncGst;
}

/** Decisions 349/351/374: whose electrician is doing the electrical work. `installer_usual` = the installer's own
 *  (usual / nominated) electrician on an A1 job (pass-through: no fixes margin); `ours` = Home Insulation Victoria's / an
 *  approved REC we chose — ALWAYS on our leads since decision 374 (owner pays $349 for the PIESA and the decision-142
 *  $100 on fixes). */
export type ElectricianSource = "installer_usual" | "ours";

/** Is the assigned electrician business the installer's usual electrician? (`matchUsualElectrician`: licence/REC number
 *  first, then exact business name). No usual saved / no assignment → ours. A1 only (via `electricianSourceForA1`);
 *  our leads are always ours (decision 374, `electricianSourceForOurLead`). */
export function electricianSourceFor(i: { usual: UsualElectrician | null; assigned: UsualMatchCandidate | null }): ElectricianSource {
  if (!i.usual || !i.assigned) return "ours";
  return matchUsualElectrician(i.usual, [i.assigned]) ? "installer_usual" : "ours";
}

/** Decision 374 (Jo 25 Oct 2026): on our leads (A2) WE always choose the electrician — whoever is assigned, even the
 *  quoted installer's usual electrician, the source is ours. */
export function electricianSourceForOurLead(): ElectricianSource {
  return "ours";
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
