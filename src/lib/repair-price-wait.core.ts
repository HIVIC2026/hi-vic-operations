// Jo 28 Oct 2026 (Task 9): if the electrician's repair price still isn't entered 24 hours after the business owner's price
// link was sent (the recorded `repair_price_link_sent` event), the job shows exactly "Waiting on the electrician's price"
// on the office's Active jobs list. There is no reminder text. Office only: used by office-status.core / office.server,
// never by a trade read. Once a price is entered for that form, the alert clears. Pure.
import { REPAIR_PRICE_EVENT, REPAIR_PRICE_LINK_EVENT } from "./electrician-repair-price.core";

export const REPAIR_PRICE_WAITING_NOTICE = "Waiting on the electrician's price";
export const REPAIR_PRICE_WAIT_HOURS = 24;

type Ev = { event_type: unknown; details: unknown; created_at: unknown };
const auditOf = (d: unknown) => (d && typeof d === "object" ? (d as Record<string, unknown>)["audit_id"] : undefined);

/** When the latest price link was sent, or null when none was sent or a price has since been entered for that form. */
export function repairPriceWaitingSince(events: Ev[]): string | null {
  const links = events.filter((e) => e.event_type === REPAIR_PRICE_LINK_EVENT).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = links[0];
  if (!latest) return null;
  const audit = auditOf(latest.details);
  const priced = events.some((e) => e.event_type === REPAIR_PRICE_EVENT && auditOf(e.details) === audit);
  return priced ? null : String(latest.created_at);
}

/** Puts the alert in front of the office status detail once 24 hours have passed since the link. */
export function withRepairPriceWaiting(text: string | null, linkSentAt: string | null | undefined, now: number): string | null {
  if (!linkSentAt) return text;
  const at = Date.parse(linkSentAt);
  if (!Number.isFinite(at) || now - at < REPAIR_PRICE_WAIT_HOURS * 3_600_000) return text;
  return text ? `${REPAIR_PRICE_WAITING_NOTICE} ${text}` : REPAIR_PRICE_WAITING_NOTICE;
}
