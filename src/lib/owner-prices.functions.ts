// Office-editable owner prices (admin only) and the office-only Margins view.
// A change publishes a new price version (publish_owner_prices); it applies to NEW quotes only — issued/accepted quotes keep their stored lines.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { canChangeApFee, resolveApFeeAllowedIds } from "./ap-fee.core";
import { electricianMargins, installerMargins } from "./margins.core";

const price = z.number().positive().max(100000).optional();

export const getOwnerPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [cur, ws, hist] = await Promise.all([
      admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(),
      admin.from("workflow_settings").select("current_veec_price").limit(1).maybeSingle(),
      admin.from("admin_config_events").select("id, actor_id, event_type, summary, details, created_at").in("event_type", ["owner_prices_changed", "current_veec_price_changed"]).order("created_at", { ascending: false }).limit(50),
    ]);
    if (cur.error) throw new Error(cur.error.message);
    if (hist.error) throw new Error(hist.error.message);
    const ids = [...new Set((hist.data ?? []).map((h) => h.actor_id).filter(Boolean))] as string[];
    const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
    const who = new Map((profs ?? []).map((p) => [p.id, p.full_name || p.email || "Office"]));
    const c = cur.data;
    return {
      current: c && {
        version: c.version, r5: Number(c.r5_install_inc_gst_per_m2), removal: Number(c.removal_inc_gst_per_m2), piesa: Number(c.piesa_assessment_inc_gst),
        apFee: Number(c.ap_management_inc_gst), moderate: Number(c.access_moderate_multiplier), difficult: Number(c.access_difficult_multiplier),
        veecBuy: Number(c.veec_buy_price), veecSale: ws.data?.current_veec_price == null ? 83 : Number(ws.data.current_veec_price),
      },
      canChangeApFee: canChangeApFee(context.userId, resolveApFeeAllowedIds(process.env["AP_FEE_OVERRIDE_USER_IDS"])),
      history: (hist.data ?? []).map((h) => ({ ...h, who: h.actor_id ? who.get(h.actor_id) ?? "Office" : "Office" })),
    };
  });

export const setOwnerPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    r5: price, removal: price, piesa: price, apFee: price, moderate: z.number().min(1).max(5).optional(), difficult: z.number().min(1).max(5).optional(),
    veecBuy: price, reason: z.string().trim().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await admin.from("retail_estimator_settings").select("*").eq("is_current", true).single();
    const map: [keyof typeof data, string][] = [["r5", "r5_install_inc_gst_per_m2"], ["removal", "removal_inc_gst_per_m2"], ["piesa", "piesa_assessment_inc_gst"], ["apFee", "ap_management_inc_gst"], ["moderate", "access_moderate_multiplier"], ["difficult", "access_difficult_multiplier"], ["veecBuy", "veec_buy_price"]];
    const changes: Record<string, number> = {};
    for (const [k, col] of map) {
      const v = data[k];
      if (typeof v === "number" && Number((cur as Record<string, unknown>)[col]) !== v) changes[col] = v;
    }
    if (!Object.keys(changes).length) throw new Error("Nothing changed.");
    if ("ap_management_inc_gst" in changes && !canChangeApFee(context.userId, resolveApFeeAllowedIds(process.env["AP_FEE_OVERRIDE_USER_IDS"])))
      throw new Error("Only the Home Insulation Victoria owner can change the Accredited Person fee.");
    const { data: v, error } = await admin.rpc("publish_owner_prices", { _actor: context.userId, _prices: changes, _reason: data.reason });
    if (error) throw new Error(error.message);
    return { version: v };
  });

export const getMargins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [rs, ps, biz, cards, rates] = await Promise.all([
      admin.from("retail_estimator_settings").select("r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst").eq("is_current", true).single(),
      admin.from("pricing_settings").select("gst_rate").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle(),
      admin.from("businesses").select("id, name, business_type").eq("onboarding_status", "approved").in("business_type", ["eec_installer", "rec"]).order("name"),
      admin.from("rate_cards").select("business_id, version, rate_card_items(code, unit_price_ex_gst)").eq("kind", "installer").eq("is_active", true).order("version", { ascending: false }),
      admin.from("electrician_rates").select("business_id, rate_inc_gst, effective_from").eq("service_type", "piesa").eq("status", "active").order("effective_from", { ascending: false }),
    ]);
    for (const r of [rs, biz, cards, rates]) if (r.error) throw new Error(r.error.message);
    const p = { r5PerM2: Number(rs.data!.r5_install_inc_gst_per_m2), removalPerM2: Number(rs.data!.removal_inc_gst_per_m2), piesa: Number(rs.data!.piesa_assessment_inc_gst), apFee: Number(rs.data!.ap_management_inc_gst), gstRate: Number(ps.data?.gst_rate ?? 0.1) };
    const trades = (biz.data ?? []).map((b) => {
      if (b.business_type === "rec") {
        const r = (rates.data ?? []).find((x) => x.business_id === b.id);
        return { id: b.id, name: b.name, kind: "Electrician" as const, lines: electricianMargins(p, r ? Number(r.rate_inc_gst) : null) };
      }
      const card = (cards.data ?? []).find((c) => c.business_id === b.id);
      const items = (card?.rate_card_items ?? []) as { code: string; unit_price_ex_gst: number }[];
      const rate = (...codes: string[]) => { for (const c of codes) { const it = items.find((i) => i.code === c); if (it) return Number(it.unit_price_ex_gst); } return null; };
      return { id: b.id, name: b.name, kind: "Installer" as const, lines: installerMargins(p, rate("R5_BATTS"), rate("BATTS_REMOVAL", "REMOVAL", "LOOSE_FILL_REMOVAL")) };
    });
    return { prices: p, trades };
  });
