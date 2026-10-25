// Decision 278 (Jo 25 Oct 2026): "Your price" — the business owner's card on their own customer's job page. The price,
// what it includes and who does the electrical safety check are entered HERE, never in Mitti. The server returns null for
// team members, so the card (and every word about price) never renders for staff.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { getInstallerPriceFn, setInstallerPriceFn } from "@/lib/installer-price.functions";
import { ELECTRICIAN_CHOICE_LABEL, PRICE_INCLUDED_OPTIONS, priceCardLines, validateInstallerPrice, type PriceElectricianChoice } from "@/lib/installer-price.core";
import { LinkRow, Note, PrimaryButton, Row } from "@/components/trade/installer-kit";

export function InstallerPriceCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerPriceFn);
  const q = useQuery({ queryKey: ["installer-price", jobId], queryFn: () => load({ data: { jobId } }) });
  const save = useAction(setInstallerPriceFn);
  const view = q.data;
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [included, setIncluded] = useState<string[]>([PRICE_INCLUDED_OPTIONS[0]]);
  const [other, setOther] = useState("");
  const [electrician, setElectrician] = useState<PriceElectricianChoice | null>(null);
  const [diff, setDiff] = useState({ name: "", licence: "", priceIncGst: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const cur = view?.current?.record;
    if (!cur) return;
    setPrice(String(cur.price_inc_gst)); setIncluded(cur.included); setOther(cur.included_other ?? ""); setElectrician(cur.electrician.choice);
    if (cur.electrician.choice === "different") setDiff({ name: cur.electrician.name ?? "", licence: cur.electrician.licence ?? "", priceIncGst: cur.electrician.price_inc_gst == null ? "" : String(cur.electrician.price_inc_gst) });
  }, [view?.current?.setAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view?.canSet) return null;
  const current = view.current?.record ?? null;
  const lines = current ? priceCardLines(current) : null;
  const check = validateInstallerPrice({ priceIncGst: price, included, includedOther: other, electrician, different: diff }, { usualElectrician: view.usualElectrician });
  const showForm = editing || !current;
  const toggle = (o: string) => setIncluded((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  return (
    <div data-installer-price className="mt-1.5 border-t border-line pt-1.5">
      <p className="text-[13px] font-bold uppercase tracking-[1.1px] text-hiv-blue">Your price</p>
      {lines && !showForm && (
        <>
          <Row label="Price" value={lines.price} tone="bold" />
          <Row label="Includes" value={lines.included} />
          <Row label="Electrical safety check" value={lines.electrician} last />
          <LinkRow onClick={() => setEditing(true)}>Change your price</LinkRow>
        </>
      )}
      {showForm && (
        <form className="space-y-3 py-2" onSubmit={async (e) => { e.preventDefault(); if (!check.ok) return; setBusy(true); try { const r = await save({ jobId, priceIncGst: price, included, includedOther: other || null, electrician, different: electrician === "different" ? diff : null }, "Price saved"); if (r) { setEditing(false); await q.refetch(); } } finally { setBusy(false); } }}>
          <Note className="mt-0">Only you see and set this. We add the $349 Accredited Provider fee and the electrical safety check, take off the rebate and prepare {" "}the owner's quote.</Note>
          <div><Label htmlFor="ip-price">Your price to the owner (inc GST)</Label><Input id="ip-price" inputMode="decimal" placeholder="e.g. 2400" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <fieldset>
            <legend className="text-sm font-medium">What's included</legend>
            {PRICE_INCLUDED_OPTIONS.map((o) => (
              <label key={o} className="flex min-h-10 items-center gap-2.5 text-[15px]"><input type="checkbox" checked={included.includes(o)} onChange={() => toggle(o)} />{o}</label>
            ))}
            {included.includes("Other") && <Input aria-label="What else is included?" placeholder="What else is included?" value={other} onChange={(e) => setOther(e.target.value)} />}
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Who is doing the electrical safety check?</legend>
            {(Object.keys(ELECTRICIAN_CHOICE_LABEL) as PriceElectricianChoice[]).map((k) => (
              <label key={k} className="flex min-h-10 items-center gap-2.5 text-[15px]"><input type="radio" name="ip-electrician" checked={electrician === k} onChange={() => setElectrician(k)} />{ELECTRICIAN_CHOICE_LABEL[k]}{k === "usual" && view.usualElectrician ? <span className="text-sub"> · {view.usualElectrician.name}</span> : null}</label>
            ))}
            {electrician === "different" && (
              <div className="grid gap-2">
                <Input aria-label="Electrician name" placeholder="Electrician name" value={diff.name} onChange={(e) => setDiff({ ...diff, name: e.target.value })} />
                <Input aria-label="Electrician licence number" placeholder="Electrician licence number" value={diff.licence} onChange={(e) => setDiff({ ...diff, licence: e.target.value })} />
                <Input aria-label="Electrician price (inc GST)" inputMode="decimal" placeholder="Electrician price (inc GST)" value={diff.priceIncGst} onChange={(e) => setDiff({ ...diff, priceIncGst: e.target.value })} />
              </div>
            )}
          </fieldset>
          {!check.ok && (price || electrician) && <ul data-price-issues className="space-y-1 text-sm text-rose">{check.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={busy || !check.ok}>{busy ? "Saving…" : current ? "Save new price" : "Save price"}</PrimaryButton>
            {current && <button type="button" className="min-h-11 px-4 text-[15px] font-semibold text-sub" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      )}
    </div>
  );
}
