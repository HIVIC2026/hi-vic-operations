import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TradeShell, aud, card } from "@/components/trade/TradeShell";
import { getTradeMoneyView } from "@/lib/trade-view.functions";
import { payPill } from "@/lib/trade-view.core";

type Tab = "checking" | "coming" | "paid";
const TABS: { key: Tab; label: string; title: string; note: string }[] = [
  { key: "checking", label: "Awaiting approval", title: "Awaiting office approval", note: "The office checks the paperwork first." },
  { key: "coming", label: "Approved", title: "Approved · to be paid", note: "Paid within 7 days of approval." },
  { key: "paid", label: "Paid", title: "Paid jobs", note: "Sent to your account." },
];

export const Route = createFileRoute("/_authenticated/field/money")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab | undefined; pay?: string | undefined } => {
    const t = s["tab"], p = s["pay"];
    return { tab: t === "checking" || t === "coming" || t === "paid" ? t : undefined, pay: typeof p === "string" ? p : undefined };
  },
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "What's landing in your account and what you've earned." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "What's landing in your account and what you've earned." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Money,
});

const TONE = { blue: "bg-mist text-hiv-blue", blush: "bg-pink text-rose", mint: "bg-mint text-hiv-green" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", timeZone: "Australia/Melbourne" });

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-0"><dt className="text-sm text-sub">{k}</dt><dd className="text-right text-sm font-bold">{v}</dd></div>;
}

