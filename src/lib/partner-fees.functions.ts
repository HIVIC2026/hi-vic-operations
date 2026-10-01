// Office-configurable partner lead fee (inc GST). Charged only on Home Insulation Victoria-sourced leads,
// deducted from the installer payout when the owner accepts. Read publicly (onboarding shows it); edited by admins only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_LEAD_FEE } from "./installer-onboarding.core";

export const getPartnerLeadFee = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("workflow_settings").select("partner_lead_fee_inc_gst").limit(1).maybeSingle();
  const fee = Number(data?.partner_lead_fee_inc_gst ?? DEFAULT_LEAD_FEE);
  return { leadFee: Number.isFinite(fee) ? fee : DEFAULT_LEAD_FEE };
});

export const updatePartnerLeadFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ fee: z.number().min(0).max(5000), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("is_admin");
    if (roleErr) throw new Error("We could not check your access. Please sign in again.");
    if (!isAdmin) throw new Error("Home Insulation Victoria staff only.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ws, error } = await supabaseAdmin.from("workflow_settings").select("id, partner_lead_fee_inc_gst").limit(1).single();
    if (error || !ws) throw new Error("Settings could not be loaded.");
    const fee = Math.round(data.fee * 100) / 100;
    const { error: upErr } = await supabaseAdmin.from("workflow_settings").update({ partner_lead_fee_inc_gst: fee }).eq("id", ws.id);
    if (upErr) throw new Error("Could not save the lead fee. Please try again.");
    await supabaseAdmin.from("admin_config_events").insert({
      actor_id: context.userId, event_type: "partner_lead_fee_changed",
      summary: `Lead fee changed from $${ws.partner_lead_fee_inc_gst} to $${fee} inc GST: ${data.reason}`,
      details: { from: Number(ws.partner_lead_fee_inc_gst), to: fee, reason: data.reason },
    });
    return { leadFee: fee };
  });
