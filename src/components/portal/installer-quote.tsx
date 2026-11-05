import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { clearSiteConditionsHold, getInstallerIntake, getInstallerQuoteDraft, officeIntakeAction, sendInstallerQuote } from "@/lib/installer-quote.functions";
import { Button } from "@/components/ui/button";
import { adjustQuote } from "@/lib/portal.functions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const money = (n: number) => `$${n.toFixed(2)}`;

/** Admin: the owner quote auto-drafted from the installer's Ready Check. Nothing is sent until the office presses Send. */
export function InstallerQuoteDraftPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerQuoteDraft);
  const send = useServerFn(sendInstallerQuote);
  const adjust = useServerFn(adjustQuote);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["installer-quote-draft", jobId], queryFn: () => load({ data: { jobId } }) });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [rebate, setRebate] = useState("");
  const [mainOnly, setMainOnly] = useState(false);
  const [lineEdits, setLineEdits] = useState<Record<string, { quantity: string; price: string }>>({});
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading installer quote…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  if (!d?.applies) return null;
  const quote = d.quote;
  const brand = (quote?.cobrand ?? null) as { partner_name?: string; partnerName?: string } | null;
  const companions = d.companions ?? [];
  const companionHeld = companions.some((c) => c.blockers.length > 0);
  const partner = brand?.partner_name ?? brand?.partnerName ?? null;

  const onSend = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const r = await send({ data: { jobId, quoteId: quote.id, ...(mainOnly ? { mainOnly: true } : {}) } });
      await qc.invalidateQueries({ queryKey: ["installer-quote-draft", jobId] });
      await qc.invalidateQueries({ queryKey: ["installer-quotes-to-check"] });
      toast.success(`Quote released. Email: ${r.notification.email}. Text: ${r.notification.sms}.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Owner quote from the installer's Ready Check</h3>
        <p className="text-xs text-muted-foreground">
          {partner ? `${partner} with ` : ""}Home Insulation Victoria as the Accredited Person. All prices inc GST.{d.channel === "installer_sourced" ? " No lead fee, no margin." : ""}
        </p>
      </div>
      {d.priceChange && <div role="status" className="space-y-1 border-y py-3 text-sm"><p className="font-semibold">{d.priceChange.replacesQuoteId ? `New price from ${d.installerName ?? partner ?? 'installer'} — resend?` : 'price changed by installer'}</p><p>Old price: {money(d.priceChange.oldPrice)} inc GST · New price: {money(d.priceChange.newPrice)} inc GST</p>{d.priceChange.reason && <p>{d.priceChange.reason}</p>}</div>}
      {d.heldBlockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{quote ? "Held — fix before sending:" : "Not drafted — needs office review:"}</p>
          <ul className="list-disc pl-5 text-destructive">{d.heldBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {!quote ? (
        d.heldBlockers.length === 0 && <p className="text-sm text-muted-foreground">Waiting for the installer to finish the Ready Check in Mitti.</p>
      ) : (
        <>
          {companions.length > 0 && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="options-together">
              <p className="font-semibold">{companions.length + 1} options for the owner. Send releases them all together.</p>
            </div>
          )}
          <div className={companions.length ? "grid gap-4 md:grid-cols-2" : ""}>
          <div className={companions.length ? "rounded-md border p-3" : ""} data-testid="quote-option">
          {companions.length > 0 && <h4 className="mb-1 font-semibold">{quote.option_label ?? "Main option"}<span className="ml-2 text-xs font-normal text-muted-foreground">Main option</span></h4>}
          <dl className="divide-y text-sm">
              {quote.quote_items.map((i) => (
                <div key={i.sort} className="flex justify-between gap-4 py-1.5"><dt className="min-w-0 whitespace-pre-line break-words">{i.description}<span className="block text-xs text-muted-foreground">{Number(i.quantity)} {i.unit} × {money(Number(i.unit_price_inc_gst))}{i.explanation ? ` · ${i.explanation}` : ""}</span></dt><dd className="tabular-nums shrink-0">{money(Number(i.line_total_inc_gst))}</dd></div>
              ))}
              <div className="flex justify-between py-1.5"><dt>Estimated project total</dt><dd className="tabular-nums">{money(Number(quote.subtotal_inc_gst))}</dd></div>
              <div className="flex justify-between py-1.5"><dt>Estimated VEU / VEEC discount</dt><dd className="tabular-nums">−{money(Number(quote.veec_discount_inc_gst))}</dd></div>
              <div className="flex justify-between py-2 font-semibold"><dt>Estimated cost after discount</dt><dd className="tabular-nums">{money(Number(quote.customer_total_inc_gst))}</dd></div>
            </dl>
            {quote.discount_note && <p className="text-sm text-muted-foreground">{quote.discount_note}</p>}
            </div>
          {companions.map((c) => (
            <div key={c.id} className="rounded-md border p-3" data-testid="quote-option">
              <h4 className="mb-1 font-semibold">{c.label}</h4>
              {c.blockers.length > 0 && (
                <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
                  <p className="font-medium text-destructive">This option is held:</p>
                  <ul className="list-disc pl-5 text-destructive">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <dl className="divide-y text-sm">
                {c.items.map((i) => (
                  <div key={i.sort} className="flex justify-between gap-4 py-1.5"><dt className="min-w-0 whitespace-pre-line break-words">{i.description}<span className="block text-xs text-muted-foreground">{i.quantity} {i.unit} × {money(i.unit_price_inc_gst)}{i.explanation ? ` · ${i.explanation}` : ""}</span></dt><dd className="tabular-nums shrink-0">{money(i.line_total_inc_gst)}</dd></div>
                ))}
                <div className="flex justify-between py-1.5"><dt>Estimated project total</dt><dd className="tabular-nums">{money(c.subtotal)}</dd></div>
                <div className="flex justify-between py-1.5"><dt>Estimated VEU / VEEC discount</dt><dd className="tabular-nums">−{money(c.discount)}</dd></div>
                <div className="flex justify-between py-2 font-semibold"><dt>Estimated cost after discount</dt><dd className="tabular-nums">{money(c.total)}</dd></div>
              </dl>
              {c.discountNote && <p className="text-sm text-muted-foreground">{c.discountNote}</p>}
            </div>
          ))}
          </div>
          {d.reviewable ? (
            <div className="space-y-3">
              {companionHeld && d.heldBlockers.length === 0 && (
                <label className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={mainOnly} onChange={(e) => setMainOnly(e.target.checked)} />
                  <span>Send main only. The held option is not sent and stays held for the office.</span>
                </label>
              )}
              <div className="flex gap-2"><Button disabled={busy || editing || d.heldBlockers.length > 0 || (companionHeld && !mainOnly)} onClick={onSend}>{busy ? "Sending…" : companions.length === 0 ? "Send quote" : mainOnly ? "Send main only" : `Send all ${companions.length + 1} options together`}</Button><Button variant="outline" disabled={busy} onClick={() => { setEditing(!editing); setRebate(String(quote.veec_discount_inc_gst)); setLineEdits(Object.fromEntries(quote.quote_items.map(i => [i.id, { quantity: String(i.quantity), price: String(i.unit_price_inc_gst) }]))); }}>Adjust</Button></div>
              {editing && <form className="space-y-3" onSubmit={async e => { e.preventDefault(); const items = quote.quote_items.map(i => ({ id: i.id, quantity: Number(lineEdits[i.id]?.quantity), unit_price_inc_gst: Number(lineEdits[i.id]?.price) })); if (items.some(i => !Number.isFinite(i.quantity) || !Number.isFinite(i.unit_price_inc_gst) || i.quantity < 0 || i.unit_price_inc_gst < 0)) { toast.error("Enter valid quantities and prices."); return; } setBusy(true); try { await adjust({ data: { quoteId: quote.id, reason: reason.trim(), items, veecDiscount: Number(rebate) } }); await Promise.all([qc.invalidateQueries({ queryKey: ["installer-quote-draft", jobId] }), qc.invalidateQueries({ queryKey: ["installer-quotes-to-check"] })]); setEditing(false); setReason(""); toast.success("Quote adjusted — check it, then press Send."); } catch(e) { toast.error(e instanceof Error ? e.message : "Could not adjust quote"); } finally { setBusy(false); } }}>
                {quote.quote_items.map(i => <fieldset key={i.id} className="space-y-2 border-b pb-3"><legend className="text-sm font-semibold">{i.description}</legend><div className="grid grid-cols-2 gap-2"><label className="text-xs">Quantity<Input type="number" min="0" step="0.01" value={lineEdits[i.id]?.quantity ?? ""} onChange={e => setLineEdits(p => ({...p,[i.id]: {quantity:e.target.value,price:p[i.id]?.price ?? ""}}))} /></label><label className="text-xs">Unit price inc GST<Input type="number" min="0" step="0.01" value={lineEdits[i.id]?.price ?? ""} onChange={e => setLineEdits(p => ({...p,[i.id]: {quantity:p[i.id]?.quantity ?? "",price:e.target.value}}))} /></label></div></fieldset>)}
                <label className="block space-y-1 text-sm">VEU rebate inc GST<Input type="number" min="0" step="0.01" value={rebate} onChange={e => setRebate(e.target.value)} /></label>
                <label className="block space-y-1 text-sm">Reason<Textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
                <Button type="submit" disabled={busy || reason.trim().length < 5 || !rebate.trim() || !Number.isFinite(Number(rebate)) || Number(rebate) < 0}>Save adjustment</Button>
              </form>}
            </div>
          ) : (
            <p className="text-sm font-medium">{quote.status === "accepted" ? "Accepted by the owner." : "Sent to the owner."}</p>
          )}
        </>
      )}
    </section>
  );
}

// The office intake review panel (retired 4-step intake, decisions 34/185) was removed 24 Oct 2026 (audit removal 6).