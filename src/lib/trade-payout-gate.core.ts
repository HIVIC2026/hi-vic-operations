// Decision 318 (Jo 25 Oct 2026): "Payment for the PIESA, fixes, install etc will not be made until the Mitti forms are
// 100% completed with the Complete button pressed. Photos and locations are geotagged and nothing can be missed or we
// can't claim the rebate." PURE gate: no database, no network. The facts are read by `trade-payout-gate.server.ts`
// from the records the Mitti syncs already keep:
//   • safety check (PIESA, A3)  ← `assessments.mitti_completed` (mitti.server sets it ONLY when the form is Complete AND
//     `piesaEvidenceBlockers` is empty) + those evidence blockers re-read from the stored snapshot;
//   • electrical fixes (A4)     ← the latest fixes form's outcome (`fixesFormOutcome`, "done" = Complete with Q9 Yes, CoES
//     and a geotagged work photo); fixes done on the same visit are on the A3, so they follow the A3 rule;
//   • install (A5 Install day)  ← a signed installer declaration (saved only from a Complete A5) + the latest
//     `install_evidence_synced` blockers (geotagged zone videos/photos, SWMS, sign-off).
// The Ready Check (A1/A2) is unpaid, so it has no payout; its quote already waits for Complete.
// Amounts and timing (decisions 30/109) are untouched: a blocked payout is simply Held with its reasons.

export type PayoutKind = "assessment" | "rectification" | "installation";

/** `completedAt` (decision 355): when the form became 100% complete (the A3 sync that saw it Complete with its evidence;
 *  the A4 completion event), null/absent when unknown or not complete. */
export type PiesaFormFacts = { mittiForm: boolean; completed: boolean; evidence: string[]; completedAt?: string | null };
export type FixesFormFacts = { sameVisitOnPiesa: boolean; outcome: "open" | "done" | "not_done" | "held" | null; detail: string | null; completedAt?: string | null };
export type InstallFormFacts = { formCompleted: boolean; evidence: string[] };
/** Decision 410 (Jo 27 Oct 2026): when someone in the office pressed Approve on the electrician's form (A3 / A4). */
export type ElectricianFormApprovals = { assessment: string | null; rectification: string | null };
export type TradePayoutFacts = { piesa: PiesaFormFacts | null; fixes: FixesFormFacts | null; install: InstallFormFacts | null; electricianApprovedAt?: ElectricianFormApprovals };

export const PAYOUT_FORM_NOT_COMPLETE: Record<PayoutKind, string> = {
  assessment: "Mitti safety check form (A3) not marked Complete",
  rectification: "Mitti electrical fixes form (A4) not marked Complete",
  installation: "Mitti install day form (A5) not marked Complete",
};
const FORM_NAME: Record<PayoutKind, string> = { assessment: "Safety check form", rectification: "Electrical fixes form", installation: "Install day form" };

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const evidenceLines = (kind: PayoutKind, xs: string[]) => uniq(xs).map((x) => `${FORM_NAME[kind]}: ${x.replace(/^Install evidence:\s*/i, "")}`);

function piesaBlockers(kind: PayoutKind, p: PiesaFormFacts | null): string[] {
  if (!p || !p.mittiForm) return [PAYOUT_FORM_NOT_COMPLETE[kind]];
  const ev = evidenceLines(kind, p.evidence);
  return p.completed && !ev.length ? [] : [...(p.completed ? [] : [PAYOUT_FORM_NOT_COMPLETE[kind]]), ...ev];
}

/**
 * Plain reasons a trade payout is held. Empty = the matching Mitti form is Complete and its evidence checks pass, so
 * the payout follows its normal timing. Never empty when a fact is missing (fails closed).
 */
export function tradePayoutBlockers(kind: PayoutKind, f: TradePayoutFacts): string[] {
  if (kind === "assessment") return piesaBlockers("assessment", f.piesa);
  if (kind === "rectification") {
    const x = f.fixes;
    if (x?.sameVisitOnPiesa) return piesaBlockers("assessment", f.piesa);
    if (!x || x.outcome !== "done") {
      const why = x?.outcome === "not_done" ? `Electrical fixes form says the work is not all done${x.detail ? `: ${x.detail}` : ""}`
        : x?.outcome === "held" && x.detail ? `${FORM_NAME.rectification}: ${x.detail}` : null;
      return uniq([PAYOUT_FORM_NOT_COMPLETE.rectification, ...(why ? [why] : [])]);
    }
    return [];
  }
  const i = f.install;
  if (!i) return [PAYOUT_FORM_NOT_COMPLETE.installation];
  const ev = evidenceLines("installation", i.evidence);
  return [...(i.formCompleted ? [] : [PAYOUT_FORM_NOT_COMPLETE.installation]), ...ev];
}

