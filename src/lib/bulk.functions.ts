import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Admin-only bulk job actions. Each job is processed on its own so one failure never hides the rest;
// every change goes through the normal guarded transition and is logged. Delete is limited to test records.
export const bulkJobAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobIds: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(["cancel", "hold", "mark_test", "delete"]),
    reason: z.string().trim().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const results: { jobId: string; ok: boolean; error?: string }[] = [];
    for (const jobId of data.jobIds) {
      try {
        // Hold/cancel use the same reviewed disposition as the single-job action (transition() never allows these targets).
        if (data.action === "cancel" || data.action === "hold") await (await import("./job-disposition.server")).applyHoldOrCancel(jobId, data.action, `${data.reason} (bulk)`, context.userId, { bulk: true, reason: data.reason });
        else if (data.action === "mark_test") {
          const { data: before } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
          const { error } = await admin.from("jobs").update({ source: "qa_test" }).eq("id", jobId);
          if (error) throw new Error(error.message);
          // prior_source lets Reopen put it back (office gaps A4).
          await logEvent(jobId, context.userId, "marked_test", `Marked as test record: ${data.reason}`, { bulk: true, prior_source: before?.source ?? null }, { internal: true });
        } else {
          const { data: j, error: je } = await admin.from("jobs").select("source").eq("id", jobId).single();
          if (je) throw new Error(je.message);
          if (j.source !== "qa_test") throw new Error("Only test records can be deleted. Mark it as a test record or cancel it instead.");
          const { error } = await admin.from("jobs").delete().eq("id", jobId);
          if (error) throw new Error(`Could not delete (linked signed or sent records are kept for audit): ${error.message}`);
        }
        results.push({ jobId, ok: true });
      } catch (e) {
        results.push({ jobId, ok: false, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  });
