// New job flow, Part 9, Task 12: the office records a complaint, its acknowledgement and its resolution as job events
// (complaints.core turns them into the "acknowledge within 5 business days / resolve within 20" office rows). Office
// only. No owner message is sent from here — the office acknowledges by hand (no approved automatic wording).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const jobId = z.string().uuid();

export const recordComplaint = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    jobId,
    receivedAt: z.string().datetime({ offset: true }),
    channel: z.enum(["phone", "email", "text", "in_person", "other"]),
    summary: z.string().trim().min(3).max(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { COMPLAINT_RECEIVED_EVENT, complaintDue } = await import("./complaints.core");
    const due = complaintDue(data.receivedAt);
    await logEvent(data.jobId, context.userId, COMPLAINT_RECEIVED_EVENT, `Complaint received (${data.channel.replace("_", " ")})`, { received_at: data.receivedAt, channel: data.channel, summary: data.summary, ack_by: due.ackBy, resolve_by: due.resolveBy }, { internal: true });
    return { ok: true as const, ...due };
  });

export const acknowledgeComplaint = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId, note: z.string().trim().max(2000).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent, WorkflowError } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { COMPLAINT_ACKNOWLEDGED_EVENT } = await import("./complaints.core");
    const s = await (await import("./complaints.server")).complaintStateFor(data.jobId);
    if (!s) throw new WorkflowError("No complaint is recorded on this job.");
    if (s.acknowledgedAt) return { ok: true as const, already: true as const, at: s.acknowledgedAt };
    await logEvent(data.jobId, context.userId, COMPLAINT_ACKNOWLEDGED_EVENT, "Complaint acknowledged to the owner", { note: data.note || null, received_at: s.receivedAt }, { internal: true });
    return { ok: true as const, already: false as const, at: new Date().toISOString() };
  });

export const resolveComplaint = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId, outcome: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent, WorkflowError } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { COMPLAINT_RESOLVED_EVENT } = await import("./complaints.core");
    const s = await (await import("./complaints.server")).complaintStateFor(data.jobId);
    if (!s) throw new WorkflowError("No complaint is recorded on this job.");
    if (s.resolvedAt) return { ok: true as const, already: true as const, at: s.resolvedAt };
    await logEvent(data.jobId, context.userId, COMPLAINT_RESOLVED_EVENT, "Complaint resolved", { outcome: data.outcome, received_at: s.receivedAt }, { internal: true });
    return { ok: true as const, already: false as const, at: new Date().toISOString() };
  });
