// Decision 318 (Jo 25 Oct 2026): "Payment for the PIESA, fixes, install etc will not be made until the Mitti forms are
// 100% completed with the Complete button pressed. Photos and locations are geotagged and nothing can be missed or we
// can't claim the rebate." PURE gate: no database, no network. The facts are read by `trade-payout-gate.server.ts`
// from the records the Mitti syncs already keep:
//   • safety check (PIESA, A4)  ← `assessments.mitti_completed` (mitti.server sets it ONLY when the form is Complete AND
//     `piesaEvidenceBlockers` is empty) + those evidence blockers re-read from the stored snapshot;
//   • electrical fixes (A5)     ← the latest fixes form's outcome (`fixesFormOutcome`, "done" = Complete with Q9 Yes, CoES
//     and a geotagged work photo); fixes done on the same visit are on the A4, so they follow the A4 rule;
//   • install (A3 Install day)  ← a signed installer declaration (saved only from a Complete A3) + the latest
//     `install_evidence_synced` blockers (geotagged zone videos/photos, SWMS, sign-off).
// The Ready Check (A1/A2) is unpaid, so it has no payout; its quote already waits for Complete.
// Amounts and timing (decisions 30/109) are untouched: a blocked payout is simply Held with its reasons.

export type PayoutKind = "assessment" | "rectification" | "installation";

export type PiesaFormFacts = { mittiForm: boolean; completed: boolean; evidence: string[] };
export type FixesFormFacts = { sameVisitOnPiesa: boolean; outcome: "open" | "done" | "not_done" | "held" | null; detail: string | null };
export type InstallFormFacts = { formCompleted: boolean; evidence: string[] };
export type TradePayoutFacts = { piesa: PiesaFormFacts | null; fixes: FixesFormFacts | null; install: InstallFormFacts | null };

export const PAYOUT_FORM_NOT_COMPLETE: Record<PayoutKind, string> = {
  assessment: "Mitti safety check form (A4) not marked Complete",
  rectification: "Mitti electrical fixes form (A5) not marked Complete",
  installation: "Mitti install day form (A3) not marked Complete",
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

/** One short line for a held payout (office table / trade money row): first reason + "and N more". */
export function payoutHeldLine(reasons: string[]): string {
  if (!reasons.length) return "";
  return reasons.length === 1 ? `Held: ${reasons[0]}` : `Held: ${reasons[0]} and ${reasons.length - 1} more`;
}
