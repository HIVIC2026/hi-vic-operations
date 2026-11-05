// Photo-quote installers Part 2 (Jo 5 Nov 2026): the extra Add a job fields for a "From photos" installer — the photo quote
// (under R2, sqm to remove, sqm to install, product), the installer's price, and the live quote worked out by the server
// with the SAME builder the owner's quote uses (own-photo-quote.core). Shown only for From photos businesses.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ownPhotoQuotePreview } from "@/lib/onsite-ready-check.functions";
import { APPROVED_PRODUCTS } from "@/lib/insulation-product.core";
import { PHOTO_QUOTE_WORDS } from "@/lib/photo-quote.core";
import { OWN_PHOTO_QUOTE_WORDS, money, type OwnPhotoPreview, type OwnPhotoQuoteInput } from "@/lib/own-photo-quote.core";
import { inputCls } from "@/components/trade/TradeShell";
import { PRICE_INCLUDED_OPTIONS } from "@/lib/installer-price.core";

const num = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function OwnPhotoQuoteFields({ businessId, postcode, disabled, onChange }: { businessId: string; postcode: string; disabled: boolean; onChange: (v: OwnPhotoQuoteInput) => void }) {
  const preview = useServerFn(ownPhotoQuotePreview);
  const [underR2, setUnderR2] = useState<boolean | null>(null);
  const [removeM2, setRemove] = useState("");
  const [installM2, setInstall] = useState("");
  const [product, setProduct] = useState("");
  const [price, setPrice] = useState("");
  // Jo 5 Nov 16:44: the SAME "What's included" ticks as the Your price card (base ticked to start, as there).
  const [included, setIncluded] = useState<string[]>([PRICE_INCLUDED_OPTIONS[0]]);
  const [other, setOther] = useState("");
  const toggle = (o: string) => setIncluded((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  const [box, setBox] = useState<OwnPhotoPreview | null>(null);
  const value: OwnPhotoQuoteInput = { underR2, removeM2: num(removeM2), installM2: num(installM2), product: product || null, priceIncGst: num(price), included, includedOther: included.includes("Other") ? other.trim() || null : null };
  useEffect(() => { onChange(value); }, [underR2, removeM2, installM2, product, price, included, other]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = num(price), m = num(installM2);
    if (!(p && p > 0 && m && m > 0 && postcode.trim())) { setBox(null); return; }
    const t = setTimeout(() => {
      void preview({ data: { businessId, priceIncGst: p, installM2: m, removeM2: num(removeM2), postcode, product: product || null, included, includedOther: value.includedOther } }).then(setBox).catch(() => setBox(null));
    }, 400);
    return () => clearTimeout(t);
  }, [price, installM2, removeM2, postcode, product, businessId, included, other]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="space-y-3 rounded-[18px] bg-mist p-4" data-own-photo-quote>
      <h2 className="font-display text-[17px] font-bold text-ink">{PHOTO_QUOTE_WORDS.boxTitle}</h2>
      <fieldset>
        <legend className="text-[15px] font-bold">{PHOTO_QUOTE_WORDS.fields.underR2}</legend>
        <div className="mt-1 flex gap-4">
          {([[true, "Yes"], [false, "No"]] as const).map(([v, l]) => (
            <label key={l} className="flex min-h-12 items-center gap-2 text-[15px]"><input type="radio" name="own-photo-under-r2" checked={underR2 === v} disabled={disabled} onChange={() => setUnderR2(v)} />{l}</label>
          ))}
        </div>
      </fieldset>
      <label className="block text-[15px] font-bold">{PHOTO_QUOTE_WORDS.fields.removeM2}<input className={`${inputCls} mt-1`} inputMode="decimal" value={removeM2} disabled={disabled} onChange={(e) => setRemove(e.target.value)} /></label>
      <label className="block text-[15px] font-bold">{PHOTO_QUOTE_WORDS.fields.installM2}<input className={`${inputCls} mt-1`} inputMode="decimal" value={installM2} disabled={disabled} onChange={(e) => setInstall(e.target.value)} /></label>
      <label className="block text-[15px] font-bold">{PHOTO_QUOTE_WORDS.fields.product}
        <select className={`${inputCls} mt-1`} value={product} disabled={disabled} onChange={(e) => setProduct(e.target.value)}>
          <option value="">Pick one</option>
          {APPROVED_PRODUCTS.map((p) => <option key={p.option} value={p.option}>{p.option}</option>)}
        </select>
      </label>
      <label className="block text-[15px] font-bold">{OWN_PHOTO_QUOTE_WORDS.price}<input className={`${inputCls} mt-1`} inputMode="decimal" value={price} disabled={disabled} onChange={(e) => setPrice(e.target.value)} /></label>
      <fieldset>
        <legend className="text-[15px] font-bold">What's included</legend>
        {PRICE_INCLUDED_OPTIONS.map((o) => (
          <label key={o} className="flex min-h-12 items-center gap-2.5 text-[15px]"><input type="checkbox" checked={included.includes(o)} disabled={disabled} onChange={() => toggle(o)} />{o}</label>
        ))}
        {included.includes("Other") && <input className={inputCls} aria-label="What else is included?" placeholder="What else is included?" value={other} disabled={disabled} onChange={(e) => setOther(e.target.value)} />}
      </fieldset>
      {box && ("held" in box ? <p className="text-sm text-sub" data-own-quote-held>{box.held}</p> : (
        <div className="rounded-[12px] bg-paper p-3 text-[15px]" data-own-quote-preview>
          {box.lines.map((l) => <p key={l.label} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{l.amount < 0 ? "−" : ""}{money(Math.abs(l.amount))}</span></p>)}
          <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-bold"><span>{OWN_PHOTO_QUOTE_WORDS.ownerPays}</span><span className="tabular-nums">{money(box.ownerPays)}</span></p>
          <p className="mt-2 text-[13px] text-sub">{box.feesLine}</p>
        </div>
      ))}
    </section>
  );
}
