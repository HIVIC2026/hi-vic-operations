// The crew rules the installer crew picker needs, split out of piisa-a3.core.ts (speed: installer screens towards 1 second)
// so the trade screens do not download mitti.core, install-day.core, official forms or the email code with them.
// Code moved unchanged; piisa-a3.core re-exports every name, so other importers are unchanged.
import { COLLECTION_NOTICE_BLOCK_MESSAGE, norm } from "./trade-shared-consts.core";
import { DECLARATIONS_DUE_MESSAGE, WHITE_CARD_BLOCK_MESSAGE, type WhiteCardState } from "./worker-compliance.core";
import type { WorkerRole } from "./worker-role.core";

// ---------- crew ----------
export type StaffOption = {
  workerId: string; name: string; eec: string | null; eecVerified: boolean;
  /** Lead / Crew. Crew can't be the install-day Lead; they can be crew members. Undefined = not loaded (not blocking). */
  workerRole?: WorkerRole | null;
  /** Office login approval (shown only; decision 153: it no longer gates the crew — clearance does). */
  approved?: boolean;
  /** Decision 153: cleared for crews = verified CII certificate + recorded level + expiry not passed. Undefined = not derived (legacy shape, not blocking). */
  cleared?: boolean; clearanceReason?: string | null;
  issuer?: string | null; certificationId?: string | null;
  /** Recorded level/expiry only — null when not recorded; never invented. */
  level?: string | null; expiresOn?: string | null;
  /** ESC collection notice (decision 130): false = not acknowledged, so this person can't be lead or crew. Undefined = not loaded. */
  noticeAcknowledged?: boolean;
  /** Decision 319: this person's White Card state (office-verified once). */
  whiteCard?: WhiteCardState;
  /** Decision 319: true = White Card not verified and this installation was booked on/after the cutoff → can't be lead or crew. Undefined = rule not applied (older callers). */
  whiteCardBlocked?: boolean;
  /** Jo 29 Oct 2026: true = added on Team and not signed the worker declarations yet → can't be Lead or crew. Undefined = not loaded. */
  declarationsDue?: boolean;
};

/** Portal lookup only. Native direct-entry schema awaits concrete edited IDs; the observed native choice mapping remains fail closed. */
export const A3_NATIVE_CREW_LOOKUP = { available: false, note: "Choose from your company’s approved installers, or enter a full legal name and Certified Insulation Installer (CII) certification number. Entered details need office verification." } as const;

export const CREW_NOT_LEAD_MESSAGE = "is Crew, so can't be the Lead. Make them Lead on the Team page first.";
export type CrewPick = { workerId: string } | { other: { name: string; eec: string } };
/** Lead = a staff workerId, or "Other" (typed name + EEC, office verification required before work starts). */
export type CrewSelection = { lead: string | { other: { name: string; eec: string } } | null; additional: CrewPick[] };
export const leadWorkerId = (sel: CrewSelection): string | null => typeof sel.lead === "string" ? sel.lead : null;
/** Jo 29 Oct 2026: a crew saved before the Lead + 2 / Lead-from-the-Team rules (typed-in Lead, or more than 2 others) must be
 *  picked again — treated as not picked. The stored record is kept. */
export const savedCrewNeedsRepick = (sel: CrewSelection): boolean => typeof sel.lead === "object" && sel.lead !== null || sel.additional.length > 2;

/** Lead = cleared staff (decision 153: verified CII + recorded level + not expired) of the assigned installer business; ≤2 additional (Lead + 2); a crew member may be "Other" (name + EEC, office verification); the Lead may not. */
export function crewSelectionProblems(sel: CrewSelection, staff: StaffOption[]): { problems: string[]; needsVerification: string[] } {
  const p: string[] = [], nv: string[] = [];
  const byId = new Map(staff.map((s) => [s.workerId, s]));
  const leadId = leadWorkerId(sel);
  const lead = leadId ? byId.get(leadId) : undefined;
  // Not cleared (derived) blocks; a legacy shape without `cleared` falls through to the EEC check below.
  const notCleared = (s: StaffOption) => s.cleared === false;
  const clearMsg = (s: StaffOption) => `${s.name}: ${s.clearanceReason ?? "not cleared for the crew yet"} — can't go on the safety form yet`;
  const seenIds = new Set<string>(leadId ? [leadId] : []);
  const seenEec = new Set<string>();
  const seenName = new Set<string>();
  // Jo 29 Oct 2026: the Lead must come from the Team list (needs a Mitti login); a typed-in or empty Lead is refused.
  if (!leadId) p.push("Choose the Lead from your Team list");
  else if (!lead) p.push("The lead installer is not on your staff list");
  else if (lead.workerRole === "crew") p.push(`${lead.name} ${CREW_NOT_LEAD_MESSAGE}`);
  else if (notCleared(lead)) p.push(clearMsg(lead));
  else if (!lead.eecVerified || !lead.eec) p.push(`${lead.name}: EEC certification not verified`);
  else if (lead.noticeAcknowledged === false) p.push(`${lead.name}: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`);
  else if (lead.whiteCardBlocked) p.push(`${lead.name}: ${WHITE_CARD_BLOCK_MESSAGE}`);
  else if (lead.declarationsDue === true) p.push(`${lead.name}: ${DECLARATIONS_DUE_MESSAGE}`);
  if (lead) { seenName.add(norm(lead.name)); if (lead.eec) seenEec.add(norm(lead.eec)); }
  if (sel.additional.length > 2) p.push("The install form has room for a Lead and 2 more");
  for (const a of sel.additional) {
    if ("workerId" in a) {
      const s = byId.get(a.workerId);
      if (!s) { p.push("An additional installer is not on your verified staff list"); continue; }
      if (seenIds.has(a.workerId)) { p.push(`${s.name} is listed twice`); continue; }
      seenIds.add(a.workerId); seenName.add(norm(s.name)); if (s.eec) seenEec.add(norm(s.eec));
      if (notCleared(s)) p.push(clearMsg(s));
      else if (!s.eecVerified || !s.eec) p.push(`${s.name}: EEC certification not verified`);
      else if (s.noticeAcknowledged === false) p.push(`${s.name}: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`);
      else if (s.whiteCardBlocked) p.push(`${s.name}: ${WHITE_CARD_BLOCK_MESSAGE}`);
      else if (s.declarationsDue === true) p.push(`${s.name}: ${DECLARATIONS_DUE_MESSAGE}`);
    } else {
      const name = a.other.name.trim(), eec = a.other.eec.trim();
      if (!name || !eec) { p.push("Other installer needs a full name and EEC certification number"); continue; }
      if (seenName.has(norm(name)) || seenEec.has(norm(eec))) { p.push(`${name} is listed twice`); continue; }
      const known = staff.find((s) => norm(s.name) === norm(name) || (s.eec && norm(s.eec) === norm(eec)));
      if (known) { p.push(`${known.name} is already on your staff list — choose them instead of Other`); continue; }
      seenName.add(norm(name)); seenEec.add(norm(eec));
      nv.push(`${name} (EEC ${eec}) must be verified by the office before work starts`);
    }
  }
  return { problems: p, needsVerification: nv };
}
