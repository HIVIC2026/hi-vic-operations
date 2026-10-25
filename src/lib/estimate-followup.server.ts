// Decision 238 (Jo, 24 Oct 2026): automatic follow-up for estimate-only leads, swept by the 15-minute tick
// (allocation-tick, same pattern as install-clearance / veec-reminders). Rules live in estimate-followup.core.ts.
//
// Per job at `preliminary_estimate_ready` with a sent Save my spot estimate email and no saved spot: ONE reminder on
// day 2, day 7 and day 21 (O66/O67/O68) and, a week after the day-21 email, an automatic close (stage cancelled,
// cancelled_reason "no response after estimate", prior_stage kept so the office can reopen it). Every step is recorded
// ONCE as a workflow event BEFORE anything is sent, so a tick never repeats a step.
// Real owners: only through sendGuardedOwnerEmail, behind customer_comms_enabled + contact consent
// (assertCustomerDeliveryAllowed) and ESTIMATE_FOLLOWUP_APPROVED (true since decisions 242/357; were it false, nothing
// would be recorded, so the right step goes the moment it is approved). TEST (qa_test) jobs use test-send only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  ESTIMATE_FOLLOWUP_APPROVED, ESTIMATE_FOLLOWUP_CLOSE_REASON, ESTIMATE_FOLLOWUP_CLOSE_SOURCE, ESTIMATE_FOLLOWUP_EVENT, ESTIMATE_FOLLOWUP_NOT_SENT_EVENT,
  ESTIMATE_FOLLOWUP_STAGE, TEMPLATE_CODE, decideEstimateFollowup, estimateFollowupKey, estimateFollowupPurpose, renderEstimateFollowupEmail,
  type EstimateFollowupFacts, type EstimateFollowupStep,
} from "./estimate-followup.core";
import { LAUNCH_CAMPAIGN, savedPriceFromEstimate } from "./launch-campaign.core";
import { sendKindFromKey } from "./save-spot-delivery.core";
import { LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { CUSTOMER_BASE } from "./engagement.core";
import { normaliseInsulation } from "./eligibility.core";
import { joAreaBasis } from "./jo-area-basis.core";
import { basisLine } from "./jo-outcome-email.core";
import type { JoEstimateFigures } from "./jo-email-templates.core";

const db = admin as any;
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type JobRow = { id: string; job_number: string | null; source: string | null; stage: string | null; deleted_at: string | null; qa_archived_at: string | null; owner_id: string | null; property_id: string | null; estimated_area_m2: number | string | null; estimated_area_unknown: boolean | null; owners: { full_name: string | null; email: string | null } | null };

/** Is this customer_email_sends row the owner's Save my spot estimate email (office_enquiry_index.spot_offered rule)? */
export function isEstimateOfferSend(s: { purpose: string; idempotency_key: string | null; status: string }): boolean {
  if (s.status !== "sent") return false;
  if (s.purpose === LINK_PURPOSE) return true;
  return s.purpose === LAUNCH_CAMPAIGN && sendKindFromKey(s.idempotency_key) !== "insulation_details" && !/:b(:|$)/.test(s.idempotency_key ?? "");
}

/** Everything the pure decision needs for a set of jobs. Read-only. */
export async function loadEstimateFollowupFacts(jobs: JobRow[]): Promise<Map<string, EstimateFollowupFacts>> {
  const out = new Map<string, EstimateFollowupFacts>();
  for (const c of chunks(jobs)) {
    const ids = c.map((j) => j.id);
    const [sends, resps, eopts, events, inbound] = await Promise.all([
      db.from("customer_email_sends").select("job_id,purpose,idempotency_key,status,sent_at,created_at").in("job_id", ids).in("purpose", [LAUNCH_CAMPAIGN, LINK_PURPOSE]).eq("status", "sent"),
      db.from("lead_campaign_responses").select("job_id,spot_saved_at,opted_out_at").in("job_id", ids),
      db.from("customer_email_optouts").select("job_id,opted_out_at").in("job_id", ids),
      db.from("workflow_events").select("job_id,event_type,details,created_at").in("job_id", ids).in("event_type", [ESTIMATE_FOLLOWUP_EVENT, ESTIMATE_FOLLOWUP_NOT_SENT_EVENT]),
      db.from("job_communications").select("job_id,created_at,received_at").in("job_id", ids).eq("direction", "inbound"),
    ]);
    for (const q of [sends, resps, eopts, events, inbound]) if (q.error) throw new Error(`Could not read estimate follow-up facts: ${q.error.message}`);
    const emailedAt = new Map<string, string>();
    for (const s of (sends.data ?? []) as { job_id: string; purpose: string; idempotency_key: string | null; status: string; sent_at: string | null; created_at: string }[]) {
      if (!isEstimateOfferSend(s)) continue;
      const at = s.sent_at ?? s.created_at;
      const prev = emailedAt.get(s.job_id);
      if (!prev || Date.parse(at) < Date.parse(prev)) emailedAt.set(s.job_id, at);
    }
    const resp = new Map<string, { spot_saved_at: string | null; opted_out_at: string | null }>();
    for (const r of (resps.data ?? []) as { job_id: string; spot_saved_at: string | null; opted_out_at: string | null }[]) resp.set(r.job_id, r);
    const emailOpt = new Set<string>();
    for (const r of (eopts.data ?? []) as { job_id: string; opted_out_at: string | null }[]) if (r.opted_out_at) emailOpt.add(r.job_id);
    const done = new Map<string, { step: EstimateFollowupStep; at: string }[]>();
    for (const e of (events.data ?? []) as { job_id: string; details: { step?: EstimateFollowupStep } | null; created_at: string }[]) {
      const step = e.details?.step;
      if (step) done.set(e.job_id, [...(done.get(e.job_id) ?? []), { step, at: e.created_at }]);
    }
    const replied = new Map<string, string>();
    for (const m of (inbound.data ?? []) as { job_id: string; created_at: string; received_at: string | null }[]) {
      const at = m.received_at ?? m.created_at;
      const prev = replied.get(m.job_id);
      if (!prev || Date.parse(at) > Date.parse(prev)) replied.set(m.job_id, at);
    }
    for (const j of c) {
      const r = resp.get(j.id);
      out.set(j.id, {
        stage: j.stage, source: j.source, deletedAt: j.deleted_at, qaArchivedAt: j.qa_archived_at,
        estimateEmailedAt: emailedAt.get(j.id) ?? null, spotSavedAt: r?.spot_saved_at ?? null,
        optedOut: !!r?.opted_out_at || emailOpt.has(j.id), repliedAt: replied.get(j.id) ?? null,
        ownerEmail: j.owners?.email ?? null, done: done.get(j.id) ?? [],
      });
    }
  }
  return out;
}

/** The current figures, basis line and secure links for the reminder; null (with a reason) when one is missing. */
async function reminderInput(j: JobRow): Promise<{ ok: true; rebate: number; price: number; fullPrice: number; basis: string; someInsulation: boolean; saveUrl: string; calculatorUrl: string } | { ok: false; reason: string }> {
  const [{ data: est }, { data: links }] = await Promise.all([
    db.from("indicative_estimates").select("id,area_m2,area_source,insulation_declared,scenarios").eq("job_id", j.id).eq("status", "current").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("customer_estimate_links").select("token,status,expires_at,created_at").eq("job_id", j.id).eq("purpose", LINK_PURPOSE).eq("status", "active").order("created_at", { ascending: false }),
  ]);
  const price = savedPriceFromEstimate(est ?? null);
  if (!price || !(price.gross > 0) || !(price.total > 0)) return { ok: false, reason: "Estimate figures missing — recalculate first" };
  const link = ((links ?? []) as { token: string; status: string; expires_at: string }[]).find((l) => linkUsable(l));
  if (!link) return { ok: false, reason: "No working secure estimate link (missing or expired)" };
  const basis = joAreaBasis({ areaSource: est?.area_source ?? null, areaM2: price.areaM2, ownerAreaM2: j.estimated_area_unknown ? null : Number(j.estimated_area_m2) || null });
  if (!basis.ok) return { ok: false, reason: "Estimate size basis needs office review" };
  const someInsulation = normaliseInsulation(est?.insulation_declared ?? null) === "present";
  const figures: JoEstimateFigures = { veuRebate: price.discount, customerTotal: price.total, totalBeforeRebate: price.gross, installation: 0, piesaFee: 0, apFee: 0, ceilingAreaM2: basis.areaM2, areaEstimated: basis.areaEstimated };
  const base = `${CUSTOMER_BASE}/estimate/${link.token}`;
  return { ok: true, rebate: price.discount, price: price.total, fullPrice: price.gross, basis: basisLine(figures, someInsulation), someInsulation, saveUrl: `${base}/campaign`, calculatorUrl: `${base}/calculator` };
}

/** Sends one reminder step for one job. Records the step first; never sends the same step twice. */
export async function sendEstimateFollowupStep(j: JobRow, step: EstimateFollowupStep): Promise<string> {
  const { data: dup } = await db.from("workflow_events").select("id").eq("job_id", j.id).in("event_type", [ESTIMATE_FOLLOWUP_EVENT, ESTIMATE_FOLLOWUP_NOT_SENT_EVENT]).contains("details", { step }).limit(1).maybeSingle();
  if (dup) return "already handled";
  const test = j.source === "qa_test";
  const to = j.owners?.email?.trim() ?? "";
  if (!test) {
    if (!ESTIMATE_FOLLOWUP_APPROVED) return "held — wording awaiting approval";
    const { assertCustomerDeliveryAllowed } = await import("./comms.server");
    try { await assertCustomerDeliveryAllowed(j.id, `Estimate reminder email (${step})`); } catch (e) { return `held — ${(e as Error).message}`; }
  }
  const input = await reminderInput(j);
  const code = TEMPLATE_CODE[step];
  if (!input.ok) {
    await logEvent(j.id, null, ESTIMATE_FOLLOWUP_NOT_SENT_EVENT, `Estimate reminder ${code} (${step.replace("_", " ")}) could not be prepared: ${input.reason}`, { step, reason: input.reason }, { internal: true });
    return `not sent — ${input.reason}`;
  }
  const key = estimateFollowupKey(j.id, step);
  await logEvent(j.id, null, ESTIMATE_FOLLOWUP_EVENT, `Estimate reminder ${code} (${step.replace("_", " ")} after the estimate email) prepared for the owner`, { step, key, template: code }, { internal: true });
  const render = (unsubscribeUrl: string | null) => renderEstimateFollowupEmail({ step, firstName: j.owners?.full_name ?? null, ...input, unsubscribeUrl, test });
  if (test) {
    const { sendTestEmail } = await import("./test-send.server");
    const m = render(null);
    const r = await sendTestEmail({ jobId: j.id, jobSource: j.source, partnerIsTest: true, label: `estimate_followup:${step}`, actorId: null }, to, m.subject, m.html, m.text);
    return `test email ${r.status}: ${r.detail}`;
  }
  const { sendGuardedOwnerEmail } = await import("./owner-email-send.server");
  return `email ${await sendGuardedOwnerEmail({ jobId: j.id, jobSource: j.source, to, purpose: estimateFollowupPurpose(step), key, build: render })}`;
}

/** Closes one estimate-only lead: conditional stage update (only from the estimate stage) + one stage_changed event. */
export async function closeEstimateFollowup(j: JobRow): Promise<string> {
  const { data: changed, error } = await db.from("jobs").update({
    stage: "cancelled", prior_stage: ESTIMATE_FOLLOWUP_STAGE, cancelled_reason: ESTIMATE_FOLLOWUP_CLOSE_REASON, hold_reason: null, last_activity_at: new Date().toISOString(),
  }).eq("id", j.id).eq("stage", ESTIMATE_FOLLOWUP_STAGE).is("deleted_at", null).select("id").maybeSingle();
  if (error) throw new Error(`Could not close estimate: ${error.message}`);
  if (!changed) return "not closed — job changed";
  await logEvent(j.id, null, "stage_changed", `Closed: ${ESTIMATE_FOLLOWUP_CLOSE_REASON} (day 2, 7 and 21 reminders sent; the owner can come back any time)`, { source: ESTIMATE_FOLLOWUP_CLOSE_SOURCE, reason: ESTIMATE_FOLLOWUP_CLOSE_REASON }, { from: ESTIMATE_FOLLOWUP_STAGE, to: "cancelled", internal: true });
  return "closed";
}

export type EstimateFollowupSweep = { checked: number; sent: number; held: number; closed: number; stopped: number; failed: number };

/** 15-minute tick: one decision per estimate-only lead. Counts only, never PII. */
export async function sweepEstimateFollowups(now = new Date()): Promise<EstimateFollowupSweep> {
  const { data: jobs, error } = await db.from("jobs")
    .select("id,job_number,source,stage,deleted_at,qa_archived_at,owner_id,property_id,estimated_area_m2,estimated_area_unknown,owners(full_name,email)")
    .eq("stage", ESTIMATE_FOLLOWUP_STAGE).is("deleted_at", null).is("qa_archived_at", null);
  if (error) throw new Error(`Could not read estimate-only leads: ${error.message}`);
  const rows = (jobs ?? []) as JobRow[];
  const facts = await loadEstimateFollowupFacts(rows);
  const out: EstimateFollowupSweep = { checked: rows.length, sent: 0, held: 0, closed: 0, stopped: 0, failed: 0 };
  for (const j of rows) {
    const f = facts.get(j.id);
    if (!f) continue;
    const d = decideEstimateFollowup(f, now.toISOString());
    try {
      if (d.kind === "stop") out.stopped++;
      else if (d.kind === "send") {
        const r = await sendEstimateFollowupStep(j, d.step);
        if (r.startsWith("held")) out.held++; else if (r === "already handled") { /* recorded by an earlier tick */ } else out.sent++;
      } else if (d.kind === "close") { if ((await closeEstimateFollowup(j)) === "closed") out.closed++; }
    } catch (e) { out.failed++; console.error("estimate follow-up failed", j.id, (e as Error).message); }
  }
  return out;
}
