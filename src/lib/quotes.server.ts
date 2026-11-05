// CENTRAL QUOTE CALCULATIONS. All customer-facing prices are stored inc GST.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { applyRectificationMargin } from "./rectification-pricing.core";
import { A4_FIXES_PRICING_SOURCE, buildA4FixesQuote, fixesMarginFor, fixesPriceSource } from "./fixes-price.core";
import { shortAnswersFromEntries } from "./official-short.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { quoteInputsFromMeasurement, type MeasurementLike } from "./scope.core";
import { lookupLocation } from "./activity48.core";
import { applyDiscountRules, discountNotes, wholeVeecDiscount } from "./estimate.core";
import { confirmedQuoteDecision, currentEstimateTotal, rectificationQuoteDecision } from "./quote-release.core";
import { saveFixesQuote } from "./fixes-quote-save.server";
import { holdForTotals, quoteTotalsHoldReason } from "./quote-totals.server";
import { QUOTE_TOTALS_HOLD_REASON, quoteTotalsMismatch } from "./quote-totals.core";
import { NEW_QUOTE_HOLD_REASON, NEW_QUOTE_REQUESTED_EVENT, newQuoteRebuildPending } from "./new-quote-request.core";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function activePricing() {
  const { data } = await admin
    .from("pricing_settings")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (!data) throw new WorkflowError("No active pricing settings.");
  return data;
}

async function activeRateCard(kind: "installer" | "electrical", businessId?: string | null, allowFallback = true) {
  let q = admin.from("rate_cards").select("*, rate_card_items(*)").eq("kind", kind).eq("is_active", true);
  if (businessId) q = q.eq("business_id", businessId);
  const { data } = await q.order("version", { ascending: false }).limit(1);
  if (data?.[0]) return data[0];
  if (businessId && !allowFallback) throw new WorkflowError(`The assigned business has no active ${kind} rate card.`);
  if (businessId) return activeRateCard(kind, null, allowFallback);
  const { data: any } = await admin
    .from("rate_cards")
    .select("*, rate_card_items(*)")
    .eq("kind", kind)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1);
  if (!any?.[0]) throw new WorkflowError(`No active ${kind} rate card.`);
  return any[0];
}

type Line = { code: string | null; description: string; quantity: number; unit: string; exGst: number; is_other?: boolean; explanation?: string | null };

// REMOVED (security review 6 Oct): legacy priceInstallerOption and its flat per-m² VEEC credit
// (pricing_settings.veec_credit_per_m2_inc_gst). Every discount uses wholeVeecDiscount + applyDiscountRules.

/** Options: `mittiDraft` prices a draft from the Ready Check measurement before it is accepted.
 *  Batch 3a ("Send me a new quote"): decided from the job's history, whoever calls this (owner tap, office Generate, Mitti
 *  redraft) — while the owner's `new_quote_requested` has no installation quote SENT after it, the quote is built from the
 *  measurement only (an accepted electrical fixes quote is not folded in) and forced to a HELD draft (never issued). */
/** Batch 3a: true while an owner's new-quote request is waiting for its quote to be sent (pure rule in new-quote-request.core).
 *  A read error stops the build (nothing is priced on a guess). */
async function newQuoteRebuildFor(jobId: string): Promise<boolean> {
  const [req, sent] = await Promise.all([
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", NEW_QUOTE_REQUESTED_EVENT),
    admin.from("quotes").select("sent_at").eq("job_id", jobId).eq("kind", "installation"),
  ]);
  if (req.error || sent.error) throw new WorkflowError("The job's quote history could not be read — try again.");
  const asked = (req.data ?? []).map((r) => String(r.created_at));
  return newQuoteRebuildPending(asked, (sent.data ?? []).map((q) => (q.sent_at as string | null) ?? null));
}