function Money() {
  const load = useServerFn(getTradeMoneyView);
  const { tab: tabParam, pay } = Route.useSearch();
  const { data, error } = useQuery({ queryKey: ["trade-money-v2"], queryFn: () => load(), retry: false }); // a refusal (staff) shows at once, not after retries
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const key = (r: (typeof data.rows)[number]) => `${r.jobId}:${r.kind}`;
  const shell = (c: React.ReactNode) => <TradeShell installer={data.kind === "installer"} boss={data.boss}>{c}</TradeShell>;

  // ---- Job payment detail ----
  const detail = pay ? data.rows.find((r) => key(r) === pay) : undefined;
  if (pay) {
    if (!detail) return shell(<><Link to="/field/money" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />Money</Link><p className={`${card} text-sm`}>This payment isn't in your list any more.</p></>);
    const p = payPill(detail.state);
    const status = detail.state.kind === "paid" ? "Paid" : detail.state.kind === "coming" ? "Approved · to be paid" : "Awaiting office approval";
    return shell(<>
      <Link to="/field/money" search={{ tab: detail.state.kind }} className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />Money</Link>
      <div><h1 className="font-display text-[26px] font-bold leading-tight">Job payment</h1><p className="text-sm text-sub">{detail.surname}, {detail.suburb} · {detail.jobNumber}</p></div>
      <section className={card} data-payment-detail>
        <dl>
          <Pair k="Business" v={data.business.replace(/^\[TEST PARTNER\]\s*/, "")} />
          <Pair k="Work" v={detail.what} />
          <Pair k="Amount · inc GST" v={aud(detail.amount)} />
          <Pair k="Status" v={<span className={`inline-block rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold ${TONE[p.tone]}`}>{status}</span>} />
          {detail.approvedAt && <Pair k="Approved" v={day(detail.approvedAt)} />}
          {detail.state.kind === "coming" && <Pair k="Expected pay date" v={day(detail.state.on)} />}
          {detail.state.kind === "paid" && <Pair k="Paid" v={day(detail.state.on)} />}
          <Pair k="Bank account" v={data.bankEnding ? `Account ending ${data.bankEnding}` : "Not saved yet"} />
        </dl>
        {detail.state.kind === "checking" && <p className="mt-3 border-t border-line pt-3 text-xs text-sub">Payment is confirmed once the office approves the job paperwork{data.kind === "installer" ? " and the owner has paid in full" : ""}.</p>}
      </section>
    </>);
  }

  // ---- Overview ----
  if (!data.rows.length && !(data.ownerDirect ?? []).length) return shell(<>
    <h1 className="font-display text-[26px] font-bold leading-tight">Money</h1>
    <section className={`${card} text-center`} data-money-empty><h2 className="font-display text-xl font-bold">No completed jobs yet.</h2><p className="mt-1 text-sm text-sub">Approved jobs and expected payment dates will appear here.</p></section>
  </>);
  const tab: Tab = tabParam ?? (data.rows.some((r) => r.state.kind === "coming") ? "coming" : data.rows.some((r) => r.state.kind === "checking") ? "checking" : "paid");
  const t = TABS.find((x) => x.key === tab)!;
  const rows = data.rows.filter((r) => r.state.kind === tab);
  const comingTotal = data.rows.filter((r) => r.state.kind === "coming").reduce((s, r) => s + (r.amount ?? 0), 0);
  const csv = () => {
    const lines = [["Job", "Owner", "Suburb", "What", "Amount", "Status"], ...data.rows.map((r) => [r.jobNumber, r.surname, r.suburb ?? "", r.what, String(r.amount ?? ""), payPill(r.state).label])];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
  };
  return shell(<>
    <div><h1 className="font-display text-[26px] font-bold leading-tight">Money</h1><p className="text-sm text-sub">{data.business}</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className={card.replace("bg-paper", "bg-mint")}><p className="text-xs font-semibold">Approved · to be paid</p><p className="mt-2 font-display text-[25px] font-bold leading-none">{aud(comingTotal)}</p><p className="mt-2 text-xs text-sub">{data.next ? `Next payment ${day(data.next.on)}` : "Expected date shown per job"}</p></div>
      <div className={card}><p className="text-xs font-semibold">This month</p><p className="mt-2 font-display text-[25px] font-bold leading-none">{aud(data.month)}</p></div>
      <div className={card}><p className="text-xs font-semibold">All time</p><p className="mt-2 font-display text-[25px] font-bold leading-none">{aud(data.allTime)}</p></div>
    </div>
    <div role="tablist" aria-label="Payments" className="flex gap-1 border-b border-line pb-2">
      {TABS.map((x) => { const n = data.rows.filter((r) => r.state.kind === x.key).length; return (
        <Link key={x.key} role="tab" aria-selected={tab === x.key} to="/field/money" search={{ tab: x.key }} className={`flex min-h-11 items-center rounded-[10px] px-3 text-center text-sm font-semibold text-estimate-blue ${tab === x.key ? "bg-estimate-mist" : ""}`}>{x.label}{n ? ` (${n})` : ""}</Link>); })}
    </div>
    <section aria-labelledby="money-section" className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1"><h2 id="money-section" className="font-display text-lg font-bold">{t.title}</h2><span className="font-display text-xl font-bold">{aud(rows.reduce((s, r) => s + (r.amount ?? 0), 0))}</span></div>
      <p className="px-1 text-xs text-sub">{t.note}</p>
      {rows.length ? <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">{rows.map((r) => { const p = payPill(r.state); return (
        <li key={key(r)}><Link to="/field/money" search={{ pay: key(r) }} className="flex min-h-[64px] items-center gap-3 p-4">
          <span className="min-w-0 flex-1"><span className="block font-bold">{r.surname}, {r.suburb}</span><span className="block text-sm text-sub">{r.jobNumber} · {r.what} · {aud(r.amount)} inc GST</span></span>
          <span className={`shrink-0 rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold ${TONE[p.tone]}`}>{r.state.kind === "coming" ? `Expected ${day(r.state.on)}` : r.state.kind === "checking" ? "In review" : `Paid ${day(r.state.on)}`}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-sub" aria-hidden />
        </Link></li>); })}</ul> : <p className={`${card} text-sm`}>None right now.</p>}
    </section>
    {(data.ownerDirect ?? []).length > 0 && (
      <section data-owner-direct className="space-y-2">
        <h2 className="px-1 font-display text-lg font-bold">Invoice the owner directly</h2>
        <p className="px-1 text-xs text-sub">The installer's customer chose you as their own electrician. You invoice and collect payment from the owner at your agreed price — Home Insulation Victoria doesn't pay this work and hasn't recorded the owner's payment.</p>
        <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper">{data.ownerDirect.map((r) => (
          <li key={r.jobId + r.what} className="flex min-h-[56px] items-center gap-3 p-4"><span className="min-w-0 flex-1"><span className="block font-bold">{r.surname}, {r.suburb}</span><span className="block text-sm text-sub">{r.jobNumber} · {r.what}</span></span><span className="shrink-0 text-[11px] font-semibold text-sub">Owner payment: not recorded</span></li>
        ))}</ul>
      </section>
    )}
    <a href={csv()} download="statement.csv" className="block text-center text-sm font-bold text-estimate-blue">Download statements ›</a>
  </>);
}
