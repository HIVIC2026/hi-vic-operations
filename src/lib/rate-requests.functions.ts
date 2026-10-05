// Installer R6.0 / R7.0 supply & install rates after onboarding.
// An installer business admin REQUESTS rates; nothing applies until the office approves,
// which creates a NEW rate card version (old versions stay as history).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rate = z.number().positive().max(100000).refine((n) => Math.round(n * 100) === n * 100, "Use dollars and cents").nullable();
const HIGHER = [{ code: "R6_BATTS", r: 6, sort: 4 }, { code: "R7_BATTS", r: 7, sort: 5 }, { code: "TOPUP_R5", r: 5, sort: 6 }] as const;

export const getHigherRates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = !!(await context.supabase.rpc("is_admin")).data;
    if (!isAdmin) { const { requireMember } = await import("./pilot.server"); await requireMember(context.userId, data.businessId); }
    const [{ data: card, error: e1 }, { data: reqs, error: e2 }] = await Promise.all([
      admin.from("rate_cards").select("id, version, rate_card_items(code, unit_price_ex_gst)").eq("business_id", data.businessId).eq("kind", "installer").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle(),
      admin.from("installer_rate_requests").select("id, r6_rate, r7_rate, topup_r5_rate, gst_registered, status, requested_at, reviewed_at, review_note").eq("business_id", data.businessId).order("requested_at", { ascending: false }).limit(5),
    ]);
    if (e1 || e2) throw new Error("Couldn't load rates – please try again.");
    const items = (card?.rate_card_items ?? []) as { code: string; unit_price_ex_gst: number }[];
    const ex = (code: string) => { const it = items.find((i) => i.code === code); return it ? Number(it.unit_price_ex_gst) : null; };
    return { hasCard: !!card, version: card?.version ?? null, r5Ex: ex("R5_BATTS"), r6Ex: ex("R6_BATTS"), r7Ex: ex("R7_BATTS"), topupEx: ex("TOPUP_R5"), requests: reqs ?? [] };
  });

export const requestHigherRates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid(), r6: rate, r7: rate, topup: rate, gstRegistered: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = !!(await context.supabase.rpc("is_admin")).data;
    if (!isAdmin) { const { requireMember } = await import("./pilot.server"); await requireMember(context.userId, data.businessId, true); }
    await admin.from("installer_rate_requests").update({ status: "withdrawn", reviewed_at: new Date().toISOString(), reviewed_by: context.userId, review_note: "Replaced by a newer request" }).eq("business_id", data.businessId).eq("status", "pending");
    const { error } = await admin.from("installer_rate_requests").insert({ business_id: data.businessId, r6_rate: data.r6, r7_rate: data.r7, topup_r5_rate: data.topup, gst_registered: data.gstRegistered, requested_by: context.userId });
    if (error) throw new Error("Couldn't save your rates – please try again.");
    return { ok: true };
  });

export const reviewHigherRates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await admin.from("installer_rate_requests").select("*").eq("id", data.requestId).eq("status", "pending").maybeSingle();
    if (!req) throw new Error("This request is no longer waiting for review.");
    const now = new Date().toISOString();
    if (!data.approve) {
      if (!data.note) throw new Error("Give a reason for declining.");
      await admin.from("installer_rate_requests").update({ status: "declined", reviewed_by: context.userId, reviewed_at: now, review_note: data.note }).eq("id", req.id);
      return { ok: true };
    }
    const { data: card } = await admin.from("rate_cards").select("id, name, version, rate_card_items(code, description, category, unit, unit_price_ex_gst, r_value, sort, display_unit)").eq("business_id", req.business_id).eq("kind", "installer").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!card) throw new Error("This installer has no agreed rate card yet – approve their onboarding first.");
    const toEx = (v: number) => Number((req.gst_registered ? v / 1.1 : v).toFixed(2));
    const kept = ((card.rate_card_items ?? []) as Record<string, unknown>[]).filter((i) => !HIGHER.some((h) => h.code === i["code"]));
    const added = HIGHER.flatMap((h) => { const v = h.code === "R6_BATTS" ? req.r6_rate : h.code === "R7_BATTS" ? req.r7_rate : req.topup_r5_rate; return v == null ? [] : [{ code: h.code, description: h.code === "TOPUP_R5" ? "Top up to R5.0 over existing insulation (existing stays in place)" : `R${h.r}.0 ceiling batts supply & install`, category: "product", unit: "m2", unit_price_ex_gst: toEx(Number(v)), r_value: h.r, sort: h.sort, display_unit: null }]; });
    const { data: next, error: e1 } = await admin.from("rate_cards").insert({ kind: "installer", business_id: req.business_id, name: card.name, version: card.version + 1, is_active: true }).select("id").single();
    if (e1 || !next) throw new Error("Couldn't create the new rate card version.");
    const { error: e2 } = await admin.from("rate_card_items").insert([...kept, ...added].map((i) => ({ ...(i as object), rate_card_id: next.id })) as never);
    if (e2) { await admin.from("rate_cards").delete().eq("id", next.id); throw new Error("Couldn't copy the rates – nothing was changed."); }
    await admin.from("rate_cards").update({ is_active: false }).eq("id", card.id);
    await admin.from("installer_rate_requests").update({ status: "approved", reviewed_by: context.userId, reviewed_at: now, review_note: data.note ?? null, rate_card_id: next.id }).eq("id", req.id);
    return { ok: true, version: card.version + 1 };
  });
