// Decision 318 (Jo 25 Oct 2026): reads the facts for the pure payout gate (`trade-payout-gate.core.ts`) from the records
// the Mitti syncs already keep. Server-only, READ-ONLY: no writes, no senders, no Mitti call. Batched by job id.
// Callers: office Money › Payouts (office-money.server), office Mark paid (office.functions markPayoutPaid) and the trade
// Money rows (trade-view.server) — one rule, one set of facts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { tradePayoutBlockers, type PayoutKind, type TradePayoutFacts } from "./trade-payout-gate.core";
import { piesaEvidenceBlockersFromSnapshot } from "./piesa-evidence.core";
import { shortAnswersFromEntries } from "./official-short.core";
import { FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT, FIXES_FORM_NOT_DONE_EVENT, fixesFormNeeded, fixesFormOutcome, type FixesFormEvent } from "./fixes-day.core";
import { installEvidenceGateLines, type InstallEvidenceSummary } from "./install-evidence.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function inJobs<T>(table: string, cols: string, jobIds: string[], extra?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (const ids of chunks(jobIds)) {
    let q = db.from(table).select(cols).in("job_id", ids);
    if (extra) q = extra(q);
    const { data, error } = await q;
    // Fail closed: an unreadable fact holds the payout (the gate treats missing facts as not complete).
    if (error) throw new Error(`Could not read ${table} for the payout check: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

type Snapshot = { label: string; value: string | null }[];

/** Gate facts per job (every requested job gets an entry). */
export async function payoutGateFacts(jobIds: string[]): Promise<Map<string, TradePayoutFacts>> {
  const ids = [...new Set(jobIds)];
  const out = new Map<string, TradePayoutFacts>();
  if (!ids.length) return out;
  const [assess, fixEv, decl, ieEv] = await Promise.all([
    inJobs<{ job_id: string; external_mitti_id: string | null; mitti_completed: boolean | null; mitti_raw_snapshot: unknown; mitti_synced_at: string | null; mitti_modified_at: string | null }>("assessments", "job_id, external_mitti_id, mitti_completed, mitti_raw_snapshot, mitti_synced_at, mitti_modified_at", ids),
    inJobs<FixesFormEvent & { job_id: string }>("workflow_events", "job_id, event_type, created_at, summary, details", ids, (q) => q.in("event_type", [FIXES_FORM_CREATED_EVENT, FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_NOT_DONE_EVENT, FIXES_FORM_HELD_EVENT]).order("created_at", { ascending: false })),
    inJobs<{ job_id: string }>("installer_declarations", "job_id", ids, (q) => q.eq("status", "signed")),
    inJobs<{ job_id: string; details: { summary?: InstallEvidenceSummary } | null; created_at: string }>("workflow_events", "job_id, details, created_at", ids, (q) => q.eq("event_type", "install_evidence_synced").order("created_at", { ascending: false })),
  ]);
  const { installStartDate } = await import("./install-evidence.server");
  for (const id of ids) {
    const a = assess.find((x) => x.job_id === id);
    const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as Snapshot).filter((e) => e && typeof e.label === "string") : [];
    const piesa = a ? {
      mittiForm: !!a.external_mitti_id,
      completed: a.mitti_completed === true,
      evidence: a.external_mitti_id ? piesaEvidenceBlockersFromSnapshot(a.mitti_raw_snapshot, (e) => shortAnswersFromEntries("piesa", e)) : [],
      // Decision 355: the sync that saw the A3 Complete with its evidence stamps mitti_synced_at.
      completedAt: a.mitti_completed === true ? a.mitti_synced_at ?? a.mitti_modified_at ?? null : null,
    } : null;
    const jobFixEv = fixEv.filter((e) => e.job_id === id);
    const fo = fixesFormOutcome(jobFixEv);
    const fixesDoneAt = fo.outcome === "done" ? jobFixEv.find((e) => e.event_type === FIXES_FORM_COMPLETED_EVENT && (e.details as { audit_id?: string } | null)?.audit_id === fo.auditId)?.created_at ?? null : null;
    // Fixes done on the same visit are recorded on the A3 (q30 Yes): no A4 form exists, the A3 rule applies.
    const sameVisitOnPiesa = !fo.auditId && entries.length > 0 && !fixesFormNeeded(shortAnswersFromEntries("piesa", entries));
    const summary = ieEv.find((e) => e.job_id === id)?.details?.summary ?? null;
    const declared = decl.some((d) => d.job_id === id);
    // No signed A5 and no evidence read yet: the "not marked Complete" reason already holds it — skip the date lookup.
    const installDate = !declared && !summary ? null : summary?.installDate ?? await installStartDate(id).catch(() => null);
    out.set(id, {
      piesa,
      fixes: { sameVisitOnPiesa, outcome: fo.outcome, detail: fo.detail, completedAt: fixesDoneAt },
      install: { formCompleted: declared, evidence: !declared && !summary ? [] : installEvidenceGateLines(summary, installDate) },
    });
  }
  return out;
}

/** Reasons one payout is held (empty = payable on its normal timing). */
export async function payoutBlockersFor(jobId: string, kind: PayoutKind): Promise<string[]> {
  const f = (await payoutGateFacts([jobId])).get(jobId)!;
  return tradePayoutBlockers(kind, f);
}
