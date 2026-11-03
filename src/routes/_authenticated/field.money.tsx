// Money = the approved new-job-flow screen (money-phone.png, Jo 2 Nov 2026; installer screens Task 8): heading, sub, two
// tiles (COMING TO YOU / PAID THIS MONTH) and one row per pay item with its plain rule, each opening the job's pay page.
// The installer's own pay only — never the owner's price. No statement download (Jo 2 Nov, answer 14). Only installer
// businesses reach it (boss always; Office with "Can see Money"); electricians have no Money page.
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { getTradeMoneyView } from "@/lib/trade-view.functions";
import { MONEY_WORDS, NO_FORM_NO_PAY_V2_APPROVED, PAY_RULE_LINE_V2 } from "@/lib/money-screen.core";
import { NoFormNoPay, Screen } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/money")({
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "What's coming to you and what's been paid." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "What's coming to you and what's been paid." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "money", params, preload),
  component: Money,
});

function Money() {
  const load = useServerFn(getTradeMoneyView);
  const uid = Route.useRouteContext().user.id;
  const seed = useMemo(() => readTradeCache<Awaited<ReturnType<typeof load>>>(uid, "money"), [uid]);
  const { data, error } = useQuery({ queryKey: ["trade-money-v2"], queryFn: async () => { const d = await headStartOr(uid, ["trade-money-v2"], () => load()); if (d) writeTradeCache(uid, "money", d); return d; }, retry: false, staleTime: 30_000, ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}) }); // a refusal shows at once, not after retries
  if (error) return <TradeShell installer><p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p><Link to="/field" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-hiv-blue">Back to My work</Link></TradeShell>;
  if (!data) return <TradeShell installer><p className="text-sm">Loading…</p></TradeShell>;
  const s = data.screen;
  const tile = (label: string, value: string, sub: string, tone: "green" | "sub") => (
    <div className={card}>
      <p className={`text-[11px] font-bold uppercase tracking-[1.3px] ${tone === "green" ? "text-hiv-green" : "text-sub"}`}>{label}</p>
      <p className="mt-1 font-display text-[28px] font-bold leading-tight text-ink">{value}</p>
      <p className="mt-1 text-sm text-sub">{sub}</p>
    </div>
  );
  return (
    <TradeShell installer boss={data.boss} money redesign>
      <Screen>
        <div>
          <h1 className="font-display text-[26px] font-bold leading-[1.2]">{MONEY_WORDS.title}</h1>
          <p className="mt-1 text-[15px] text-sub">{MONEY_WORDS.sub}</p>
        </div>
        <div className="grid grid-cols-2 gap-3" data-money-tiles>
          {tile(MONEY_WORDS.coming, s.coming.total, s.coming.jobs, "green")}
          {tile(MONEY_WORDS.paidThisMonth, s.paidThisMonth.total, s.paidThisMonth.jobs, "sub")}
        </div>
        {/* Jo 3 Nov 2026: the pay rule stays; the plain one-liner replaces the old block once she approves it. */}
        {NO_FORM_NO_PAY_V2_APPROVED ? <p className="text-sm text-sub" data-pay-rule-v2>{PAY_RULE_LINE_V2}</p> : <NoFormNoPay />}
        <ul className="space-y-3" data-money-rows>
          {s.rows.map((r) => (
            <li key={`${r.jobId}:${r.title}`}>
              <Link to="/field/money/$jobId" params={{ jobId: r.jobId }} className={`${card} block`} data-paid={r.paid ? "yes" : "no"}>
                <span className="block font-display text-[17px] font-semibold text-ink">{r.title}</span>
                <span className={`mt-1 block text-[15px] ${r.paid ? "font-semibold text-hiv-green" : "text-sub"}`}>{r.rule}</span>
              </Link>
            </li>
          ))}
          {!s.rows.length && <li className="py-3 text-sm text-sub" data-money-empty>{MONEY_WORDS.empty}</li>}
        </ul>
      </Screen>
    </TradeShell>
  );
}
