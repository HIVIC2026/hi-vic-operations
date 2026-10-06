import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell, aud, card } from "@/components/trade/TradeShell";
import { getTradeMoneyView } from "@/lib/trade-view.functions";
import { payPill } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/money")({
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "What's landing in your account and what you've earned." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "What's landing in your account and what you've earned." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Money,
});

const TONE = { blue: "bg-estimate-mist text-estimate-blue", blush: "bg-estimate-blush", mint: "bg-estimate-green-soft text-estimate-green" } as const;

function Money() {
  const load = useServerFn(getTradeMoneyView);
  const { data, error } = useQuery({ queryKey: ["trade-money-v2"], queryFn: () => load() });
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne" });
  const csv = () => {
    const lines = [["Job", "Owner", "Suburb", "What", "Amount", "Status"], ...data.rows.map((r) => [r.jobNumber, r.surname, r.suburb ?? "", r.what, String(r.amount ?? ""), payPill(r.state).label])];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
  };
  return (
    <TradeShell installer={data.kind === "installer"} boss={data.boss}>
      <h1 className="font-display text-3xl font-extrabold">Money</h1>
      <section className="rounded-[22px] bg-estimate-green p-5 text-white shadow-sm">
        <p className="text-sm font-bold">{data.next ? `Landing in your account ${day(data.next.on)}` : "Nothing landing just yet"}</p>
        <p className="font-display text-4xl font-extrabold">{aud(data.next?.total ?? 0)}</p>
        <p className="text-sm">{data.next ? `${data.next.jobs} job${data.next.jobs === 1 ? "" : "s"}` : "Jobs show here once they're signed off."}</p>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <div className={card}><p className="text-xs font-bold uppercase tracking-wide">This month</p><p className="font-display text-2xl font-extrabold">{aud(data.month)}</p></div>
        <div className={card}><p className="text-xs font-bold uppercase tracking-wide">All time</p><p className="font-display text-2xl font-extrabold">{aud(data.allTime)}</p></div>
      </div>
      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">Jobs</h2>
        {data.rows.length ? <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">{data.rows.map((r) => { const p = payPill(r.state); return (
          <li key={r.jobId + r.what} className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1"><span className="block font-bold">{r.surname}, {r.suburb}</span><span className="block text-sm text-estimate-navy/70">{r.what}</span></span>
            <span className="text-right"><span className="block font-bold">{aud(r.amount)}</span><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${TONE[p.tone]}`}>{p.label}</span></span>
          </li>); })}</ul> : <p className={`${card} text-sm`}>No finished jobs yet.</p>}
      </section>
      {data.rows.length > 0 && <a href={csv()} download="statement.csv" className="block text-center text-sm font-bold text-estimate-blue">Download statements ›</a>}
    </TradeShell>
  );
}
