// Electrical clearance facts (read-only). Kept lean — admin reads + pure cores, the payment gate from workflow.server — so
// stageEntryBlockers and autoAdvanceJob can read the decision-314 on-site-only clearance without pulling senders, Xero or
// Mitti into their import graph (tests/comms.test.ts). allocation.server re-exports `clearanceFacts` for its callers.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { electricalClearance, onsiteStartAtInstall, type ClearanceFacts } from "./allocation.core";

/** Decision 314: the stored A3 PIESA snapshot's ONLY repair tick is "Be on site at the start of the install day"
 *  (fixes-times.core `onsiteStartOnly`). No snapshot = false. */
export async function onsiteStartOnlyFor(jobId: string): Promise<boolean> {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as unknown as { label: string; value: string | null }[]) : [];
  if (!entries.length) return false;
  const [{ shortAnswersFromEntries }, { onsiteStartOnly }] = await Promise.all([import("./official-short.core"), import("./fixes-times.core")]);
  return onsiteStartOnly(shortAnswersFromEntries("piesa", entries));
}

/** Review R08 / audit F14: has the owner paid the FULL accepted onsite electrical (fixes) charge on its own fixes invoice
 *  (batch 3b), and the safety check payment on the installation invoice (pure rule `onsiteChargePaid`)?
 *  Read-only and lean (ledger reader in payment-ledger.server). No invoice / no accepted charge = false. */
export async function onsiteChargePaidFor(jobId: string): Promise<boolean> {
  const [{ data: inv, error: ie }, { data: rect, error: re }, { data: ws }] = await Promise.all([
    admin.from("invoices").select("id, quote_id, total_inc_gst, total_paid").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("quotes").select("id, customer_total_inc_gst").eq("job_id", jobId).eq("kind", "rectification").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
  ]);
  if (ie || re) throw new Error(`Could not read the onsite electrical charge: ${(ie ?? re)!.message}`);
  if (!inv || !rect) return false;
  const [{ data: piesaLines }, { data: fixesInv, error: fe }] = await Promise.all([
    inv.quote_id ? admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", inv.quote_id).eq("code", "PIESA") : Promise.resolve({ data: [] as { code: string | null; line_total_inc_gst: number | string | null }[] }),
    admin.from("invoices").select("id, total_paid").eq("quote_id", rect.id).eq("kind", "rectification").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (fe) throw new Error(`Could not read the onsite electrical charge: ${fe.message}`);
  if (!fixesInv) return false;
  const [{ onsiteChargePaid, toCents }, { safetyCheckCentsFor }, { invoicePaidCents }] = await Promise.all([import("./payments.core"), import("./safety-check-amount.core"), import("./payment-ledger.server")]);
  const [install, fixes] = await Promise.all([invoicePaidCents(jobId, inv.id, inv.total_paid), invoicePaidCents(jobId, fixesInv.id, fixesInv.total_paid)]);
  return onsiteChargePaid({
    quoteTotalCents: toCents(inv.total_inc_gst),
    safetyCheckCents: safetyCheckCentsFor({ lines: piesaLines ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null }).cents,
    rectTotalCents: toCents(rect.customer_total_inc_gst),
    paid: { install, fixes },
  });
}

export async function clearanceFacts(jobId: string): Promise<ClearanceFacts> {
  // Decision 316 (Jo 25 Oct 2026): the 30 days run from the official PIESA. The anchor is the latest official PIESA
  // (initial, or a reassessment after an expired window) — it stays the anchor after a post_rectification row becomes current.
  const [{ data: initial }, { data: rect }, { data: rq }] = await Promise.all([
    admin.from("piesa_records").select("outcome, completed_date, signed_off_by").eq("job_id", jobId).in("kind", ["initial", "reassessment"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("piesa_records").select("rectification_completed_at, section_c_signed_at, outcome").eq("job_id", jobId).neq("kind", "initial").eq("is_current", true).maybeSingle(),
    admin.from("quotes").select("status").eq("job_id", jobId).eq("kind", "rectification").in("status", ["issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { count: items } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  // Decision 314 follow-up: an A3 whose ONLY repair tick is "Be on site at the start of the install day" clears on the
  // accepted fixes quote + the payment rule (no fixes visit, no Section C). Read only once the fixes quote is accepted.
  const onsiteOnly = rq?.status === "accepted" ? await onsiteStartOnlyFor(jobId).catch(() => false) : false;
  // Review R08 / audit F14: the generic payment gate clears on the safety check payment alone, so it is NOT the fixes
  // payment. The exception needs BOTH: the approved payment rule still cleared (activation switch, route, accepted quote)
  // AND the full accepted onsite electrical charge received (`onsiteChargePaidFor`). Any read failure = not cleared.
  const fixesPaymentCleared = onsiteOnly
    ? (await (await import("./workflow.server")).paymentGate(jobId).then((g) => g.cleared).catch(() => false)) && (await onsiteChargePaidFor(jobId).catch(() => false))
    : false;
  return {
    piesaOutcome: (initial?.outcome as "pass" | "fail" | null) ?? null,
    piesaCompletedAt: initial?.completed_date && initial.signed_off_by ? initial.completed_date : null,
    rectificationRequired: (items ?? 0) > 0 || initial?.outcome === "fail",
    rectificationQuoteAccepted: rq?.status === "accepted",
    rectificationCompletedAt: rect?.rectification_completed_at ?? null,
    sectionCSignedAt: rect?.section_c_signed_at ?? null,
    onsiteStartOnly: onsiteOnly,
    fixesPaymentCleared,
  };
}

/** Decision 314 follow-up: is this job cleared on the `electrician_at_start` basis (open fixes items done on the install day)? */
export async function onsiteStartClearedFor(jobId: string): Promise<boolean> {
  return onsiteStartAtInstall(electricalClearance(await clearanceFacts(jobId)));
}
