// Facts for the trade "where is this job up to?" line and timeline. Scoped to the signed-in trade's own jobs.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { electricianPayState, payState } from "./trade-view.core";
import { chaseMode, paymentDates, forViewer, jobStatusLine, jobTimeline, reminderRequestMessage, type StatusFacts } from "./job-status.core";
import { safetyCheckPayState } from "./payment-gate.core";
import type { DueSettings } from "./waiting.core";

const none = ["00000000-0000-0000-0000-000000000000"];
type Ctx = { biz: { id: string; name: string }; boss: boolean; kind: "installer" | "electrician" };

export async function statusFactsFor(c: Ctx, jobIds: string[]): Promise<Map<string, StatusFacts & { channel: string | null; originating: string | null; jobNumber: string }>> {
  const ids = jobIds.length ? jobIds : none;
  const [{ data: jobs }, { data: books }, { data: ev }, { data: quotes }, { data: invs }, { data: props }, { data: ws }, { data: aps }, { data: sims }, { data: ovs }, { data: rcw }] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, channel, originating_installer_business_id, created_at").in("id", ids),
    admin.from("bookings").select("job_id, kind, status, scheduled_start, scheduled_end, business_id, businesses(name, trading_name)").in("job_id", ids).in("status", ["confirmed", "completed"]),
    admin.from("workflow_events").select("job_id, event_type, to_stage, created_at").in("job_id", ids).in("event_type", ["stage_changed", "payout_marked_paid", "installer_ready_check_times_delivery", "ready_check_more_times_requested"]).order("created_at", { ascending: false }).limit(5000),
    admin.from("quotes").select("job_id, kind, status, sent_at, accepted_at").in("job_id", ids).in("status", ["issued", "accepted"]),
    admin.from("invoices").select("id, job_id, kind, status, deposit_paid_at, balance_paid_at, paid_at, total_paid, deposit_paid_amount, deposit_amount").in("job_id", ids),
    admin.from("appointment_proposals").select("job_id, kind, created_at, proposer_role").in("job_id", ids).eq("kind", "assessment").eq("proposer_role", "owner").order("created_at", { ascending: false }),
    admin.from("workflow_settings").select("due_trade_reply_warn_hours, due_trade_reply_exception_hours, due_owner_reminder_days, due_owner_flag_days").eq("id", 1).maybeSingle(),
    admin.from("assessment_payments").select("job_id, paid_at").in("job_id", ids).eq("status", "paid"),
    // TEST journeys only. Read so the label can say "simulated"; never presented as money received.
    admin.from("workflow_events").select("job_id, details").in("job_id", ids).in("event_type", ["qa_payment_simulated", "payment_simulated"]).order("created_at", { ascending: false }).limit(2000),
    // Audited office overrides on the deposit gate: permission to proceed, not a payment.
    admin.from("payment_overrides").select("job_id, invoice_id").in("job_id", ids).eq("gate", "deposit"),
    admin.from("ready_check_windows").select("job_id, created_at").in("job_id", ids).order("created_at", { ascending: false }),
  ]);
  const settings: DueSettings | null = ws ? { tradeWarnHours: Number(ws.due_trade_reply_warn_hours ?? 24), tradeExceptionHours: Number(ws.due_trade_reply_exception_hours ?? 48), ownerReminderDays: Number(ws.due_owner_reminder_days ?? 3), ownerFlagDays: Number(ws.due_owner_flag_days ?? 7) } : null;
  const now = new Date();
  // Decision 355: an electrician's pay follows their own form + the owner's payment for that step (not AP approval).
  const realIds = (jobs ?? []).map((j) => j.id);
  const elecPay = c.kind === "electrician" && realIds.length ? await Promise.all([
    (await import("./trade-payout-gate.server")).payoutGateFacts(realIds),
    (await import("./electrician-pay.server")).ownerElectricalStepsPaidAt(realIds),
    import("./electrician-pay.server"),
  ]) : null;
  const out = new Map<string, StatusFacts & { channel: string | null; originating: string | null; jobNumber: string }>();
  for (const j of jobs ?? []) {
    const e = (ev ?? []).filter((x) => x.job_id === j.id);
    const stageSince = e.find((x) => x.event_type === "stage_changed" && x.to_stage === j.stage)?.created_at ?? e.find((x) => x.event_type === "stage_changed")?.created_at ?? j.created_at ?? null; // the latest stage move, else when the job was added
    const apAt = e.find((x) => x.event_type === "stage_changed" && x.to_stage === "ready_for_veec")?.created_at ?? null;
    const paidOut = e.find((x) => x.event_type === "payout_marked_paid")?.created_at ?? null;
    const q = (quotes ?? []).filter((x) => x.job_id === j.id);
    const inst = q.find((x) => x.kind === "installation" && x.status === "accepted") ?? q.find((x) => x.kind === "installation");
    const rect = q.find((x) => x.kind === "rectification" && x.status === "issued");
    const iv = (invs ?? []).filter((x) => x.job_id === j.id);
    const pd = paymentDates(iv, (aps ?? []).filter((x) => x.job_id === j.id));
    // The $349 safety check payment, stated once: money received vs an administrative override vs a TEST
    // simulation. Office's payment mirror reads the Xero invoice, so without this the two portals could
    // describe the same job as both "paid" and "$0.00 received".
    const currentInvoice = iv.find((x) => (x.kind ?? "installation") === "installation") ?? iv[0] ?? null;
    const safetyPay = safetyCheckPayState({
      // invoices.deposit_amount is the required safety check payment; invoices.total_paid is the Xero-mirrored receipt.
      requiredAmount: currentInvoice?.deposit_amount ?? null,
      invoicePaid: currentInvoice?.total_paid ?? null,
      overrideCount: (ovs ?? []).filter((o) => o.job_id === j.id && (!currentInvoice || o.invoice_id === currentInvoice.id)).length,
      qaSimulated: (sims ?? []).some((s) => s.job_id === j.id),
      recordedPaidAt: pd.safetyPaidAt,
    });
    const full = pd.finalHalfPaidAt;
    const bs = (books ?? []).filter((b) => b.job_id === j.id).map((b) => { const bz = b.businesses as { name: string; trading_name: string | null } | null; return { kind: b.kind, status: b.status, start: b.scheduled_start, end: b.scheduled_end, business: bz?.trading_name || bz?.name || null, mine: b.business_id === c.biz.id }; });
    const supplied = j.channel === "installer_sourced";
    const mineKinds = c.kind === "installer" ? ["installation"] : ["assessment", "rectification"];
    const workDone = bs.some((b) => mineKinds.includes(b.kind) && b.status === "completed");
    out.set(j.id, {
      jobNumber: j.job_number, channel: j.channel, originating: j.originating_installer_business_id,
      stage: j.stage, stageSince, now, staff: !c.boss, bookings: bs,
      quoteSentAt: inst?.sent_at ?? null, quoteAcceptedAt: inst?.accepted_at ?? null,
      safetyPaidAt: pd.safetyPaidAt, firstHalfPaidAt: pd.firstHalfPaidAt, fixesPaidAt: pd.fixesPaidAt,
      safetyPay,
      ownerTimesChosenAt: (props ?? []).find((p) => p.job_id === j.id)?.created_at ?? null,
      rcTimesAskedAt: e.find((x) => x.event_type === "installer_ready_check_times_delivery" || x.event_type === "ready_check_more_times_requested")?.created_at ?? null,
      rcTimesGivenAt: (rcw ?? []).find((w) => w.job_id === j.id)?.created_at ?? null,
      rectQuoteSentAt: rect?.sent_at ?? null, paidInFullAt: full, apApprovedAt: apAt,
      payout: !workDone ? null : elecPay ? (() => {
        const kind = bs.some((b) => b.mine && b.kind === "rectification" && b.status === "completed") ? "rectification" as const : "assessment" as const;
        const t = elecPay[2].electricianPayTiming(kind, elecPay[0].get(j.id), elecPay[1].get(j.id));
        return electricianPayState({ paidAt: paidOut, formCompleteAt: t.formCompleteAt, ownerPaidAt: t.ownerPaidAt });
      })() : payState({ paidAt: paidOut, apApprovedAt: apAt, installerSupplied: supplied, ownerPaidInFullAt: full }),
      settings,
    });
  }
  return out;
}

