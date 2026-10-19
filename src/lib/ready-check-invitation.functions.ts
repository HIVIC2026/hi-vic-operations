// P1-R3-S92 — GAP-2 Office entry points for the Template 8 Ready Check invitation.
//
// OWNER DECISION (approved): OPTION A — OFFICE MANUAL TRIGGER. Every entry point requires the existing
// Office authorisation (requireAdmin) and acts on ONE job the Office named. There is no automatic
// trigger, no batch action and no schedule: availability, area, customer activity and Save-my-spot
// completion are all deliberately incapable of starting an invitation.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getReadyCheckCandidates = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { loadReadyCheckCandidates } = await import("./ready-check-invitation.server");
    return { rows: await loadReadyCheckCandidates() };
  });

/** Office preview. Renders the exact invitation for Office to review; never sends and never reserves. */
export const prepareReadyCheckInvitation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { prepareReadyCheckInvitation: prepare } = await import("./ready-check-invitation.server");
    return prepare(data.jobId, { userId: context.userId, role: "office" });
  });

/** Office send. Re-runs every COM-04 safeguard at send time; the preview is never trusted. */
export const sendReadyCheckInvitation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { sendReadyCheckInvitation: send } = await import("./ready-check-invitation.server");
    return send(data.jobId, { userId: context.userId, role: "office" });
  });
