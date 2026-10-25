import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const getProfitRegister = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  // Daily online refresh: if no price recorded today, pull it from the online source (best-effort, never blocks the page).
  const today = melbourneToday();
  const { data: todays } = await admin.from("veec_spot_prices").select("id").eq("priced_on", today).limit(1);
  if (!todays?.length) {
    try {
      const res = await fetch("https://www.ecovantage.com.au/energy-certificate-market-update/", { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const { parseVeecSpotFromHtml } = await import("./profit.core");
        const price = parseVeecSpotFromHtml(await res.text());
        if (price != null) await admin.from("veec_spot_prices").insert({ price, priced_on: today, source: "Ecovantage market update (online)", note: "https://www.ecovantage.com.au/energy-certificate-market-update/", recorded_by: context.userId });
      }
    } catch { /* fall back to stored history / manual entry */ }
  }
  const [spots, quotes, jobs, channels, pricing] = await Promise.all([
    admin.from("veec_spot_prices").select("id,price,priced_on,source,note,created_at").order("priced_on", { ascending: false }).limit(500),
    admin.from("quotes").select("id,job_id,kind,customer_total_inc_gst,subtotal_inc_gst,veec_discount_inc_gst,veec_count,accepted_at").eq("status", "accepted"),
    admin.from("job_overview").select("id,job_number,property_address,owner_name,stage,source"),
    admin.from("jobs").select("id,channel,electrician_choice"),
    admin.from("pricing_settings").select("piesa_rec_cost_ex_gst,veec_lodgement_fee_ex_gst").eq("is_active", true).maybeSingle(),
  ]);
  for (const r of [spots, quotes, jobs, channels, pricing]) if (r.error) throw new Error(`Profit register could not be loaded: ${r.error.message}`);
  const piesaRecCost = pricing.data?.piesa_rec_cost_ex_gst != null ? Number(pricing.data.piesa_rec_cost_ex_gst) : null; // negotiated REC PIESA rate; null until agreed
  const lodgementFeeExGst = pricing.data?.veec_lodgement_fee_ex_gst != null ? Number(pricing.data.veec_lodgement_fee_ex_gst) : null; // ESC fee per VEEC
  const ids = (quotes.data ?? []).map((q) => q.id);
  const [internals, items] = await Promise.all([
    ids.length ? admin.from("quote_internals").select("quote_id,cost_ex_gst,ap_margin_ex_gst,ap_fee_ex_gst").in("quote_id", ids) : Promise.resolve({ data: [], error: null } as const),
    ids.length ? admin.from("quote_items").select("quote_id,line_total_inc_gst,description").in("quote_id", ids) : Promise.resolve({ data: [], error: null } as const),
  ]);
  if (internals.error) throw new Error(`Trade costs could not be loaded: ${internals.error.message}`);
  if (items.error) throw new Error(`Quote lines could not be loaded: ${items.error.message}`);
  const byJob = new Map<string, {
    customer: number; discount: number; veecCount: number | null; acceptedAt: string | null;
    installerCost: number; installerMargin: number; apFee: number;
    electricalCost: number; electricalChargeEx: number;
    piesaCostEx: number | null; piesaCostMissing: boolean;
    lodgementFeeExGst: number | null;
    costMissing: boolean; installerSourced: boolean; installerLed?: boolean;
  }>();
  const gst = 1.1;
  const ensure = (jobId: string) => byJob.get(jobId) ?? {
    customer: 0, discount: 0, veecCount: null, acceptedAt: null,
    installerCost: 0, installerMargin: 0, apFee: 0,
    electricalCost: 0, electricalChargeEx: 0,
    piesaCostEx: piesaRecCost, piesaCostMissing: piesaRecCost == null,
    lodgementFeeExGst,
    costMissing: false, installerSourced: false,
  };
  for (const q of quotes.data ?? []) {
    const cur = ensure(q.job_id);
    const internal = (internals.data ?? []).find((i) => i.quote_id === q.id);
    if (internal?.cost_ex_gst == null) cur.costMissing = true;
    cur.customer += Number(q.customer_total_inc_gst ?? 0);
    cur.discount += Number(q.veec_discount_inc_gst ?? 0);
    if (q.kind !== "rectification" && q.veec_count != null) cur.veecCount = (cur.veecCount ?? 0) + Number(q.veec_count);
    cur.acceptedAt = q.accepted_at ?? cur.acceptedAt;
    if (q.kind === "rectification") {
      // Rectification is charged to the customer and paid to the electrician from the electrical rate card.
      cur.electricalCost += internal ? Number(internal.cost_ex_gst) : Number(q.subtotal_inc_gst) / gst;
      cur.electricalChargeEx += Number(q.subtotal_inc_gst) / gst;
    } else if (internal) {
      // Installer work: charge = rate-card cost + Home Insulation Victoria markup + AP fee (uplift distributed across lines).
      cur.installerCost += Number(internal.cost_ex_gst ?? 0);
      cur.installerMargin += Number(internal.ap_margin_ex_gst ?? 0);
      cur.apFee += Number(internal.ap_fee_ex_gst ?? 0);
    } else {
      // No internals recorded: installer charge = line totals minus folded electrical lines, ex GST.
      const rectLineTotal = (items.data ?? []).filter((l) => l.quote_id === q.id && (l.description ?? "").startsWith("Electrical rectification:")).reduce((a, l) => a + Number(l.line_total_inc_gst ?? 0), 0);
      cur.electricalChargeEx += rectLineTotal / gst;
      cur.installerCost += (Number(q.subtotal_inc_gst) - rectLineTotal) / gst;
    }
    byJob.set(q.job_id, cur);
  }
  const channelByJob = new Map((channels.data ?? []).map((c) => [c.id, c.channel]));
  // Owner-direct electrician (installer's own REC): zero PIESA cost/markup, never "rate missing". Accepted quotes carrying a PIESA line stay as committed.
  const { electricalBillingSource } = await import("./installer-led.core");
  for (const c of channels.data ?? []) {
    const cur = byJob.get(c.id); if (!cur) continue;
    const qids = (quotes.data ?? []).filter((q) => q.job_id === c.id).map((q) => q.id);
    const hasLine = (items.data ?? []).some((l) => qids.includes(l.quote_id) && /\(PIESA\)/.test(l.description ?? ""));
    if (electricalBillingSource({ channel: c.channel, choice: (c as { electrician_choice?: string | null }).electrician_choice ?? null, committedLineOnAcceptedQuote: hasLine, hivPaidAt: null }) === "owner_direct") { cur.piesaCostEx = 0; cur.piesaCostMissing = false; }
  }
  const rows = (jobs.data ?? []).filter((j) => j.id && byJob.has(j.id) && j.source !== "qa_test" && j.stage !== "cancelled").map((j) => ({
    jobId: j.id!, jobNumber: j.job_number, address: j.property_address, owner: j.owner_name, stage: j.stage,
    ...byJob.get(j.id!)!, installerSourced: channelByJob.get(j.id!) === "hivic_sourced", installerLed: channelByJob.get(j.id!) === "installer_sourced",
  }));
  return { spots: (spots.data ?? []).map((s) => ({ ...s, price: Number(s.price) })), rows };
});

