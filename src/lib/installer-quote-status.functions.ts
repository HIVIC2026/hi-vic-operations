import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

/** Installer: on their own jobs the whole owner quote exactly as the owner will see it, its status and anything holding
 *  it; on our leads the status only (Jo 24 Oct). Read-only;
 *  Jo 24 Oct 2026: there is no installer approval step. */
export const getMyOwnerQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Rpc;
    const { data: ok, error } = await sb.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { data: inst } = await sb.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!inst) return { applies: false as const };
    const a = await (await import("./installer-quote-status.server")).loadInstallerQuote(data.jobId);
    if (!a.applies || !a.quote) return { applies: false as const };
    const { installerQuoteLine } = await import("./installer-quote-status.core");
    // Jo 24 Oct: on our leads the installer sees the quote's status only — never the owner's price or our margin.
    if (a.channel === "hivic_sourced") return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line: installerQuoteLine(a) };
    // Decision 278: on the installer's own jobs the figures are the business owner's — a team member gets the status only.
    const ctx = await (await import("./trade-view.server")).tradeContext(context.userId).catch(() => null);
    if (!ctx?.boss) return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line: installerQuoteLine(a) };
    const blockers = a.sent ? [] : await (await import("./office-quote-review.server")).officeQuoteBlockers(data.jobId, a.quote);
    const q = a.quote;
    return {
      applies: true as const, priceHidden: false as const,
      quoteId: q.id as string,
      lines: (q.quote_items as { description: string; explanation: string | null; quantity: number; unit: string | null; line_total_inc_gst: number }[]).map((l) => ({ description: l.description, explanation: l.explanation, quantity: Number(l.quantity), unit: l.unit, total: Number(l.line_total_inc_gst) })),
      subtotal: Number(q.subtotal_inc_gst), rebate: Number(q.veec_discount_inc_gst), total: Number(q.customer_total_inc_gst),
      blockers, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true,
      line: installerQuoteLine(a),
    };
  });
