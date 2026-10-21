import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { fetchOnlineSpotPrice, getProfitRegister, recordSpotPrice } from "@/lib/profit.functions";
import { getVeecRegister, type VeecRow } from "@/lib/veec-register.functions";
import { OWNER_VEEC_RATE, jobMargin, sellSignal } from "@/lib/profit.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/admin/veec")({
  head: () => ({ meta: [{ title: "VEECs – Home Insulation Victoria Portal" }, { name: "description", content: "VEECs bought at $70, spot price, and sale value per accepted job." }, { property: "og:title", content: "VEECs – Home Insulation Victoria Portal" }, { property: "og:description", content: "VEECs bought at $70, spot price, and sale value per accepted job." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: VeecPage,
});

const BUCKETS = [
  ["outstanding", "Outstanding", "Quote accepted – VEECs to lodge once the job is complete"],
  ["pending_acceptance", "Pending quote acceptance", "Quote sent – waiting for the owner's approval"],
  ["potential", "Potential if job proceeds", "No quote yet – preliminary estimate only"],
  ["lodged", "Lodged / complete", "Submitted to the registry or job complete"],
] as const;
const PAID = { paid: ["good", "Paid"], part_paid: ["warn", "Part paid"], unpaid: ["bad", "Unpaid"], no_invoice: ["neutral", "No invoice yet"] } as const;
const n = (v: number) => v.toLocaleString("en-AU", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`);

function VeecPage() {
  const loadRegister = useServerFn(getVeecRegister);
  const loadProfit = useServerFn(getProfitRegister);
  const { data = [], isPending, error } = useQuery({ queryKey: ["veec-register"], queryFn: () => loadRegister() });
  const { data: profit, refetch: refetchProfit } = useQuery({ queryKey: ["profit-register"], queryFn: () => loadProfit() });
  const save = useAction(recordSpotPrice);
  const fetchOnline = useAction(fetchOnlineSpotPrice);
  const autoFetch = useServerFn(fetchOnlineSpotPrice);
  const [bucket, setBucket] = useState<VeecRow["bucket"]>("outstanding");
  const [paid, setPaid] = useState<"all" | VeecRow["paid"]>("all");
  const [price, setPrice] = useState(""); const [on, setOn] = useState(melbourneToday()); const [source, setSource] = useState("");
  const spots = profit?.spots ?? [];
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    if (!profit || autoTried) return;
    setAutoTried(true);
    const today = melbourneToday();
    const hasToday = spots.some((s: { priced_on?: string; created_at?: string }) => (s.created_at ?? s.priced_on ?? "").slice(0, 10) === today);
    if (!hasToday) autoFetch().then(() => refetchProfit()).catch(() => {});
  }, [profit, autoTried, autoFetch, refetchProfit, spots]);
  const signal = sellSignal(spots, new Date());
  const spot = signal.latest;
  const sum = (rows: VeecRow[]) => rows.reduce((t, r) => t + (r.veecs ?? 0), 0);
  const rows = data.filter((r) => r.bucket === bucket && (paid === "all" || r.paid === paid));
  const confirmed = data.filter((r) => r.quoteState === "accepted");
  const pending = data.filter((r) => r.quoteState === "issued");
  const spotValue = (veecs: number) => (spot != null ? money(veecs * spot) : "—");
  const keeps = (veecs: number) => (spot != null ? money(veecs * (spot - OWNER_VEEC_RATE)) : "—");
  return <AppShell wide>
    <p className="text-xs font-bold uppercase text-primary">Admin only – never shown to owners or trades</p>
    <h1 className="mt-1 text-4xl font-bold">VEECs</h1>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">The owner receives ${OWNER_VEEC_RATE} per VEEC as their discount; Home Insulation Victoria keeps the spot price minus ${OWNER_VEEC_RATE} on every VEEC. VEEC numbers are estimates (VEU discount ÷ ${OWNER_VEEC_RATE}) until a lodged quantity is recorded. Read-only – nothing is lodged or sent from here.</p>
    {error && <p role="alert" className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">The VEEC register could not be loaded.</p>}

    <section className="mt-6 grid gap-3 lg:grid-cols-3">
      <div className={`rounded-md border p-4 ${signal.good ? "border-success bg-success-soft" : "bg-card"}`}>
        <div className="text-xs font-bold uppercase text-muted-foreground">VEEC spot price</div>
        <div className="mt-1 flex items-center gap-2 text-3xl font-bold">{spot != null ? `$${spot.toFixed(2)}` : "—"}{signal.change != null && (signal.change >= 0 ? <TrendingUp className="h-5 w-5 text-success" /> : <TrendingDown className="h-5 w-5 text-danger" />)}</div>
        <div className="text-xs">90-day avg {signal.avg90 != null ? `$${signal.avg90.toFixed(2)}` : "—"}</div>
        <div className="mt-2"><Pill t={signal.good ? "good" : "neutral"}>{signal.good ? "GOOD TO SELL" : "HOLD / WATCH"}</Pill></div>
        <p className="mt-2 text-xs text-muted-foreground">{signal.reason}</p>
      </div>
      <div className="rounded-md border border-workspace-blush-strong bg-workspace-blush p-4 shadow-sm">
        <div className="text-xs font-bold uppercase text-muted-foreground">Confirmed jobs – VEEC value</div>
        <div className="mt-1 text-4xl font-bold">{spotValue(sum(confirmed))}</div>
        <div className="mt-1 text-sm font-semibold">{confirmed.length} accepted {confirmed.length === 1 ? "job" : "jobs"} · {n(sum(confirmed))} VEECs</div>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>Bought at ${OWNER_VEEC_RATE} (paid to owners): {money(sum(confirmed) * OWNER_VEEC_RATE)}</div>
          <div>If sold at spot, Home Insulation Victoria keeps: <b>{keeps(sum(confirmed))}</b></div>
        </div>
      </div>
      <div className="rounded-md border bg-card p-4">
        <div className="text-xs font-bold uppercase text-muted-foreground">Pending quote acceptance – VEEC value</div>
        <div className="mt-1 text-4xl font-bold">{spotValue(sum(pending))}</div>
        <div className="mt-1 text-sm font-semibold">{pending.length} {pending.length === 1 ? "job" : "jobs"} awaiting acceptance · {n(sum(pending))} VEECs</div>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>Not yet accepted – value only if the owner proceeds</div>
          <div>If accepted and sold at spot, Home Insulation Victoria keeps: {keeps(sum(pending))}</div>
        </div>
      </div>
    </section>

    <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{BUCKETS.map(([key, label, hint]) => {
      const b = data.filter((r) => r.bucket === key);
      return <button key={key} type="button" onClick={() => setBucket(key)} className={`rounded-md border p-4 text-left transition hover:border-primary ${bucket === key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card"}`}>
        <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-bold">{n(sum(b))} <span className="text-base font-semibold">VEECs</span></div>
        <div className="mt-1 text-sm">{b.length} jobs</div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </button>;
    })}</section>

    <div className="mt-5 flex flex-wrap gap-2">{(["all", "paid", "part_paid", "unpaid", "no_invoice"] as const).map((p) => <button key={p} type="button" onClick={() => setPaid(p)} className={`rounded-full border px-3 py-1 text-xs font-bold ${paid === p ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{p === "all" ? "All" : PAID[p][1]}</button>)}</div>

    <section className="mt-4 grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted text-left text-xs uppercase"><tr><th className="p-3">Job</th><th className="p-3">Property</th><th className="p-3 text-right">VEECs</th><th className="p-3 text-right">Bought @ $70</th><th className="p-3 text-right">If sold at spot</th><th className="p-3 text-right">Home Insulation Victoria keeps</th><th className="p-3">Payment</th></tr></thead>
          <tbody>{isPending ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No jobs in this view.</td></tr> : rows.map((r) => {
            const v = r.veecs ?? 0;
            return <tr key={r.jobId} className="border-t">
              <td className="p-3 font-bold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-primary underline">{r.jobNumber ?? "—"}</Link><div className="text-xs font-normal text-muted-foreground">{r.owner ?? ""}</div></td>
              <td className="p-3">{r.address ?? "—"}</td>
              <td className="p-3 text-right font-bold">{r.veecs != null ? n(v) : "—"}</td>
              <td className="p-3 text-right">{r.veecs != null ? money(v * OWNER_VEEC_RATE) : "—"}</td>
              <td className="p-3 text-right">{r.veecs != null && spot != null ? money(v * spot) : "—"}</td>
              <td className={`p-3 text-right font-bold ${spot != null && spot - OWNER_VEEC_RATE < 0 ? "text-danger" : "text-success"}`}>{r.veecs != null && spot != null ? money(v * (spot - OWNER_VEEC_RATE)) : "—"}</td>
              <td className="p-3"><Pill t={PAID[r.paid][0]}>{PAID[r.paid][1]}</Pill></td>
            </tr>;
          })}</tbody></table>
      </div>
      <aside className="space-y-4">
        <div className="rounded-md border bg-card p-4">
          <h2 className="font-bold">Record today's spot price</h2>
          <Button className="mt-3 w-full" variant="secondary" onClick={async () => { await fetchOnline(undefined, "Online spot price saved"); await refetchProfit(); }}>Update from online (Ecovantage)</Button>
          <p className="mt-2 text-xs text-muted-foreground">Reads the latest published VEEC market update. If the page can't be read, enter the price by hand below.</p>
          <div className="mt-3 grid gap-2"><div><Label>Price per VEEC ($)</Label><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div><div><Label>Date</Label><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div><div><Label>Source (e.g. broker, Ecovantage)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} /></div>
            <Button disabled={!(Number(price) > 0)} onClick={async () => { await save({ price: Number(price), pricedOn: on, source: source || undefined }, "Spot price saved"); setPrice(""); await refetchProfit(); }}>Save spot price</Button></div>
        </div>
        <div className="rounded-md border bg-card p-4"><h2 className="font-bold">Spot price history</h2>{spots.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No prices recorded yet.</p> : <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm">{spots.map((s) => <li key={s.id} className="flex justify-between border-b py-1"><span>{s.priced_on}{s.source ? ` · ${s.source}` : ""}</span><b>${s.price.toFixed(2)}</b></li>)}</ul>}</div>
      </aside>
    </section>

    {profit && <section className="mt-10">
      <h2 className="text-2xl font-bold">Markup by job – accepted jobs</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">What Home Insulation Victoria charges versus what we pay each trade. Installer work is marked up and carries the Accredited Person fee. The owner is charged the standard $349 electrical assessment fee while the REC is paid its agreed supplier rate. Home Insulation Victoria does not charge installers or electricians a lead fee.</p>
      {profit.rows.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No accepted jobs yet — this table fills in as quotes are accepted.</p> : <>
      <div className="mt-3 overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted text-left text-xs uppercase">
          <tr><th className="p-3" rowSpan={2}>Job</th><th className="border-b p-3 text-center" colSpan={3}>Installer</th><th className="border-b p-3 text-center" colSpan={3}>Electrician (electrical fixes)</th><th className="border-b p-3 text-center" colSpan={2}>Electrical assessment ($349 inc GST)</th><th className="p-3 text-right" rowSpan={2}>VEEC margin</th><th className="p-3 text-right" rowSpan={2}>Home Insulation Victoria profit</th></tr>
          <tr><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Charged</th><th className="p-3 text-right">Markup</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Charged</th><th className="p-3 text-right">Markup</th><th className="p-3 text-right">Charged (ex GST)</th><th className="p-3 text-right">REC paid</th></tr>
        </thead>
          <tbody>{profit.rows.map((r) => {
            const m = jobMargin({ installerCostExGst: r.installerCost, installerMarginExGst: r.installerMargin, apFeeExGst: r.apFee, electricalCostExGst: r.electricalCost, electricalChargeExGst: r.electricalChargeEx, installerSourced: r.installerSourced, installerLed: r.installerLed, veecDiscountIncGst: r.discount, veecCount: r.veecCount, piesaRecCostExGst: r.piesaCostEx, veecLodgementFeeExGst: r.lodgementFeeExGst }, spot);
            return <tr key={r.jobId} className="border-t">
              <td className="p-3 font-bold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="text-primary underline">{r.jobNumber ?? "—"}</Link><div className="text-xs font-normal text-muted-foreground">{r.owner ?? ""}</div></td>
              <td className="p-3 text-right">{r.costMissing ? "—" : money(r.installerCost)}</td>
              <td className="p-3 text-right">{r.costMissing ? "—" : money(m.installerChargedEx)}</td>
              <td className="p-3 text-right font-semibold">{r.costMissing ? "—" : money(m.installerMarkup)}</td>
              <td className="p-3 text-right">{r.electricalChargeEx > 0 || r.electricalCost > 0 ? money(r.electricalCost) : "—"}</td>
              <td className="p-3 text-right">{r.electricalChargeEx > 0 || r.electricalCost > 0 ? money(r.electricalChargeEx) : "—"}</td>
              <td className="p-3 text-right font-semibold">{r.electricalChargeEx > 0 || r.electricalCost > 0 ? money(m.electricalMarkup) : "—"}</td>
              <td className="p-3 text-right">{r.costMissing ? "—" : money(m.piesaChargeEx)}</td>
              <td className={`p-3 text-right ${r.piesaCostMissing ? "text-danger" : ""}`}>{r.costMissing ? "—" : m.piesaRecPaidEx != null ? money(m.piesaRecPaidEx) : "not set"}</td>
              <td className="p-3 text-right">{m.veecMargin != null ? money(m.veecMargin) : "—"}</td>
              <td className={`p-3 text-right font-bold ${m.profit != null && m.profit < 0 ? "text-danger" : "text-success"}`}>{m.profit != null ? money(m.profit) : "—"}</td>
            </tr>;
          })}</tbody>
          {(() => {
            const tot = profit.rows.reduce((t, r) => {
              const m = jobMargin({ installerCostExGst: r.installerCost, installerMarginExGst: r.installerMargin, apFeeExGst: r.apFee, electricalCostExGst: r.electricalCost, electricalChargeExGst: r.electricalChargeEx, installerSourced: r.installerSourced, installerLed: r.installerLed, veecDiscountIncGst: r.discount, veecCount: r.veecCount, piesaRecCostExGst: r.piesaCostEx, veecLodgementFeeExGst: r.lodgementFeeExGst }, spot);
              return { installerMarkup: t.installerMarkup + m.installerMarkup, piesaCharge: t.piesaCharge + m.piesaChargeEx, piesaRecPaid: t.piesaRecPaid + (m.piesaRecPaidEx ?? 0), lodgement: t.lodgement + (m.lodgementFeeEx ?? 0), veec: t.veec + (m.veecMargin ?? 0), profit: m.profit != null ? t.profit + m.profit : t.profit, anyNull: t.anyNull || m.profit == null };
            }, { installerMarkup: 0, piesaCharge: 0, piesaRecPaid: 0, lodgement: 0, veec: 0, profit: 0, anyNull: false });
            return <tfoot><tr className="border-t-2 bg-muted font-bold">
              <td className="p-3">Total – {profit.rows.length} {profit.rows.length === 1 ? "job" : "jobs"}</td>
              <td className="p-3 text-right" colSpan={2}>{money(profit.rows.reduce((t, r) => t + r.installerCost + r.installerMargin + r.apFee, 0))} charged</td>
              <td className="p-3 text-right">{money(tot.installerMarkup)}</td>
              <td className="p-3 text-right" colSpan={2}>{money(profit.rows.reduce((t, r) => t + r.electricalChargeEx, 0))} charged</td>
              <td className="p-3 text-right">{profit.rows.reduce((t, r) => t + r.electricalChargeEx - r.electricalCost, 0) !== 0 ? money(profit.rows.reduce((t, r) => t + r.electricalChargeEx - r.electricalCost, 0)) : "—"}</td>
              <td className="p-3 text-right">{money(tot.piesaCharge)}</td>
              <td className="p-3 text-right">{profit.rows.some((r) => r.piesaCostMissing) ? `${money(tot.piesaRecPaid)} + not set` : money(tot.piesaRecPaid)}</td>
              <td className="p-3 text-right">{spot != null ? money(tot.veec) : "—"}</td>
              <td className={`p-3 text-right ${tot.anyNull ? "" : tot.profit < 0 ? "text-danger" : "text-success"}`}>{tot.anyNull ? "—" : money(tot.profit)}</td>
            </tr></tfoot>;
          })()}
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Electrical upgrades pass through at the agreed electrical rate card — no markup. The VEU pre-installation Pre Insulation Electrical Safety Assessment (PIESA) is charged at $349 inc GST ($317.27 ex GST); the REC is paid its negotiated supplier rate. Profit also deducts the ESC $4.35 per VEEC lodgement fee. "—" means a figure is not recorded yet.</p>
      </>}
    </section>}
  </AppShell>;
}
