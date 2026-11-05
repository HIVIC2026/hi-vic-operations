// Installer fixes deep, Task 6 (Jo 5 Nov 2026): the Boss / Office offers a discount on a quote the owner already has
// (installer's OWN customer job). Makes a NEW quote version — a held draft on "Quotes to check" with a line
// "Discount −$X" under the installer's price — and never touches the sent quote. The office's Send (office-quote-review
// `releaseQuoteToOwner`) replaces the old quote through `discountSourceFor` + `replaceDiscountSource`; the 30-day validity
// restarts from the new send date because it is a new quote row. Nothing here sends anything to anyone.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { canEnterPrice } from "./installer-price.core";
import { quoteIsExpired } from "./quote-expiry.core";
import {
  DISCOUNT_ACCEPTED, DISCOUNT_ALREADY_PENDING, DISCOUNT_EXPIRED, DISCOUNT_HOLD_REASON, DISCOUNT_NOT_OWN_JOB, DISCOUNT_NOT_SENT,
  DISCOUNT_PRICE_CHANGE_WAITING, DISCOUNT_QUOTE_LABEL, DISCOUNT_REFUSED_ROLE, INSTALLER_DISCOUNT_EVENT, INSTALLER_DISCOUNT_REPLACED_EVENT,
  discountErrors, discountedLines, discountedTotals, existingDiscountIncGst,
} from "./installer-discount.core";

const MAIN_CODE = "INSTALLER_A1";
const QUOTE_COLS = "id, job_id, kind, status, sent_at, accepted_at, expired_at, option_code, option_label, created_at, subtotal_inc_gst, veec_discount_inc_gst, discount_note, veec_count, veec_unit_value_inc_gst, customer_total_inc_gst, partner_business_id, cobrand, rate_card_id, pricing_settings_id, prices_include_gst";

type DiscountEvent = { quote_id: string; source_quote_id: string; amount_inc_gst: number; note: string | null; requested_by: string };

/** The ACTIVE membership row for this business, read directly (same rule as installer-price-set.server). Null = not a member. */
async function memberRoleFor(userId: string, businessId: string): Promise<string | null> {
  const { data, error } = await admin.from("business_members").select("member_role").eq("business_id", businessId).eq("user_id", userId).eq("active", true).limit(1).maybeSingle();
  if (error) throw new WorkflowError("Your business membership could not be read.");
  return (data as { member_role?: string | null } | null)?.member_role ?? null;
}

/** One quote row with its lines in order (the installer card shows the quote the owner still has while a discount waits). */
export async function quoteWithLines(quoteId: string) {
  const { data, error } = await admin.from("quotes").select("id, job_id, status, sent_at, accepted_at, expired_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)").eq("id", quoteId).maybeSingle();
  if (error) throw new WorkflowError("The quote could not be read.");
  if (!data) return null;
  return { ...data, quote_items: [...(data.quote_items ?? [])].sort((a, b) => a.sort - b.sort) };
}

/** The discount waiting for the office on this job (its draft is still a draft), else null. */
export async function installerDiscountState(jobId: string): Promise<{ pending: { quoteId: string; sourceQuoteId: string; amountIncGst: number; note: string | null; at: string } | null }> {
  const { data: ev, error } = await admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", INSTALLER_DISCOUNT_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The discount history could not be read.");
  const d = ev?.details as DiscountEvent | null | undefined;
  if (!ev || !d?.quote_id) return { pending: null };
  const { data: q, error: qe } = await admin.from("quotes").select("id, status, sent_at").eq("id", d.quote_id).maybeSingle();
  if (qe) throw new WorkflowError("The discount quote could not be read.");
  if (!q || q.status !== "draft" || q.sent_at) return { pending: null };
  return { pending: { quoteId: d.quote_id, sourceQuoteId: d.source_quote_id, amountIncGst: Number(d.amount_inc_gst), note: d.note ?? null, at: String(ev.created_at) } };
}

