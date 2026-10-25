import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveTradeUsualElectrician } from "@/lib/trade-view.functions";
import type { UsualElectrician } from "@/lib/usual-electrician.core";
import { field, greenBtn } from "./business-pages";

export function UsualElectricianSettings({ saved, onSaved }: { saved: UsualElectrician | null; onSaved: () => void }) {
  const save = useServerFn(saveTradeUsualElectrician);
  const [name, setName] = useState(saved?.name ?? "");
  const [licence, setLicence] = useState(saved?.licence ?? "");
  const [price, setPrice] = useState(saved ? String(saved.priceIncGst) : "");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [busy, setBusy] = useState(false);
  return <section className="space-y-3">
    <h2 className="font-display text-xl font-bold">My usual electrician</h2>
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { await save({ data: { name, licence, priceIncGst: Number(price), email: email.trim() || null, phone: phone.trim() || null } }); toast.success("Usual electrician saved"); onSaved(); }
      catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); }
      finally { setBusy(false); }
    }}>
      <label className="block space-y-1 text-sm font-semibold">Electrician name<input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} disabled={busy} autoComplete="off" /></label>
      <label className="block space-y-1 text-sm font-semibold">Electrician licence number<input className={field} value={licence} onChange={(e) => setLicence(e.target.value)} required maxLength={100} disabled={busy} autoComplete="off" /></label>
      <label className="block space-y-1 text-sm font-semibold">Electrician price (inc GST)<input className={field} type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required disabled={busy} /></label>
      <label className="block space-y-1 text-sm font-semibold">Electrician email<input className={field} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} disabled={busy} autoComplete="off" /><span className="block text-xs font-normal text-estimate-sub">If they're not signed up with us yet, we email them once to onboard — your quotes wait until they are.</span></label>
      <label className="block space-y-1 text-sm font-semibold">Electrician mobile (optional)<input className={field} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} disabled={busy} autoComplete="off" /></label>
      <Button type="submit" className={greenBtn} disabled={busy || !name.trim() || !licence.trim() || !price.trim()}>{busy ? "Saving…" : "Save electrician"}</Button>
    </form>
  </section>;
}