export function statusView(c: Ctx, f: StatusFacts) {
  return forViewer(jobStatusLine(f), c.kind);
}

async function ownJobCtx(userId: string, jobId: string) {
  const { requireTradeJob } = await import("./trade-view.server");
  return requireTradeJob(userId, jobId);
}

/** Job page: status line, timeline, and how to chase. Owner contacts only for the installer's own customers. */
export async function tradeJobStatus(userId: string, jobId: string) {
  const c = await ownJobCtx(userId, jobId);
  const f = (await statusFactsFor(c, [jobId])).get(jobId);
  if (!f) throw new WorkflowError("Job not found.");
  const mode = chaseMode({ channel: f.channel, originatingBusinessId: f.originating }, c.biz.id);
  let contact: { phone: string | null; email: string | null } | null = null;
  if (mode === "own_customer") {
    const { data: j } = await admin.from("jobs").select("owners(phone, email)").eq("id", jobId).single();
    const o = j?.owners as { phone: string | null; email: string | null } | null;
    contact = { phone: o?.phone ?? null, email: o?.email ?? null };
  }
  const { data: asked } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "trade_reminder_requested").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { line: statusView(c, f), timeline: jobTimeline(f), chase: { mode, contact, askedAt: asked?.created_at ?? null } };
}

/** "Ask Home Insulation Victoria to send a reminder": recorded for the office's Needs me. Never an automatic send. */
export async function tradeAskReminder(userId: string, jobId: string) {
  const c = await ownJobCtx(userId, jobId);
  const f = (await statusFactsFor(c, [jobId])).get(jobId)!;
  if (chaseMode({ channel: f.channel, originatingBusinessId: f.originating }, c.biz.id) === "own_customer") throw new WorkflowError("This is your own customer. Contact them directly.");
  const line = statusView(c, f);
  const { data: p } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const message = reminderRequestMessage({ jobNumber: f.jobNumber, status: line.text, by: p?.full_name ?? null });
  const { error } = await admin.from("partner_change_requests").insert({ business_id: c.biz.id, kind: "other", message, requested_by: userId });
  if (error) throw new Error(error.message);
  await logEvent(jobId, userId, "trade_reminder_requested", `${c.biz.name} asked Home Insulation Victoria to remind the owner`, { status: line.text }, { internal: true });
  return { ok: true };
}