export async function generateInstallerQuotes(jobId: string, actorId: string | null, options: { mittiDraft?: boolean } = {}) {
  // Installer-supplied jobs (installer's own customer and price) never use this builder: no installer markup there.
  const { data: jobRow } = await admin.from("jobs").select("channel, installer_led, ap_fee_override_inc_gst, property_id").eq("id", jobId).single();
  if (!jobRow) throw new WorkflowError("Job not found.");
  if (jobRow.channel === "installer_sourced" || jobRow.installer_led) throw new WorkflowError("Installer-supplied job: use the installer's own quote (installer price + PIESA + AP fee). This quote builder is for Home Insulation Victoria jobs only.");
  // Two-requirement model: quote inputs come ONLY from the accepted/current ceiling measurement.
  const { data: m } = await admin.from("ceiling_measurements").select("*").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  let qi: ReturnType<typeof quoteInputsFromMeasurement>;
  try {
    if (options.mittiDraft && m && Number(m.measured_area_m2) > 0) {
      // Draft pricing only; the Send boundary still requires the accepted measurement.
      qi = { areaM2: Number(m.measured_area_m2), removalM2: m.removal_required ? Number(m.removal_m2 ?? 0) : 0,
        access: (m.access_difficulty ?? "easy") as "easy" | "moderate" | "difficult", measurementId: m.id };
    } else qi = quoteInputsFromMeasurement(m as MeasurementLike | null);
  } catch (e) { throw new WorkflowError(e instanceof Error ? e.message : "Ready Check missing."); }
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  if (!inst?.business_id) throw new WorkflowError("Assign the installer before quoting – the quote uses that installer's agreed rates.");
  const settings = await activePricing();
  const card = await activeRateCard("installer", inst.business_id, false);
  const items = card.rate_card_items as { code: string; description: string; unit_price_ex_gst: number; category: string }[];
  const rate = (...codes: string[]) => { for (const c of codes) { const it = items.find((i) => i.code === c); if (it) return Number(it.unit_price_ex_gst); } return null; };
  const { data: rs } = await admin.from("retail_estimator_settings").select("r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst, minimum_customer_copayment_inc_gst, indicative_veec_value").eq("is_current", true).maybeSingle();
  if (!rs) throw new WorkflowError("Owner prices are not set – cannot quote.");
  // Region decides which program maximum applies; an unlisted postcode uses the lower metro cap (fails safe).
  const { data: prop } = await admin.from("properties").select("postcode").eq("id", jobRow.property_id).maybeSingle();
  const loc = prop?.postcode ? lookupLocation(String(prop.postcode).trim()) : null;
  const metro = loc ? loc.metropolitan_or_regional === "Metropolitan" : null;

  const newQuote = await newQuoteRebuildFor(jobId);
  // Batch 3b (Jo 29 Oct 2026): accepted electrical fixes are never folded in — they have their own quote and their own
  // invoice. The installation quote keeps only the installation lines (incl. the PIESA and AP fee lines).
  const gstMul = 1 + Number(settings.gst_rate);
  // Decisions 373/374 (Jo 25 Oct 2026): on our leads WE always choose the electrician (nearest approved REC covering the
  // postcode), so the PIESA line is always HIV's standard price ($349) and the electrician is ours (paid their own
  // onboarding rate on the offer). The safety-check payment (decision 302) and the repeat-PIESA charge (decision 342)
  // read this line, so they follow automatically.
  const { ownerPiesaLineIncGst } = await import("./our-lead-piesa-electrician.core");
  const piesaOwnerIncGst = ownerPiesaLineIncGst(Number(rs.piesa_assessment_inc_gst));
  const piesaElectrician = { source: "ours" as const, business_id: null, rate_inc_gst: null, rate_id: null };
  // Jo 4 Nov 2026: a Ready Check on the new ceiling-layout wording is priced from HIV's fixed retail prices with the
  // installer's brand + batts per area (ceiling-layout.core). Old-wording Ready Checks carry on below, unchanged.
  const layoutZones = (Array.isArray((m as { zones?: unknown } | null)?.zones) ? (m as { zones: { layout?: unknown }[] }).zones : []).map((z) => z?.layout).filter(Boolean);
  if (layoutZones.length) {
    return generateLayoutQuotes({ jobId, actorId, m: m as Record<string, unknown>, layoutAreas: layoutZones as import("./ceiling-layout.core").LayoutArea[], rate, rsBase: rs, settings, card, loc, piesaOwnerIncGst, apFeeIncGst: jobRow.ap_fee_override_inc_gst != null ? Number(jobRow.ap_fee_override_inc_gst) : Number(rs.ap_management_inc_gst), newQuote });
  }
  const { priceHivQuote, HIV_PRICING_RULE, R_VALUE_CODE } = await import("./hiv-quote.core");
  const chosen = await (await import("./insulation-product.server")).productForHivQuote(jobId);
  const rValue = chosen.product?.rValue ?? "R5.0";
  // Decision 341 (Jo 25 Oct 2026): no percentage access loading — the owner pays the normal list price whatever the
  // access. Only a Ready Check rating of "Difficult" (decision 290 `accessFlagFromEntries`) WITH the installer's agreed
  // DIFFICULT_ACCESS rate adds ONE pass-through line (rate × 1.1, paid to the installer, no margin). Pure rule in hiv-quote.core.
  const rawSnap = (m as { raw_snapshot?: unknown } | null)?.raw_snapshot;
  const formEntries = (Array.isArray(rawSnap) ? rawSnap : []).filter((e: { label?: unknown }) => e && typeof e.label === "string") as { label: string; value: unknown }[];
  const { accessFlagFromEntries } = await import("./ready-check-answers.core");
  const { readyCheckAccessRating } = await import("./hiv-quote.core");
  const accessRating = readyCheckAccessRating(accessFlagFromEntries(formEntries).rating, qi.access);
  let calc: ReturnType<typeof priceHivQuote>;
  try {
    calc = priceHivQuote({
      areaM2: qi.areaM2, removalM2: qi.removalM2,
      ownerR5IncPerM2: Number(rs.r5_install_inc_gst_per_m2), ownerRemovalIncPerM2: Number(rs.removal_inc_gst_per_m2),
      piesaIncGst: piesaOwnerIncGst,
      apFeeIncGst: jobRow.ap_fee_override_inc_gst != null ? Number(jobRow.ap_fee_override_inc_gst) : Number(rs.ap_management_inc_gst),
      gstRate: Number(settings.gst_rate),
      installerR5ExPerM2: rate("R5_BATTS"), installerRemovalExPerM2: rate("BATTS_REMOVAL", "REMOVAL", "LOOSE_FILL_REMOVAL"), installerTravelEx: rate("TRAVEL"),
      rValue, installerRExPerM2: rate(R_VALUE_CODE[rValue]), product: chosen.product,
      accessRating, installerDifficultAccessExGst: rate("DIFFICULT_ACCESS"),
    });
  } catch (e) { throw new WorkflowError(e instanceof Error ? e.message : "Could not price this quote."); }

  // Earlier open quotes are superseded only AFTER the new quote and its lines are saved (below): a failure part-way
  // never withdraws the owner's current quote without a replacement.
  const ownSubtotal = r2(calc.lines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  const subtotal = ownSubtotal;
  // Jo, 5 Oct 2026: same basis as the calculator — whole VEECs (Eq 48.1 rounded down, property postcode) × consumer
  // $/VEEC, then the $200 minimum rule. The old flat per-m² credit is no longer used for new/redrafted quotes.
  if (!loc) throw new WorkflowError("Rebate can't be worked out: the property postcode isn't in the official VEU location list. Quote this job manually.");
  const wv = wholeVeecDiscount(qi.areaM2, loc, Number(rs.indicative_veec_value));
  const rules = applyDiscountRules(wv.raw, subtotal, metro, rs);
  const veec = r2(rules.discount);
  const customerTotal = r2(subtotal - veec);
  const [{ data: workflow }, { data: estimate }] = await Promise.all([
    admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled, quote_estimate_variance_tolerance_pct").eq("id", 1).maybeSingle(),
    admin.from("indicative_estimates").select("scenarios").eq("job_id", jobId).eq("status", "current").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const baseRelease = confirmedQuoteDecision({
    estimateTotal: currentEstimateTotal(estimate?.scenarios, qi.removalM2 > 0),
    quoteTotal: customerTotal,
    tolerancePct: Number(workflow?.quote_estimate_variance_tolerance_pct ?? 15),
    hasUnratedExtras: false,
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  // Jo 22 Oct 2026: installer's agreed rate above the owner rate for the chosen R-value → held for office review.
  // Jo 22 Oct 23:45: no confirmed approved product from the form → held, office confirms the product.
  const { PRODUCT_NEEDS_OFFICE } = await import("./insulation-product.core");
  const holds = [...(newQuote ? [NEW_QUOTE_HOLD_REASON] : []), ...calc.holdReasons, ...(chosen.product ? [] : [PRODUCT_NEEDS_OFFICE])];
  // The lines are all in memory here: if they don't add up to the totals the quote is saved held, never released.
  const totalsWhy = quoteTotalsMismatch({ subtotal_inc_gst: subtotal, veec_discount_inc_gst: veec, customer_total_inc_gst: customerTotal }, calc.lines);
  const release: typeof baseRelease = totalsWhy ? { state: "held", status: "draft", reason: QUOTE_TOTALS_HOLD_REASON } : holds.length ? { state: "held", status: "draft", reason: holds.join(" ") } : baseRelease;
  const releasedAt = release.status === "issued" ? new Date().toISOString() : null;
  const availableToOwner = release.state !== "held";
  const discountNote = discountNotes(rules).join(" ") || null;
  const label = `${rValue} ceiling insulation`;
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: label, option_code: R_VALUE_CODE[rValue], status: availableToOwner ? "issued" : "draft", sent_at: releasedAt,
    release_state: release.state, release_hold_reason: release.reason,
    rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal,
    gst_amount: r2(subtotal - subtotal / gstMul), veec_discount_inc_gst: veec, discount_note: discountNote,
    veec_count: wv.veecs, veec_unit_value_inc_gst: wv.unitValue,
    customer_total_inc_gst: customerTotal, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message);
  const { error: itemsError } = await admin.from("quote_items").insert(calc.lines.map((l) => ({ ...l, quote_id: q.id })));
  const { error: internalsError } = itemsError ? { error: null } : await admin.from("quote_internals").insert({
    quote_id: q.id, cost_ex_gst: calc.installerCostEx, ap_margin_ex_gst: calc.installerMarkup.markupEx, ap_fee_ex_gst: r2((jobRow.ap_fee_override_inc_gst != null ? Number(jobRow.ap_fee_override_inc_gst) : Number(rs.ap_management_inc_gst)) / gstMul), // job AP fee override wins
    calc_snapshot: { pricing_rule: HIV_PRICING_RULE, installer_markup: calc.installerMarkup, piesa_electrician: piesaElectrician, measurement_id: qi.measurementId, area_m2: qi.areaM2, removal_m2: qi.removalM2, rate_card_version: card.version, pricing_version: settings.version, access: qi.access, access_rating: accessRating, difficult_access_pass_through: calc.difficultAccess, r_value: rValue, product: chosen.product, product_source: chosen.source, product_declared_not_verified: true, discount_notes: discountNotes(rules), discount_cap_applied: rules.cappedAtMax, discount_reduced_for_minimum: rules.reducedForMin },
  });
  if (itemsError || internalsError) {
    await admin.from("quotes").update({ status: "superseded" }).eq("id", q.id); // withdraw the incomplete new quote; the previous one stays current
    throw new Error(`Quote lines could not be saved: ${(itemsError ?? internalsError)!.message}`);
  }
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued"]).neq("id", q.id);
  if (totalsWhy) await holdForTotals(q.id, jobId, totalsWhy, actorId);
  const summary = release.state === "held" ? (release.reason ?? "Quote held for office review") : release.state === "queued" ? "Installation quote ready to send — queued behind the launch switches" : "Installation quote automatically released to the owner";
  await logEvent(jobId, actorId, release.state === "held" ? "installation_quote_held" : release.state === "queued" ? "installation_quote_queued" : "installation_quote_released", summary, { quote_ids: [q.id], rate_card: card.name, pricing_rule: HIV_PRICING_RULE, release_state: release.state }, { internal: release.state !== "released" });
  if (!chosen.product) await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, q.id, [PRODUCT_NEEDS_OFFICE]);
  return [q.id];
}

/** Derive rectification items from the assessment (replaces previously auto-derived items). */
export async function deriveRectificationItems(jobId: string, actorId: string) {
  const { data: a } = await admin.from("assessments").select("*").eq("job_id", jobId).single();
  if (!a) throw new WorkflowError("No assessment.");
  await admin.from("rectification_items").delete().eq("job_id", jobId).eq("is_other", false).eq("status", "required");
  const rows: { rate_code: string; description: string; quantity: number }[] = [];
  if ((a.downlights_upgrade_qty ?? 0) > 0) rows.push({ rate_code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", quantity: a.downlights_upgrade_qty! });
  if ((a.rcds_required_qty ?? 0) > 0) rows.push({ rate_code: "RCD_INSTALL", description: "Install RCD", quantity: a.rcds_required_qty! });
  if (a.switchboard_condition === "upgrade_required") rows.push({ rate_code: "SWITCHBOARD_UPGRADE", description: "Switchboard upgrade", quantity: 1 });
  if ((a.exhaust_fans_clearance_qty ?? 0) > 0) rows.push({ rate_code: "EXHAUST_CLEARANCE", description: "Exhaust fan clearance guard", quantity: a.exhaust_fans_clearance_qty! });
  if (rows.length)
    await admin.from("rectification_items").insert(rows.map((r) => ({ ...r, job_id: jobId, assessment_id: a.id, added_by: actorId })));
  const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required");
  return count ?? 0;
}

/** Decision 305: the electrician's one total for the repair work, read from the synced A3 PIESA snapshot (pure decision in fixes-price.core). */
async function a4FixesPriceSource(jobId: string) {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string | null }[]) : [];
  return fixesPriceSource(entries.length ? shortAnswersFromEntries("piesa", entries) : null);
}

/** Decision 305 (Jo 25 Oct 2026): ONE line from the electrician's A3 total + the decision-142 margin; no rate-card lookup.
 *  Same supersede/insert/release shape as the rate-card path below — the quote is still a held draft for office review.
 *  Decision 308: `included` is built from the electrician's ticks (fixes-price.core). Decision 310 (Jo 25 Oct 2026):
 *  office-added rectification_items are NOT added on top of the electrician's total — the A3 price is the whole price. */
async function generateA4FixesQuote(jobId: string, actorId: string | null, businessId: string, source: { electricianPriceIncGst: number; included: string }, settings: Awaited<ReturnType<typeof activePricing>>, margin: number, electricianSource: "installer_usual" | "ours") {
  // quotes.rate_card_id is nullable: keep the electrician's active card for reference when there is one, never required here.
  const { data: cards } = await admin.from("rate_cards").select("id, version").eq("kind", "electrical").eq("is_active", true).eq("business_id", businessId).order("version", { ascending: false }).limit(1);
  const card = cards?.[0] ?? null;
  const gstRate = Number(settings.gst_rate);
  const built = buildA4FixesQuote({ electricianPriceIncGst: source.electricianPriceIncGst, included: source.included, gstRate, margin });
  const subtotal = built.subtotalIncGst;
  const q = await saveFixesQuote(jobId, { option_label: "electrical fixes", rate_card_id: card?.id ?? null, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / (1 + gstRate)), veec_discount_inc_gst: 0, customer_total_inc_gst: subtotal, created_by: actorId }, built.lines, { cost_ex_gst: built.costExGst, calc_snapshot: { pricing_source: A4_FIXES_PRICING_SOURCE, electrician_price_inc_gst: built.electricianPriceIncGst, rectification_margin_inc_gst: built.marginIncGst, electrician_source: electricianSource, rate_card_version: card?.version ?? null } });
  if (q.already) return q.id;
  const { data: workflow } = await admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled").eq("id", 1).maybeSingle();
  const release = rectificationQuoteDecision({
    hasNonStandardItem: false,
    manuallyPriced: false,
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  const now = new Date().toISOString();
  if (release.state !== "held") {
    const totalsWhy = await quoteTotalsHoldReason(q.id);
    if (totalsWhy) { await holdForTotals(q.id, jobId, totalsWhy, actorId); return q.id; }
  }
  await admin.from("quotes").update({ status: release.state === "held" ? "draft" : "issued", sent_at: release.state === "released" ? now : null, office_reviewed_at: release.state === "released" ? now : null, office_reviewed_by: null, release_state: release.state, release_hold_reason: release.reason }).eq("id", q.id);
  const summary = release.state === "held" ? (release.reason ?? "Electrical fixes quote held for office review") : release.state === "queued" ? "Electrical fixes quote ready to send — queued behind the launch switches" : "Electrical fixes quote automatically released to the owner";
  await logEvent(jobId, actorId, release.state === "held" ? "rectification_quote_held" : release.state === "queued" ? "rectification_quote_queued" : "rectification_quote_released", summary, { quote_id: q.id, release_state: release.state, pricing_source: A4_FIXES_PRICING_SOURCE }, { internal: release.state !== "released" });
  return q.id;
}

/** Part 3 Task 1 (Jo 2 Nov 2026): Home Insulation Victoria never builds an upgrades (rectification) quote — the
 *  electrician quotes, books and bills the owner directly on every job (upgrades-billing.core). Returns the skip for
 *  every job before any read or write; the builder below is kept intact so a reversal is one line in the predicate. */
export async function generateRectificationQuote(jobId: string, actorId: string | null) {
  const { ELECTRICIAN_BILLS_SKIP, electricianBillsUpgrades } = await import("./upgrades-billing.core");
  if (electricianBillsUpgrades(jobId)) return { skipped: ELECTRICIAN_BILLS_SKIP };
  const { partnerBilledRectificationFor } = await import("./in-house-rectification.server");
  if (await partnerBilledRectificationFor(jobId)) return { skipped: "in_house_partner_bills" as const };
  const settings = await activePricing();
  const { data: rec } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!rec?.business_id) throw new WorkflowError("Assign an approved REC business before generating the electrical fixes quote.");
  // Decision 305: the electrician's own total from the A3 PIESA wins; older forms without it keep the rate-card path below.
  // Decision 351: the $100 follows WHOSE electrician on both routes — ours (incl. on A1) → +$100; the installer's own /
  // usual / nominated electrician → passed through as is.
  const electricianSource = await (await import("./our-lead-piesa-electrician.server")).electricianSourceForJob(jobId, rec.business_id);
  const margin = fixesMarginFor(electricianSource);
  const a4 = await a4FixesPriceSource(jobId);
  if (a4.path === "a4_price") return generateA4FixesQuote(jobId, actorId, rec.business_id, a4, settings, margin, electricianSource);
  const card = await activeRateCard("electrical", rec.business_id, false);
  const rates = card.rate_card_items as { code: string; description: string; unit: string; display_unit?: string | null; unit_price_ex_gst: number }[];
  const { data: items } = await admin.from("rectification_items").select("*").eq("job_id", jobId).eq("status", "required");
  if (!items?.length) throw new WorkflowError("No electrical fixes items.");
  const gst = 1 + Number(settings.gst_rate);
  const lines = [] as { code: string | null; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null; sort: number }[];
  const callout = rates.find((r) => r.code === "CALLOUT");
  if (callout) lines.push({ code: "CALLOUT", description: callout.description, quantity: 1, unit: "flat", unit_price_inc_gst: r2(Number(callout.unit_price_ex_gst) * gst), line_total_inc_gst: r2(Number(callout.unit_price_ex_gst) * gst), is_other: false, explanation: null, sort: 0 });
  let cost = callout ? Number(callout.unit_price_ex_gst) : 0;
  for (const it of items) {
    let unitInc: number;
    if (it.is_other) unitInc = Number(it.other_unit_price_inc_gst ?? 0);
    else {
      const rate = rates.find((r) => r.code === it.rate_code);
      if (!rate) throw new WorkflowError(`No rate for ${it.rate_code}`);
      unitInc = r2(Number(rate.unit_price_ex_gst) * gst);
    }
    cost += (unitInc / gst) * Number(it.quantity);
    const approved = rates.find((r) => r.code === it.rate_code);
    lines.push({ code: it.rate_code, description: it.description, quantity: Number(it.quantity), unit: approved?.display_unit || approved?.unit || "each", unit_price_inc_gst: unitInc, line_total_inc_gst: r2(unitInc * Number(it.quantity)), is_other: it.is_other, explanation: it.explanation, sort: lines.length });
  }
  // Decision 142: owner price = electrician price + the margin spread over the lines; trade cost below stays unmarked.
  // Decision 351: no margin with the installer's own electrician (A1 or A2); our electrician → +$100 on both routes.
  const priced = margin > 0 ? applyRectificationMargin(lines, margin) : lines;
  const subtotal = r2(priced.reduce((a, l) => a + l.line_total_inc_gst, 0));
  const q = await saveFixesQuote(jobId, { option_label: "electrical fixes", rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: 0, customer_total_inc_gst: subtotal, created_by: actorId }, priced, { cost_ex_gst: r2(cost), calc_snapshot: { rate_card_version: card.version, rectification_margin_inc_gst: margin, electrician_source: electricianSource } });
  if (q.already) return q.id;
  const { data: workflow } = await admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled").eq("id", 1).maybeSingle();
  const release = rectificationQuoteDecision({
    hasNonStandardItem: items.some((item) => item.is_other),
    manuallyPriced: items.some((item) => item.needs_office_pricing || item.other_unit_price_inc_gst != null),
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  const now = new Date().toISOString();
  if (release.state !== "held") {
    const totalsWhy = await quoteTotalsHoldReason(q.id);
    if (totalsWhy) { await holdForTotals(q.id, jobId, totalsWhy, actorId); return q.id; }
  }
  await admin.from("quotes").update({ status: release.state === "held" ? "draft" : "issued", sent_at: release.state === "released" ? now : null, office_reviewed_at: release.state === "released" ? now : null, office_reviewed_by: null, release_state: release.state, release_hold_reason: release.reason }).eq("id", q.id);
  const summary = release.state === "held" ? (release.reason ?? "Electrical fixes quote held for office review") : release.state === "queued" ? "Electrical fixes quote ready to send — queued behind the launch switches" : "Standard-rate electrical fixes quote automatically released to the owner";
  await logEvent(jobId, actorId, release.state === "held" ? "rectification_quote_held" : release.state === "queued" ? "rectification_quote_queued" : "rectification_quote_released", summary, { quote_id: q.id, release_state: release.state }, { internal: release.state !== "released" });
  return q.id;
}

/** Legacy scheduled hook retained inert: Office alone may send quotes. */
export async function releaseQueuedQuotes() {
  return { released: 0 };
}

/** Recover only a provably unsent installer quote previously queued by the Office.
 * An older generic approval event does not record whether it sent the quote, so it cannot establish eligibility.
 */
async function requireUnsentQueuedQuote(quote: { id: string; job_id: string; sent_at: string | null; accepted_at: string | null; accepted_by: string | null }) {
  if (quote.sent_at !== null || quote.accepted_at !== null || quote.accepted_by !== null) throw new WorkflowError("A sent or accepted quote cannot be requeued through hold recovery.");
  const safeHistory = "(installer_quote_drafted,installer_quote_held,installer_quote_queued,quote_requeued_after_review)";
  const checks = await Promise.all([
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", quote.job_id).eq("event_type", "installer_quote_queued").contains("details", { quote_id: quote.id }),
    // Fail closed on any other quote-specific history, including legacy send/accept events.
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", quote.job_id).contains("details", { quote_id: quote.id }).not("event_type", "in", safeHistory),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", quote.job_id).contains("details", { quote_ids: [quote.id] }).not("event_type", "in", safeHistory),
    admin.from("customer_agreements").select("id", { count: "exact", head: true }).eq("quote_id", quote.id),
    admin.from("invoices").select("id", { count: "exact", head: true }).eq("quote_id", quote.id),
  ]);
  if (checks.some((r) => r.error || r.count == null)) throw new WorkflowError("The quote's previous delivery and acceptance history could not be checked. It has not been requeued.");
  if (!(checks[0]!.count! > 0) || checks.slice(1).some((r) => r.count! > 0)) throw new WorkflowError("This quote is not proven to be a previously queued, unsent and unaccepted installer quote. Office review is required.");
}

/** Office approval clears an exception hold; previously queued unsent quotes return to the guarded sender. */
/** Audit 23 Oct: owner quotes are released ONLY by Office "Send quote" (sendOfficeReviewedQuote); no installer approval since Jo 24 Oct 2026. */
export async function approveHeldQuote(_quoteId: string, _actorId: string): Promise<never> {
  throw new WorkflowError('Use Office "Send quote" on Quotes to check. Nothing sent.');
}

export async function adjustQuote(quoteId: string, actorId: string, reason: string, changes: { id: string; quantity: number; unit_price_inc_gst: number }[], veecDiscount?: number, discountOverride = false) {
  // 1. Read everything first (every read checks its error), 2. work the new lines and totals out in memory,
  // 3. save in ONE database call. Nothing is written until the whole edit is known to be valid.
  const { data: before, error: be } = await admin.from("quotes").select("*, quote_items(*)").eq("id", quoteId).single();
  if (be) throw new WorkflowError("The quote could not be read, so nothing was changed. Please try again.");
  if (!before) throw new WorkflowError("Quote not found");
  if (!["issued", "draft"].includes(before.status)) throw new WorkflowError("Only open quotes can be adjusted.");
  const existing = (before.quote_items ?? []) as { id: string; line_total_inc_gst: number }[];
  const edited = new Map<string, { id: string; quantity: number; unit_price_inc_gst: number; line_total_inc_gst: number }>();
  for (const c of changes) {
    if (!existing.some((i) => i.id === c.id)) throw new WorkflowError("A line in this edit isn't on the quote any more – reload");
    edited.set(c.id, { id: c.id, quantity: c.quantity, unit_price_inc_gst: r2(c.unit_price_inc_gst), line_total_inc_gst: r2(c.quantity * c.unit_price_inc_gst) });
  }
  const subtotal = r2(existing.reduce((a, i) => a + Number(edited.get(i.id)?.line_total_inc_gst ?? i.line_total_inc_gst), 0));
  const { data: rs, error: rse } = await admin.from("retail_estimator_settings").select("indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle();
  if (rse) throw new WorkflowError("The rebate settings could not be read, so nothing was changed. Please try again.");
  const { quoteAdjustmentDiscount } = await import("./estimate.core");
  const dr = quoteAdjustmentDiscount(veecDiscount ?? Number(before.veec_discount_inc_gst), subtotal, Number(rs?.indicative_veec_value), Number(rs?.minimum_customer_copayment_inc_gst ?? 200), discountOverride);
  if (!dr.ok) throw new WorkflowError(dr.error);
  const veec = dr.discount;
  const { data: s, error: se } = before.pricing_settings_id ? await admin.from("pricing_settings").select("gst_rate").eq("id", before.pricing_settings_id).maybeSingle() : { data: null, error: null };
  if (se) throw new WorkflowError("The GST rate could not be read, so nothing was changed. Please try again.");
  const gst = 1 + Number(s?.gst_rate ?? 0.1);
  const after = { subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: veec, customer_total_inc_gst: r2(subtotal - veec), manually_adjusted: true, ...(veec !== Number(before.veec_discount_inc_gst) ? { veec_count: dr.veecs, veec_unit_value_inc_gst: dr.veecs != null ? Number(rs?.indicative_veec_value) : null } : {}) };
  // Jo 24 Oct 2026: no installer reapproval — an adjusted Ready Check draft simply stays on Quotes to check for office Send.
  let release: { status?: "draft"; release_state: string; release_hold_reason: string; sent_at?: null } | null = null;
  if (before.status === "draft") {
    const readyCheck = (await (await import("./installer-quote-status.server")).loadInstallerQuote(before.job_id)).applies;
    release = { release_state: "held", release_hold_reason: readyCheck ? "Waiting for office review before sending" : "Quote held: manually priced or adjusted" };
  }
  // Intake jobs: an adjusted issued quote goes back to held (not visible as current) until the office re-approves it.
  else if (before.option_code === "INSTALLER_A1" && await (await import("./installer-intake.server")).isIntakeJob(before.job_id))
    release = { status: "draft", release_state: "held", release_hold_reason: "Adjusted after sending — office must re-approve", sent_at: null };
  const items = [...edited.values()];

  const { error: rpcError } = await admin.rpc("apply_quote_adjustment" as never, {
    p_quote_id: quoteId, p_expected_version: before.version, p_items: items, p_totals: after, p_release: release,
    p_adjustment: { adjusted_by: actorId, reason, before_snapshot: before },
  } as never) as { error: { code?: string; message: string } | null };
  if (rpcError && rpcError.code !== "PGRST202" && rpcError.code !== "42883") {
    if (/version_conflict/.test(rpcError.message)) throw new WorkflowError("This quote was changed by someone else – reload");
    throw new Error(rpcError.message);
  }
  if (rpcError) {
    // The save function isn't deployed yet: the old sequence, but already validated above and with every write checked.
    // A failure after the first write can leave a partial save (accepted only until the SQL is deployed).
    console.error("apply_quote_adjustment is not deployed (SQL not applied yet), using the separate writes:", rpcError.message);
    const patch = { ...after, ...(release ?? {}), version: before.version + 1 };
    const { data: moved, error: qe } = await admin.from("quotes").update(patch).eq("id", quoteId).eq("version", before.version).select("id").maybeSingle();
    if (qe) throw new Error(`Quote totals could not be saved: ${qe.message}`);
    if (!moved) throw new WorkflowError("This quote was changed by someone else – reload");
    for (const it of items) {
      const { error: ie } = await admin.from("quote_items").update({ quantity: it.quantity, unit_price_inc_gst: it.unit_price_inc_gst, line_total_inc_gst: it.line_total_inc_gst }).eq("id", it.id).eq("quote_id", quoteId);
      if (ie) throw new Error(`Quote line could not be saved: ${ie.message}`);
    }
    const afterFull = { ...before, ...patch, quote_items: existing.map((i) => ({ ...i, ...(edited.get(i.id) ?? {}) })) };
    const { error: ae } = await admin.from("quote_adjustments").insert({ quote_id: quoteId, adjusted_by: actorId, reason, before_snapshot: before, after_snapshot: afterFull });
    if (ae) throw new Error(`Quote adjustment record could not be saved: ${ae.message}`);
  }
  if (discountOverride && dr.veecs == null) await logEvent(before.job_id, actorId, "quote_discount_override", `Office discount override: ${reason}`, { quote_id: quoteId, requested: veecDiscount ?? null, applied: veec, reduced_for_minimum: dr.reducedForMin }, { internal: true });
  await logEvent(before.job_id, actorId, "quote_adjusted", `Quote manually adjusted: ${reason}`, { quote_id: quoteId, before_total: before.customer_total_inc_gst, after_total: after.customer_total_inc_gst }, { internal: true });
}

/** Jo 4 Nov 2026 (A2, HIV's customer): one quote row per option (main R5.0 + any "thicker too" option), each with its
 *  own rebate and 15% check, all HELD as drafts for office review (as now). The installer's rate card is only what
 *  HIV pays them. A blank retail price, a failed area or an unapproved product → no quote, office Needs me. */
async function generateLayoutQuotes(i: {
  jobId: string; actorId: string | null; m: Record<string, unknown>; layoutAreas: import("./ceiling-layout.core").LayoutArea[];
  rate: (...codes: string[]) => number | null; rsBase: { removal_inc_gst_per_m2: unknown; r5_install_inc_gst_per_m2: unknown; minimum_customer_copayment_inc_gst: unknown; indicative_veec_value: unknown };
  settings: { id: string; version: number; gst_rate: unknown }; card: { id: string; name: string; version: number };
  loc: ReturnType<typeof lookupLocation>; piesaOwnerIncGst: number; apFeeIncGst: number; newQuote: boolean;
}): Promise<string[]> {
  const lc = await import("./ceiling-layout.core");
  const { AP_FEE_DESCRIPTION } = await import("./hiv-quote.core");
  const rawSnap = i.m["raw_snapshot"];
  const entries = (Array.isArray(rawSnap) ? rawSnap : []).filter((e: { label?: unknown }) => e && typeof e.label === "string") as { label: string; value: unknown }[];
  const outcome = lc.readLayoutOutcome(entries);
  const [{ data: rsAll, error: re }, { data: wf, error: we }, { data: estimate }] = await Promise.all([
    admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(),
    admin.from("workflow_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("indicative_estimates").select("scenarios").eq("job_id", i.jobId).eq("status", "current").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (re || we) throw new WorkflowError("Retail prices or settings could not be read — nothing priced.");
  const rsx = (rsAll ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const topupCountsExisting = (wf as Record<string, unknown> | null)?.["topups_count_existing_insulation"] !== false; // ON by default
  const { options, reasons } = lc.priceA2Options({
    areas: i.layoutAreas, brand: outcome.brand, thicker: outcome.thicker, topupCountsExisting, gstRate: Number(i.settings.gst_rate),
    retail: { r5: n(i.rsBase.r5_install_inc_gst_per_m2), removal: n(i.rsBase.removal_inc_gst_per_m2), topup: n(rsx["topup_inc_gst_per_m2"]), r6: n(rsx["r6_install_inc_gst_per_m2"]), r7: n(rsx["r7_install_inc_gst_per_m2"]) },
    installerRatesEx: { R5_BATTS: i.rate("R5_BATTS"), TOPUP_R5: i.rate("TOPUP_R5"), R6_BATTS: i.rate("R6_BATTS"), R7_BATTS: i.rate("R7_BATTS"), REMOVAL: i.rate("BATTS_REMOVAL", "REMOVAL", "LOOSE_FILL_REMOVAL") },
  });
  const ready = (await import("./ready-check-quote.server"));
  if (!options.length) { await ready.recordNeedsOffice(i.jobId, i.actorId, null, reasons); throw new WorkflowError(reasons.join(" ")); }
  if (!i.loc) throw new WorkflowError("The rebate can't be worked out: the property postcode isn't in the official VEU location list. Quote this job manually.");
  const tolerancePct = Number((wf as Record<string, unknown> | null)?.["quote_estimate_variance_tolerance_pct"] ?? 15);
  const anyRemoval = i.layoutAreas.some((a) => a.old === "out");
  const estimateTotal = currentEstimateTotal(estimate?.scenarios, anyRemoval);
  const gstMul = 1 + Number(i.settings.gst_rate);
  const ids: string[] = [];
  for (const opt of options) {
    const wv = wholeVeecDiscount(opt.areaM2, i.loc, Number(i.rsBase.indicative_veec_value));
    const q = lc.assembleLayoutQuote({
      label: opt.label, insulationLines: opt.lines.map(({ sort: _s, ...l }) => l), piesaIncGst: i.piesaOwnerIncGst, apFeeIncGst: i.apFeeIncGst, apFeeDescription: AP_FEE_DESCRIPTION,
      veuRawDiscount: wv.raw, minimumCopayIncGst: Number(i.rsBase.minimum_customer_copayment_inc_gst), estimateTotal, tolerancePct,
      extraHolds: [...(i.newQuote ? [NEW_QUOTE_HOLD_REASON] : []), ...reasons],
    });
    const holdReason = q.holds.length ? q.holds.join(" ") : "Waiting for office review before sending";
    const { data: row, error } = await admin.from("quotes").insert({
      job_id: i.jobId, kind: "installation", option_label: opt.label, option_code: `LAYOUT_R${opt.target}`, status: "draft", sent_at: null,
      release_state: "held", release_hold_reason: holdReason, rate_card_id: i.card.id, pricing_settings_id: i.settings.id,
      subtotal_inc_gst: q.subtotalIncGst, gst_amount: r2(q.subtotalIncGst - q.subtotalIncGst / gstMul), veec_discount_inc_gst: q.veuDiscountIncGst,
      discount_note: q.reducedForMinimum ? discountNotes({ cappedAtMax: false, reducedForMin: true }).join(" ") : null,
      veec_count: wv.veecs, veec_unit_value_inc_gst: wv.unitValue, customer_total_inc_gst: q.customerTotalIncGst, created_by: i.actorId,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Quote could not be saved.");
    const { error: le } = await admin.from("quote_items").insert(q.lines.map((l) => ({ ...l, quote_id: row.id })));
    const { error: ie } = le ? { error: null } : await admin.from("quote_internals").insert({
      quote_id: row.id, cost_ex_gst: opt.installerCostEx, ap_margin_ex_gst: r2((opt.subtotalIncGst / gstMul) - opt.installerCostEx), ap_fee_ex_gst: r2(i.apFeeIncGst / gstMul),
      calc_snapshot: { pricing_rule: "hiv_layout_retail_v1", measurement_id: String(i.m["id"] ?? ""), option_target: opt.target, brand: outcome.brand, thicker_requested: outcome.thicker, areas: i.layoutAreas as unknown as import("@/integrations/supabase/types").Json, topups_count_existing_insulation: topupCountsExisting, rate_card_version: i.card.version, pricing_version: i.settings.version, area_m2: opt.areaM2 },
    });
    if (le || ie) { await admin.from("quotes").update({ status: "superseded" }).in("id", [...ids, row.id]); throw new Error(`Quote lines could not be saved: ${(le ?? ie)!.message}`); }
    ids.push(row.id);
  }
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", i.jobId).eq("kind", "installation").in("status", ["draft", "issued"]).not("id", "in", `(${ids.join(",")})`);
  await logEvent(i.jobId, i.actorId, "installation_quote_held", `Ready Check quote${ids.length > 1 ? "s" : ""} held for office review (${options.map((o) => o.label).join(" + ")})`, { quote_ids: ids, rate_card: i.card.name, pricing_rule: "hiv_layout_retail_v1", release_state: "held" }, { internal: true });
  if (reasons.length) await ready.recordNeedsOffice(i.jobId, i.actorId, ids[0] ?? null, reasons);
  return ids;
}
