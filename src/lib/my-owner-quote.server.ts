// The installer's read of the owner quote behind `getMyOwnerQuote` (installer-quote-status.functions) and the installer
// job bundle (trade-job-bundle.server). One body, called from both. Jo 24 Oct 2026: there is no installer approval step;
// on our leads the installer sees the status only, and on their own jobs the figures are the business owner's.
import { early } from "./early-read";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export async function myOwnerQuoteFor(sb: Rpc, userId: string, jobId: string) {
  // Speed (installer screens, Task 6): the two access checks, the quote facts and the caller's business context need only
  // the caller and the job, so they are read together. Each is awaited in the old order, so a refusal still comes first
  // and nothing read is used or returned before both checks pass.
  const okP = early(sb.rpc("can_access_job", { _job: jobId }));
  const instP = early(sb.rpc("has_role", { _user_id: userId, _role: "installer" }));
  const quoteP = early(import("./installer-quote-status.server").then((m) => m.loadInstallerQuote(jobId)));
  const ctxP = early(import("./trade-view.server").then((m) => m.tradeContext(userId)).catch(() => null));
  const { data: ok, error } = await okP;
  if (error || !ok) throw new Error("Not your job.");
  const { data: inst } = await instP;
  if (!inst) return { applies: false as const };
  const a = await quoteP;
  if (!a.applies || !a.quote) return { applies: false as const };
  const { installerQuoteLine } = await import("./installer-quote-status.core");
  // Jo 24 Oct: on our leads the installer sees the quote's status only — never the owner's price or our margin.
  if (a.channel === "hivic_sourced") return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line: installerQuoteLine(a) };
  // Decision 278: on the installer's own jobs the figures are the business owner's — a team member gets the status only.
  const ctx = await ctxP;
  if (!ctx?.boss) return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line: installerQuoteLine(a) };
  const blockers = a.sent ? [] : await (await import("./office-quote-review.server")).officeQuoteBlockers(jobId, a.quote);
  const q = a.quote;
  return {
    applies: true as const, priceHidden: false as const,
    quoteId: q.id as string,
    lines: (q.quote_items as { description: string; explanation: string | null; quantity: number; unit: string | null; line_total_inc_gst: number }[]).map((l) => ({ description: l.description, explanation: l.explanation, quantity: Number(l.quantity), unit: l.unit, total: Number(l.line_total_inc_gst) })),
    subtotal: Number(q.subtotal_inc_gst), rebate: Number(q.veec_discount_inc_gst), total: Number(q.customer_total_inc_gst),
    blockers, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true,
    line: installerQuoteLine(a),
  };
}