/** Makes the held discount version. Only Boss / Office of the job's business; only on a sent, unaccepted, unexpired
 *  own-job installation quote; one discount waiting at a time. Returns the new draft's id. */
export async function requestInstallerDiscount(jobId: string, actorId: string, amountIncGst: number, note: string | null | undefined): Promise<{ quoteId: string }> {
  const { data: job, error: je } = await admin.from("jobs").select("id, channel, stage, deleted_at, qa_archived_at, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (je || !job) throw new WorkflowError("Job not found.");
  if (job.channel !== "installer_sourced" || !job.originating_installer_business_id) throw new WorkflowError(DISCOUNT_NOT_OWN_JOB);
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) throw new WorkflowError("This job is closed.");
  if (!canEnterPrice(await memberRoleFor(actorId, job.originating_installer_business_id))) throw new WorkflowError(DISCOUNT_REFUSED_ROLE);

  const { data: quotes, error: qe } = await admin.from("quotes").select(QUOTE_COLS).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted", "expired"]).order("created_at", { ascending: false });
  if (qe) throw new WorkflowError("The quote could not be read.");
  const all = quotes ?? [];
  if (all.some((q) => q.status === "accepted")) throw new WorkflowError(DISCOUNT_ACCEPTED);
  const sent = all.find((q) => q.status === "issued" && q.sent_at && q.option_code === MAIN_CODE);
  if (!sent) {
    if (all.some((q) => q.status === "expired" || q.expired_at)) throw new WorkflowError(DISCOUNT_EXPIRED);
    throw new WorkflowError(DISCOUNT_NOT_SENT);
  }
  if (sent.expired_at || quoteIsExpired({ kind: "installation", sent_at: sent.sent_at })) throw new WorkflowError(DISCOUNT_EXPIRED);
  if ((await installerDiscountState(jobId)).pending) throw new WorkflowError(DISCOUNT_ALREADY_PENDING);
  // Main's "installer changes the price after Send": while that new price waits for its replacement quote, a discount
  // on the old sent price would be built from figures already withdrawn — refused until the office sends the new quote.
  if (await (await import("./installer-price-change.server")).pendingChangeFor(jobId)) throw new WorkflowError(DISCOUNT_PRICE_CHANGE_WAITING);

  const [{ data: items, error: ie }, { data: rs, error: re }] = await Promise.all([
    admin.from("quote_items").select("code, description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, is_other, explanation, sort").eq("quote_id", sent.id),
    admin.from("retail_estimator_settings").select("indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle(),
  ]);
  if (ie || !items?.length) throw new WorkflowError("The quote's lines could not be read.");
  if (re || !rs) throw new WorkflowError("Owner price settings could not be read.");
  const price = items.find((l) => l.code === "INSTALLER_PRICE");
  const amount = Math.round(Number(amountIncGst) * 100) / 100;
  // Review 1 finding 4: the sent quote may already be a discount version — the new amount comes off what is left.
  const errors = discountErrors(amount, Number(price?.line_total_inc_gst ?? 0), { subtotal_inc_gst: sent.subtotal_inc_gst, veec_discount_inc_gst: sent.veec_discount_inc_gst, minimumCopay: Number(rs.minimum_customer_copayment_inc_gst ?? 200), veecValue: Number(rs.indicative_veec_value) }, existingDiscountIncGst(items));
  if (errors.length) throw new WorkflowError(errors.join(" "));

  const totals = discountedTotals(sent, amount);
  const lines = discountedLines(items, amount);
  const { data: q, error: insErr } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: DISCOUNT_QUOTE_LABEL, option_code: MAIN_CODE, status: "draft", sent_at: null,
    release_state: "held", release_hold_reason: DISCOUNT_HOLD_REASON,
    subtotal_inc_gst: totals.subtotal_inc_gst, gst_amount: totals.gst_amount, veec_discount_inc_gst: totals.veec_discount_inc_gst, customer_total_inc_gst: totals.customer_total_inc_gst,
    discount_note: sent.discount_note ?? null, veec_count: sent.veec_count ?? null, veec_unit_value_inc_gst: sent.veec_unit_value_inc_gst ?? null,
    partner_business_id: sent.partner_business_id ?? null, cobrand: sent.cobrand ?? null, rate_card_id: sent.rate_card_id ?? null, pricing_settings_id: sent.pricing_settings_id ?? null,
    created_by: actorId,
  }).select("id").single();
  if (insErr || !q) throw new WorkflowError(insErr?.message ?? "The discount quote could not be saved.");
  const { error: le } = await admin.from("quote_items").insert(lines.map((l) => ({ ...l, quote_id: q.id })));
  if (le) {
    await admin.from("quotes").update({ status: "superseded" }).eq("id", q.id).eq("status", "draft"); // withdraw the half-saved version; the sent quote stays
    throw new WorkflowError(`The discount quote's lines could not be saved: ${le.message}`);
  }
  // The office's Send checks the electrician snapshot per quote id (quoteBillingBlocker): carry the sent quote's over.
  const { data: snap, error: se } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_quote_electrician_snapshot").contains("details", { quote_id: sent.id }).limit(1).maybeSingle();
  if (se) throw new WorkflowError("The quote's electrician snapshot could not be read.");
  if (snap) await logEvent(jobId, actorId, "mitti_quote_electrician_snapshot", "Ready Check quote electrician price and identity snapshot retained (discount version)", { ...(snap.details as Record<string, unknown>), quote_id: q.id }, { internal: true });
  const cleanNote = (note ?? "").trim() || null;
  const details: DiscountEvent = { quote_id: q.id, source_quote_id: sent.id, amount_inc_gst: amount, note: cleanNote, requested_by: actorId };
  // The installer's note is for the office only: it goes in this internal event (job history), never on the quote row
  // (`quotes.discount_note` is shown to the owner once a quote is issued).
  await logEvent(jobId, actorId, INSTALLER_DISCOUNT_EVENT, `Installer offered a discount of $${amount.toLocaleString("en-AU", { minimumFractionDigits: 2 })} — new quote version held for office review${cleanNote ? `. Note to office: ${cleanNote}` : ""}`, details as unknown as Record<string, unknown>, { internal: true });
  return { quoteId: q.id };
}

