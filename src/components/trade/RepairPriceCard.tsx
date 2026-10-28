// Task 9 (Jo 28 Oct 2026, spec rule 3): "Your price" for the electrical repair work — on the electrician job page for the
// owner of the electrician business, and on the office job page. The server returns null for electrician staff, so the
// card (and every word about price) never renders for them. The ticked work list from the A3 is shown read-only; the
// owner enters ONE total inc GST, and prices any "Other" item still waiting after the PIESA is complete. The text link
// opens on `#price`. Presentation only: reads and saves through electrician-repair-price.functions.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, Section } from "@/components/trade/trade-ui";
import { PriceItemForm } from "@/components/portal/mitti";
import { useAction } from "@/hooks/use-me";
import { getRepairPriceFn, setRepairPriceFn } from "@/lib/electrician-repair-price.functions";
import { REPAIR_PRICE_CARD, validateRepairPrice } from "@/lib/electrician-repair-price.core";
import { PRICE_CARD_ANCHOR } from "@/lib/boss-price-link.core";

const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function RepairPriceCard({ jobId, office = false }: { jobId: string; office?: boolean }) {
  const load = useServerFn(getRepairPriceFn);
  const q = useQuery({ queryKey: ["repair-price", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const save = useAction(setRepairPriceFn);
  const view = q.data;
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (view?.current) setPrice(String(view.current.priceIncGst)); }, [view?.current?.setAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // The text link opens on this card: scroll to it once it has drawn.
  useEffect(() => {
    if (!view || typeof window === "undefined" || window.location.hash !== `#${PRICE_CARD_ANCHOR}`) return;
    document.getElementById(PRICE_CARD_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [!!view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null;
  const check = validateRepairPrice(price);
  const showForm = view.canSet && (editing || !view.current);
  return (
    <div id={PRICE_CARD_ANCHOR} className="scroll-mt-4" data-repair-price>
      <Section title={office ? REPAIR_PRICE_CARD.officeTitle : REPAIR_PRICE_CARD.title}>
        <p className="text-sm font-medium">{REPAIR_PRICE_CARD.listHeading}</p>
        {view.workList.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{view.workList.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="mt-1 text-sm text-sub">{view.workIssue ?? "No work listed."}</p>}
        {view.current && !showForm && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-lg font-semibold">{REPAIR_PRICE_CARD.yourPrice} {aud(view.current.priceIncGst)}{view.canSet && <> — <button type="button" className="text-base font-semibold text-hiv-blue" onClick={() => setEditing(true)}>{REPAIR_PRICE_CARD.change}</button></>}</p>
          </div>
        )}
        {!view.current && view.formPrice != null && !showForm && <p className="mt-3 text-sm">Price on the form: {aud(view.formPrice)} inc GST</p>}
        {showForm && (
          <form className="mt-3 space-y-2 border-t border-line pt-3" onSubmit={async (e) => {
            e.preventDefault(); if (!check.ok) return; setBusy(true);
            try { const r = await save({ jobId, priceIncGst: price }, "Price saved"); if (r) { setEditing(false); await q.refetch(); } } finally { setBusy(false); }
          }}>
            <Label htmlFor="rp-price">{REPAIR_PRICE_CARD.priceLabel}</Label>
            <Input id="rp-price" inputMode="decimal" placeholder={view.formPrice != null ? String(view.formPrice) : "e.g. 1200"} value={price} onChange={(e) => setPrice(e.target.value)} />
            {!check.ok && price && <p className="text-sm text-rose">{check.issue}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="field" disabled={busy || !check.ok}>{busy ? "Saving…" : REPAIR_PRICE_CARD.saveButton}</Button>
              {view.current && <button type="button" className="min-h-11 px-4 text-[15px] font-semibold text-sub" onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          </form>
        )}
        {view.lockedReason && <p className="mt-3 text-sm text-sub">{view.lockedReason}</p>}
        {view.unpricedItems.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-sm font-medium">{REPAIR_PRICE_CARD.extrasHeading}</p>
            <ul className="mt-1 space-y-2 text-sm">{view.unpricedItems.map((i) => <li key={i.id}>{i.description} × {i.quantity}<PriceItemForm itemId={i.id} /></li>)}</ul>
          </div>
        )}
      </Section>
    </div>
  );
}
