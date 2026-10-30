// Decision 410 (Jo 27 Oct 2026): the office's Approve on an electrician's completed Mitti form (A3 safety check / A4
// fixes). The electrician's pay falls due 7 days after it (electrician-pay.core). Server-only. Callers: office Money ›
// Payouts (office.functions `approveElectricianForm`) and the TEST journey branch check 2.8.
import type { ElectricianPayKind } from "./trade-view.core";

export async function recordElectricianFormApproval(jobId: string, kind: ElectricianPayKind, actorId: string | null, bookingId: string | null = null): Promise<{ approvedAt: string; already: boolean }> {
  const [{ payoutGateFacts }, { tradePayoutBlockers }, { ELECTRICIAN_FORM_APPROVED_EVENT, approvalKindFor, electricianPayTiming }] = await Promise.all([
    import("./trade-payout-gate.server"), import("./trade-payout-gate.core"), import("./electrician-pay.core"),
  ]);
  // Batch 1 F5: a safety check visit (bookingId) is approved on its own record — a later visit never inherits the
  // first visit's form or approval.
  const { safetyVisitFacts } = await import("./trade-payout-gate.server");
  const { visitGateFacts } = await import("./trade-payout-gate.core");
  const forVisit = async () => { const g = (await payoutGateFacts([jobId])).get(jobId); return g && kind === "assessment" && bookingId ? visitGateFacts(g, (await safetyVisitFacts([jobId])).get(jobId), bookingId) : g; };
  const gate = await forVisit();
  const blockers = gate ? tradePayoutBlockers(kind, gate) : [];
  if (!gate || blockers.length) throw new Error(`Can't approve yet — ${blockers.join("; ") || "the Mitti form isn't complete"}.`);
  const t = electricianPayTiming(kind, gate);
  if (t.approvedAt) return { approvedAt: t.approvedAt, already: true };
  const approvalKind = approvalKindFor(kind, gate);
  const what = approvalKind === "assessment" ? "safety check form (A3)" : "electrical fixes form (A4)";
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, actorId, ELECTRICIAN_FORM_APPROVED_EVENT, `Office approved the electrician's ${what} — pay due in 7 days`, { kind: approvalKind, ...(kind === "assessment" && bookingId ? { booking_id: bookingId } : {}) }, { internal: true });
  const again = electricianPayTiming(kind, await forVisit());
  return { approvedAt: again.approvedAt ?? new Date().toISOString(), already: false };
}
