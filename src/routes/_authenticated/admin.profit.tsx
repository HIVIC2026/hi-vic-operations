import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { fetchOnlineSpotPrice, getProfitRegister, recordSpotPrice } from "@/lib/profit.functions";
import { jobProfit, OWNER_VEEC_RATE, sellSignal } from "@/lib/profit.core";

export const Route = createFileRoute("/_authenticated/admin/profit")({
  head: () => ({ meta: [{ title: "Profit & VEEC Spot Price – HI VIC Portal" }, { name: "description", content: "Accepted-job profit and VEEC spot price history." }, { property: "og:title", content: "Profit & VEEC Spot Price – HI VIC Portal" }, { property: "og:description", content: "Accepted-job profit and VEEC spot price history." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ProfitPage,
});

const $ = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);

function ProfitPage() {
  const load = useServerFn(getProfitRegister);
  const { data, refetch, error } = useQuery({ queryKey: ["profit-register"], queryFn: () => load() });
  const save = useAction(recordSpotPrice);
  const fetchOnline = useAction(fetchOnlineSpotPrice);
  const [price, setPrice] = useState(""); const [on, setOn] = useState(new Date().toISOString().slice(0, 10)); const [source, setSource] = useState("");
  const spots = data?.spots ?? [];
  const signal = sellSignal(spots, new Date());
  const rows = (data?.rows ?? []).map((r) => ({ ...r, p: jobProfit({ customerTotalIncGst: r.customer, veecDiscountIncGst: r.discount, tradeCostExGst: r.cost }, signal.latest) }));
  const total = (k: "profit" | "veecMargin" | "veecs") => rows.reduce((t, r) => t + (r.p[k] ?? 0), 0);
  return <AppShell wide>
    <p className="text-xs font-bold uppercase text-primary">Admin only – never shown to owners or trades</p>
    <h1 className="mt-1 text-4xl font-bold">PROFIT</h1>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Accepted jobs only. Profit = customer price (ex GST) + VEEC margin − trade costs (ex GST). The owner receives ${OWNER_VEEC_RATE} per VEEC as their discount; HI VIC keeps the spot price minus ${OWNER_VEEC_RATE} on every VEEC.</p>
    {error && <p role="alert" className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">Profit figures could not be loaded.</p>}

    <section className="mt-6 grid gap-3 md:grid-cols-4">
      <div className={`rounded-md border p-4 ${signal.good ? "border-success bg-success-soft" : "bg-card"}`}>
        <div className="text-xs font-bold uppercase text-muted-foreground">VEEC spot price</div>
        <div className="mt-1 flex items-center gap-2 text-3xl font-bold">{$(signal.latest)}{signal.change != null && (signal.change >= 0 ? <TrendingUp className="h-5 w-5 text-success" /> : <TrendingDown className="h-5 w-5 text-danger" />)}</div>
        <div className="text-xs">90-day avg {signal.avg90 != null ? `$${signal.avg90.toFixed(2)}` : "—"}</div>
        <div className="mt-2"><Pill t={signal.good ? "good" : "neutral"}>{signal.good ? "GOOD TO SELL" : "HOLD / WATCH"}</Pill></div>
        <p className="mt-2 text-xs text-muted-foreground">{signal.reason}</p>
      </div>
      <Stat label="Estimated profit" value={$(total("profit"))} hint={`${rows.length} accepted jobs`} />
      <Stat label="VEECs held" value={total("veecs").toLocaleString("en-AU", { maximumFractionDigits: 1 })} hint="From accepted quotes" />
      <Stat label="VEEC margin (HI VIC keeps)" value={$(total("veecMargin"))} hint={`Spot − $${OWNER_VEEC_RATE} per VEEC`} />
    </section>

    <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted text-left text-xs uppercase"><tr><th className="p-3">Job</th><th className="p-3">Property</th><th className="p-3 text-right">Customer ex GST</th><th className="p-3 text-right">Trade cost ex GST</th><th className="p-3 text-right">VEECs</th><th className="p-3 text-right">VEEC margin</th><th className="p-3 text-right">Profit</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No accepted jobs yet.</td></tr> : rows.map((r) => <tr key={r.jobId} className="border-t">
            <td className="p-3 font-bold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-primary underline">{r.jobNumber ?? "—"}</Link></td>
            <td className="p-3">{r.address ?? "—"}</td>
            <td className="p-3 text-right">{$(r.p.customerExGst)}</td>
            <td className="p-3 text-right">{$(r.cost)}{r.costMissing && <div><Pill t="warn">Trade cost missing</Pill></div>}</td>
            <td className="p-3 text-right">{r.p.veecs.toFixed(1)}</td>
            <td className="p-3 text-right">{$(r.p.veecMargin)}</td>
            <td className={`p-3 text-right font-bold ${(r.p.profit ?? 0) < 0 ? "text-danger" : "text-success"}`}>{$(r.p.profit)}</td>
          </tr>)}</tbody></table>
      </div>
      <aside className="space-y-4">
        <div className="rounded-md border bg-card p-4">
          <h2 className="font-bold">Record today's spot price</h2>
          <Button className="mt-3 w-full" variant="secondary" onClick={async () => { await fetchOnline({}, "Online spot price saved"); await refetch(); }}>Update from online (Ecovantage)</Button>
          <p className="mt-2 text-xs text-muted-foreground">Reads the latest published VEEC market update. If the page can't be read, enter the price by hand below.</p>
          <div className="mt-3 grid gap-2"><div><Label>Price per VEEC ($)</Label><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div><div><Label>Date</Label><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div><div><Label>Source (e.g. broker, Ecovantage)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} /></div>
            <Button disabled={!(Number(price) > 0)} onClick={async () => { await save({ price: Number(price), pricedOn: on, source: source || undefined }, "Spot price saved"); setPrice(""); await refetch(); }}>Save spot price</Button></div>
        </div>
        <div className="rounded-md border bg-card p-4"><h2 className="font-bold">Spot price history</h2>{spots.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No prices recorded yet.</p> : <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm">{spots.map((s) => <li key={s.id} className="flex justify-between border-b py-1"><span>{s.priced_on}{s.source ? ` · ${s.source}` : ""}</span><b>${s.price.toFixed(2)}</b></li>)}</ul>}</div>
      </aside>
    </section>
  </AppShell>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-md border bg-card p-4"><div className="text-xs font-bold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{hint}</div></div>;
}
