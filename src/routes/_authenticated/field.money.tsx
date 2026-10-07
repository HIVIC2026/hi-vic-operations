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

const TONE = { blue: "bg-mist text-hiv-blue", blush: "bg-pink text-rose", mint: "bg-mint text-hiv-green" } as const;

function Money() {
  const load = useServerFn(getTradeMoneyView);
  const { data, error } = useQuery({ queryKey: ["trade-money-v2"], queryFn: () => load(), retry: false }); // a refusal (staff) shows at once, not after retries
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne" });
  const csv = () => {
    const lines = [["Job", "Owner", "Suburb", "What", "Amount", "Status"], ...data.rows.map((r) => [r.jobNumber, r.surname, r.suburb ?? "", r.what, String(r.amount ?? ""), payPill(r.state).label])];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
  };
  return (
    <TradeShell installer={data.kind === "installer"} boss={data.boss}>
      <h1 className="font-display text-[26px] font-bold leading-tight">Money</h1>
      <section className="rounded-[19px] border border-line bg-mint p-5 text-ink md:p-[23px]">
        <p className="text-sm font-bold">{data.next ? `Landing in your account ${day(data.next.on)}` : "Nothing landing just yet"}</p>
        <p className="font-display text-[30px] font-bold">{aud(data.next?.total ?? 0)}</p>
        <p className="text-sm">{data.next ? `${data.next.jobs} job${data.next.jobs === 1 ? "" : "s"}` : "Jobs show here once they're signed off."}</p>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <div className={card}><p className="text-xs text-sub">This month</p><p className="font-display text-[25px] font-bold leading-none">{aud(data.month)}</p></div>
        <div className={card}><p className="text-xs text-sub">All time</p><p className="font-display text-[25px] font-bold leading-none">{aud(data.allTime)}</p></div>
      </div>
      {([
        ["checking", "Waiting for office sign-off", "The office checks the paperwork first."],
        ["coming", "Approved – to be paid", "Paid within 7 days of approval."],
        ["paid", "Paid", "Sent to your account."],
      ] as const).map(([k, title, note]) => {
        const rows = data.rows.filter((r) => r.state.kind === k);
        const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0);
        return (
          <section key={k} aria-labelledby={`money-${k}`} className="space-y-2">
            <div className="flex items-end justify-between gap-3 px-1">
              <h2 id={`money-${k}`} className="font-display text-lg font-bold">{title}</h2>
              <span className="font-display text-xl font-bold">{aud(total)}</span>
            </div>
            <p className="px-1 text-xs text-sub">{note}</p>
            {rows.length ? <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">{rows.map((r) => { const p = payPill(r.state); return (
              <li key={r.jobId + r.what} className="flex items-center gap-3 p-4">
                <span className="min-w-0 flex-1"><span className="block font-bold">{r.surname}, {r.suburb}</span><span className="block text-sm text-sub">{r.jobNumber} · {r.what}</span></span>
                <span className="text-right"><span className="block font-bold">{aud(r.amount)}</span><span className={`mt-1 inline-block rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold ${TONE[p.tone]}`}>{r.state.kind === "coming" ? `Expected ${p.label.replace("Coming ", "")}` : r.state.kind === "checking" ? "Waiting" : p.label}</span></span>
              </li>); })}</ul> : <p className={`${card} text-sm`}>None right now.</p>}
          </section>
        );
      })}
      {data.rows.length > 0 && <a href={csv()} download="statement.csv" className="block text-center text-sm font-bold text-estimate-blue">Download statements ›</a>}
    </TradeShell>
  );
}
