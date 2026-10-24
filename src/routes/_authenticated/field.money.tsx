// Money = approved mock-up M6 (Jo 24 Oct 2026, decision 203): the installer's own pay only — Coming / Being checked /
// This month / Last month, per-job rows with payPill states, how pay works by job type, bank account on file,
// Download statement. Pay states come from trade-view.core payPill; totals from installer-screens.core.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell, aud } from "@/components/trade/TradeShell";
import { getTradeMoneyExtras, getTradeMoneyView } from "@/lib/trade-view.functions";
import { payPill } from "@/lib/trade-view.core";
import { HOW_PAY_WORKS, READY_CHECKS_FREE, bankLine, moneyRowSub, moneyTotals, paidByMonth, shortDay } from "@/lib/installer-screens.core";
import { Group, LinkRow, Note, Pill, Screen, outlineLinkClass } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/money")({
  validateSearch: (s: Record<string, unknown>): { all?: boolean | undefined } => ({ all: s["all"] === true || s["all"] === "1" ? true : undefined }),
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "Your pay: what's coming, what's being checked and what's been paid." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "Your pay: what's coming, what's being checked and what's been paid." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Money,
});

const PAID_SHOWN = 3;

function Money() {
  const load = useServerFn(getTradeMoneyView);
  const loadExtras = useServerFn(getTradeMoneyExtras);
  const { all } = Route.useSearch();
  const [showAll, setShowAll] = useState(!!all);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const { data, error } = useQuery({ queryKey: ["trade-money-v2"], queryFn: () => load(), retry: false }); // a refusal (staff) shows at once, not after retries
  const { data: x } = useQuery({ queryKey: ["trade-money-extras"], queryFn: () => loadExtras(), retry: false });
  if (error) return <TradeShell installer={false}><p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const business = data.business.replace(/^\[TEST PARTNER\]\s*/, "");
  const t = moneyTotals(data.rows);
  const open = data.rows.filter((r) => r.state.kind !== "paid").sort((a, b) => (a.state.kind === "checking" ? -1 : 1) - (b.state.kind === "checking" ? -1 : 1));
  const paid = data.rows.filter((r) => r.state.kind === "paid").sort((a, b) => ((b.state as { on: string }).on).localeCompare((a.state as { on: string }).on));
  const rows = [...open, ...paid.slice(0, PAID_SHOWN)];
  const csv = () => {
    const lines = [["Job", "Owner", "Suburb", "What", "Amount", "Status"], ...data.rows.map((r) => [r.jobNumber, r.surname, r.suburb ?? "", r.what, String(r.amount ?? ""), payPill(r.state).label])];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"))}`;
  };
  const tile = (label: string, value: string, sub: string, tone: "mist" | "line", color = "") => <div className={`rounded-[14px] px-3.5 py-3 ${tone === "mist" ? "bg-mist" : "border border-line"}`}><p className="text-xs text-sub">{label}</p><p className={`mt-0.5 text-xl font-semibold ${color}`}>{value}</p><p className="mt-0.5 text-xs text-sub">{sub}</p></div>;
  const payRow = (r: (typeof data.rows)[number]) => { const p = payPill(r.state); return (
    <Link key={`${r.jobId}:${r.kind}`} to={data.kind === "installer" && r.kind === "installation" ? "/field/money/$jobId" : "/field/$jobId"} params={{ jobId: r.jobId }} className="flex min-h-[60px] items-center gap-3 border-b border-line py-2.5">
      <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{r.jobNumber} · {r.suburb ?? r.surname}</span><span className="mt-0.5 block text-[13px] text-sub">{data.kind === "installer" ? moneyRowSub({ channel: r.channel, doneAt: r.doneAt }) : `${r.what}${r.doneAt ? ` · ${shortDay(r.doneAt)}` : ""}`}</span></span>
      <span className="text-right"><span className="block text-base font-semibold">{aud(r.amount)}</span><span className="mt-1 block"><Pill tone={p.tone}>{p.label}</Pill></span></span>
    </Link>); };

  // Approved state M6-all-paid: every paid job grouped by month with month totals, filter chips All / each month.
  if (showAll) {
    const months = paidByMonth(paid.map((r) => ({ jobId: r.jobId, jobNumber: r.jobNumber, suburb: r.suburb, surname: r.surname, amount: r.amount, paidOn: (r.state as { on: string }).on, doneAt: r.doneAt, channel: r.channel })));
    const shownMonths = monthFilter ? months.filter((m) => m.key === monthFilter) : months;
    return (
      <TradeShell installer={data.kind === "installer"} boss={data.boss}>
        <Screen>
          <button type="button" onClick={() => { setShowAll(false); setMonthFilter(null); }} className="inline-flex min-h-9 items-center text-sm font-medium text-hiv-blue">‹ Money</button>
          <div><h1 className="font-display text-[22px] font-semibold leading-[1.2]">All paid jobs</h1><p className="mt-1 text-sm text-sub">Everything paid to {business}. Amounts include GST.</p></div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by month" data-month-chips>
            <button type="button" aria-pressed={!monthFilter} onClick={() => setMonthFilter(null)} className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${!monthFilter ? "border-hiv-blue bg-hiv-blue text-white" : "border-line text-ink"}`}>All</button>
            {months.map((m) => <button key={m.key} type="button" aria-pressed={monthFilter === m.key} onClick={() => setMonthFilter(m.key)} className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${monthFilter === m.key ? "border-hiv-blue bg-hiv-blue text-white" : "border-line text-ink"}`}>{m.label.split(" · ")[0]}</button>)}
          </div>
          {shownMonths.map((m) => <Group key={m.key} title={m.label}>{m.rows.map((r) => payRow(data.rows.find((x) => x.jobId === r.jobId && x.state.kind === "paid")!))}</Group>)}
          {!months.length && <p className="py-3 text-sm text-sub">Nothing paid yet.</p>}
          {data.rows.length > 0 && <a href={csv()} download="statement.csv" className={outlineLinkClass}>Download statement</a>}
        </Screen>
      </TradeShell>
    );
  }
  return (
    <TradeShell installer={data.kind === "installer"} boss={data.boss}>
      <Screen>
        <div>
          <h1 className="font-display text-[22px] font-semibold leading-[1.2]">Money</h1>
          <p className="mt-1 text-sm text-sub">Your pay, {business}. Amounts include GST.</p>
        </div>

        {!data.rows.length && !(data.ownerDirect ?? []).length ? (
          <section className="rounded-[18px] bg-mist p-4 text-center" data-money-empty><h2 className="text-[17px] font-semibold">No completed jobs yet.</h2><p className="mt-1 text-sm text-sub">Your pay for each install appears here once the install is done.</p></section>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2" data-money-totals>
              {tile("Coming", aud(t.coming.total), t.coming.next ? `Next ${shortDay(t.coming.next)}` : "Nothing due yet", "mist", "text-hiv-blue")}
              {tile("Being checked", aud(t.checking.total), `${t.checking.jobs} job${t.checking.jobs === 1 ? "" : "s"}`, "line")}
              {tile("This month", `${aud(t.thisMonth.total)} paid`, `${t.thisMonth.installs} install${t.thisMonth.installs === 1 ? "" : "s"}`, "line", "text-hiv-green")}
              {tile("Last month", `${aud(t.lastMonth.total)} paid`, `${t.lastMonth.installs} install${t.lastMonth.installs === 1 ? "" : "s"}`, "line")}
            </div>

            <Group title="Jobs">
              {rows.map(payRow)}
              {!rows.length && <p className="py-3 text-sm text-sub">None right now.</p>}
              {paid.length > 0 && <LinkRow onClick={() => setShowAll(true)}>All paid jobs</LinkRow>}
            </Group>
          </>
        )}

        {(data.ownerDirect ?? []).length > 0 && (
          <Group title="Invoice the owner directly">
            <Note>The installer's customer chose you as their own electrician. You invoice and collect payment from the owner at your agreed price — Home Insulation Victoria doesn't pay this work and hasn't recorded the owner's payment.</Note>
            {data.ownerDirect.map((r) => <div key={r.jobId + r.what} className="flex min-h-12 items-center justify-between gap-3 border-b border-line text-[15px]"><span><span className="block font-semibold">{r.jobNumber} · {r.suburb ?? r.surname}</span><span className="block text-[13px] text-sub">{r.what}</span></span><span className="text-[13px] text-sub">Owner payment: not recorded</span></div>)}
          </Group>
        )}

        <Group title="How pay works">
          {data.kind === "installer" ? <>
            {HOW_PAY_WORKS.map((h) => <div key={h.who} className="flex min-h-12 items-center justify-between gap-3 border-b border-line text-sm leading-[1.45]"><span className="shrink-0 text-sub">{h.who}</span><span className="text-right">{h.how}</span></div>)}
            <Note className="mt-2">{READY_CHECKS_FREE}</Note>
          </> : <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line text-sm"><span className="text-sub">Your visits</span><span className="text-right">Paid within 7 days of our approval</span></div>}
        </Group>

        <Group title="Paid to">
          <Link to="/field/business/bank" className="flex min-h-[52px] items-center justify-between gap-3 text-[15px]">
            <span><span className="block font-medium">{x?.accountName ?? business}</span><span className="mt-0.5 block text-[13px] text-sub">{x ? bankLine(x) : data.bankEnding ? `account ending ${data.bankEnding}` : "No bank account saved yet"}</span></span>
            <span className="font-semibold text-hiv-blue">Change</span>
          </Link>
        </Group>

        {data.rows.length > 0 && <a href={csv()} download="statement.csv" className={outlineLinkClass}>Download statement</a>}
      </Screen>
    </TradeShell>
  );
}
