import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

/** Installer: the whole owner quote exactly as the owner will see it, plus anything missing or held. */
export const getMyQuoteToCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Rpc;
    const { data: ok, error } = await sb.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { data: inst } = await sb.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!inst) return { applies: false as const };
    const a = await (await import("./installer-quote-approval.server")).loadQuoteApproval(data.jobId);
    if (!a.applies || !a.quote) return { applies: false as const };
    const core = await import("./installer-quote-approval.core");
    const blockers = a.sent ? [] : (await (await import("./office-quote-review.server")).officeQuoteBlockers(data.jobId, a.quote)).filter((b) => b !== core.WAITING_ON_INSTALLER);
    const q = a.quote;
    return {
      applies: true as const,
      quoteId: q.id as string,
      lines: (q.quote_items as { description: string; explanation: string | null; quantity: number; unit: string | null; line_total_inc_gst: number }[]).map((l) => ({ description: l.description, explanation: l.explanation, quantity: Number(l.quantity), unit: l.unit, total: Number(l.line_total_inc_gst) })),
      subtotal: Number(q.subtotal_inc_gst), rebate: Number(q.veec_discount_inc_gst), total: Number(q.customer_total_inc_gst),
      blockers, state: a.state, sent: a.sent, approvedAt: a.approvedAt,
      buttonLabel: core.approveButtonLabel(a.channel), canApprove: !a.installerJob && !a.sent && a.state !== "approved" && core.canApprove(blockers),
      line: core.approvalCardLine(a.state, a.sent, a.accepted === true, a.installerJob ? { held: a.held === true, declined: a.declined === true } : undefined),
      installerJob: a.installerJob === true,
    };
  });

export const approveMyQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Rpc;
    const { data: ok, error } = await sb.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { data: inst } = await sb.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!inst) throw new Error("Only the installer can approve this quote.");
    return (await import("./installer-quote-approval.server")).approveInstallerQuote(data.jobId, data.quoteId, context.userId);
  });