export const recordSpotPrice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ price: z.number().positive().max(999), pricedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin.from("veec_spot_prices").insert({ price: data.price, priced_on: data.pricedOn, source: data.source ?? null, note: data.note ?? null, recorded_by: context.userId });
    if (error) throw new Error(`Spot price could not be saved: ${error.message}`);
    return { ok: true };
  });

const SPOT_SOURCE_URL = "https://www.ecovantage.com.au/energy-certificate-market-update/";

// Fetch the current VEEC spot price from the online market update and record it.
// Fails closed: if the page wording changes and no price can be parsed, nothing is saved.
export const fetchOnlineSpotPrice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const res = await fetch(SPOT_SOURCE_URL, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`The online price page could not be reached (HTTP ${res.status}). You can still enter the price by hand.`);
  const { parseVeecSpotFromHtml } = await import("./profit.core");
  const price = parseVeecSpotFromHtml(await res.text());
  if (price == null) throw new Error("The online price could not be read — the source page wording may have changed. Enter the price by hand instead.");
  const pricedOn = melbourneToday();
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error: readError } = await admin.from("veec_spot_prices").select("id").eq("priced_on", pricedOn).eq("price", price).limit(1);
  if (readError) throw new Error(`Spot price history could not be checked: ${readError.message}`);
  if (existing?.length) return { ok: true, price, pricedOn, alreadyRecorded: true };
  const { error } = await admin.from("veec_spot_prices").insert({ price, priced_on: pricedOn, source: "Ecovantage market update (online)", note: SPOT_SOURCE_URL, recorded_by: context.userId });
  if (error) throw new Error(`Spot price could not be saved: ${error.message}`);
  return { ok: true, price, pricedOn, alreadyRecorded: false };
});

