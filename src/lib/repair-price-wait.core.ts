// Jo 28 Oct 2026 (Task 9): if the electrician's repair price still isn't entered 24 hours after the business owner's price
// link was sent (the recorded `repair_price_link_sent` event), the job shows exactly "Waiting on the electrician's price"
// on the office's Active jobs list. There is no reminder text. Office only: used by office-status.core / office.server,
// never by a trade read. The alert shows ONLY while the price is genuinely still wanted: the job is at a stage where the
// price can be set, the fixes quote hasn't been sent, the link was for the CURRENT safety check form, and neither the
// portal nor that form carries a price. Pure.
import { REPAIR_PRICE_EVENT, REPAIR_PRICE_LINK_EVENT, REPAIR_PRICE_STAGES } from "./electrician-repair-price.core";
import { parseFixesPrice } from "./fixes-price.core";

export const REPAIR_PRICE_WAITING_NOTICE = "Waiting on the electrician's price";
export const REPAIR_PRICE_WAIT_HOURS = 24;

type Ev = { event_type: unknown; details: unknown; created_at: unknown };
const auditOf = (d: unknown) => (d && typeof d === "object" ? (d as Record<string, unknown>)["audit_id"] : undefined);

/** A fixes quote that has gone out (anything but a draft) or been accepted. */
export const fixesQuoteGone = (q: { sentAt?: string | null; status?: string | null; acceptedAt?: string | null } | null | undefined) => !!q && (!!q.sentAt || (!!q.status && q.status !== "draft") || !!q.acceptedAt);

/** Stage and quote together: is the price still wanted on this job right now? */
export const repairPriceStillWanted = (stage: string, rectQuote: { sentAt?: string | null; status?: string | null; acceptedAt?: string | null } | null | undefined) => REPAIR_PRICE_STAGES.includes(stage) && !fixesQuoteGone(rectQuote);

/** The old form's own price in the synced answers (the `fixesPriceIncGst` short answer), or null. */
export const formPriceOf = (short: Record<string, unknown> | null | undefined): number | null => parseFixesPrice(short?.["fixesPriceIncGst"]);

export type RepairPriceWaitContext = {
  stage: string;
  /** The newest non-superseded fixes quote, if any. */
  rectQuote: { sentAt?: string | null; status?: string | null; acceptedAt?: string | null } | null | undefined;
  /** The job's current A3 form (assessments.external_mitti_id). */
  currentAuditId: string | null | undefined;
  /** The current form carries a usable price of its own. */
  formPriced: boolean;
};

/** When the latest price link was sent, or null when the alert doesn't apply (see the top of this file). */
export function repairPriceWaitingSince(events: Ev[], ctx: RepairPriceWaitContext): string | null {
  if (!repairPriceStillWanted(ctx.stage, ctx.rectQuote)) return null;
  const links = events.filter((e) => e.event_type === REPAIR_PRICE_LINK_EVENT).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = links[0];
  if (!latest) return null;
  const audit = auditOf(latest.details);
  // A link for an earlier form (the safety check was redone since) says nothing about the current one.
  if (!audit || !ctx.currentAuditId || audit !== ctx.currentAuditId) return null;
  if (ctx.formPriced) return null;
  const priced = events.some((e) => e.event_type === REPAIR_PRICE_EVENT && auditOf(e.details) === audit);
  return priced ? null : String(latest.created_at);
}

/** Puts the alert in front of the office status detail once 24 hours have passed since the link, joined with " · ". */
export function withRepairPriceWaiting(text: string | null, linkSentAt: string | null | undefined, now: number): string | null {
  if (!linkSentAt) return text;
  const at = Date.parse(linkSentAt);
  if (!Number.isFinite(at) || now - at < REPAIR_PRICE_WAIT_HOURS * 3_600_000) return text;
  return text ? `${REPAIR_PRICE_WAITING_NOTICE} · ${text}` : REPAIR_PRICE_WAITING_NOTICE;
}