/** For the office Send: the sent quote this draft replaces (null = not a discount version). */
export async function discountSourceFor(jobId: string, quoteId: string): Promise<{ sourceQuoteId: string; status: string } | null> {
  const { data: ev, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALLER_DISCOUNT_EVENT).contains("details", { quote_id: quoteId }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The discount history could not be read.");
  const d = ev?.details as DiscountEvent | null | undefined;
  if (!d?.source_quote_id) return null;
  const { data: src, error: se } = await admin.from("quotes").select("id, status").eq("id", d.source_quote_id).maybeSingle();
  if (se) throw new WorkflowError("The earlier quote could not be read.");
  return { sourceQuoteId: d.source_quote_id, status: src?.status ?? "missing" };
}

/** After the office's Send claimed the discount version: the old sent quote leaves the owner's page (superseded). */
export async function replaceDiscountSource(jobId: string, quoteId: string, sourceQuoteId: string, actorId: string | null): Promise<void> {
  const { data, error } = await admin.from("quotes").update({ status: "superseded" }).eq("id", sourceQuoteId).eq("job_id", jobId).eq("status", "issued").select("id");
  if (error) throw new WorkflowError("The earlier quote could not be replaced.");
  if (data?.length) await logEvent(jobId, actorId, INSTALLER_DISCOUNT_REPLACED_EVENT, "Discount quote sent — it replaces the earlier quote; the 30 days run from today", { quote_id: quoteId, replaced_quote_id: sourceQuoteId }, { internal: true });
}