// ---- Per-job profit card (office only). Jo's rules 4 Oct 2026; pure maths in job-profit.core.ts. ----
export const getJobProfit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await admin.from("jobs").select("channel, installer_led, electrician_choice, estimated_area_m2, ap_fee_override_inc_gst, properties(postcode)").eq("id", data.jobId).single();
    if (error || !job) throw new Error("Job not found.");
    const [m, asg, rs, ps, ws, quote, lodg] = await Promise.all([
      admin.from("ceiling_measurements").select("measured_area_m2, removal_required, removal_m2, access_difficulty, status").eq("job_id", data.jobId).eq("is_current", true).maybeSingle(),
      admin.from("job_assignments").select("business_id, role").eq("job_id", data.jobId).eq("active", true),
      admin.from("retail_estimator_settings").select("r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst, veec_buy_price").eq("is_current", true).maybeSingle(),
      admin.from("pricing_settings").select("gst_rate").eq("is_active", true).maybeSingle(),
      db.from("workflow_settings").select("current_veec_price").limit(1).maybeSingle(),
      admin.from("quotes").select("id, quote_items(code, line_total_inc_gst), quote_internals(ap_margin_ex_gst, calc_snapshot)").eq("job_id", data.jobId).eq("kind", "installation").eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("veec_lodgements").select("quantity, sale_price_per_veec").eq("job_id", data.jobId).maybeSingle(),
    ]);
    if (!rs.data || !ps.data) throw new Error("Price settings missing.");
    const gst = 1 + Number(ps.data.gst_rate);
    const inst = (asg.data ?? []).find((a) => a.role === "installer")?.business_id ?? null;
    const elec = (asg.data ?? []).find((a) => a.role === "electrician")?.business_id ?? null;
    let r5: number | null = null, rem: number | null = null;
    if (inst) {
      const { data: card } = await admin.from("rate_cards").select("rate_card_items(code, unit_price_ex_gst)").eq("kind", "installer").eq("is_active", true).eq("business_id", inst).order("version", { ascending: false }).limit(1).maybeSingle();
      const items = (card?.rate_card_items ?? []) as { code: string; unit_price_ex_gst: number }[];
      const f = (...c: string[]) => { for (const x of c) { const it = items.find((i) => i.code === x); if (it) return Math.round(Number(it.unit_price_ex_gst) * gst * 100) / 100; } return null; };
      r5 = f("R5_BATTS"); rem = f("BATTS_REMOVAL", "REMOVAL", "LOOSE_FILL_REMOVAL");
    }
    let piesaRate: number | null = null;
    if (elec) {
      const { data: er } = await db.from("electrician_rates").select("rate_inc_gst, status").eq("business_id", elec).eq("service_type", "piesa").in("status", ["active", "approved"]).order("effective_from", { ascending: false }).limit(1).maybeSingle();
      piesaRate = er ? Number(er.rate_inc_gst) : null;
    }
    const meas = m.data && m.data.status === "complete" && Number(m.data.measured_area_m2) > 0 ? m.data : null;
    const qi = (quote.data?.quote_internals as unknown as { ap_margin_ex_gst: number | null; calc_snapshot: Record<string, unknown> | null }[] | null)?.[0] ?? null;
    const snap = qi?.calc_snapshot as { pricing_rule?: string; installer_markup?: { markupInc: number }; piesa_electrician?: { source?: string; rate_inc_gst?: number | null } } | null;
    const acceptedMarkup = qi ? (snap?.pricing_rule ? Number(snap.installer_markup?.markupInc ?? 0) : Math.round(Number(qi.ap_margin_ex_gst ?? 0) * gst * 100) / 100) : null;
    const { jobProfitBreakdown } = await import("./job-profit.core");
    const { electricalBillingSource } = await import("./installer-led.core");
    const qItems = (quote.data as unknown as { quote_items?: { code: string | null }[] } | null)?.quote_items;
    const piesaOwnerDirect = electricalBillingSource({ channel: job.channel, choice: (job as { electrician_choice?: string | null }).electrician_choice ?? null, committedLineOnAcceptedQuote: quote.data ? (qItems ?? []).some((i) => i.code === "PIESA") : null, hivPaidAt: null }) === "owner_direct";
    const hivJob = job.channel !== "installer_sourced" && !job.installer_led;
    // Decision 349: the owner's PIESA amount is the accepted quote's PIESA line (the installer's usual electrician's rate
    // when they do it, else $349), and with the installer's usual electrician we pay exactly that (pass-through, no margin).
    const { piesaLineCents } = await import("./safety-check-amount.core");
    const quotedPiesaCents = piesaLineCents((qItems ?? []) as { code: string | null; line_total_inc_gst: number | null }[]);
    const piesaCustomerInc = quotedPiesaCents != null ? quotedPiesaCents / 100 : Number(rs.data.piesa_assessment_inc_gst);
    const usualPiesaRate = snap?.piesa_electrician?.source === "installer_usual" && Number(snap.piesa_electrician.rate_inc_gst) > 0 ? Number(snap.piesa_electrician.rate_inc_gst) : null;
    return {
      hivJob,
      ...jobProfitBreakdown({
        hivJob, postcode: (job.properties as { postcode: string | null } | null)?.postcode ?? null,
        estimateAreaM2: job.estimated_area_m2 != null ? Number(job.estimated_area_m2) : null,
        measuredAreaM2: meas ? Number(meas.measured_area_m2) : null,
        removalM2: meas?.removal_required ? Number(meas.removal_m2 ?? 0) : 0,
        ownerR5IncPerM2: Number(rs.data.r5_install_inc_gst_per_m2), ownerRemovalIncPerM2: Number(rs.data.removal_inc_gst_per_m2),
        installerR5IncPerM2: r5, installerRemovalIncPerM2: rem,
        apFeeInc: job.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : Number(rs.data.ap_management_inc_gst),
        piesaCustomerInc, electricianPiesaRateInc: usualPiesaRate ?? piesaRate, piesaOwnerDirect, veecBuyPrice: Number(rs.data.veec_buy_price),
        currentVeecPrice: Number(ws.data?.current_veec_price ?? 83),
        acceptedQuoteMarkupInc: hivJob ? acceptedMarkup : null, acceptedQuoteLegacy: !!qi && !snap?.pricing_rule,
        lodgedVeecs: lodg.data?.quantity != null ? Number(lodg.data.quantity) : null,
        saleVeecPrice: lodg.data?.sale_price_per_veec != null ? Number(lodg.data.sale_price_per_veec) : null,
      }),
    };
  });

export const setCurrentVeecPrice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ price: z.number().positive().max(999) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: row } = await db.from("workflow_settings").select("id, current_veec_price").limit(1).maybeSingle();
    if (!row) throw new Error("Settings not found.");
    const { error } = await db.from("workflow_settings").update({ current_veec_price: data.price }).eq("id", row.id);
    if (error) throw new Error(error.message);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "current_veec_price_changed", summary: `Current VEEC price changed to $${data.price}`, details: { from: row.current_veec_price, to: data.price } });
    return { ok: true };
  });

export const setVeecSalePrice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), price: z.number().positive().max(999) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const db = admin as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await db.from("veec_lodgements").update({ sale_price_per_veec: data.price }).eq("job_id", data.jobId).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("No VEEC lodgement on this job yet.");
    const { logEvent } = await import("./workflow.server");
    await logEvent(data.jobId, context.userId, "veec_sale_price_recorded", `VEEC sale price recorded: $${data.price}`, { price: data.price }, { internal: true });
    return { ok: true };
  });
