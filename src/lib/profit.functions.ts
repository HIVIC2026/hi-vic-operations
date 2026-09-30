import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const getProfitRegister = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  // Daily online refresh: if no price recorded today, pull it from the online source (best-effort, never blocks the page).
  const today = new Date().toISOString().slice(0, 10);
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
  const [spots, quotes, jobs, channels] = await Promise.all([
    admin.from("veec_spot_prices").select("id,price,priced_on,source,note,created_at").order("priced_on", { ascending: false }).limit(500),
    admin.from("quotes").select("id,job_id,kind,customer_total_inc_gst,subtotal_inc_gst,veec_discount_inc_gst,accepted_at").eq("status", "accepted"),
    admin.from("job_overview").select("id,job_number,property_address,owner_name,stage,source"),
    admin.from("jobs").select("id,channel"),
  ]);
  for (const r of [spots, quotes, jobs, channels]) if (r.error) throw new Error(`Profit register could not be loaded: ${r.error.message}`);
  const ids = (quotes.data ?? []).map((q) => q.id);
  const [internals, items] = await Promise.all([
    ids.length ? admin.from("quote_internals").select("quote_id,cost_ex_gst,ap_margin_ex_gst,ap_fee_ex_gst").in("quote_id", ids) : Promise.resolve({ data: [], error: null } as const),
    ids.length ? admin.from("quote_items").select("quote_id,line_total_inc_gst,description").in("quote_id", ids) : Promise.resolve({ data: [], error: null } as const),
  ]);
  if (internals.error) throw new Error(`Trade costs could not be loaded: ${internals.error.message}`);
  if (items.error) throw new Error(`Quote lines could not be loaded: ${items.error.message}`);
  const byJob = new Map<string, {
    customer: number; discount: number; acceptedAt: string | null;
    installerCost: number; installerMargin: number; apFee: number;
    electricalCost: number; electricalChargeEx: number;
    costMissing: boolean; installerSourced: boolean;
  }>();
  const gst = 1.1;
  const ensure = (jobId: string) => byJob.get(jobId) ?? {
    customer: 0, discount: 0, acceptedAt: null,
    installerCost: 0, installerMargin: 0, apFee: 0,
    electricalCost: 0, electricalChargeEx: 0,
    costMissing: false, installerSourced: false,
  };
  for (const q of quotes.data ?? []) {
    const cur = ensure(q.job_id);
    const internal = (internals.data ?? []).find((i) => i.quote_id === q.id);
    if (internal?.cost_ex_gst == null) cur.costMissing = true;
    cur.customer += Number(q.customer_total_inc_gst ?? 0);
    cur.discount += Number(q.veec_discount_inc_gst ?? 0);
    cur.acceptedAt = q.accepted_at ?? cur.acceptedAt;
    if (q.kind === "rectification") {
      // Rectification is charged to the customer and paid to the electrician from the electrical rate card.
      cur.electricalCost += internal ? Number(internal.cost_ex_gst) : Number(q.subtotal_inc_gst) / gst;
      cur.electricalChargeEx += Number(q.subtotal_inc_gst) / gst;
    } else if (internal) {
      // Installer work: charge = rate-card cost + HI VIC markup + AP fee (uplift distributed across lines).
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
  const rows = (jobs.data ?? []).filter((j) => j.id && byJob.has(j.id) && j.stage !== "cancelled" || j.source === "qa_test").map((j) => ({
    jobId: j.id!, jobNumber: j.job_number, address: j.property_address, owner: j.owner_name, stage: j.stage,
    ...byJob.get(j.id!)!, installerSourced: channelByJob.get(j.id!) === "installer_sourced",
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
  const pricedOn = new Date().toISOString().slice(0, 10);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error: readError } = await admin.from("veec_spot_prices").select("id").eq("priced_on", pricedOn).eq("price", price).limit(1);
  if (readError) throw new Error(`Spot price history could not be checked: ${readError.message}`);
  if (existing?.length) return { ok: true, price, pricedOn, alreadyRecorded: true };
  const { error } = await admin.from("veec_spot_prices").insert({ price, priced_on: pricedOn, source: "Ecovantage market update (online)", note: SPOT_SOURCE_URL, recorded_by: context.userId });
  if (error) throw new Error(`Spot price could not be saved: ${error.message}`);
  return { ok: true, price, pricedOn, alreadyRecorded: false };
});
