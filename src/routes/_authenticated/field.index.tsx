import { createFileRoute, Link } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell, aud, card, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { ChevronRight } from "lucide-react";
import { Pill, PillTabs } from "@/components/portal/kit";
import { useMemo, useState } from "react";
import { getTradeHome } from "@/lib/trade-view.functions";
import { NO_LOGIN_NEEDED } from "@/lib/trade-access-role.core";
import { sourceLabel } from "@/lib/installer-home.core";
import { matchesSearch, type MyWorkCard } from "@/lib/my-work.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My work – Home Insulation Victoria" }, { name: "description", content: "New job offers, what needs you and what's coming up." }, { property: "og:title", content: "My work – Home Insulation Victoria" }, { property: "og:description", content: "New job offers, what needs you and what's coming up." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "home", params, preload),
  component: MyWork,
});

// My work (mywork2.png): greeting · Your turn / All jobs pill tabs · search · one card per job with one green button.
// Presentation only — every fact comes from tradeHome (business-scoped) and the pure my-work.core / next-step-box.core rules.
const SHOWN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (ymd: string): string => { const d = new Date(`${ymd}T12:00:00Z`); return `${SHOWN_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHOWN_MONTHS[d.getUTCMonth()]}`; };

function MyWork() {
  const load = useServerFn(getTradeHome);
  const [tab, setTab] = useState<"turn" | "all">("turn");
  const [q, setQ] = useState("");
  // staleTime (decision 280): coming back from a job shows the last answer at once; the 60s poll and every action's invalidation still refresh it.
  // Return visit: the last copy (this user only, under 24 h) shows at once; it is old, so a fresh copy still loads straight away.
  const uid = Route.useRouteContext().user.id;
  const seed = useMemo(() => readTradeCache<Awaited<ReturnType<typeof load>>>(uid, "home"), [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, refetch } = useQuery({ queryKey: ["trade-home"], queryFn: async () => { const d = await headStartOr(uid, ["trade-home"], () => load()); if (d) writeTradeCache(uid, "home", d); return d; }, refetchInterval: 60_000, staleTime: 20_000, ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}) });
  if (error) return <TradeShell installer={false}><div role="alert" className={card}><p className="text-sm">Your work couldn't load. Check your signal and try again.</p><button className="mt-3 min-h-11 font-bold text-estimate-blue" onClick={() => refetch()}>Try again</button></div></TradeShell>;
  if (data === undefined) return <TradeShell installer={false}><p className="text-sm">Loading your work…</p></TradeShell>;
  if (data === null) return <TradeShell installer={false}><p className={`${card} text-sm`}>Your sign-in isn't linked to an approved business yet. Home Insulation Victoria will sort this out.</p></TradeShell>;
  const installer = data.kind === "installer";
  if (installer && data.myWork) {
    const myWork = data.myWork;
    const list = (tab === "turn" ? myWork.yourTurn : myWork.all).filter((c) => matchesSearch(c, q));
    return (
      <TradeShell installer boss={data.boss} money={data.money} test={data.isTest} redesign>
        <div data-my-work>
          <h1 className="font-display text-[22px] font-semibold leading-[1.2]">{myWork.greeting.title}</h1>
          <p className="mt-1 text-sm text-sub">{myWork.greeting.sub}</p>
        </div>
        <PillTabs label="Show jobs" value={tab} onChange={setTab} options={[
          { value: "turn", label: `Your turn · ${myWork.yourTurn.length}` },
          { value: "all", label: `All jobs · ${myWork.all.length}` },
        ]} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, address or HV number" aria-label="Search name, address or HV number" className={inputCls} />
        <div className="space-y-3" data-job-cards>
          {list.length ? list.map((c) => <JobCard key={c.jobId + c.step} c={c} />)
            : <p className="py-3 text-sm text-sub">{q ? "No jobs match that." : tab === "turn" ? "Nothing needs you right now." : "No jobs yet."}</p>}
        </div>
      </TradeShell>
    );
  }

  // Electricians never log in (new job flow Part 6): each job reaches them as one no-login link. An old electrician
  // login that still gets here sees one plain line.
  return <TradeShell installer={false}><p className={`${card} text-base`} data-no-login>{NO_LOGIN_NEEDED}</p></TradeShell>;
}

/** One job: pill, owner, HV number · suburb, the step and why, and one green button. A red border marks a job past its book-by date. */
function JobCard({ c }: { c: MyWorkCard }) {
  const open = <Link to="/field/$jobId" params={{ jobId: c.jobId }} className="min-w-0 flex-1">{cardBody(c)}</Link>;
  return (
    <div data-job-card className={`${card} flex flex-col gap-3 ${c.overdue ? "border-rose" : ""}`}>
      <div className="flex items-start gap-3">{open}<ChevronRight aria-hidden className="mt-1 h-5 w-5 shrink-0 text-sub" /></div>
      {c.button && <Link to="/field/$jobId" params={{ jobId: c.jobId }} className={greenBtn}>{c.button}</Link>}
    </div>
  );
}
function cardBody(c: MyWorkCard) {
  return (<>
    <Pill tone={c.pill === "Your customer" ? "plain" : "green"}>{c.pill}</Pill>
    <span className="mt-2 block font-display text-lg font-semibold leading-tight">{c.owner}</span>
    {c.hvSuburb && <span className="mt-0.5 block text-sm text-sub">{c.hvSuburb}</span>}
    <span className="mt-2 block text-base font-semibold">{c.step}</span>
    <span className="mt-0.5 block text-sm text-sub">{c.reason}{c.by ? ` · By ${dayWords(c.by)}` : ""}{c.overdue ? <span className="font-semibold text-rose"> · overdue</span> : null}</span>
  </>);
}
