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
    const { data: q } = await admin.from("quotes").select("id, status, option_code, job_id, release_state").eq("id", data.quoteId).eq("job_id", data.jobId).maybeSingle();
    if (!q || q.option_code !== "INSTALLER_A1") throw new WorkflowError("Quote not found.");
    if (q.status !== "draft") throw new WorkflowError("This quote has already been sent.");
    { // Approved intake jobs: readiness + a real consent row + fee awareness before release (event alone is not consent).
      const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("event_type", "installer_evidence_acknowledged");
      if (count) {
        const { installerIntakeState } = await import("./installer-intake.server");
        const st = await installerIntakeState(data.jobId);
        const b = [...st.readiness.blockers, ...st.releaseBlockers];
        if (b.length) throw new WorkflowError(b.join(" • "));
      }
    }
    await applyCobrand(data.jobId);
    const { customerDeliveryState } = await import("./comms.server");
    const delivery = await customerDeliveryState(data.jobId);
    const released = delivery === "ready_to_send";
    const { error } = await admin.from("quotes").update({ status: "issued", sent_at: released ? new Date().toISOString() : null, release_state: released ? "released" : "queued", release_hold_reason: null }).eq("id", q.id).eq("status", "draft");
    if (error) throw new Error(error.message);
    await logEvent(data.jobId, context.userId, released ? "installer_quote_released" : "installer_quote_queued", released ? "Office released the co-branded owner quote" : "Office approved the co-branded owner quote — queued behind the launch switches", { quote_id: q.id, email_delivery: delivery });
    return { delivery };
  });

// ---- Approved installer intake (Jo, 8 Oct 2026): office review of the short intake. Admin only. ----
export const getInstallerIntake = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { installerIntakeState } = await import("./installer-intake.server");
    return installerIntakeState(data.jobId);
  });

export const officeIntakeAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.discriminatedUnion("action", [
    z.object({ action: z.literal("eligibility"), jobId: z.string().uuid(), outcome: z.enum(["eligible", "not_eligible"]), reason: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("correct"), jobId: z.string().uuid(), insulation: z.enum(["none", "below_r2", "unknown"]).optional(), quoteIncGst: z.number().positive().max(1_000_000).nullable().optional(), includes: z.string().trim().max(1000).nullable().optional(), reason: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("fee_awareness"), jobId: z.string().uuid(), note: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("draft_quote"), jobId: z.string().uuid() }),
  ]).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const m = await import("./installer-intake.server");
    if (data.action === "eligibility") await m.recordCommercialEligibility(data.jobId, context.userId, data.outcome, data.reason);
    else if (data.action === "correct") await m.correctInstallerIntake(data.jobId, context.userId, { insulation: data.insulation, quoteIncGst: data.quoteIncGst, includes: data.includes, reason: data.reason });
    else if (data.action === "fee_awareness") await m.recordOfficeFeeAwareness(data.jobId, context.userId, data.note);
    else await m.draftQuoteFromIntake(data.jobId, context.userId);
    return m.installerIntakeState(data.jobId);
  });

// Installer's own job: the Ready Check outstanding list (business-scoped via job assignment).
export const getMyIntakeReadyCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { installerIntakeState } = await import("./installer-intake.server");
    const s = await installerIntakeState(data.jobId);
    return { coordination: s.coordination, readyCheck: s.readyCheck, quoteHeldFor: s.readiness.blockers.filter((b) => /insulation|eligib/i.test(b)) };
  });
