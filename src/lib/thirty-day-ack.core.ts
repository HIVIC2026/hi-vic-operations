// Decision 307 (Jo, 25 Oct 2026): before an owner chooses their electrical safety check (PIESA) times on the secure
// link, they tick ONE box saying they understand the 30-day rule. Pure rules only; no network, no database.
// Recorded once per PIESA cycle as an append-only `owner_thirty_day_acknowledged` workflow event. The cycle number is
// the count of `install_window_expired` events (decision 158) on the job: 0 for the first PIESA, 1 after the first
// lapse, and so on — so a re-done PIESA after expiry asks again, and nothing else does.

export const OWNER_THIRTY_DAY_ACK_EVENT = "owner_thirty_day_acknowledged";
export const THIRTY_DAY_ACK_VERSION = "v1";
export const THIRTY_DAY_ACK_WORDING =
  "I understand the Victorian Energy Upgrades program requires my insulation to be installed within 30 days of the electrical safety check. If it isn't, a new safety check is needed and may be charged.";
export const THIRTY_DAY_ACK_REFUSAL = "Please tick the box to say you understand the 30-day rule before choosing your safety check times.";
export const THIRTY_DAY_ACK_SUMMARY = "Owner acknowledged the 30-day rule";

/** The PIESA cycle = how many 30-day windows have lapsed on this job (0 = first PIESA). */
export function piesaCycle(expiredWindowCount: number): number {
  return Math.max(0, Math.floor(expiredWindowCount || 0));
}

/** True when this cycle has no acknowledgement yet. Old/odd rows without a numeric cycle count as cycle 0. */
export function thirtyDayAckNeeded(x: { cycle: number; acks: { cycle?: unknown }[] }): boolean {
  return !x.acks.some((a) => (typeof a.cycle === "number" ? a.cycle : 0) === x.cycle);
}

/** Refusal text when the owner must tick and did not; null = allowed (ticked, or already recorded this cycle). */
export function thirtyDayAckBlocker(x: { needed: boolean; understandsThirtyDays: boolean | undefined | null }): string | null {
  if (!x.needed) return null;
  return x.understandsThirtyDays === true ? null : THIRTY_DAY_ACK_REFUSAL;
}

export type ThirtyDayAckDetails = {
  version: string; wording: string; cycle: number; quote_id: string | null; acknowledged_at: string;
  ip_hash: string | null; ua_hash: string | null; via: "secure_link";
};

export function buildThirtyDayAck(p: { cycle: number; quoteId: string | null; at: string; ipHash: string | null; uaHash: string | null }): ThirtyDayAckDetails {
  return { version: THIRTY_DAY_ACK_VERSION, wording: THIRTY_DAY_ACK_WORDING, cycle: p.cycle, quote_id: p.quoteId, acknowledged_at: p.at, ip_hash: p.ipHash, ua_hash: p.uaHash, via: "secure_link" };
}
