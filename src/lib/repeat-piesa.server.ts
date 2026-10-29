// Repeat PIESA persistence (decision 158 + Jo 28 Oct "OFFICE CHOOSES"). Pure rules in repeat-piesa.core.ts.
// Append-only workflow_events per lapsed deadline; the price setting is append-only admin_config_events.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  REPEAT_PIESA_ACCEPTED_EVENT, REPEAT_PIESA_CHOSEN_EVENT, REPEAT_PIESA_PAID_EVENT, REPEAT_PIESA_PRICE_EVENT, REPEAT_REOPEN_EVENT,
  chooseRepeatPayerBlocker, piesaSupersededByReopen, repeatPiesaState, repeatRoundActive, type RepeatChoice, type RepeatPayer, type RepeatState,
} from "./repeat-piesa.core";

export async function repeatPiesaPrice(): Promise<number | null> {
  const { data } = await admin.from("admin_config_events").select("details").eq("event_type", REPEAT_PIESA_PRICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const v = (data?.details as { price_inc_gst?: number | null } | null)?.price_inc_gst;
  return typeof v === "number" && v > 0 ? v : null;
}

export async function setRepeatPiesaPrice(priceIncGst: number | null, actorId: string): Promise<number | null> {
  const v = priceIncGst != null && priceIncGst > 0 ? Math.round(priceIncGst * 100) / 100 : null;
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: REPEAT_PIESA_PRICE_EVENT, summary: v == null ? "Repeat safety check price cleared" : `Repeat safety check price set to $${v} inc GST`, details: { price_inc_gst: v } });
  if (error) throw new Error(error.message);
  return v;
}

/** Batch 1 task 6: when the latest reopen happened (null = never reopened past the safety check). */
export async function latestReopenAt(jobId: string): Promise<string | null> {
  const { data } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", REPEAT_REOPEN_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { created_at?: string } | null)?.created_at ?? null;
}

/** Batch 1 final fix F3: PIESA offers made since the job's latest reopen (all of them for a job never reopened). The
 *  automatic first offer round runs once per job — and once again after a reopen. */
export async function piesaOffersSinceReopen(jobId: string): Promise<number> {
  const since = await latestReopenAt(jobId);
  let q = admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "piesa");
  if (since) q = q.gt("offered_at", since);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Decision 426 fix wave: the job is in a repeat safety check round (office chose who pays after the latest reopen, or
 *  the job was never reopened). Repeat rounds keep their batch offers and refill; first-time checks go one at a time. */
