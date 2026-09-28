// CENTRAL QUOTE CALCULATIONS. All customer-facing prices are stored inc GST.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";

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

async function activeRateCard(kind: "installer" | "electrical", businessId?: string | null) {
  let q = admin.from("rate_cards").select("*, rate_card_items(*)").eq("kind", kind).eq("is_active", true);
  if (businessId) q = q.eq("business_id", businessId);
  const { data } = await q.order("version", { ascending: false }).limit(1);
  if (data?.[0]) return data[0];
  if (businessId) return activeRateCard(kind, null);
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

export function priceInstallerOption(input: {
  areaM2: number;
  removalM2: number;
  access: "easy" | "moderate" | "difficult";
  product: { code: string; description: string; unit_price_ex_gst: number };
  removal?: { unit_price_ex_gst: number } | null;
  travel?: { unit_price_ex_gst: number } | null;
  settings: { gst_rate: number; ap_margin_pct: number; ap_fee_ex_gst: number; veec_credit_per_m2_inc_gst: number; access_loadings: Record<string, number> };
}) {
  const s = input.settings;
  const loading = Number(s.access_loadings[input.access] ?? 1);
  const lines: Line[] = [
    {
      code: input.product.code,
      description: input.product.description,
      quantity: input.areaM2,
      unit: "m2",
      exGst: Number(input.product.unit_price_ex_gst) * loading,
    },
  ];
  if (input.removalM2 > 0 && input.removal)
    lines.push({ code: "REMOVAL", description: "Removal & disposal of existing insulation", quantity: input.removalM2, unit: "m2", exGst: Number(input.removal.unit_price_ex_gst) });
  if (input.travel) lines.push({ code: "TRAVEL", description: "Travel / site establishment", quantity: 1, unit: "flat", exGst: Number(input.travel.unit_price_ex_gst) });

  const cost = lines.reduce((a, l) => a + l.exGst * l.quantity, 0);
  const margin = cost * Number(s.ap_margin_pct);
  const fee = Number(s.ap_fee_ex_gst);
  const uplift = cost > 0 ? (cost + margin + fee) / cost : 1; // distributed so customers only see final prices
  const gst = 1 + Number(s.gst_rate);
  const items = lines.map((l, i) => {
    const unitInc = r2(l.exGst * uplift * gst);
    return { code: l.code, description: l.description, quantity: l.quantity, unit: l.unit, unit_price_inc_gst: unitInc, line_total_inc_gst: r2(unitInc * l.quantity), sort: i };
  });
  const subtotal = r2(items.reduce((a, i) => a + i.line_total_inc_gst, 0));
  const veec = r2(Math.min(subtotal, input.areaM2 * Number(s.veec_credit_per_m2_inc_gst)));
  return {
    items,
    subtotal_inc_gst: subtotal,
    gst_amount: r2(subtotal - subtotal / gst),
    veec_discount_inc_gst: veec,
    customer_total_inc_gst: r2(subtotal - veec),
    internals: { cost_ex_gst: r2(cost), ap_margin_ex_gst: r2(margin), ap_fee_ex_gst: r2(fee), loading },
  };
}

export async function generateInstallerQuotes(jobId: string, actorId: string) {
  const { data: a } = await admin.from("assessments").select("*").eq("job_id", jobId).maybeSingle();
  if (!a || a.status !== "complete" || !a.measured_area_m2) throw new WorkflowError("Quotes require a completed site assessment with measured area.");
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const settings = await activePricing();
  const card = await activeRateCard("installer", inst?.business_id);
  const items = card.rate_card_items as { code: string; description: string; unit_price_ex_gst: number; category: string }[];
  const byCode = (c: string) => items.find((i) => i.code === c);

  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued"]);

  // Known rectification scope (owner-approved) is folded into every option so the single accepted
  // total – and therefore the 50% deposit – covers the whole job. Lines stay itemised.
  const { data: rectQuote } = await admin.from("quotes").select("id, quote_items(*)").eq("job_id", jobId).eq("kind", "rectification").eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const rectLines = ((rectQuote?.quote_items ?? []) as { code: string | null; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null }[])
    .map((l) => ({ code: l.code, description: `Electrical rectification: ${l.description}`, quantity: Number(l.quantity), unit: l.unit, unit_price_inc_gst: Number(l.unit_price_inc_gst), line_total_inc_gst: Number(l.line_total_inc_gst), is_other: l.is_other, explanation: l.explanation }));
  const rectTotal = r2(rectLines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  const gstMul = 1 + Number(settings.gst_rate);

  // Installer-sourced jobs skip the multi-installer option marketplace: one quote from the assigned installer's card.
  const { data: jobRow } = await admin.from("jobs").select("channel").eq("id", jobId).single();
  const optionCodes = jobRow?.channel === "installer_sourced" ? settings.installer_option_codes.slice(0, 1) : settings.installer_option_codes;
  const created: string[] = [];
  for (const code of optionCodes) {
    const product = byCode(code);
    if (!product) continue;
    const calc = priceInstallerOption({
      areaM2: Number(a.measured_area_m2),
      removalM2: a.removal_required ? Number(a.removal_m2 ?? 0) : 0,
      access: a.access_difficulty ?? "easy",
      product,
      removal: byCode("REMOVAL") ?? null,
      travel: byCode("TRAVEL") ?? null,
      settings: { ...settings, access_loadings: settings.access_loadings as Record<string, number> },
    });
    const subtotal = r2(calc.subtotal_inc_gst + rectTotal);
    const { data: q, error } = await admin
      .from("quotes")
      .insert({
        job_id: jobId, kind: "installation", option_label: rectLines.length ? `${product.description} + electrical rectification` : product.description, option_code: code, status: "issued",
        rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal,
        gst_amount: r2(subtotal - subtotal / gstMul), veec_discount_inc_gst: calc.veec_discount_inc_gst,
        customer_total_inc_gst: r2(subtotal - calc.veec_discount_inc_gst), created_by: actorId,
      })
      .select("id")
      .single();
    if (error || !q) throw new Error(error?.message);
    await admin.from("quote_items").insert([
      ...calc.items.map((i) => ({ ...i, quote_id: q.id })),
      ...rectLines.map((l, i) => ({ ...l, quote_id: q.id, sort: 100 + i })),
    ]);
    const { loading, ...internals } = calc.internals;
    await admin.from("quote_internals").insert({ quote_id: q.id, ...internals, calc_snapshot: { loading, assessment_id: a.id, rate_card_version: card.version, pricing_version: settings.version, access: a.access_difficulty } });
    created.push(q.id);
  }
  if (!created.length) throw new WorkflowError("Rate card has none of the configured quote option products.");
  await logEvent(jobId, actorId, "installer_quotes_generated", `${created.length} installation quote options generated`, { quote_ids: created, rate_card: card.name, pricing_version: settings.version });
  return created;
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

export async function generateRectificationQuote(jobId: string, actorId: string) {
  const settings = await activePricing();
  const card = await activeRateCard("electrical");
  const rates = card.rate_card_items as { code: string; description: string; unit_price_ex_gst: number }[];
  const { data: items } = await admin.from("rectification_items").select("*").eq("job_id", jobId).eq("status", "required");
  if (!items?.length) throw new WorkflowError("No rectification items.");
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
    lines.push({ code: it.rate_code, description: it.description, quantity: Number(it.quantity), unit: "each", unit_price_inc_gst: unitInc, line_total_inc_gst: r2(unitInc * Number(it.quantity)), is_other: it.is_other, explanation: it.explanation, sort: lines.length });
  }
  const subtotal = r2(lines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  await admin.from("quotes").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "rectification").in("status", ["draft", "issued"]);
  const { data: q, error } = await admin
    .from("quotes")
    .insert({ job_id: jobId, kind: "rectification", option_label: "Electrical rectification", status: "issued", rate_card_id: card.id, pricing_settings_id: settings.id, subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: 0, customer_total_inc_gst: subtotal, created_by: actorId })
    .select("id")
    .single();
  if (error || !q) throw new Error(error?.message);
  await admin.from("quote_items").insert(lines.map((l) => ({ ...l, quote_id: q.id })));
  await admin.from("quote_internals").insert({ quote_id: q.id, cost_ex_gst: r2(cost), calc_snapshot: { rate_card_version: card.version } });
  await logEvent(jobId, actorId, "rectification_quote_generated", `Rectification quote generated (${lines.length} lines)`, { quote_id: q.id });
  return q.id;
}

/** Admin manual adjustment with mandatory reason; before/after snapshot kept for audit. */
export async function adjustQuote(quoteId: string, actorId: string, reason: string, changes: { id: string; quantity: number; unit_price_inc_gst: number }[], veecDiscount?: number) {
  const { data: before } = await admin.from("quotes").select("*, quote_items(*)").eq("id", quoteId).single();
  if (!before) throw new WorkflowError("Quote not found");
  if (!["issued", "draft"].includes(before.status)) throw new WorkflowError("Only open quotes can be adjusted.");
  for (const c of changes)
    await admin.from("quote_items").update({ quantity: c.quantity, unit_price_inc_gst: r2(c.unit_price_inc_gst), line_total_inc_gst: r2(c.quantity * c.unit_price_inc_gst) }).eq("id", c.id).eq("quote_id", quoteId);
  const { data: items } = await admin.from("quote_items").select("line_total_inc_gst").eq("quote_id", quoteId);
  const subtotal = r2((items ?? []).reduce((a, i) => a + Number(i.line_total_inc_gst), 0));
  const veec = r2(Math.min(subtotal, veecDiscount ?? Number(before.veec_discount_inc_gst)));
  const { data: s } = await admin.from("pricing_settings").select("gst_rate").eq("id", before.pricing_settings_id!).maybeSingle();
  const gst = 1 + Number(s?.gst_rate ?? 0.1);
  const after = { subtotal_inc_gst: subtotal, gst_amount: r2(subtotal - subtotal / gst), veec_discount_inc_gst: veec, customer_total_inc_gst: r2(subtotal - veec), manually_adjusted: true };
  await admin.from("quotes").update(after).eq("id", quoteId);
  const { data: afterFull } = await admin.from("quotes").select("*, quote_items(*)").eq("id", quoteId).single();
  await admin.from("quote_adjustments").insert({ quote_id: quoteId, adjusted_by: actorId, reason, before_snapshot: before, after_snapshot: afterFull ?? {} });
  await logEvent(before.job_id, actorId, "quote_adjusted", `Quote manually adjusted: ${reason}`, { quote_id: quoteId, before_total: before.customer_total_inc_gst, after_total: after.customer_total_inc_gst }, { internal: true });
}
