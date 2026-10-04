import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

// Admin-only: the auto-drafted owner quote from an installer's Ready Check, and the office "send" step.
export const getInstallerQuoteDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: job, error: je } = await admin.from("jobs").select("channel").eq("id", data.jobId).single();
    if (je) throw new Error(je.message);
    if (job.channel !== "installer_sourced") return { applies: false as const };
    const [{ data: q, error }, { data: held }] = await Promise.all([
      admin.from("quotes").select("id, status, option_code, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, cobrand, created_at, quote_items(code, description, explanation, line_total_inc_gst, sort)")
        .eq("job_id", data.jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("workflow_events").select("details, created_at").eq("job_id", data.jobId).eq("event_type", "installer_quote_held").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const heldNewer = held && (!q || held.created_at > q.created_at);
    return {
      applies: true as const,
      quote: q ? { ...q, quote_items: [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort) } : null,
      heldBlockers: heldNewer ? (((held.details as { blockers?: string[] } | null)?.blockers) ?? []) : [],
    };
  });

export const sendInstallerQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { WorkflowError, logEvent } = await import("./workflow.server");
    const { applyCobrand } = await import("./pilot.server");
    const { customerDeliveryState } = await import("./comms.server");
    const { data: q } = await admin.from("quotes").select("id, status, option_code, job_id").eq("id", data.quoteId).eq("job_id", data.jobId).maybeSingle();
    if (!q || q.option_code !== "INSTALLER_A1") throw new WorkflowError("Quote not found.");
    if (q.status !== "draft") throw new WorkflowError("This quote has already been sent.");
    await applyCobrand(data.jobId);
    const { error } = await admin.from("quotes").update({ status: "issued", sent_at: new Date().toISOString() }).eq("id", q.id).eq("status", "draft");
    if (error) throw new Error(error.message);
    const delivery = await customerDeliveryState(data.jobId);
    await logEvent(data.jobId, context.userId, "installer_quote_sent", "Office sent the co-branded owner quote", { quote_id: q.id, email_delivery: delivery });
    return { delivery };
  });
