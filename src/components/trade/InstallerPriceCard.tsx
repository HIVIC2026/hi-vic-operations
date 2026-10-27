// Decision 278 (Jo 25 Oct 2026): "Your price" — the business owner's card on their own customer's job page. The price and
// what it includes are entered HERE, never in Mitti. The server returns null for team members, so the card (and every word
// about price) never renders for staff. Decision 289: the electrician was chosen once at Add a job and is shown read-only
// here — never asked again. Decision 290 (corrected): the Ready Check's access rating and issue notes show as the flag;
// the boss prices any difficult access themselves. The boss's text (decision 288) deep-links to `#price`.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { getInstallerPriceFn, setInstallerPriceFn } from "@/lib/installer-price.functions";
import { PRICE_INCLUDED_OPTIONS, PRICE_ISSUES, accessFlagLine, priceCardLines, validateInstallerPrice } from "@/lib/installer-price.core";
const REMOVAL_OPTION = PRICE_INCLUDED_OPTIONS[1]; // "Removal of existing insulation"
import { PRICE_CARD_ANCHOR } from "@/lib/boss-price-link.core";
import { LinkRow, Note, PrimaryButton, Row } from "@/components/trade/installer-kit";

export function InstallerPriceCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({ queryKey: ["installer-price", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const save = useAction(setInstallerPriceFn);
  const view = q.data;
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [included, setIncluded] = useState<string[]>([PRICE_INCLUDED_OPTIONS[0]]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  // Jo 27 Oct 2026: when the Ready Check positively says there is no removal, the removal tick stays unticked and can't
  // be ticked; tapping it shows the reason under it.
  const removalBlocked = view?.removalRequired === false;
  const [removalNote, setRemovalNote] = useState(false);
  useEffect(() => {
    const cur = view?.current?.record;
    if (!cur) return;
    setPrice(String(cur.price_inc_gst)); setIncluded(removalBlocked ? cur.included.filter((x) => x !== REMOVAL_OPTION) : cur.included); setOther(cur.included_other ?? "");
  }, [view?.current?.setAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view?.canSet) return null;
  const current = view.current?.record ?? null;
  const lines = current ? priceCardLines(current) : null;
  const access = accessFlagLine(view.access);
  const check = validateInstallerPrice({ priceIncGst: price, included, includedOther: other, removalRequired: view.removalRequired });
  const showForm = editing || !current;
  const toggle = (o: string) => {
    if (o === REMOVAL_OPTION && removalBlocked) { setRemovalNote(true); return; }
    setIncluded((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  };
  return (
    <div id={PRICE_CARD_ANCHOR} data-installer-price className="mt-1.5 scroll-mt-4 border-t border-line pt-1.5">
      <p className="text-[13px] font-bold uppercase tracking-[1.1px] text-hiv-blue">Your price</p>
      {access && <Row label="Ready Check" value={access} />}
      <Row label="Electrical safety check" value={view.electrician} last={!lines || showForm} />
      {lines && !showForm && (
        <>
          <Row label="Price" value={lines.price} tone="bold" />
          <Row label="Includes" value={lines.included} last />
          <LinkRow onClick={() => setEditing(true)}>Change your price</LinkRow>
        </>
      )}
      {showForm && (
        <form className="space-y-3 py-2" onSubmit={async (e) => { e.preventDefault(); if (!check.ok) return; setBusy(true); try { const r = await save({ jobId, priceIncGst: price, included, includedOther: other || null }, "Price saved"); if (r) { setEditing(false); await q.refetch(); } } finally { setBusy(false); } }}>
          <Note className="mt-0">Only you see and set this. We add the $349 Accredited Person fee and the electrical safety check, take off the rebate and prepare {" "}the owner's quote.{access ? " Any difficult access is yours to price in." : ""}</Note>
          <div><Label htmlFor="ip-price">Your price to the owner (inc GST)</Label><Input id="ip-price" inputMode="decimal" placeholder="e.g. 2400" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <fieldset>
            <legend className="text-sm font-medium">What's included</legend>
            {PRICE_INCLUDED_OPTIONS.map((o) => (
              <Fragment key={o}>
                <label className="flex min-h-10 items-center gap-2.5 text-[15px]"><input type="checkbox" checked={included.includes(o)} onChange={() => toggle(o)} />{o}</label>
                {o === REMOVAL_OPTION && removalBlocked && removalNote && <p data-removal-note className="pb-1 pl-7 text-sm text-rose">{PRICE_ISSUES.noRemoval}</p>}
              </Fragment>
            ))}
            {included.includes("Other") && <Input aria-label="What else is included?" placeholder="What else is included?" value={other} onChange={(e) => setOther(e.target.value)} />}
          </fieldset>
          {!check.ok && price && <ul data-price-issues className="space-y-1 text-sm text-rose">{check.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={busy || !check.ok}>{busy ? "Saving…" : current ? "Save new price" : "Save price"}</PrimaryButton>
            {current && <button type="button" className="min-h-11 px-4 text-[15px] font-semibold text-sub" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      )}
    </div>
  );
}
