// Decision 318 (Jo 25 Oct 2026): reads the facts for the pure payout gate (`trade-payout-gate.core.ts`) from the records
// the Mitti syncs already keep. Server-only, READ-ONLY: no writes, no senders, no Mitti call. Batched by job id.
// Callers: office Money › Payouts (office-money.server), office Mark paid (office.functions markPayoutPaid) and the trade
// Money rows (trade-view.server) — one rule, one set of facts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { tradePayoutBlockers, type PayoutKind, type SafetyVisitFacts, type TradePayoutFacts } from "./trade-payout-gate.core";
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
  const { ELECTRICIAN_FORM_APPROVED_EVENT } = await import("./electrician-pay.core");
  const [assess, fixEv, decl, ieEv, apprEv, fixesQuotes, fixesInvoices] = await Promise.all([
    inJobs<{ job_id: string; external_mitti_id: string | null; mitti_completed: boolean | null; mitti_raw_snapshot: unknown; mitti_synced_at: string | null; mitti_modified_at: string | null }>("assessments", "job_id, external_mitti_id, mitti_completed, mitti_raw_snapshot, mitti_synced_at, mitti_modified_at", ids),
    inJobs<FixesFormEvent & { job_id: string }>("workflow_events", "job_id, event_type, created_at, summary, details", ids, (q) => q.in("event_type", [FIXES_FORM_CREATED_EVENT, FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_NOT_DONE_EVENT, FIXES_FORM_HELD_EVENT]).order("created_at", { ascending: false })),
    inJobs<{ job_id: string }>("installer_declarations", "job_id", ids, (q) => q.eq("status", "signed")),
    inJobs<{ job_id: string; details: { summary?: InstallEvidenceSummary } | null; created_at: string }>("workflow_events", "job_id, details, created_at", ids, (q) => q.eq("event_type", "install_evidence_synced").order("created_at", { ascending: false })),
    // Decision 410: the office's Approve on the electrician's form (earliest one per form counts).
    inJobs<{ job_id: string; details: { kind?: string } | null; created_at: string }>("workflow_events", "job_id, details, created_at", ids, (q) => q.eq("event_type", ELECTRICIAN_FORM_APPROVED_EVENT).order("created_at", { ascending: true })),
    // Batch 3b (Jo 29 Oct): electrician fixes pay waits for the owner's fixes invoice (the newest accepted fixes quote's own).
    inJobs<{ id: string; job_id: string; accepted_at: string | null; customer_total_inc_gst: number | string | null }>("quotes", "id, job_id, accepted_at, customer_total_inc_gst", ids, (q) => q.eq("kind", "rectification").eq("status", "accepted")),
    inJobs<{ job_id: string; quote_id: string | null; total_inc_gst: number | string | null; total_paid: number | string | null }>("invoices", "job_id, quote_id, total_inc_gst, total_paid", ids, (q) => q.eq("kind", "rectification")),
  ]);
  const approvedAt = (id: string, kind: string) => apprEv.find((e) => e.job_id === id && e.details?.kind === kind)?.created_at ?? null;
  const fixesInvoice = (id: string) => {
    const q = fixesQuotes.filter((x) => x.job_id === id).sort((a, b) => String(b.accepted_at ?? "").localeCompare(String(a.accepted_at ?? "")))[0];
    if (!q || !(Number(q.customer_total_inc_gst ?? 0) > 0)) return null;
    const inv = fixesInvoices.find((x) => x.job_id === id && x.quote_id === q.id);
    // No invoice yet = nothing paid yet. Paid in full = the Xero mirror (reconciled) reaches the invoice total.
    return { paid: !!inv && Number(inv.total_paid ?? 0) >= Number(inv.total_inc_gst ?? 0) && Number(inv.total_inc_gst ?? 0) > 0 };
  };
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
      electricianApprovedAt: { assessment: approvedAt(id, "assessment"), rectification: approvedAt(id, "rectification") },
      fixesInvoice: fixesInvoice(id),
    });
  }
  return out;
}

/** Reasons one payout is held (empty = payable on its normal timing). */
export async function payoutBlockersFor(jobId: string, kind: PayoutKind): Promise<string[]> {
  const f = (await payoutGateFacts([jobId])).get(jobId)!;
  return tradePayoutBlockers(kind, f);
}

/** Batch 1 final fix F5: per job, the safety-check visits (assessment bookings not cancelled, earliest first), the PIESA
 *  records, the A3 form id and the office's Approve events — so each visit is paid and gated on its own
 *  (`visitGateFacts`, `safetyVisitPaidAt`). Read-only; every requested job gets an entry. */
export async function safetyVisitFacts(jobIds: string[]): Promise<Map<string, SafetyVisitFacts>> {
  const ids = [...new Set(jobIds)];
  const out = new Map<string, SafetyVisitFacts>();
  if (!ids.length) return out;
  const { ELECTRICIAN_FORM_APPROVED_EVENT } = await import("./electrician-pay.core");
  const [books, recs, forms, appr] = await Promise.all([
    inJobs<{ id: string; job_id: string; scheduled_start: string; business_id: string | null; status: string }>("bookings", "id, job_id, scheduled_start, business_id, status", ids, (q) => q.eq("kind", "assessment").in("status", ["confirmed", "completed"])),
    inJobs<{ job_id: string; created_at: string; external_mitti_id: string | null }>("piesa_records", "job_id, created_at, external_mitti_id", ids),
    inJobs<{ job_id: string; external_mitti_id: string | null }>("assessments", "job_id, external_mitti_id", ids),
    inJobs<{ job_id: string; details: { kind?: string; booking_id?: string } | null; created_at: string }>("workflow_events", "job_id, details, created_at", ids, (q) => q.eq("event_type", ELECTRICIAN_FORM_APPROVED_EVENT)),
  ]);
  const ms = (x: string) => Date.parse(x);
  for (const id of ids) out.set(id, {
    visits: books.filter((b) => b.job_id === id).sort((a, b) => ms(a.scheduled_start) - ms(b.scheduled_start)).map((b) => ({ id: b.id, start: b.scheduled_start, businessId: b.business_id, status: b.status })),
    records: recs.filter((r) => r.job_id === id).map((r) => ({ created_at: r.created_at, external_mitti_id: r.external_mitti_id })),
    formExternalId: forms.find((f) => f.job_id === id)?.external_mitti_id ?? null,
    approvals: appr.filter((e) => e.job_id === id && e.details?.kind === "assessment").sort((a, b) => ms(a.created_at) - ms(b.created_at)).map((e) => ({ at: e.created_at, bookingId: e.details?.booking_id ?? null })),
  });
  return out;
}

/** Reasons ONE safety-check visit's payout is held (decision 318 on that visit's own record + decision 410 waiting). */
export async function safetyVisitPayoutBlockers(jobId: string, bookingId: string | null): Promise<string[]> {
  const [{ visitGateFacts }, { electricianPayTiming }] = await Promise.all([import("./trade-payout-gate.core"), import("./electrician-pay.core")]);
  const [gate, visits] = await Promise.all([payoutGateFacts([jobId]), safetyVisitFacts([jobId])]);
  const f = visitGateFacts(gate.get(jobId)!, visits.get(jobId), bookingId);
  return [...tradePayoutBlockers("assessment", f), ...electricianPayTiming("assessment", f).waiting];
}
