import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { installerLedOwnerPrice, piesaChargeIncGst, type ElectricianChoice } from "./installer-led.core";
import { apFeeLockedByQuotes, applyApFeeChange, canChangeApFee, resolveApFeeAllowedIds } from "./ap-fee.core";

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
    const { data: allQuotes, error: aqe } = await admin.from("quotes").select("id, status, accepted_at").eq("job_id", data.jobId).eq("kind", "installation");
    if (aqe) throw new Error(aqe.message);
    const apFeeLocked = apFeeLockedByQuotes(allQuotes ?? []);
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
      // C04: computed here, not in the browser, so the screen can't be talked into showing the editor.
      apFeeLocked,
      canChangeApFee: !apFeeLocked && canChangeApFee(context.userId, resolveApFeeAllowedIds(process.env["AP_FEE_OVERRIDE_USER_IDS"])),
      price,
    };
  });

// C04: the Home Insulation Victoria owner alone may set (or clear with amount=null) a per-job AP fee.
// Reason required; permanently logged.
export const setApFeeOverride = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), amount: z.number().min(0).max(100000).nullable(), reason: z.string().max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { logEvent } = await import("./workflow.server");
    return applyApFeeChange({
      async loadInstallationQuotes(jobId) {
        const { data: rows, error } = await admin.from("quotes").select("id, status, accepted_at").eq("job_id", jobId).eq("kind", "installation");
        if (error) throw new Error("The quote could not be checked. Please try again.");
        return rows ?? [];
      },
      async loadJob(jobId) {
        const { data: j, error } = await admin.from("jobs").select("ap_fee_override_inc_gst, ap_fee_override_reason, ap_fee_override_by, ap_fee_override_at").eq("id", jobId).single();
        if (error) throw new Error(error.message);
        return { ...j, ap_fee_override_inc_gst: j.ap_fee_override_inc_gst == null ? null : Number(j.ap_fee_override_inc_gst) };
      },
      async writeJob(jobId, next) {
        const { error } = await admin.from("jobs").update(next).eq("id", jobId);
        if (error) throw new Error(error.message);
      },
      async audit(jobId, actorId, type, summary, details) { await logEvent(jobId, actorId, type, summary, details, { internal: true }); },
      now: () => new Date().toISOString(),
    }, {
      actorId: context.userId, // from the verified session, never from the browser
      allowedUserIds: resolveApFeeAllowedIds(process.env["AP_FEE_OVERRIDE_USER_IDS"]),
      jobId: data.jobId, amount: data.amount, reason: data.reason,
    });
  });
