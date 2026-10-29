// Office O6 Money reads (decisions 30/109 payouts, 139–144 payments, 230 margin, 240 no Record payment, 243 approved tabs).
// Server-only; every caller is an admin-checked server function in office-money.functions.ts. Read-only except
// `setVeecSpotPrice` (the ONE place the VEEC spot price is entered, audited). TEST (qa_test) and deleted jobs never count.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { melbourneMonthStart, melbourneToday } from "./melbourne-time.core";
import { installerPayExFor, jobMargin, marginTotal, veecValueReceived, type JobMargin } from "./job-margin.core";
import { groupPayouts, invoiceRowState, stepsLine, veecRegistryLabel, type PayoutLine } from "./office-money.core";
import { electricalBillingSource } from "./installer-led.core";
import { payoutGateFacts } from "./trade-payout-gate.server";
import { PAYOUT_FORM_NOT_COMPLETE, tradePayoutBlockers } from "./trade-payout-gate.core";
import { installerPayHeldReasons, ownerPaidInFullAt, payState } from "./trade-view.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

async function inJobs<T>(table: string, cols: string, jobIds: string[], extra?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (const ids of chunks(jobIds)) {
    let q = db.from(table).select(cols).in("job_id", ids);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

type JobRow = { id: string; job_number: string; stage: string | null; source: string | null; channel: string | null; electrician_choice: string | null; originating_installer_business_id: string | null; installation_completed_at: string | null; deleted_at: string | null; owners: { full_name: string | null } | null };
async function liveJobs(ids: string[], testJobIds?: string[]): Promise<Map<string, JobRow>> {
  const out = new Map<string, JobRow>();
  for (const part of chunks(ids)) {
    const { data, error } = await db.from("jobs").select("id, job_number, stage, source, channel, electrician_choice, originating_installer_business_id, installation_completed_at, deleted_at, owners(full_name)").in("id", part);
    if (error) throw new Error(`Could not read jobs: ${error.message}`);
    for (const j of (data ?? []) as JobRow[]) if (!j.deleted_at && (testJobIds ? j.source === "qa_test" && testJobIds.includes(j.id) : j.source !== "qa_test")) out.set(j.id, j);
  }
  return out;
}

/** Today's VEEC spot price: the latest recorded spot price, else the current price setting. */
export async function currentSpotPrice(): Promise<{ price: number | null; pricedOn: string | null; previous: number | null }> {
  const [{ data: spots }, { data: ws }] = await Promise.all([
    db.from("veec_spot_prices").select("price, priced_on, created_at").order("priced_on", { ascending: false }).order("created_at", { ascending: false }).limit(2),
    db.from("workflow_settings").select("current_veec_price").eq("id", 1).maybeSingle(),
  ]);
  const latest = (spots ?? [])[0];
  return { price: latest ? Number(latest.price) : num(ws?.current_veec_price), pricedOn: latest?.priced_on ?? null, previous: (spots ?? [])[1] ? Number(spots[1].price) : null };
}

const STAGE_WORD: Record<string, string> = {
  quote_accepted: "Quote accepted", piesa: "PIESA", assessment: "PIESA", rectification: "Electrical fixes", installation: "Install", install_scheduled: "Install booked",
  ready_for_veec: "Final check done", final_check: "Final check", on_hold: "On hold",
};
const stageWord = (j: JobRow) => j.installation_completed_at ? `Complete ${new Date(j.installation_completed_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}` : STAGE_WORD[j.stage ?? ""] ?? (j.stage ?? "").replace(/_/g, " ");

export type MarginRow = { jobId: string; jobNumber: string; owner: string | null; status: string; completedAt: string | null } & JobMargin;

/** Decision 230: per-job margin for every live job with an accepted quote (most recent 200), one pure rule (job-margin.core). */
export async function moneyMargins(now = new Date()) {
  const { data: quotes, error } = await db.from("quotes").select("id, job_id, kind, subtotal_inc_gst, veec_discount_inc_gst, veec_count, accepted_at").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`Could not read accepted quotes: ${error.message}`);
  const jobIds = [...new Set(((quotes ?? []) as { job_id: string }[]).map((q) => q.job_id))];
  const jobs = await liveJobs(jobIds);
  const ids = [...jobs.keys()].filter((id) => jobs.get(id)!.stage !== "cancelled");
  const qIds = ((quotes ?? []) as { id: string; job_id: string }[]).filter((q) => jobs.has(q.job_id)).map((q) => q.id);
  const internals: { quote_id: string; cost_ex_gst: number | null; calc_snapshot?: { piesa_electrician?: { source?: string; rate_inc_gst?: number | null } } | null }[] = [];
  for (const part of chunks(qIds)) { const { data } = await db.from("quote_internals").select("quote_id, cost_ex_gst, calc_snapshot").in("quote_id", part); internals.push(...(data ?? [])); }
  const [asg, lodg, items, spot, pricing] = await Promise.all([
    inJobs<{ job_id: string; business_id: string; role: string }>("job_assignments", "job_id, business_id, role", ids, (q) => q.eq("active", true).eq("role", "electrician")),
    inJobs<{ job_id: string; quantity: number | null; sale_price_per_veec: number | null }>("veec_lodgements", "job_id, quantity, sale_price_per_veec", ids),
    (async () => { const out: { quote_id: string; code: string | null }[] = []; for (const part of chunks(qIds)) { const { data } = await db.from("quote_items").select("quote_id, code").in("quote_id", part).eq("code", "PIESA"); out.push(...(data ?? [])); } return out; })(),
    currentSpotPrice(),
    db.from("pricing_settings").select("piesa_rec_cost_ex_gst, gst_rate").eq("is_active", true).maybeSingle(),
  ]);
  const gstRate = num(pricing.data?.gst_rate) ?? 0.1;
  const elecIds = [...new Set(asg.map((a) => a.business_id))];
  const { data: rates } = elecIds.length ? await db.from("electrician_rates").select("business_id, rate_inc_gst, status, effective_from").in("business_id", elecIds).eq("service_type", "piesa").in("status", ["active", "approved"]).order("effective_from", { ascending: false }) : { data: [] };
  const piesaRate = new Map<string, number>();
  for (const r of (rates ?? []) as { business_id: string; rate_inc_gst: number }[]) if (!piesaRate.has(r.business_id)) piesaRate.set(r.business_id, Number(r.rate_inc_gst) / (1 + gstRate));
  const fallbackPiesa = num(pricing.data?.piesa_rec_cost_ex_gst);
  // Jo 26 Oct 2026: on Reinsulate's jobs with their own electrician we pay Reinsulate the flat safety check price.
  const installerPaid = await (await import("./installer-paid-electricians.server")).safetyCheckPayeesFor(ids.map((id) => jobs.get(id)!));
  // Installer's own jobs: the portal price is their pay when the quote has no agreed cost (Jo 27 Oct 2026, HV-3385).
  const { readInstallerPrices } = await import("./installer-price.server");
  const portalPrices = await readInstallerPrices(ids.filter((id) => jobs.get(id)?.channel === "installer_sourced"));
  const rows: MarginRow[] = ids.map((id) => {
    const j = jobs.get(id)!;
    const qs = ((quotes ?? []) as { id: string; job_id: string; kind: string; subtotal_inc_gst: number; veec_discount_inc_gst: number; veec_count: number | null }[]).filter((q) => q.job_id === id);
    const inst = qs.find((q) => q.kind === "installation");
    const rect = qs.find((q) => q.kind === "rectification");
    const cost = (qid?: string) => { const c = internals.find((x) => x.quote_id === qid); return c && c.cost_ex_gst != null ? Number(c.cost_ex_gst) : null; };
    const committed = inst ? items.some((it) => it.quote_id === inst.id) : null;
    const ownerDirect = electricalBillingSource({ channel: j.channel, choice: j.electrician_choice, committedLineOnAcceptedQuote: committed, hivPaidAt: null }) === "owner_direct";
    const elec = asg.find((a) => a.job_id === id)?.business_id;
    // Decisions 349/352/353: we pay whoever does the PIESA THEIR own onboarding rate (electrician_rates PIESA row of the
    // assigned electrician) — for the installer's usual electrician that is the quoted line; if our electrician did it
    // instead, the owner's quoted price stands and we pay ours their rate. The quoted usual rate is only the fallback.
    const usualPiesa = inst ? internals.find((x) => x.quote_id === inst.id)?.calc_snapshot?.piesa_electrician : null;
    const usualPiesaEx = usualPiesa?.source === "installer_usual" && Number(usualPiesa.rate_inc_gst) > 0 ? Number(usualPiesa.rate_inc_gst) / (1 + gstRate) : null;
    const paidToInstaller = installerPaid.get(id);
    const piesaCostEx = ownerDirect ? 0 : paidToInstaller ? paidToInstaller.piesaIncGst / (1 + gstRate) : (elec && piesaRate.has(elec) ? piesaRate.get(elec)! : usualPiesaEx ?? fallbackPiesa);
    const l = lodg.find((x) => x.job_id === id);
    const v = veecValueReceived({ lodgedQty: num(l?.quantity), salePrice: num(l?.sale_price_per_veec), quoteCount: num(inst?.veec_count), spotPrice: spot.price });
    const m = jobMargin({
      ownerPriceInc: qs.reduce((a, q) => a + Number(q.subtotal_inc_gst ?? 0), 0) || null, gstRate,
      installerPayEx: installerPayExFor({ recordedInc: null, quoteCostEx: inst ? cost(inst.id) : null, portalPriceInc: portalPrices.get(id)?.price_inc_gst ?? null, installerSourced: j.channel === "installer_sourced", gstRate }), piesaCostEx: piesaCostEx == null ? null : Math.round(piesaCostEx * 100) / 100,
      fixesCostEx: rect ? cost(rect.id) ?? Number(rect.subtotal_inc_gst) / (1 + gstRate) : 0,
      veecValue: v.value, veecIncentive: inst ? Number(inst.veec_discount_inc_gst ?? 0) : 0,
    });
    return { jobId: id, jobNumber: j.job_number, owner: j.owners?.full_name ?? null, status: stageWord(j), completedAt: j.installation_completed_at, ...m };
  }).sort((a, b) => (b.completedAt ?? "9999").localeCompare(a.completedAt ?? "9999")).slice(0, 200);
  const monthStart = melbourneMonthStart(now);
  const month = marginTotal(rows.filter((r) => r.completedAt && r.completedAt >= monthStart));
  return { rows, month, spot: spot.price };
}

/** Payouts (decisions 30/109/355): what we owe each installer (once the job is through Final check) and each electrician
 *  (within 7 days of the office approving their completed Mitti form; never waits for the owner). Mark paid = existing markPayoutPaid. */
export async function moneyPayouts(testJobIds?: string[]) {
  const scope = testJobIds?.length ? testJobIds : ["00000000-0000-0000-0000-000000000000"];
  let jobsQuery = db.from("jobs").select("id").in("stage", ["ready_for_veec", "complete"]).is("deleted_at", null);
  jobsQuery = testJobIds ? jobsQuery.eq("source", "qa_test").in("id", scope) : jobsQuery.neq("source", "qa_test");
  const { data: js, error } = await jobsQuery.limit(2000);
  if (error) throw new Error(`Could not read jobs: ${error.message}`);
  // Decision 355: electrician pay falls due long before Final check (within 7 days of the office approving the completed form
  // — it never waits for the owner), so jobs with a completed safety check / fixes visit are read too — electrician lines only.
  let visitsQuery = db.from("bookings").select("id, job_id, kind, business_id").in("kind", ["assessment", "rectification"]).eq("status", "completed");
  if (testJobIds) visitsQuery = visitsQuery.in("job_id", scope);
  const { data: eb, error: ebe } = await visitsQuery.limit(4000);
  if (ebe) throw new Error(`Could not read completed electrician visits: ${ebe.message}`);
  const finalIds = new Set(((js ?? []) as { id: string }[]).map((j) => j.id));
  const elecVisits = (eb ?? []) as { id: string; job_id: string; kind: string; business_id: string | null }[];
  const jobs = await liveJobs([...new Set([...finalIds, ...elecVisits.map((b) => b.job_id)])], testJobIds);
  const ids = [...jobs.keys()];
  const [asg, quotes, paidEv, apEv, invs] = await Promise.all([
    inJobs<{ job_id: string; business_id: string; role: string; businesses: { name: string; trading_name: string | null } | null }>("job_assignments", "job_id, business_id, role, businesses(name, trading_name)", ids, (q) => q.eq("active", true)),
    inJobs<{ id: string; job_id: string; kind: string }>("quotes", "id, job_id, kind", ids, (q) => q.eq("status", "accepted")),
    inJobs<{ job_id: string; details: { kind?: string; booking_id?: string } | null; created_at: string }>("workflow_events", "job_id, details, created_at", ids, (q) => q.eq("event_type", "payout_marked_paid")),
    inJobs<{ job_id: string; created_at: string }>("workflow_events", "job_id, created_at", ids, (q) => q.eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec")),
    // Audit F19: owner paid in full (Xero mirror) — installer-supplied jobs wait for it, exactly as the installer's screen.
    inJobs<{ job_id: string; kind: string | null; status: string | null; balance_paid_at: string | null; paid_at: string | null; updated_at: string | null }>("invoices", "job_id, kind, status, balance_paid_at, paid_at, updated_at", ids, (q) => q.eq("kind", "installation")),
  ]);
  const internals: { quote_id: string; cost_ex_gst: number | null }[] = [];
  for (const part of chunks(quotes.map((q) => q.id))) { const { data } = await db.from("quote_internals").select("quote_id, cost_ex_gst").in("quote_id", part); internals.push(...(data ?? [])); }
  const costOf = (jobId: string, kind: string) => { const q = quotes.find((x) => x.job_id === jobId && x.kind === kind); const c = q ? internals.find((i) => i.quote_id === q.id) : null; return c?.cost_ex_gst != null ? Number(c.cost_ex_gst) : null; };
  const { data: pricing } = await db.from("pricing_settings").select("piesa_rec_cost_ex_gst, gst_rate").eq("is_active", true).maybeSingle();
  const gst = 1 + (num(pricing?.gst_rate) ?? 0.1);
  // Batch 1 F5: one safety check line per completed visit, paid to whoever did it (after a reopen that may be an
  // electrician no longer assigned) — their name and rate are read too.
  const { safetyVisitFacts } = await import("./trade-payout-gate.server");
  const { safetyVisitPaidAt, visitGateFacts } = await import("./trade-payout-gate.core");
  const safety = await safetyVisitFacts(ids);
  const visitBiz = [...new Set(elecVisits.filter((b) => b.kind === "assessment" && b.business_id).map((b) => b.business_id as string))];
  const { data: visitNames } = visitBiz.length ? await db.from("businesses").select("id, name, trading_name").in("id", visitBiz) : { data: [] };
  const bizName = new Map(((visitNames ?? []) as { id: string; name: string; trading_name: string | null }[]).map((b) => [b.id, b.trading_name || b.name]));
  const elecIds = [...new Set([...asg.filter((a) => a.role === "electrician").map((a) => a.business_id), ...visitBiz])];
  const { data: rates } = elecIds.length ? await db.from("electrician_rates").select("business_id, rate_inc_gst, effective_from").in("business_id", elecIds).eq("service_type", "piesa").in("status", ["active", "approved"]).order("effective_from", { ascending: false }) : { data: [] };
  const piesaEx = (businessId: string) => { const r = ((rates ?? []) as { business_id: string; rate_inc_gst: number }[]).find((x) => x.business_id === businessId); return r ? Math.round((Number(r.rate_inc_gst) / gst) * 100) / 100 : num(pricing?.piesa_rec_cost_ex_gst); };
  // Jo 26 Oct 2026: the safety check on Reinsulate's own-electrician jobs is paid to Reinsulate, at the flat price.
  const installerPaid = await (await import("./installer-paid-electricians.server")).safetyCheckPayeesFor(ids.map((id) => jobs.get(id)!));
  const lines: PayoutLine[] = [];
  for (const id of ids) {
    const j = jobs.get(id)!;
    const ap = apEv.filter((e) => e.job_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at ?? null;
    // Audit F19: installer pay uses the SAME payState as the installer's Money screen — AP + 7 days for our leads; for
    // installer-supplied jobs 7 days after the LATER of AP approval and the owner's payment in full.
    const installerSupplied = j.channel === "installer_sourced";
    const timing = { apApprovedAt: ap, installerSupplied, ownerPaidInFullAt: ownerPaidInFullAt(invs.filter((x) => x.job_id === id)) };
    const instPay = payState({ paidAt: null, ...timing });
    const dueAt = instPay.kind === "coming" ? instPay.on : null;
    // Review R09: the SAME rule Mark paid enforces at the write (installer-pay-timing.server).
    const instHeld = installerPayHeldReasons(timing);
    const paidFor = (kind: string) => paidEv.filter((e) => e.job_id === id && ((e.details?.kind ?? "installation") === kind)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at ?? null;
    const name = (a?: { businesses: { name: string; trading_name: string | null } | null }) => a?.businesses?.trading_name || a?.businesses?.name || "Not assigned";
    const atFinal = finalIds.has(id);
    const inst = asg.find((a) => a.job_id === id && a.role === "installer");
    // Installer pay (Final check jobs only): payState above; while it still says "checking" (no AP approval recorded, or
    // an installer-supplied job still waiting for the owner's payment in full) the line is Held with that reason (never
    // in a Mark paid group).
    if (atFinal) lines.push({ jobId: id, jobNumber: j.job_number, businessId: inst?.business_id ?? null, business: name(inst), kind: "installation", amountEx: costOf(id, "installation"), dueAt, paidAt: paidFor("installation"), ...(instHeld.length ? { held: instHeld } : {}) });
    const elec = asg.find((a) => a.job_id === id && a.role === "electrician");
    const ownerDirect = electricalBillingSource({ channel: j.channel, choice: j.electrician_choice, committedLineOnAcceptedQuote: null, hivPaidAt: null }) === "owner_direct";
    const visited = (kind: string) => elecVisits.some((b) => b.job_id === id && b.kind === kind);
    const paidToInstaller = installerPaid.get(id);
    // Batch 1 F5: one line per completed safety-check visit (none recorded yet on an older job = one line, as before).
    const safetyVisits: ({ id: string; business_id: string | null } | null)[] = elecVisits.filter((b) => b.job_id === id && b.kind === "assessment");
    if (!safetyVisits.length && atFinal) safetyVisits.push(null);
    const paidVisit = (v: { id: string } | null) => safetyVisitPaidAt(paidEv.filter((e) => e.job_id === id), safety.get(id), v?.id ?? null);
    if (paidToInstaller) for (const v of safetyVisits)
      lines.push({ jobId: id, jobNumber: j.job_number, businessId: paidToInstaller.businessId, business: `${paidToInstaller.name} (safety checks by their electricians)`, kind: "assessment", amountEx: Math.round((paidToInstaller.piesaIncGst / gst) * 100) / 100, dueAt: null, paidAt: paidVisit(v), ...(v ? { visitId: v.id } : {}) });
    if (elec && !ownerDirect) {
      // dueAt for electrician lines is set below from the decision-355 rule.
      if (!paidToInstaller) for (const v of safetyVisits) {
        const biz = v?.business_id ?? elec.business_id;
        lines.push({ jobId: id, jobNumber: j.job_number, businessId: biz, business: bizName.get(biz) ?? (biz === elec.business_id ? name(elec) : "Not assigned"), kind: "assessment", amountEx: piesaEx(biz), dueAt: null, paidAt: paidVisit(v), ...(v ? { visitId: v.id } : {}) });
      }
      if (quotes.some((q) => q.job_id === id && q.kind === "rectification") && (atFinal || visited("rectification"))) lines.push({ jobId: id, jobNumber: j.job_number, businessId: elec.business_id, business: name(elec), kind: "rectification", amountEx: costOf(id, "rectification"), dueAt: null, paidAt: paidFor("rectification") });
    }
  }
  // Decision 318: no payout is payable until the matching Mitti form is Complete and its evidence checks pass.
  // Decision 410: an electrician payout is due 7 days after the office approves its completed form.
  const elecJobs = [...new Set(lines.filter((l) => l.kind !== "installation").map((l) => l.jobId))];
  const unpaidJobs = [...new Set(lines.filter((l) => !l.paidAt).map((l) => l.jobId))];
  const facts = await payoutGateFacts([...new Set([...unpaidJobs, ...elecJobs])]);
  const { electricianPayTiming } = await import("./electrician-pay.core");
  for (const l of lines) {
    // Batch 1 F5: a later safety-check visit is gated on its own record, never the first visit's completed form.
    const jf = facts.get(l.jobId);
    const vf = jf && l.kind === "assessment" ? visitGateFacts(jf, safety.get(l.jobId), l.visitId) : jf;
    const t = l.kind === "installation" ? null : electricianPayTiming(l.kind, vf);
    if (t) { l.dueAt = t.dueAt; if (t.approvable) l.approvable = true; }
    if (!l.paidAt) { const f = vf; l.held = [...(f ? tradePayoutBlockers(l.kind, f) : [PAYOUT_FORM_NOT_COMPLETE[l.kind]]), ...(t?.waiting ?? []), ...(l.held ?? [])]; }
  }
  // Jo 28 Oct (decision 158): when the office chose the installer to pay for a repeat safety check, it comes off their install payout.
  const instJobs = [...new Set(lines.filter((l) => l.kind === "installation").map((l) => l.jobId))];
  if (instJobs.length) {
    const { data: rp } = await admin.from("workflow_events").select("job_id, details").in("job_id", instJobs).eq("event_type", "repeat_piesa_payer_chosen");
    const { repeatDeductionEx } = await import("./repeat-piesa.core");
    for (const l of lines) {
      if (l.kind !== "installation" || l.amountEx == null) continue;
      const off = repeatDeductionEx((rp ?? []).filter((e) => e.job_id === l.jobId).map((e) => e.details as { payer?: string; price_inc_gst?: number | null }), gst);
      if (off > 0) { l.amountEx = Math.round((l.amountEx - off) * 100) / 100; l.held = [...(l.held ?? []), ...(l.amountEx < 0 ? ["Repeat safety check costs more than this install payout — the office settles the difference."] : [])]; }
    }
  }
  const g = groupPayouts(lines);
  return { due: g.due, held: g.held, paid: g.paid.slice(0, 30), owedEx: g.due.reduce((a, x) => a + (x.amountEx ?? 0), 0), heldEx: g.held.reduce((a, x) => a + (x.amountEx ?? 0), 0), unknownAmounts: g.due.filter((x) => x.amountEx == null).length };
}

/** Invoices (decisions 139–144, 240): steps derived by payments.server jobPaymentView. Read-only. Batch 3b: a job can have
 *  an install invoice, an electrical fixes invoice and a repeat safety check invoice — each is its own row, with its own
 *  total, its own money, its own steps and its reference. */
export async function moneyInvoices(now = new Date()) {
  const { data: inv, error } = await db.from("invoices").select("id, job_id, kind, total_inc_gst, total_paid, xero_invoice_number, xero_reference, created_at").in("kind", ["installation", "rectification", "repeat_safety_check"]).order("created_at", { ascending: false }).limit(600);
  if (error) throw new Error(`Could not read invoices: ${error.message}`);
  type Inv = { id: string; job_id: string; kind: string; total_inc_gst: number; total_paid: number; xero_invoice_number: string | null; xero_reference: string | null };
  const all = (inv ?? []) as Inv[];
  const jobs = await liveJobs([...new Set(all.map((i) => i.job_id))]);
  const live = all.filter((i) => jobs.has(i.job_id) && jobs.get(i.job_id)!.stage !== "cancelled");
  // The newest invoice of each kind per job (newest first already). One entry per job: its installation invoice, else
  // (fixes accepted before any installation quote) its newest fixes / repeat invoice — such a job is listed too.
  const newest = new Map<string, Inv>();
  for (const i of live) if (!newest.has(`${i.job_id}:${i.kind}`)) newest.set(`${i.job_id}:${i.kind}`, i);
  const kinds = ["installation", "rectification", "repeat_safety_check"] as const;
  const latest = [...new Set(live.map((i) => i.job_id))].map((id) => kinds.map((k) => newest.get(`${id}:${k}`)).find((x): x is Inv => !!x)!);
  const unpaid = (i: Inv | undefined) => !!i && Number(i.total_paid ?? 0) < Number(i.total_inc_gst ?? 0);
  const jobOpen = (jobId: string) => ["installation", "rectification", "repeat_safety_check"].some((k) => unpaid(newest.get(`${jobId}:${k}`)));
  const open = latest.filter((i) => jobOpen(i.job_id)).slice(0, 80);
  const paid = latest.filter((i) => !jobOpen(i.job_id)).slice(0, 20);
  const { jobPaymentView } = await import("./payments.server");
  const { stepInvoiceKind } = await import("./payments.core");
  const { invoiceSlotLabel, invoiceSlotOf } = await import("./office-money.core");
  const rows = [];
  for (const part of chunks([...open, ...paid], 8)) {
    rows.push(...(await Promise.all(part.map(async (i) => {
      const j = jobs.get(i.job_id)!;
      const v = await jobPaymentView(i.job_id, now).catch(() => null);
      const job = { jobId: i.job_id, jobNumber: j.job_number, owner: j.owners?.full_name ?? null, stage: stageWord(j) };
      if (!v) {
        // No payment view (no installation invoice yet, or it could not be read): each of the job's invoices from the
        // Xero mirror, so a fixes / repeat invoice is never missing from the list.
        return kinds.flatMap((k) => {
          const r = newest.get(`${i.job_id}:${k}`);
          if (!r) return [];
          const slot = invoiceSlotOf(k);
          const totalCents = Math.round(Number(r.total_inc_gst ?? 0) * 100), paidCents = Math.round(Number(r.total_paid ?? 0) * 100);
          const st = k === "installation" ? invoiceRowState([], now.toISOString()) : paidCents >= totalCents ? { label: "Paid in full", tone: "green" as const, chase: false } : { label: "On track", tone: "plain" as const, chase: false };
          return [{ ...job, invoiceId: r.id, invoiceNumber: r.xero_invoice_number, label: invoiceSlotLabel(slot, r.xero_reference), reference: r.xero_reference, totalCents, paidCents, steps: k === "installation" ? "Not in Xero yet" : "—", state: st.label, tone: st.tone, chase: st.chase }];
        });
      }
      return (["install", "fixes", "repeat"] as const).flatMap((slot) => {
        const r = v.invoices[slot];
        if (!r) return [];
        const steps = v.steps.filter((x) => stepInvoiceKind(x.key) === slot);
        const st = invoiceRowState(steps, now.toISOString());
        return [{ ...job, invoiceId: r.id, invoiceNumber: r.xero_invoice_number, label: invoiceSlotLabel(slot, r.xero_reference), reference: r.xero_reference, totalCents: Math.round(Number(r.total_inc_gst ?? 0) * 100), paidCents: v.paid[slot], steps: steps.length ? stepsLine(steps) : "Not in Xero yet", state: st.label, tone: st.tone, chase: st.chase }];
      });
    }))).flat());
  }
  const owedCents = rows.reduce((a, r) => a + Math.max(0, r.totalCents - r.paidCents), 0);
  return { rows, owedCents, openCount: open.length, overdue: rows.filter((r) => r.chase).length, bounded: latest.length > open.length + paid.length };
}

/** VEECs tab: lodged / registered / waiting this month and per job (decisions 28–29, 119; audit §6). */
export async function moneyVeecs(now = new Date()) {
  const [{ data: lodg, error }, { data: done }] = await Promise.all([
    db.from("veec_lodgements").select("job_id, quantity, status, submitted_date, sale_price_per_veec, updated_at").limit(2000),
    db.from("jobs").select("id").not("installation_completed_at", "is", null).neq("source", "qa_test").is("deleted_at", null).order("installation_completed_at", { ascending: false }).limit(200),
  ]);
  if (error) throw new Error(`Could not read VEEC lodgements: ${error.message}`);
  const ids = [...new Set([...((lodg ?? []) as { job_id: string }[]).map((l) => l.job_id), ...((done ?? []) as { id: string }[]).map((d) => d.id)])];
  const jobs = await liveJobs(ids);
  const live = [...jobs.keys()];
  const [quotes, meas, signed, spot] = await Promise.all([
    inJobs<{ job_id: string; veec_count: number | null }>("quotes", "job_id, veec_count", live, (q) => q.eq("status", "accepted").eq("kind", "installation")),
    inJobs<{ job_id: string; measured_area_m2: number | null }>("ceiling_measurements", "job_id, measured_area_m2", live, (q) => q.eq("is_current", true)),
    inJobs<{ job_id: string; consumer_signed_at: string | null }>("customer_assignments", "job_id, consumer_signed_at", live, (q) => q.eq("record_kind", "final_veec_assignment").neq("status", "cancelled")),
    currentSpotPrice(),
  ]);
  const monthStart = melbourneToday(new Date(melbourneMonthStart(now)));
  const rows = live.map((id) => {
    const j = jobs.get(id)!;
    const l = ((lodg ?? []) as { job_id: string; quantity: number | null; status: string; submitted_date: string | null; sale_price_per_veec: number | null }[]).find((x) => x.job_id === id);
    const lodgedQty = l && l.status !== "not_submitted" ? num(l.quantity) : null;
    const veecs = lodgedQty ?? num(quotes.find((q) => q.job_id === id)?.veec_count);
    const claimed = lodgedQty != null && spot.price != null ? Math.round(lodgedQty * (num(l?.sale_price_per_veec) ?? spot.price)) : null;
    const received = l?.status === "approved" && lodgedQty != null && l.sale_price_per_veec != null ? Math.round(lodgedQty * Number(l.sale_price_per_veec)) : null;
    return {
      jobId: id, jobNumber: j.job_number, owner: j.owners?.full_name ?? null, installedAt: j.installation_completed_at, areaM2: num(meas.find((m) => m.job_id === id)?.measured_area_m2),
      veecs, claimed, received, status: l?.status ?? null, submittedDate: l?.submitted_date ?? null,
      registry: veecRegistryLabel({ stage: j.stage, lodgementStatus: l?.status ?? null, submittedDate: l?.submitted_date ?? null, ownerSigned: signed.some((s) => s.job_id === id && !!s.consumer_signed_at) }),
    };
  }).sort((a, b) => (b.installedAt ?? "").localeCompare(a.installedAt ?? ""));
  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number | null) => xs.reduce((a, r) => a + (f(r) ?? 0), 0);
  const lodgedMonth = rows.filter((r) => r.submittedDate && r.submittedDate >= monthStart && r.status !== "not_submitted");
  const registered = rows.filter((r) => r.status === "approved");
  const waiting = rows.filter((r) => r.status === "submitted" || r.status === "query");
  return {
    rows, spot,
    lodgedMonth: { jobs: lodgedMonth.length, veecs: sum(lodgedMonth, (r) => r.veecs), value: sum(lodgedMonth, (r) => r.claimed) },
    registered: { jobs: registered.length, veecs: sum(registered, (r) => r.veecs), received: sum(registered, (r) => r.received) },
    waiting: { jobs: waiting.length, veecs: sum(waiting, (r) => r.veecs) },
  };
}

/** The ONE place the VEEC spot price is entered (audit §6): records today's spot price and keeps the current-price setting in step. */
export async function setVeecSpotPrice(price: number, actorId: string) {
  const pricedOn = melbourneToday();
  const { data: ws, error: we } = await db.from("workflow_settings").select("id, current_veec_price").eq("id", 1).maybeSingle();
  if (we || !ws) throw new Error("Settings not found – nothing saved.");
  const { error } = await db.from("veec_spot_prices").insert({ price, priced_on: pricedOn, source: "Office entry (Money › VEECs)", note: null, recorded_by: actorId });
  if (error) throw new Error(`Spot price could not be saved: ${error.message}`);
  const { error: ue } = await db.from("workflow_settings").update({ current_veec_price: price }).eq("id", ws.id);
  if (ue) throw new Error(`Spot price recorded, but the current price setting could not be updated: ${ue.message}`);
  await db.from("admin_config_events").insert({ actor_id: actorId, event_type: "current_veec_price_changed", summary: `VEEC spot price set to $${price} (Money › VEECs)`, details: { from: ws.current_veec_price, to: price, priced_on: pricedOn } });
  return { ok: true, pricedOn };
}

/** Office "Create invoice": the job's accepted installation quote and (batch 3b) its current accepted electrical fixes quote
 *  each go through the same once-only invoice step the acceptance uses; an invoice already linked is left alone. */
export async function createInvoiceForJob(jobId: string, actorId: string | null): Promise<{ ok: true }> {
  const { WorkflowError } = await import("./workflow.server");
  const { data: job } = await admin.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  if (job?.stage === "cancelled") throw new WorkflowError("This job is cancelled, so no invoice can be created.");
  const { data: q, error } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError(`Could not read the accepted quote: ${error.message}`);
  let fixes: { id: string; status: string } | null = null;
  try { fixes = await (await import("./fixes-quote-current.server")).currentFixesQuote(jobId); }
  catch (e) { throw new WorkflowError((e as Error).message); }
  const quoteIds = [q?.id, fixes?.status === "accepted" ? fixes.id : null].filter((x): x is string => !!x);
  // Batch 3b: an owner-paid repeat safety check the owner accepted (not yet paid) gets its own invoice too.
  const { repeatPiesaContext } = await import("./repeat-piesa.server");
  const { state: repeat } = await repeatPiesaContext(jobId);
  const repeatDue = repeat.stage === "owner_pay" && repeat.payer === "owner" && !!repeat.deadline && !!repeat.priceIncGst;
  if (!quoteIds.length && !repeatDue) throw new WorkflowError("This job has no accepted quote, so there is nothing to invoice.");
  const { createInvoiceAfterAcceptance } = await import("./invoice-after-acceptance.server");
  const errors: string[] = [];
  for (const id of quoteIds) {
    const r = await createInvoiceAfterAcceptance(id, jobId, actorId);
    if (!r.ok) errors.push(`${id === q?.id ? "Invoice" : "Fixes invoice"}: ${r.error ?? "unknown error"}`);
  }
  if (repeatDue) {
    try {
      const { createRepeatInvoice } = await import("./xero.server");
      const { invoiceId } = await createRepeatInvoice(jobId, repeat.deadline!, repeat.priceIncGst!);
      const { data: inv } = await admin.from("invoices").select("xero_invoice_id, last_sync_error").eq("id", invoiceId).maybeSingle();
      if (!inv?.xero_invoice_id) errors.push(`Repeat safety check invoice: ${inv?.last_sync_error ?? "not linked to Xero"}`);
    } catch (e) { errors.push(`Repeat safety check invoice: ${(e as Error).message}`); }
  }
  if (errors.length) throw new WorkflowError(`The invoice still did not reach Xero: ${errors.join(" · ")}`);
  return { ok: true };
}
