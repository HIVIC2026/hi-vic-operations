// CENTRAL QUOTE CALCULATIONS. All customer-facing prices are stored inc GST.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { applyRectificationMargin, RECTIFICATION_MARGIN_INC_GST } from "./rectification-pricing.core";
import { A4_FIXES_PRICING_SOURCE, buildA4FixesQuote, fixesPriceSource } from "./fixes-price.core";
import { shortAnswersFromEntries } from "./official-short.core";
import { WorkflowError, logEvent } from "./workflow.server";
import { quoteInputsFromMeasurement, type MeasurementLike } from "./scope.core";
import { lookupLocation } from "./activity48.core";
import { applyDiscountRules, discountNotes, wholeVeecDiscount } from "./estimate.core";
import { confirmedQuoteDecision, currentEstimateTotal, rectificationQuoteDecision } from "./quote-release.core";

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
  const { data: rs } = await admin.from("retail_estimator_settings").select("r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier, minimum_customer_copayment_inc_gst, indicative_veec_value").eq("is_current", true).maybeSingle();
  if (!rs) throw new WorkflowError("Owner prices are not set – cannot quote.");
  // Region decides which program maximum applies; an unlisted postcode uses the lower metro cap (fails safe).
  const { data: prop } = await admin.from("properties").select("postcode").eq("id", jobRow.property_id).maybeSingle();
  const loc = prop?.postcode ? lookupLocation(String(prop.postcode).trim()) : null;
  const metro = loc ? loc.metropolitan_or_regional === "Metropolitan" : null;

  // Known rectification scope (owner-approved) is folded in so the single accepted total covers the whole job. Lines stay itemised, no markup.
  const { data: rectQuote } = await admin.from("quotes").select("id, quote_items(*)").eq("job_id", jobId).eq("kind", "rectification").eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const rectLines = ((rectQuote?.quote_items ?? []) as { code: string | null; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null }[])
    .map((l) => ({ code: l.code, description: `electrical fixes: ${l.description}`, quantity: Number(l.quantity), unit: l.unit, unit_price_inc_gst: Number(l.unit_price_inc_gst), line_total_inc_gst: Number(l.line_total_inc_gst), is_other: l.is_other, explanation: l.explanation }));
  const rectTotal = r2(rectLines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  const gstMul = 1 + Number(settings.gst_rate);
  const { priceHivQuote, HIV_PRICING_RULE, R_VALUE_CODE } = await import("./hiv-quote.core");
  const chosen = await (await import("./insulation-product.server")).productForHivQuote(jobId);
  const rValue = chosen.product?.rValue ?? "R5.0";
  // Decision 290 (Jo 25 Oct 2026): the A2 form no longer carries an access fee — the access rating is the flag and the
  // office decides any access charge through the normal quote adjustment. Nothing is read from the form here.
  const accessFee: { amountIncGst: number | null; reason: string | null } = { amountIncGst: null, reason: null };
  let calc: ReturnType<typeof priceHivQuote>;
  try {
    calc = priceHivQuote({
      areaM2: qi.areaM2, removalM2: qi.removalM2,
      // Owner access loading comes from the office-set owner prices (same as the estimate).
      accessMultiplier: Number(qi.access === "difficult" ? rs.access_difficult_multiplier : qi.access === "moderate" ? rs.access_moderate_multiplier : rs.access_standard_multiplier),
      ownerR5IncPerM2: Number(rs.r5_install_inc_gst_per_m2), ownerRemovalIncPerM2: Number(rs.removal_inc_gst_per_m2),
      piesaIncGst: Number(rs.piesa_assessment_inc_gst),
      apFeeIncGst: jobRow.ap_fee_override_inc_gst != null ? Number(jobRow.ap_fee_override_inc_gst) : Number(rs.ap_management_inc_gst),
      gstRate: Number(settings.gst_rate),
      installerR5ExPerM2: rate("R5_BATTS"), installerRemovalExPerM2: rate("BATTS_REMOVAL", "REMOVAL", "LOOSE_FILL_REMOVAL"), installerTravelEx: rate("TRAVEL"),
      rValue, installerRExPerM2: rate(R_VALUE_CODE[rValue]), product: chosen.product,
      difficultAccessFeeIncGst: accessFee.amountIncGst,
    });
  } catch (e) { throw new WorkflowError(e instanceof Error ? e.message : "Could not price this quote."); }

  // Earlier open quotes are superseded only AFTER the new quote and its lines are saved (below): a failure part-way
  // never withdraws the owner's current quote without a replacement.
  const ownSubtotal = r2(calc.lines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  const subtotal = r2(ownSubtotal + rectTotal);
  // Jo, 5 Oct 2026: same basis as the calculator — whole VEECs (Eq 48.1 rounded down, property postcode) × consumer
  // $/VEEC, then the $200 minimum rule. The old flat per-m² credit is no longer used for new/redrafted quotes.
  if (!loc) throw new WorkflowError("VEU discount can't be worked out: the property postcode isn't in the official VEU location list. Quote this job manually.");
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
    hasUnratedExtras: rectLines.some((line) => line.is_other),
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  // Jo 22 Oct 2026: installer's agreed rate above the owner rate for the chosen R-value → held for office review.
  // Jo 22 Oct 23:45: no confirmed approved product from the form → held, office confirms the product.
  const { PRODUCT_NEEDS_OFFICE } = await import("./insulation-product.core");
  const holds = [...calc.holdReasons, ...(chosen.product ? [] : [PRODUCT_NEEDS_OFFICE]), ...(accessFee.reason ? [accessFee.reason] : [])];
  const release: typeof baseRelease = holds.length ? { state: "held", status: "draft", reason: holds.join(" ") } : baseRelease;
  const releasedAt = release.status === "issued" ? new Date().toISOString() : null;
  const availableToOwner = release.state !== "held";
  const discountNote = discountNotes(rules).join(" ") || null;
  const label = rectLines.length ? `${rValue} ceiling insulation + electrical fixes` : `${rValue} ceiling insulation`;
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: label, option_code: R_VALUE_CODE[rValue], status: availableToOwner ? "issued" : "draft", sent_at: releasedAt,
    release_state: release.state, release_hold_reason: release.reason,
    rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal,
    gst_amount: r2(subtotal - subtotal / gstMul), veec_discount_inc_gst: veec, discount_note: discountNote,
    veec_count: wv.veecs, veec_unit_value_inc_gst: wv.unitValue,
    customer_total_inc_gst: customerTotal, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new Error(error?.message);
  const { error: itemsError } = await admin.from("quote_items").insert([
    ...calc.lines.map((l) => ({ ...l, quote_id: q.id })),
    ...rectLines.map((l, i) => ({ ...l, quote_id: q.id, sort: 100 + i })),
  ]);
  const { error: internalsError } = itemsError ? { error: null } : await admin.from("quote_internals").insert({
    quote_id: q.id, cost_ex_gst: calc.installerCostEx, ap_margin_ex_gst: calc.installerMarkup.markupEx, ap_fee_ex_gst: r2((jobRow.ap_fee_override_inc_gst != null ? Number(jobRow.ap_fee_override_inc_gst) : Number(rs.ap_management_inc_gst)) / gstMul), // job AP fee override wins
    calc_snapshot: { pricing_rule: HIV_PRICING_RULE, installer_markup: calc.installerMarkup, measurement_id: qi.measurementId, area_m2: qi.areaM2, removal_m2: qi.removalM2, rate_card_version: card.version, pricing_version: settings.version, access: qi.access, r_value: rValue, product: chosen.product, product_source: chosen.source, product_declared_not_verified: true, discount_notes: discountNotes(rules), discount_cap_applied: rules.cappedAtMax, discount_reduced_for_minimum: rules.reducedForMin },
  });
  if (itemsError || internalsError) {
    await admin.from("quotes").update({ status: "superseded" }).eq("id", q.id); // withdraw the incomplete new quote; the previous one stays current
    throw new Error(`Quote lines could not be saved: ${(itemsError ?? internalsError)!.message}`);
  }
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued"]).neq("id", q.id);
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

/** Decision 305: the electrician's one total for the repair work, read from the synced A4 PIESA snapshot (pure decision in fixes-price.core). */
async function a4FixesPriceSource(jobId: string) {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string | null }[]) : [];
  return fixesPriceSource(entries.length ? shortAnswersFromEntries("piesa", entries) : null);
}

