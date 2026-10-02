import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { installerLedOwnerPrice, piesaChargeIncGst, type ElectricianChoice } from "./installer-led.core";

// Admin-only co-branded invoice preview for installer-led jobs. Read-only: never creates a Xero invoice.
export const getInstallerLedInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await admin.from("jobs")
      .select("installer_led, electrician_choice, ap_fee_override_inc_gst, ap_fee_override_reason, ap_fee_override_at")
      .eq("id", data.jobId).single();
    if (error) throw new Error(error.message);
    const [{ data: s, error: se }, { data: quote, error: qe }] = await Promise.all([
      admin.from("retail_estimator_settings").select("ap_management_inc_gst").eq("is_current", true).maybeSingle(),
      admin.from("quotes").select("id, option_label, status, subtotal_inc_gst, veec_discount_inc_gst, quote_items(code, line_total_inc_gst)")
        .eq("job_id", data.jobId).eq("kind", "installation").neq("status", "superseded")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (se) throw new Error(se.message);
    if (qe) throw new Error(qe.message);
    const standardApFee = s ? Number(s.ap_management_inc_gst) : null;
    const override = job.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : null;
    const apFee = override ?? standardApFee;
    const piesa = piesaChargeIncGst((job.electrician_choice as ElectricianChoice | null) ?? null, null);
    const price = installerLedOwnerPrice({
      // The quote already carries an AP_FEE line; strip it so the installer's price isn't counted twice.
      installerQuoteIncGst: quote ? Number(quote.subtotal_inc_gst) - (quote.quote_items ?? []).filter((i) => i.code === "AP_FEE").reduce((a, i) => a + Number(i.line_total_inc_gst), 0) : 0,
      piesaIncGst: piesa, rectificationIncGst: 0, apFeeIncGst: apFee,
      veecDiscountIncGst: quote ? Number(quote.veec_discount_inc_gst) : 0,
    });
    return {
      installerLed: job.installer_led, quote, piesa, standardApFee, apFee,
      override: override == null ? null : { amount: override, reason: job.ap_fee_override_reason, at: job.ap_fee_override_at },
      price,
    };
  });

// Admin-only: set (or clear with amount=null) a per-job AP fee. Reason required; permanently logged.
export const setApFeeOverride = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), amount: z.number().min(0).max(100000).nullable(), reason: z.string().trim().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { logEvent } = await import("./workflow.server");
    const { data: acceptedQuote, error: quoteError } = await admin.from("quotes")
      .select("id").eq("job_id", data.jobId).eq("kind", "installation").eq("status", "accepted").limit(1).maybeSingle();
    if (quoteError) throw new Error("The accepted quote could not be checked. Please try again.");
    if (acceptedQuote) throw new Error("The Accredited Person fee is locked because the owner has accepted the quote.");
    const amount = data.amount == null ? null : Math.round(data.amount * 100) / 100;
    const { error } = await admin.from("jobs").update({
      ap_fee_override_inc_gst: amount, ap_fee_override_reason: amount == null ? null : data.reason,
      ap_fee_override_by: amount == null ? null : context.userId, ap_fee_override_at: amount == null ? null : new Date().toISOString(),
    }).eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await logEvent(data.jobId, context.userId, "ap_fee_override",
      amount == null ? "AP fee reset to standard" : `AP fee overridden to $${amount.toFixed(2)} inc GST`,
      { amount, reason: data.reason }, { internal: true });
    return { ok: true };
  });