/** Decision 355: when the electrician's form for this payout was 100% complete — null while the gate still holds it
 *  (or the time is unknown). Fixes done on the same visit follow the A3. */
export function electricianFormCompleteAt(kind: "assessment" | "rectification", f: TradePayoutFacts): string | null {
  if (tradePayoutBlockers(kind, f).length) return null;
  if (kind === "rectification" && !f.fixes?.sameVisitOnPiesa) return f.fixes?.completedAt ?? null;
  return f.piesa?.completedAt ?? null;
}

/** One short line for a held payout (office table / trade money row): first reason + "and N more". */
export function payoutHeldLine(reasons: string[]): string {
  if (!reasons.length) return "";
  return reasons.length === 1 ? `Held: ${reasons[0]}` : `Held: ${reasons[0]} and ${reasons.length - 1} more`;
}

/* ---- Batch 1 final fix F5: one safety-check payout per completed visit ----
 * After a reopen (or a 30-day repeat) a second electrician does a NEW safety check. Each completed safety-check visit is
 * its own payout line, paid to whoever did it; the old visit's "paid" and its completed form never carry over. */

/** A safety-check (assessment) booking that was not cancelled; `visits` lists them earliest first. */
export type SafetyVisit = { id: string; start: string; businessId: string | null; status: string };
export type SafetyVisitFacts = {
  visits: SafetyVisit[];
  /** PIESA records (any kind) with when they were made and the Mitti form they came from (null = entered on the portal). */
  records: { created_at: string; external_mitti_id: string | null }[];
  /** The job's A3 Mitti form (assessments.external_mitti_id). */
  formExternalId: string | null;
  /** Office Approve events on the safety check form (decision 410), earliest first: when, and the visit they named. */
  approvals: { at: string; bookingId: string | null }[];
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** The job's first safety-check visit (the one the A3 form and every legacy event belong to). */
export const firstSafetyVisit = (v: SafetyVisitFacts | undefined): SafetyVisit | null => v?.visits[0] ?? null;

/** Gate facts for ONE safety-check visit. The first visit (or no visit known) keeps the job's facts. A later visit
 *  counts only its own record: a PIESA record made after that visit from the job's A3 form, with the form completed after
 *  the visit, uses that form; anything else (no record yet, or a record entered on the portal with no Mitti form) is
 *  "form not Complete" — decision 318 fails closed. Its approval (decision 410, rule unchanged) is the first Approve that
 *  names that visit or, unnamed, came after the visit started. */
export function visitGateFacts(base: TradePayoutFacts, v: SafetyVisitFacts | undefined, visitId: string | null | undefined): TradePayoutFacts {
  const first = firstSafetyVisit(v);
  if (!visitId || !v || !first || first.id === visitId) {
    if (!v?.approvals.some((a) => a.bookingId)) return base;
    // Approvals that name a later visit belong to that visit, not to the first.
    const mine = v.approvals.find((a) => !a.bookingId || a.bookingId === first?.id)?.at ?? null;
    return { ...base, electricianApprovedAt: { assessment: mine, rectification: base.electricianApprovedAt?.rectification ?? null } };
  }
  const visit = v.visits.find((x) => x.id === visitId);
  const start = visit ? ms(visit.start) : Infinity;
  const ownRecord = v.records.find((r) => ms(r.created_at) >= start && !!r.external_mitti_id && r.external_mitti_id === v.formExternalId);
  const formAfter = ms(base.piesa?.completedAt) >= start;
  const piesa = ownRecord && formAfter ? base.piesa : { mittiForm: false, completed: false, evidence: [], completedAt: null };
  const approved = v.approvals.find((a) => a.bookingId === visitId || (!a.bookingId && ms(a.at) >= start))?.at ?? null;
  return { ...base, piesa, electricianApprovedAt: { assessment: approved, rectification: base.electricianApprovedAt?.rectification ?? null } };
}

/** When the office marked ONE safety-check visit paid. An event naming the visit (details.booking_id) pays that visit; a
 *  legacy event (no booking_id) pays the job's first visit only, and only if it came after that visit started. With no
 *  visit known (older jobs whose visit was never marked done) any assessment payment counts, as before. Latest wins. */
export function safetyVisitPaidAt(events: { created_at: string; details: { kind?: string; booking_id?: string } | null }[], v: SafetyVisitFacts | undefined, visitId: string | null | undefined): string | null {
  const mine = events.filter((e) => (e.details?.kind ?? "installation") === "assessment");
  const first = firstSafetyVisit(v);
  const hit = !visitId || !first ? mine
    : mine.filter((e) => e.details?.booking_id ? e.details.booking_id === visitId : visitId === first.id && ms(e.created_at) >= ms(first.start));
  return hit.sort((a, b) => ms(a.created_at) - ms(b.created_at)).at(-1)?.created_at ?? null;
}