export async function inRepeatPiesaRound(jobId: string): Promise<boolean> {
  const [reopenAt, { data }] = await Promise.all([
    latestReopenAt(jobId),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", REPEAT_PIESA_CHOSEN_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return repeatRoundActive((data as { created_at?: string } | null)?.created_at ?? null, reopenAt);
}

/** Batch 1 task 6: the job's current PIESA record was made before its latest reopen, so it no longer counts. */
export async function currentPiesaSupersededByReopen(jobId: string): Promise<boolean> {
  const at = await latestReopenAt(jobId);
  if (!at) return false;
  const { data } = await admin.from("piesa_records").select("created_at").eq("job_id", jobId).eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return !!data && piesaSupersededByReopen((data as { created_at?: string }).created_at, at);
}

/** Batch 1 task 6: a reopen that superseded a check that was done (had_check) is the current lapse, keyed by its key,
 *  until a PIESA record is created after it. */
async function currentReopenLapse(jobId: string): Promise<string | null> {
  const { data } = await admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", REPEAT_REOPEN_EVENT).contains("details", { had_check: true }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const key = (data?.details as { key?: string } | null)?.key;
  if (!data || !key) return null;
  const { data: after } = await admin.from("piesa_records").select("id").eq("job_id", jobId).gt("created_at", data.created_at).limit(1).maybeSingle();
  return after ? null : key;
}

/** Lapsed deadline + this deadline's choice/acceptance/payment. */
export async function repeatPiesaContext(jobId: string): Promise<{ state: RepeatState; suggestion: string | null; paidBeforeAcceptCents: number | null }> {
  const { installDayContext } = await import("./install-days.server");
  const [c, reopenLapse] = await Promise.all([installDayContext(jobId).catch(() => null), currentReopenLapse(jobId)]);
  const { data: rows } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [REPEAT_PIESA_CHOSEN_EVENT, REPEAT_PIESA_ACCEPTED_EVENT, REPEAT_PIESA_PAID_EVENT, "install_window_expired"]).order("created_at", { ascending: false });
  const ev = rows ?? [];
  const d = (r: { details: unknown }) => (r.details ?? {}) as Record<string, unknown>;
  const chosen = ev.find((r) => r.event_type === REPEAT_PIESA_CHOSEN_EVENT);
  const choice: RepeatChoice | null = chosen ? { payer: d(chosen)["payer"] as RepeatPayer, priceIncGst: (d(chosen)["price_inc_gst"] as number | null) ?? null, deadline: String(d(chosen)["deadline"]), at: chosen.created_at } : null;
  // A lapse stays current until the repeat PIESA is offered (the job may leave installation_scheduling afterwards).
  // A current reopen lapse wins: the check the 30-day window ran from no longer counts.
  const lapsedDeadline = reopenLapse ?? (c && c.deadline && c.expired && !c.booked ? c.deadline : choice?.deadline ?? null);
  const forDeadline = (t: string) => ev.find((r) => r.event_type === t && String(d(r)["deadline"]) === lapsedDeadline)?.created_at ?? null;
  const state = repeatPiesaState({ lapsedDeadline, choice, acceptedAt: forDeadline(REPEAT_PIESA_ACCEPTED_EVENT), paidAt: forDeadline(REPEAT_PIESA_PAID_EVENT) });
  const exp = ev.find((r) => r.event_type === "install_window_expired" && String(d(r)["deadline"]) === lapsedDeadline);
  const sp = exp ? String(d(exp)["payer"] ?? "") : "";
  const acc = ev.find((r) => r.event_type === REPEAT_PIESA_ACCEPTED_EVENT && String(d(r)["deadline"]) === lapsedDeadline);
  const pb = acc ? d(acc)["paid_before_cents"] : null;
  return { state, suggestion: sp && sp !== "undetermined" ? sp : null, paidBeforeAcceptCents: typeof pb === "number" && Number.isFinite(pb) ? pb : null };
}

/** Office choice. The suggestion is recorded alongside, never used to decide. */
export async function chooseRepeatPayer(jobId: string, payer: RepeatPayer, actorId: string, opts: { testPriceIncGst?: number } = {}): Promise<RepeatState> {
  const { state, suggestion } = await repeatPiesaContext(jobId);
  let price = await repeatPiesaPrice();
  // TEST journeys only (server-side, never an endpoint input): a stand-in price on a qa_test job, so the owner-pays path
  // can be proven while the real office setting stays empty.
  if (opts.testPriceIncGst != null) {
    const { data: j } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
    if (j?.source !== "qa_test") throw new WorkflowError("A stand-in repeat price is only allowed on TEST jobs.");
    price = opts.testPriceIncGst;
  }
  const blocker = chooseRepeatPayerBlocker(state, payer, price);
  if (blocker) throw new WorkflowError(blocker);
  const label = payer === "hivic" ? "Home Insulation Victoria" : `the ${payer}`;
  await logEvent(jobId, actorId, REPEAT_PIESA_CHOSEN_EVENT, `Office chose ${label} to pay for the repeat safety check (PIESA)`, {
    deadline: state.deadline, payer, price_inc_gst: price, suggestion, installer_payout_deduction_inc_gst: payer === "installer" ? price : null,
  }, { internal: true });
  return (await repeatPiesaContext(jobId)).state;
}

/** Owner accepts on their secure link. No cost (installer/HIVIC) → normal PIESA offer starts now. */
export async function acceptRepeatPiesa(jobId: string): Promise<RepeatState> {
  const { state } = await repeatPiesaContext(jobId);
  if (state.stage !== "owner_accept") {
    if (state.stage === "owner_pay" || state.stage === "offer") return state; // idempotent
    throw new WorkflowError("There's nothing to accept right now.");
  }
  // What the owner had already paid on the ONE invoice when they accepted: the repeat counts as paid only once payments
  // reach this plus the repeat price (a reversed-and-re-applied payment never counts as the repeat payment).
  const { data: invRow } = await admin.from("invoices").select("total_paid").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const paidBeforeCents = Math.round(Number(invRow?.total_paid ?? 0) * 100);
  await logEvent(jobId, null, REPEAT_PIESA_ACCEPTED_EVENT, `Owner accepted the new safety check (PIESA)${state.payer === "owner" ? ` — $${state.priceIncGst} inc GST added to their bill` : " at no cost to them"}`, { deadline: state.deadline, payer: state.payer, owner_charge_inc_gst: state.payer === "owner" ? state.priceIncGst : 0, paid_before_cents: paidBeforeCents }, { internal: false });
  const next = (await repeatPiesaContext(jobId)).state;
  // Owner pays (decision 233): the price goes on the job's ONE Xero invoice now; every Sync retries / holds for the office.
  if (next.stage === "owner_pay") await (await import("./xero.server")).addRepeatPiesaToXeroInvoice(jobId, null)
    .catch((e) => console.error("repeat PIESA Xero line skipped", (e as Error).message));
  if (next.stage === "offer") await startRepeatOffer(jobId, next).catch((e) => logEvent(jobId, null, "repeat_piesa_offer_failed", `Repeat safety check offer didn't start: ${(e as Error).message}`, { deadline: next.deadline }, { internal: true }));
  return next;
}

/** Office records the owner's repeat-check payment (seen in Xero). Then the offer starts. */
export async function recordRepeatPiesaPaid(jobId: string, actorId: string, reference: string): Promise<RepeatState> {
  const { state } = await repeatPiesaContext(jobId);
  if (state.stage !== "owner_pay") throw new WorkflowError("No repeat safety check payment is waiting on this job.");
  await logEvent(jobId, actorId, REPEAT_PIESA_PAID_EVENT, `Repeat safety check (PIESA) paid — ${reference}`, { deadline: state.deadline, amount_inc_gst: state.priceIncGst, reference }, { internal: true });
  const next = (await repeatPiesaContext(jobId)).state;
  await startRepeatOffer(jobId, next);
  return next;
}

/** Xero sync: once payments on the ONE invoice grew by the repeat price since its line went on, record it paid once and
 *  start the normal PIESA offer. Nothing happens before the line is on the invoice. */
export async function repeatPaidFromInvoice(jobId: string, invoiceId: string, paidCents: number, actorId: string | null): Promise<boolean> {
  const { state } = await repeatPiesaContext(jobId);
  if (state.stage !== "owner_pay" || !state.deadline) return false;
  const rpc = await import("./repeat-piesa.core");
  const { data: added } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", rpc.REPEAT_XERO_ADDED_EVENT).contains("details", { invoice_id: invoiceId, deadline: state.deadline }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = (added?.details ?? null) as { amount_cents?: number; paid_at_add_cents?: number } | null;
  if (!d) return false;
  const { data: acc } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", REPEAT_PIESA_ACCEPTED_EVENT).contains("details", { deadline: state.deadline }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const before = Number((acc?.details as { paid_before_cents?: number } | null)?.paid_before_cents ?? NaN);
  const paidAtAdd = Math.max(Number.isFinite(before) ? before : 0, Number(d.paid_at_add_cents ?? 0));
  if (!rpc.repeatPaidByInvoice({ paidCents, paidAtAddCents: paidAtAdd, priceCents: Number(d.amount_cents ?? 0) })) return false;
  await logEvent(jobId, actorId, REPEAT_PIESA_PAID_EVENT, `Repeat safety check (PIESA) paid on the Xero invoice`, { deadline: state.deadline, amount_inc_gst: state.priceIncGst, reference: "xero", invoice_id: invoiceId }, { internal: true });
  const next = (await repeatPiesaContext(jobId)).state;
  await startRepeatOffer(jobId, next);
  return true;
}

/** Stripe: a card payment for the repeat safety check counts at once. Once a card row for this step landed after the owner
 *  accepted and payments grew by the repeat price, record it paid and start the normal PIESA offer. Idempotent: the
 *  second call sees stage "offer" and does nothing. */
export async function repeatPaidByCard(jobId: string, invoiceId: string, paidCents: number): Promise<boolean> {
  const { state, paidBeforeAcceptCents } = await repeatPiesaContext(jobId);
  if (state.stage !== "owner_pay" || !state.deadline || !state.priceIncGst) return false;
  const { data: acc } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", REPEAT_PIESA_ACCEPTED_EVENT).contains("details", { deadline: state.deadline }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!acc) return false;
  const { PAYMENT_EVENT } = await import("./payment-ledger.server");
  const { data: card } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", PAYMENT_EVENT).contains("details", { invoice_id: invoiceId, source: "card", step: "repeat_safety_check" }).gt("created_at", acc.created_at).limit(1);
  const rpc = await import("./repeat-piesa.core");
  if (!rpc.repeatCardPaid({ priceCents: Math.round(state.priceIncGst * 100), paidCents, paidBeforeAcceptCents, cardRowAfterAccept: (card ?? []).length > 0 })) return false;
  await logEvent(jobId, null, REPEAT_PIESA_PAID_EVENT, `Repeat safety check (PIESA) paid by card`, { deadline: state.deadline, amount_inc_gst: state.priceIncGst, reference: "card", invoice_id: invoiceId }, { internal: true });
  const next = (await repeatPiesaContext(jobId)).state;
  await startRepeatOffer(jobId, next);
  return true;
}

async function startRepeatOffer(jobId: string, s: RepeatState) {
  if (s.stage !== "offer") return;
  const { startPiesaAllocation } = await import("./allocation.server");
  await startPiesaAllocation(jobId, null, "piesa", { adding: false, repeat: true });
}
