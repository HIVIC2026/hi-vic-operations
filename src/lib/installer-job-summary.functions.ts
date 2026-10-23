// Office summary for one installer job (Jo 23 Oct 2026). Admin-only, read-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { installerJobSummary } from "./installer-job-summary.core";
import { A2_CORRECTION_EVENT, FLAG_EVENTS, FORM_CREATED_EVENTS, FORM_PROBLEM_EVENTS, HELD_EVENTS, classifyNewInstallerJob } from "./installer-new-jobs.core";

export const getInstallerJobSummary = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [job, consent, form, events, asg] = await Promise.all([
      admin.from("jobs").select("id, job_number, created_at, source, stage, channel, eligibility_outcome, originating_installer_business_id").eq("id", data.jobId).maybeSingle(),
      admin.from("owner_contact_consents").select("consent_status").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("ceiling_measurements").select("external_id").eq("job_id", data.jobId).eq("is_current", true).eq("external_source", "mitti").maybeSingle(),
      admin.from("workflow_events").select("event_type, created_at, summary, details").eq("job_id", data.jobId)
        .in("event_type", ["ready_check_basics", A2_CORRECTION_EVENT, ...FLAG_EVENTS, ...HELD_EVENTS, ...FORM_PROBLEM_EVENTS, ...FORM_CREATED_EVENTS]).order("created_at", { ascending: false }).limit(200),
      admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    ]);
    if (job.error || consent.error || form.error || events.error || asg.error) throw new Error("The installer job summary could not be read.");
    if (!job.data || job.data.channel !== "installer_sourced") return { applies: false as const };
    const bizId = asg.data?.business_id ?? job.data.originating_installer_business_id;
    const { data: biz } = bizId ? await admin.from("businesses").select("name").eq("id", bizId).maybeSingle() : { data: null };
    const ev = (events.data ?? []).map((e) => ({ type: e.event_type, at: e.created_at, summary: e.summary, details: e.details as Record<string, unknown> | null }));
    const auditId = form.data?.external_id ?? null;
    const basicsEv = ev.find((e) => e.type === "ready_check_basics");
    const created = ev.find((e) => (FORM_CREATED_EVENTS as readonly string[]).includes(e.type));
    const problem = !auditId ? ev.find((e) => (FORM_PROBLEM_EVENTS as readonly string[]).includes(e.type) && (!created || e.at > created.at)) : undefined;
    const held = ev.find((e) => (HELD_EVENTS as readonly string[]).includes(e.type));
    const heldDetails = held?.details ?? {};
    const { loadQuoteApproval } = await import("./installer-quote-approval.server");
    const ap = await loadQuoteApproval(data.jobId).catch(() => null);
    // Warnings the summary doesn't already show in its own rows (duplicate, A2, ineligible, not started).
    const listed = classifyNewInstallerJob({
      jobId: job.data.id, jobNumber: job.data.job_number, createdAt: job.data.created_at, source: job.data.source, stage: job.data.stage,
      owner: null, address: null, installer: biz?.name ?? null, eligibility: job.data.eligibility_outcome,
      hasMittiForm: !!auditId, mittiAuditId: auditId, hasQuote: !!ap?.applies, events: ev,
    }, new Date());
    const warnings = (listed?.warnings ?? []).filter((w) => !/^(No Mitti Ready Check form yet|Ready Check missing:|Quote held|Mitti Ready Check form could not be created)/.test(w) && w !== problem?.summary?.trim());
    const b = basicsEv?.details as { missing?: string[]; stops?: string[]; completed?: boolean } | null;
    const summary = installerJobSummary({
      installer: biz?.name ?? null,
      consent: (consent.data?.consent_status as "granted" | "not_granted" | "unknown" | undefined) ?? null,
      mittiAuditId: auditId, formProblem: problem?.summary?.trim() ?? null,
      basics: b ? { missing: b.missing ?? [], stops: b.stops ?? [], completed: b.completed === true } : null,
      heldReasons: held ? ((heldDetails["blockers"] as string[] | undefined) ?? (heldDetails["reasons"] as string[] | undefined) ?? ["Reason not recorded"]) : null,
      quote: ap?.applies ? { total: ap.quote?.customer_total_inc_gst == null ? null : Number(ap.quote.customer_total_inc_gst), sent: ap.sent, accepted: ap.accepted === true, installerApproved: ap.state === "approved", ...(ap.installerJob ? { autoSendHeld: ap.held === true } : {}) } : null,
      warnings,
    });
    return { applies: true as const, installer: biz?.name ?? null, consent: consent.data?.consent_status ?? null, ...summary };
  });
