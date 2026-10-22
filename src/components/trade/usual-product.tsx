import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveTradeUsualProduct } from "@/lib/trade-view.functions";
import { PRODUCT_BRANDS, PRODUCT_R_VALUES, type UsualProduct } from "@/lib/usual-product.core";
import { field, greenBtn } from "./business-pages";

export function UsualProductSettings({ saved, onSaved }: { saved: UsualProduct | null; onSaved: () => void }) {
  const save = useServerFn(saveTradeUsualProduct);
  const [brand, setBrand] = useState<string>(saved?.brand ?? "");
  const [brandOther, setBrandOther] = useState(saved?.brandOther ?? "");
  const [productName, setProductName] = useState(saved?.productName ?? "");
  const [rValue, setRValue] = useState<string>(saved?.rValue ?? "");
  const [busy, setBusy] = useState(false);
  const ok = !!brand && (brand !== "Other" || !!brandOther.trim()) && !!productName.trim() && !!rValue;
  return <section className="space-y-3">
    <h2 className="font-display text-xl font-bold">My usual product</h2>
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { await save({ data: { brand, brandOther: brand === "Other" ? brandOther : null, productName, rValue } }); toast.success("Usual product saved"); onSaved(); }
      catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); }
      finally { setBusy(false); }
    }}>
      <label className="block space-y-1 text-sm font-semibold">Brand
        <select className={field} value={brand} onChange={(e) => setBrand(e.target.value)} required disabled={busy}>
          <option value="" disabled>Choose a brand</option>
          {PRODUCT_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      {brand === "Other" && <label className="block space-y-1 text-sm font-semibold">Other brand<input className={field} value={brandOther} onChange={(e) => setBrandOther(e.target.value)} required maxLength={100} disabled={busy} autoComplete="off" /></label>}
      <label className="block space-y-1 text-sm font-semibold">Product name<input className={field} value={productName} onChange={(e) => setProductName(e.target.value)} required maxLength={200} disabled={busy} autoComplete="off" /></label>
      <label className="block space-y-1 text-sm font-semibold">R-value
        <select className={field} value={rValue} onChange={(e) => setRValue(e.target.value)} required disabled={busy}>
          <option value="" disabled>Choose R-value</option>
          {PRODUCT_R_VALUES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <Button type="submit" className={greenBtn} disabled={busy || !ok}>{busy ? "Saving…" : "Save product"}</Button>
    </form>
  </section>;
}