/** Decision 305 (Jo 25 Oct 2026): ONE line from the electrician's A4 total + the decision-142 margin; no rate-card lookup.
 *  Same supersede/insert/release shape as the rate-card path below — the quote is still a held draft for office review. */
async function generateA4FixesQuote(jobId: string, actorId: string, businessId: string, source: { electricianPriceIncGst: number; included: string }, settings: Awaited<ReturnType<typeof activePricing>>) {
  // quotes.rate_card_id is nullable: keep the electrician's active card for reference when there is one, never required here.
  const { data: cards } = await admin.from("rate_cards").select("id, version").eq("kind", "electrical").eq("is_active", true).eq("business_id", businessId).order("version", { ascending: false }).limit(1);
  const card = cards?.[0] ?? null;
  const gstRate = Number(settings.gst_rate);
  const built = buildA4FixesQuote({ electricianPriceIncGst: source.electricianPriceIncGst, included: source.included, gstRate });
  const subtotal = built.subtotalIncGst;
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").in("status", ["draft", "issued"]);
  const { data: q, error } = await admin
    .from("quotes")
    .insert({ job_id: jobId, kind: "rectification", option_label: "electrical fixes", status: "draft", rate_card_id: card?.id ?? null, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / (1 + gstRate)), veec_discount_inc_gst: 0, customer_total_inc_gst: subtotal, created_by: actorId })
    .select("id")
    .single();
  if (error || !q) throw new Error(error?.message);
  await admin.from("quote_items").insert(built.lines.map((l) => ({ ...l, quote_id: q.id })));
  await admin.from("quote_internals").insert({ quote_id: q.id, cost_ex_gst: built.costExGst, calc_snapshot: { pricing_source: A4_FIXES_PRICING_SOURCE, electrician_price_inc_gst: built.electricianPriceIncGst, rectification_margin_inc_gst: built.marginIncGst, rate_card_version: card?.version ?? null } });
  const { data: workflow } = await admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled").eq("id", 1).maybeSingle();
  const release = rectificationQuoteDecision({
    hasNonStandardItem: false,
    manuallyPriced: false,
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  const now = new Date().toISOString();
  await admin.from("quotes").update({ status: release.state === "held" ? "draft" : "issued", sent_at: release.state === "released" ? now : null, office_reviewed_at: release.state === "released" ? now : null, office_reviewed_by: null, release_state: release.state, release_hold_reason: release.reason }).eq("id", q.id);
  const summary = release.state === "held" ? (release.reason ?? "Electrical fixes quote held for office review") : release.state === "queued" ? "Electrical fixes quote ready to send — queued behind the launch switches" : "Electrical fixes quote automatically released to the owner";
  await logEvent(jobId, actorId, release.state === "held" ? "rectification_quote_held" : release.state === "queued" ? "rectification_quote_queued" : "rectification_quote_released", summary, { quote_id: q.id, release_state: release.state, pricing_source: A4_FIXES_PRICING_SOURCE }, { internal: release.state !== "released" });
  return q.id;
}

export async function generateRectificationQuote(jobId: string, actorId: string) {
  const settings = await activePricing();
  const { data: rec } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!rec?.business_id) throw new WorkflowError("Assign an approved REC business before generating the electrical fixes quote.");
  // Decision 305: the electrician's own total from the A4 PIESA wins; older forms without it keep the rate-card path below.
  const a4 = await a4FixesPriceSource(jobId);
  if (a4.path === "a4_price") return generateA4FixesQuote(jobId, actorId, rec.business_id, a4, settings);
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
  // Decision 142: owner price = electrician price + $50 on the attendance line; trade cost below stays unmarked.
  const priced = applyRectificationMargin(lines);
  const subtotal = r2(priced.reduce((a, l) => a + l.line_total_inc_gst, 0));
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").in("status", ["draft", "issued"]);
  const { data: q, error } = await admin
    .from("quotes")
    .insert({ job_id: jobId, kind: "rectification", option_label: "electrical fixes", status: "draft", rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: 0, customer_total_inc_gst: subtotal, created_by: actorId })
    .select("id")
    .single();
  if (error || !q) throw new Error(error?.message);
  await admin.from("quote_items").insert(priced.map((l) => ({ ...l, quote_id: q.id })));
  await admin.from("quote_internals").insert({ quote_id: q.id, cost_ex_gst: r2(cost), calc_snapshot: { rate_card_version: card.version, rectification_margin_inc_gst: RECTIFICATION_MARGIN_INC_GST } });
  const { data: workflow } = await admin.from("workflow_settings").select("auto_send_quote, customer_comms_enabled").eq("id", 1).maybeSingle();
  const release = rectificationQuoteDecision({
    hasNonStandardItem: items.some((item) => item.is_other),
    manuallyPriced: items.some((item) => item.needs_office_pricing || item.other_unit_price_inc_gst != null),
    externalSendingEnabled: workflow?.auto_send_quote === true && workflow?.customer_comms_enabled === true,
  });
  const now = new Date().toISOString();
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
  const { data: before } = await admin.from("quotes").select("*, quote_items(*)").eq("id", quoteId).single();
  if (!before) throw new WorkflowError("Quote not found");
  if (!["issued", "draft"].includes(before.status)) throw new WorkflowError("Only open quotes can be adjusted.");
  for (const c of changes)
    await admin.from("quote_items").update({ quantity: c.quantity, unit_price_inc_gst: r2(c.unit_price_inc_gst), line_total_inc_gst: r2(c.quantity * c.unit_price_inc_gst) }).eq("id", c.id).eq("quote_id", quoteId);
  const { data: items } = await admin.from("quote_items").select("line_total_inc_gst").eq("quote_id", quoteId);
  const subtotal = r2((items ?? []).reduce((a, i) => a + Number(i.line_total_inc_gst), 0));
  const { data: rs } = await admin.from("retail_estimator_settings").select("indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle();
  const { quoteAdjustmentDiscount } = await import("./estimate.core");
  const dr = quoteAdjustmentDiscount(veecDiscount ?? Number(before.veec_discount_inc_gst), subtotal, Number(rs?.indicative_veec_value), Number(rs?.minimum_customer_copayment_inc_gst ?? 200), discountOverride);
  if (!dr.ok) throw new WorkflowError(dr.error);
  const veec = dr.discount;
  const { data: s } = before.pricing_settings_id ? await admin.from("pricing_settings").select("gst_rate").eq("id", before.pricing_settings_id).maybeSingle() : { data: null };
  const gst = 1 + Number(s?.gst_rate ?? 0.1);
  const after = { subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: veec, customer_total_inc_gst: r2(subtotal - veec), manually_adjusted: true, ...(veec !== Number(before.veec_discount_inc_gst) ? { veec_count: dr.veecs, veec_unit_value_inc_gst: dr.veecs != null ? Number(rs?.indicative_veec_value) : null } : {}) };
  await admin.from("quotes").update({ ...after, version: before.version + 1 }).eq("id", quoteId);
  // Jo 24 Oct 2026: no installer reapproval — an adjusted Ready Check draft simply stays on Quotes to check for office Send.
  const readyCheck = (await (await import("./installer-quote-status.server")).loadInstallerQuote(before.job_id)).applies;
  if (before.status === "draft") await admin.from("quotes").update({ release_state: "held", release_hold_reason: readyCheck ? "Waiting for office review before sending" : "Quote held: manually priced or adjusted" }).eq("id", quoteId);
  // Intake jobs: an adjusted issued quote goes back to held (not visible as current) until the office re-approves it.
  else if (before.option_code === "INSTALLER_A1" && await (await import("./installer-intake.server")).isIntakeJob(before.job_id)) await admin.from("quotes").update({ status: "draft", release_state: "held", release_hold_reason: "Adjusted after sending — office must re-approve", sent_at: null }).eq("id", quoteId).eq("status", "issued");
  const { data: afterFull } = await admin.from("quotes").select("*, quote_items(*)").eq("id", quoteId).single();
  await admin.from("quote_adjustments").insert({ quote_id: quoteId, adjusted_by: actorId, reason, before_snapshot: before, after_snapshot: afterFull ?? {} });
  if (discountOverride && dr.veecs == null) await logEvent(before.job_id, actorId, "quote_discount_override", `Office discount override: ${reason}`, { quote_id: quoteId, requested: veecDiscount ?? null, applied: veec, reduced_for_minimum: dr.reducedForMin }, { internal: true });
  await logEvent(before.job_id, actorId, "quote_adjusted", `Quote manually adjusted: ${reason}`, { quote_id: quoteId, before_total: before.customer_total_inc_gst, after_total: after.customer_total_inc_gst }, { internal: true });
}
