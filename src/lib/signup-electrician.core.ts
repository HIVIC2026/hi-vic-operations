// The electrician an installer names at sign-up becomes their saved usual electrician on approval.
import { usualElectrician, type UsualElectrician } from "./usual-electrician.core";

type Named = { name?: unknown; email?: unknown; mobile?: unknown; is_primary?: unknown; rec_number?: unknown; business_name?: unknown; licence_number?: unknown };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function signupMainElectrician(data: unknown): UsualElectrician | null {
  const d = (data ?? {}) as { electrician_choice?: unknown; preferred_electricians?: unknown };
  if (d.electrician_choice !== "have" || !Array.isArray(d.preferred_electricians) || !d.preferred_electricians.length) return null;
  const list = d.preferred_electricians as Named[];
  const main = list.find((e) => e?.is_primary === true) ?? list[0];
  if (!main) return null;
  const phone = str(main.mobile).replace(/\s+/g, "");
  return usualElectrician({
    name: str(main.business_name) || str(main.name),
    licence: str(main.rec_number) || str(main.licence_number),
    email: str(main.email) || null,
    ...(phone ? { phone } : {}),
  });
}

/** Should the stuck sign-up electrician invite go out now? "wait" = comms are off (try again later); "skip" = never from here.
 *  Never twice: a link already issued (by the office or anyone) means handled, and any earlier sweep record for this
 *  nomination (sent, failed, blocked or skipped) is final. Only the application's main electrician, and only once the
 *  installer's sign-up electrician has been saved (on approval or by the one-off fix: that is the gate). */
export function signupInviteDue(n: {
  status: string; invite_sent_at: string | null; invite_link_issued_at: string | null; business_id: string | null; email: string | null;
  installerApproved: boolean; commsEnabled: boolean; electricianAlreadyApproved: boolean;
  isMain: boolean; installerSignupSaved: boolean; earlierSweepRecord: boolean; sameEmailAlreadySent: boolean;
}): "send" | "wait" | "skip" {
  if (n.status !== "invite_pending_comms" || n.invite_sent_at || n.invite_link_issued_at || n.business_id || !n.email?.trim() || !n.installerApproved || n.electricianAlreadyApproved) return "skip";
  if (!n.isMain || !n.installerSignupSaved || n.earlierSweepRecord || n.sameEmailAlreadySent) return "skip";
  return n.commsEnabled ? "send" : "wait";
}

/** The main electrician nomination per sign-up application, matching `signupMainElectrician`: the one marked main,
 *  else the oldest. Rows with no application are ignored. */
export function signupMainNominationIds(rows: { id: string; installer_application_id: string | null; is_primary: boolean | null; created_at: string }[]): Set<string> {
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.installer_application_id) continue;
    const cur = best.get(r.installer_application_id);
    const better = !cur || (r.is_primary === true && cur.is_primary !== true) || (!!r.is_primary === !!cur.is_primary && r.created_at < cur.created_at);
    if (better) best.set(r.installer_application_id, r);
  }
  return new Set([...best.values()].map((r) => r.id));
}

export const SIGNUP_INVITES_PER_TICK = 25;
/** First `cap` rows that can be sent; rows that can never send are passed over and do not use up the cap. */
export function pickSendable<T>(rows: T[], cap: number, canSend: (r: T) => boolean): T[] {
  const out: T[] = [];
  for (const r of rows) { if (out.length >= cap) break; if (canSend(r)) out.push(r); }
  return out;
}
