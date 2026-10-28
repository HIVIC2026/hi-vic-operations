// "Who has the ball" for one job: facts are loaded server-side after the caller's job role is verified.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { waitingOn, type BookingFact, type Proposal } from "./waiting.core";

export const getJobWaiting = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [{ data: job }, { data: ev }, { data: props }, { data: books }, { data: asg }, { data: inv }, { data: ws }] = await Promise.all([
      admin.from("jobs").select("stage, eligibility_outcome, eligibility_review_required, next_action, hold_reason").eq("id", data.jobId).single(),
      admin.from("workflow_events").select("to_stage, created_at").eq("job_id", data.jobId).not("to_stage", "is", null).order("created_at", { ascending: false }).limit(1),
      admin.from("appointment_proposals").select("kind, status, proposer_role, created_at, starts_at, responded_at").eq("job_id", data.jobId),
      admin.from("bookings").select("kind, status, scheduled_start, scheduled_end").eq("job_id", data.jobId),
      admin.from("job_assignments").select("role, business_id, user_id").eq("job_id", data.jobId).eq("active", true),
      admin.from("invoices").select("deposit_request_raised_at").eq("job_id", data.jobId).eq("kind", "installation").limit(1).maybeSingle(),
      admin.from("workflow_settings").select("due_trade_reply_warn_hours, due_trade_reply_exception_hours, due_owner_reminder_days, due_owner_flag_days").limit(1).maybeSingle(),
    ]);
    if (!job) throw new Error("Job not found.");
    // Jo 28 Oct 2026 (spec rule 3): office-typed hold / review text never reaches a trade login that isn't the owner of
    // the job's business for its role (the sentence repeats it).
    const trade = role === "electrician" || role === "installer";
    const facts = trade && !(await (await import("./crew-no-price.server")).ownsJobBusiness(data.jobId, context.userId, role))
      ? (await import("./crew-no-price.core")).overviewForViewer(job, false) : job;
    const bizIds = (asg ?? []).map((a) => a.business_id).filter(Boolean) as string[];
    const { data: biz } = bizIds.length ? await admin.from("businesses").select("id, name, trading_name").in("id", bizIds) : { data: [] };
    const nameFor = (r: string) => { const a = (asg ?? []).find((x) => x.role === r); const b = (biz ?? []).find((x) => x.id === a?.business_id); return b ? b.trading_name || b.name : null; };
    const w = waitingOn(facts, {
      now: new Date(), stageEnteredAt: ev?.[0]?.created_at ?? null,
      electricianName: nameFor("electrician"), installerName: nameFor("installer"),
      proposals: (props ?? []) as Proposal[], bookings: (books ?? []) as BookingFact[],
      depositRequestRaised: !!inv?.deposit_request_raised_at,
      settings: ws ? { tradeWarnHours: ws.due_trade_reply_warn_hours, tradeExceptionHours: ws.due_trade_reply_exception_hours, ownerReminderDays: ws.due_owner_reminder_days, ownerFlagDays: ws.due_owner_flag_days } : undefined,
    });
    return { ...w, viewerRole: role };
  });
