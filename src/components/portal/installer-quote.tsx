import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getInstallerQuoteDraft, sendInstallerQuote } from "@/lib/installer-quote.functions";
import { Button } from "@/components/ui/button";

const money = (n: number) => `$${n.toFixed(2)}`;

/** Admin: the owner quote auto-drafted from the installer's Ready Check. Nothing is sent until the office presses Send. */
export function InstallerQuoteDraftPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerQuoteDraft);
  const send = useServerFn(sendInstallerQuote);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["installer-quote-draft", jobId], queryFn: () => load({ data: { jobId } }) });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading installer quote…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  if (!d?.applies) return null;
  const quote = d.quote;
  const brand = (quote?.cobrand ?? null) as { partner_name?: string; partnerName?: string } | null;
  const partner = brand?.partner_name ?? brand?.partnerName ?? null;

  const onSend = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const r = await send({ data: { jobId, quoteId: quote.id } });
      await qc.invalidateQueries({ queryKey: ["installer-quote-draft", jobId] });
      toast.success(r.delivery === "ready_to_send" ? "Quote sent to the owner." : "Quote is now in the owner's portal. No email went out — messages are switched off or the owner hasn't agreed to contact.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Owner quote from the installer's Ready Check</h3>
        <p className="text-xs text-muted-foreground">
          {partner ? `${partner} with ` : "Installer branding with "}Home Insulation Victoria as the Accredited Person. All prices inc GST. No lead fee, no margin.
        </p>
      </div>
      {d.heldBlockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Not drafted — needs office review:</p>
          <ul className="list-disc pl-5 text-destructive">{d.heldBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {!quote ? (
        d.heldBlockers.length === 0 && <p className="text-sm text-muted-foreground">Waiting for the installer to finish the Ready Check in Mitti.</p>
      ) : (
        <>
          <dl className="divide-y text-sm">
            {quote.quote_items.map((i) => (
              <div key={i.sort} className="flex justify-between gap-4 py-1.5"><dt>{i.description}</dt><dd className="tabular-nums shrink-0">{money(Number(i.line_total_inc_gst))}</dd></div>
            ))}
            <div className="flex justify-between py-1.5"><dt>Estimated project total</dt><dd className="tabular-nums">{money(Number(quote.subtotal_inc_gst))}</dd></div>
            <div className="flex justify-between py-1.5"><dt>Estimated VEU / VEEC discount</dt><dd className="tabular-nums">−{money(Number(quote.veec_discount_inc_gst))}</dd></div>
            <div className="flex justify-between py-2 font-semibold"><dt>Estimated cost after discount</dt><dd className="tabular-nums">{money(Number(quote.customer_total_inc_gst))}</dd></div>
          </dl>
          {quote.status === "draft" ? (
            <Button disabled={busy} onClick={onSend}>Send quote to owner</Button>
          ) : (
            <p className="text-sm font-medium">{quote.status === "accepted" ? "Accepted by the owner." : "Sent to the owner."}</p>
          )}
        </>
      )}
    </section>
  );
}
