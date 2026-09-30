import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const getProfitRegister = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const [spots, quotes, jobs] = await Promise.all([
    admin.from("veec_spot_prices").select("id,price,priced_on,source,note,created_at").order("priced_on", { ascending: false }).limit(500),
    admin.from("quotes").select("id,job_id,kind,customer_total_inc_gst,veec_discount_inc_gst,accepted_at").eq("status", "accepted"),
    admin.from("job_overview").select("id,job_number,property_address,owner_name,stage,source"),
  ]);
  for (const r of [spots, quotes, jobs]) if (r.error) throw new Error(`Profit register could not be loaded: ${r.error.message}`);
  const ids = (quotes.data ?? []).map((q) => q.id);
  const { data: internals, error } = ids.length ? await admin.from("quote_internals").select("quote_id,cost_ex_gst").in("quote_id", ids) : { data: [], error: null };
  if (error) throw new Error(`Trade costs could not be loaded: ${error.message}`);
  const byJob = new Map<string, { customer: number; discount: number; cost: number; costMissing: boolean; acceptedAt: string | null }>();
  for (const q of quotes.data ?? []) {
    const cur = byJob.get(q.job_id) ?? { customer: 0, discount: 0, cost: 0, costMissing: false, acceptedAt: null };
    const internal = (internals ?? []).find((i) => i.quote_id === q.id);
    cur.customer += Number(q.customer_total_inc_gst ?? 0);
    cur.discount += Number(q.veec_discount_inc_gst ?? 0);
    if (internal?.cost_ex_gst == null) cur.costMissing = true; else cur.cost += Number(internal.cost_ex_gst);
    cur.acceptedAt = q.accepted_at ?? cur.acceptedAt;
    byJob.set(q.job_id, cur);
  }
  const rows = (jobs.data ?? []).filter((j) => j.id && byJob.has(j.id) && j.source !== "qa_test" && j.stage !== "cancelled").map((j) => ({ jobId: j.id!, jobNumber: j.job_number, address: j.property_address, owner: j.owner_name, stage: j.stage, ...byJob.get(j.id!)! }));
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
