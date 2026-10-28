// The installer's read of the owner quote behind `getMyOwnerQuote` (installer-quote-status.functions) and the installer
// job bundle (trade-job-bundle.server). One body, called from both. Jo 24 Oct 2026: there is no installer approval step;
// on our leads the installer sees the status only, and on their own jobs the figures are the business owner's.
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export async function myOwnerQuoteFor(sb: Rpc, userId: string, jobId: string) {
  const { data: ok, error } = await sb.rpc("can_access_job", { _job: jobId });
  if (error || !ok) throw new Error("Not your job.");
  const { data: inst } = await sb.rpc("has_role", { _user_id: userId, _role: "installer" });
  if (!inst) return { applies: false as const };
  const a = await (await import("./installer-quote-status.server")).loadInstallerQuote(jobId);
  if (!a.applies || !a.quote) return { applies: false as const };
  const { installerQuoteLine, quoteLineForViewer } = await import("./installer-quote-status.core");
  // Decision 278: on the installer's own jobs the figures are the business owner's — a team member gets the status only.
  // Jo 28 Oct 2026: crew never see a price, so a crew member's status line never carries the not-signed-up note ($349).
  // (On our leads the viewer is only looked up when the line would differ for crew.) "Owner" = owner of the installer
  // business on THIS job (crew-no-price.server), not of the first business the person belongs to.
  const raw = installerQuoteLine(a);
  const boss = a.channel !== "hivic_sourced" || quoteLineForViewer(raw, false) !== raw ? await (await import("./crew-no-price.server")).ownsJobBusiness(jobId, userId, "installer").catch(() => false) : false;
  const ctx = { boss };
  const line = quoteLineForViewer(raw, boss);
  // Jo 24 Oct: on our leads the installer sees the quote's status only — never the owner's price or our margin.
  if (a.channel === "hivic_sourced") return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line };
  if (!ctx?.boss) return { applies: true as const, priceHidden: true as const, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true, line };
  const blockers = a.sent ? [] : await (await import("./office-quote-review.server")).officeQuoteBlockers(jobId, a.quote);
  const q = a.quote;
  return {
    applies: true as const, priceHidden: false as const,
    quoteId: q.id as string,
    lines: (q.quote_items as { description: string; explanation: string | null; quantity: number; unit: string | null; line_total_inc_gst: number }[]).map((l) => ({ description: l.description, explanation: l.explanation, quantity: Number(l.quantity), unit: l.unit, total: Number(l.line_total_inc_gst) })),
    subtotal: Number(q.subtotal_inc_gst), rebate: Number(q.veec_discount_inc_gst), total: Number(q.customer_total_inc_gst),
    blockers, sent: a.sent, held: a.held, formCompleted: a.formCompleted === true,
    line,
  };
}
