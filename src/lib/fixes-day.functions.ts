// Decision 293: the electrician's job page reads its "A4 – Electrical fixes" Mitti form and can refresh it. Literal
// createServerFn chains only; everything else lives in fixes-day.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** The job's fixes form (audit id + what happened to it) for the assigned electrician, the installer or the office. */
export const getFixesForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer"]);
    const { fixesFormState } = await import("./fixes-day.server");
    return fixesFormState(data.jobId);
  });

/** Read the form again now (the 15-minute tick does the same). Electrician or office. */
export const refreshFixesForm = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { fixesFormState, completeFixesForm } = await import("./fixes-day.server");
    const s = await fixesFormState(data.jobId);
    if (!s.auditId) return { status: "none" as const, detail: s.detail };
    return completeFixesForm(data.jobId, s.auditId, { actorId: context.userId });
  });

/** Office: create the fixes form for the booked visit now (same path as the booking hook; held reasons come back as text). */
export const createFixesFormNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: bk } = await admin.from("bookings").select("id").eq("job_id", data.jobId).eq("kind", "rectification").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!bk) return { status: "held" as const, reason: "No confirmed electrical fixes visit on this job." };
    const { createFixesForm } = await import("./fixes-day.server");
    return createFixesForm(data.jobId, context.userId, bk.id);
  });
