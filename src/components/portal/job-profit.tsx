// Office-only per-job profit card. Rendered only on the office job page; never on owner or trade pages.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getJobProfit, setCurrentVeecPrice, setVeecSalePrice } from "@/lib/profit.functions";
import { useAction } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/portal/panels";

const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function OfficeJobProfitCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getJobProfit);
  const q = useQuery({ queryKey: ["job-profit", jobId], queryFn: () => load({ data: { jobId } }) });
  const setPrice = useAction(setCurrentVeecPrice);
  const setSale = useAction(setVeecSalePrice);
  const [price, setPriceInput] = useState("");
  const [sale, setSaleInput] = useState("");
  if (q.error) return <Section title="Profit (office only)"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Section>;
  if (!q.data) return null;
  const { expected: e, actual: a, hivJob } = q.data;
  const rows: [string, number | null, number | null][] = [
    ["Accredited Provider fee", e.apFeeInc, a.apFeeInc],
    [`VEEC spread (VEECs × (price − $70))`, e.veecSpread, a.veecSpread],
    ["PIESA markup (owner PIESA price − agreed rate)", e.piesaMarkupInc, a.piesaMarkupInc],
    [hivJob ? "Installer markup (owner price − installer rate)" : "Installer markup (none on installer-supplied jobs)", e.installerMarkupInc, a.installerMarkupInc],
  ];
  return (
    <Section title="Profit (office only)">
      <p className="mb-2 text-xs text-muted-foreground">Never shown to owners or trades. Area used: {e.areaBasis === "measured" ? "measured" : e.areaBasis === "estimate" ? "estimate (before Ready Check)" : "none yet"}{e.areaM2 ? ` · ${e.areaM2} m²` : ""} · VEECs {e.veecs ?? "—"}{a.veecs !== e.veecs ? ` (lodged ${a.veecs ?? "—"})` : ""}.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Item (inc GST)</th><th className="text-right">Expected</th><th className="text-right">Actual</th></tr></thead>
        <tbody>
          {rows.map(([l, x, y]) => <tr key={l} className="border-t"><td className="py-1">{l}</td><td className="text-right">{money(x)}</td><td className="text-right">{money(y)}</td></tr>)}
          <tr className="border-t font-semibold"><td className="py-1">Total inc GST</td><td className="text-right">{money(e.totalInc)}</td><td className="text-right">{money(a.totalInc)}</td></tr>
          <tr className="font-semibold"><td className="py-1">Total ex GST</td><td className="text-right">{money(e.totalEx)}</td><td className="text-right">{money(a.totalEx)}</td></tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted-foreground">VEEC price: expected ${e.veecPrice} (current setting) · actual ${a.veecPrice} ({a.veecPriceBasis}). The VEEC spread has no GST taken off.</p>
      {[...new Set([...e.notes, ...a.notes])].map((n) => <p key={n} className="text-xs text-danger">{n}</p>)}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="flex gap-2"><Input aria-label="Current VEEC price" inputMode="decimal" placeholder="Current VEEC price $" value={price} onChange={(ev) => setPriceInput(ev.target.value)} /><Button size="sm" disabled={!(Number(price) > 0)} onClick={async () => { await setPrice({ price: Number(price) }, "Current VEEC price saved"); setPriceInput(""); await q.refetch(); }}>Save price</Button></div>
        <div className="flex gap-2"><Input aria-label="Actual VEEC sale price" inputMode="decimal" placeholder="Actual sale price $" value={sale} onChange={(ev) => setSaleInput(ev.target.value)} /><Button size="sm" disabled={!(Number(sale) > 0)} onClick={async () => { await setSale({ jobId, price: Number(sale) }, "Sale price saved"); setSaleInput(""); await q.refetch(); }}>Record sale</Button></div>
      </div>
    </Section>
  );
}
