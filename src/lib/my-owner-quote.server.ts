// The installer's read of the owner quote behind `getMyOwnerQuote` (installer-quote-status.functions) and the installer
// job bundle (trade-job-bundle.server). One body, called from both. Jo 24 Oct 2026: there is no installer approval step;
// on our leads the installer sees the status only, and on their own jobs the figures are the business owner's.
import { early } from "./early-read";
import { sharedFor, type SharedJobReads } from "./job-shared-reads";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export async function myOwnerQuoteFor(sb: Rpc, userId: string, jobId: string, sharedReads?: SharedJobReads) {
  // Speed (Task 6): the job page bundle's quote read and trade context, when taken for this caller and job. The two access
  // checks below still run.
  const shared = sharedFor(sharedReads, userId, jobId);
  // Speed (installer screens, Task 6): the two access checks, the quote facts and the caller's business context need only
  // the caller and the job, so they are read together. Each is awaited in the old order, so a refusal still comes first
  // and nothing read is used or returned before both checks pass.
  const okP = early(sb.rpc("can_access_job", { _job: jobId }));
  const instP = early(sb.rpc("has_role", { _user_id: userId, _role: "installer" }));
  const quoteP = early(shared ? shared.quote() : import("./installer-quote-status.server").then((m) => m.loadInstallerQuote(jobId)));
  const ctxP = early(shared ? Promise.resolve(shared.access) : import("./trade-view.server").then((m) => m.tradeContext(userId)).catch(() => null));
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
  // Part 10 Task 4: the Office person sees them too (Part 5 role rule `seesPrices`); Lead Installers / crew never.
  const ctx = await ctxP;
  if (!ctx?.prices) return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line: installerQuoteLine(a) };
  // Task 6 (Jo 5 Nov 2026): while the installer's discount version waits for the office, the card keeps showing the
  // quote the owner still has (the discount draft is the newer row) plus the "sent to check" line.
  // A waiting discount is always the NEWEST row (an unsent draft), so the extra read happens only then.
  const discount = await import("./installer-discount.server");
  const { pending } = a.quote.status === "draft" && !a.quote.sent_at ? await discount.installerDiscountState(jobId) : { pending: null };
  let q = a.quote;
  let sent = a.sent;
  let facts = a;
  if (pending && pending.quoteId === q.id && !q.sent_at) {
    const source = await discount.quoteWithLines(pending.sourceQuoteId);
    // The status line describes the quote the owner has (sent, accepted…), not the waiting discount draft.
    if (source) { q = source; sent = !!source.sent_at; facts = { ...a, sent, accepted: source.status === "accepted", declined: source.status === "declined", held: false }; }
  }
  const blockers = sent ? [] : await (await import("./office-quote-review.server")).officeQuoteBlockers(jobId, q);
  const { quoteIsExpired } = await import("./quote-expiry.core");
  // Review 1 finding 5: the owner accepting the earlier quote while the discount waits wins — no "sent to check" line.
  const discountWaiting = pending && !(q.id === pending.sourceQuoteId && q.status === "accepted") ? pending : null;
  // Main's price change (installer-price-change): a new price after Send waits for its own replacement quote; no discount
  // is offered on top of it (the redraft it triggers supersedes any waiting discount draft, so the two never both wait).
  const priceChangePending = !!(await (await import('./installer-price-change.server')).pendingChangeFor(jobId));
  const canDiscount = !pending && !priceChangePending && q.status === "issued" && !!q.sent_at && !q.accepted_at && !q.expired_at && !quoteIsExpired({ kind: "installation", sent_at: q.sent_at });
  return {
    applies: true as const, priceHidden: false as const,
    priceChangePending,
    quoteId: q.id as string,
    canDiscount,
    discountPending: discountWaiting ? { amountIncGst: discountWaiting.amountIncGst, at: discountWaiting.at } : null,
    sentAt: q.sent_at as string | null,
    acceptedAt: q.accepted_at as string | null,
    expiredAt: q.expired_at as string | null,
    lines: (q.quote_items as { description: string; explanation: string | null; quantity: number; unit: string | null; line_total_inc_gst: number }[]).map((l) => ({ description: l.description, explanation: l.explanation, quantity: Number(l.quantity), unit: l.unit, total: Number(l.line_total_inc_gst) })),
    subtotal: Number(q.subtotal_inc_gst), rebate: Number(q.veec_discount_inc_gst), total: Number(q.customer_total_inc_gst),
    blockers, sent, held: a.held, formCompleted: a.formCompleted === true,
    line: installerQuoteLine(facts),
  };
}
