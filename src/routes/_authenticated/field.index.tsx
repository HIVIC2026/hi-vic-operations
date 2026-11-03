import { createFileRoute, Link } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { TradeShell, aud, card, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { NowPanel, Pill, PillTabs, btnClass } from "@/components/portal/kit";
import { useMemo, useState } from "react";
import { StatusLineView } from "@/components/trade/job-status";
import { getTradeHome } from "@/lib/trade-view.functions";
import { ELECTRICIAN_WORK_WORDS, dayTile, goneIn, tradeGreeting } from "@/lib/trade-view.core";
import { electricianYourJobs } from "@/lib/work-places.core";
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
  const [onlyChasing, setOnlyChasing] = useState(false);
  const [onlyMoving, setOnlyMoving] = useState(false);
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
  const g = tradeGreeting(data.firstName, data.week);
  const first = data.offers[0];

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
          {list.length ? list.map((c) => <JobCard key={(c.offerId ?? c.jobId) + c.step} c={c} />)
            : <p className="py-3 text-sm text-sub">{q ? "No jobs match that." : tab === "turn" ? "Nothing needs you right now." : "No jobs yet."}</p>}
        </div>
      </TradeShell>
    );
  }

  // Electrician view (unchanged apart from the retired installer fact pills).
  const yourJobs = electricianYourJobs(data.jobs);
  const chasing = yourJobs.filter((j) => j.line && j.line.tone !== "ok");
  const moving = yourJobs.filter((j) => j.place === "moving");
  const shown = onlyMoving ? moving : onlyChasing ? chasing : yourJobs;
  return (
    <TradeShell installer={false} boss={data.boss} money={data.money} test={data.isTest}>
      <div><h1 className="font-display text-[26px] font-bold leading-tight">{g.title}</h1><p className="text-sm text-sub">{g.sub}</p></div>
      <div className="grid grid-cols-2 gap-2" data-work-tiles>
        {([
          ["Offers", data.offers.length, "Pre Insulation Electrical Safety Assessment (PIESA)"],
          ["Needs me", data.yourMove.length, "Your next actions"],
          [ELECTRICIAN_WORK_WORDS.waitingTile, moving.length, ELECTRICIAN_WORK_WORDS.waitingSub],
          ["Coming up", data.coming.length, "Booked visits"],
        ] as [string, number, string][]).map(([k, n, s]) => (
          <div key={k} className="rounded-[18px] border border-line bg-paper p-3.5"><p className="text-xs font-semibold text-estimate-navy">{k}</p><p className="mt-1 font-display text-2xl font-bold">{n}</p><p className="mt-1 text-[11px] text-sub">{s}</p></div>
        ))}
      </div>
      {first ? (
        <NowPanel attention eyebrow={`${data.offers.length} new job offer${data.offers.length === 1 ? "" : "s"}`} due={first.expiresAt ? goneIn(first.expiresAt) : undefined}
          status={`Pre Insulation Electrical Safety Assessment (PIESA) in ${first.suburb ?? "Victoria"}`}
          action={<Link to="/field/offer/$offerId" params={{ offerId: first.id }} className={btnClass("primary", "w-full md:w-auto")}>View offer</Link>} />
      ) : data.yourMove[0] ? (
        <NowPanel eyebrow="Your next step" status={data.yourMove[0].title} next={data.yourMove[0].detail}
          action={<Link to="/field/$jobId" params={{ jobId: data.yourMove[0].jobId }} className={btnClass("primary", "w-full md:w-auto")}>Open job</Link>} />
      ) : null}
      {data.offers.length > 1 && (
        <section data-other-offers>
          <h2 className="mb-2 font-display text-base font-bold">More offers <span className="text-sm font-semibold text-sub">{data.offers.length - 1}</span></h2>
          <div className="space-y-2">{data.offers.slice(1).map((o) => (
            <Link key={o.id} to="/field/offer/$offerId" params={{ offerId: o.id }} className="flex min-h-[52px] items-center gap-3 rounded-[14px] border border-line bg-paper p-3 hover:border-action">
              <span className="min-w-0 flex-1"><span className="block font-bold">Pre Insulation Electrical Safety Assessment (PIESA) in {o.suburb ?? "Victoria"}</span>{o.expiresAt && <span className="block text-sm text-sub">{goneIn(o.expiresAt)}</span>}</span><ChevronRight className="h-5 w-5" />
            </Link>))}</div>
        </section>
      )}
      {data.yourMove.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-base font-bold">Your move <Pill tone="rose">{data.yourMove.length}</Pill></h2>
          <div className="space-y-2">{data.yourMove.map((m) => (
            <Link key={m.jobId + m.title} to="/field/$jobId" params={{ jobId: m.jobId }} className="flex items-center gap-3 rounded-[18px] border border-line bg-paper hover:border-action p-4"><span className="min-w-0 flex-1"><span className="block font-bold">{m.title}</span><span className="block truncate text-sm text-sub">{m.detail}</span></span><ChevronRight className="h-5 w-5" /></Link>
          ))}</div>
        </section>
      )}
      <section>
        <h2 className="mb-2 font-display text-base font-bold">Coming up</h2>
        {data.coming.length ? <div className="space-y-2">{data.coming.map((b) => { const t = dayTile(b.start); return (
          <Link key={b.jobId + b.start} to="/field/day/$jobId" params={{ jobId: b.jobId }} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3">
            <span className="flex w-20 shrink-0 flex-col items-center rounded-2xl bg-estimate-mist py-2"><span className="text-xs font-bold">{t.day}</span><span className="text-xs">{t.time}</span></span>
            <span className="min-w-0 flex-1"><span className="block font-bold">{b.what} · {b.surname}</span><span className="block truncate text-sm text-sub">{b.address}</span></span><ChevronRight className="h-5 w-5" />
          </Link>); })}</div> : <p className={`${card} text-sm`}>Nothing booked yet.</p>}
      </section>
      {yourJobs.length > 0 && (
        <section data-your-jobs>
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-base font-bold">Your jobs <span className="text-sm font-semibold text-sub">{yourJobs.length}</span></h2>
            <div className="flex gap-1" role="group" aria-label="Filter jobs"><button className={btnClass(onlyChasing || onlyMoving ? "secondary" : "primary", "min-h-[34px] px-3")} aria-pressed={!onlyChasing && !onlyMoving} onClick={() => { setOnlyChasing(false); setOnlyMoving(false); }}>All</button><button data-moving-filter className={btnClass(onlyMoving ? "primary" : "secondary", "min-h-[34px] px-3")} aria-pressed={onlyMoving} onClick={() => { setOnlyMoving(true); setOnlyChasing(false); }}>{ELECTRICIAN_WORK_WORDS.waitingFilter} ({moving.length})</button><button data-needs-chasing className={btnClass(onlyChasing ? "primary" : "secondary", "min-h-[34px] px-3")} aria-pressed={onlyChasing} onClick={() => { setOnlyChasing(true); setOnlyMoving(false); }}>{ELECTRICIAN_WORK_WORDS.slowFilter}{chasing.length ? ` (${chasing.length})` : ""}</button></div></div>
          {onlyChasing && !shown.length && <p className={`${card} text-sm`}>{ELECTRICIAN_WORK_WORDS.slowEmpty}</p>}
          <div className="space-y-2">{shown.map((j) => (
            <Link key={j.jobId} to="/field/$jobId" params={{ jobId: j.jobId }} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3">
              <span className="min-w-0 flex-1"><span className="block font-bold">{j.jobNumber} · {j.owner ?? "Owner"}</span>{sourceLabel(j.channel) && <span className="block text-[13px] text-sub">{sourceLabel(j.channel)}</span>}<span className="block truncate text-sm text-sub">{j.address}</span><span className="mt-1 block">{j.line ? <StatusLineView line={j.line} compact /> : <Pill>{j.status}</Pill>}</span></span><ChevronRight className="h-5 w-5" />
            </Link>))}</div>
        </section>
      )}
      {data.month && <section className="flex items-center justify-between rounded-[18px] border border-line bg-mint p-4">
        <span><span className="block text-xs font-bold uppercase tracking-wide">This month</span><span className="font-bold">{data.month.jobs} job{data.month.jobs === 1 ? "" : "s"} done</span></span>
        <span className="font-display text-2xl font-bold">{aud(data.month.earned)}</span>
      </section>}
    </TradeShell>
  );
}

/** One job: pill, owner, HV number · suburb, the step and why, and one green button. A red border marks a job past its book-by date. */
function JobCard({ c }: { c: MyWorkCard }) {
  const open = c.offerId
    ? <Link to="/field/offer/$offerId" params={{ offerId: c.offerId }} className="min-w-0 flex-1">{cardBody(c)}</Link>
    : <Link to="/field/$jobId" params={{ jobId: c.jobId }} className="min-w-0 flex-1">{cardBody(c)}</Link>;
  return (
    <div data-job-card className={`${card} flex flex-col gap-3 ${c.overdue ? "border-rose" : ""}`}>
      <div className="flex items-start gap-3">{open}<ChevronRight aria-hidden className="mt-1 h-5 w-5 shrink-0 text-sub" /></div>
      {c.button && (c.offerId
        ? <Link to="/field/offer/$offerId" params={{ offerId: c.offerId }} className={greenBtn}>{c.button}</Link>
        : <Link to="/field/$jobId" params={{ jobId: c.jobId }} className={greenBtn}>{c.button}</Link>)}
    </div>
  );
}
function cardBody(c: MyWorkCard) {
  return (<>
    <Pill tone={c.pill === "Your customer" ? "plain" : "green"}>{c.pill}</Pill>
    <span className="mt-2 block font-display text-lg font-semibold leading-tight">{c.owner}</span>
    {c.hvSuburb && <span className="mt-0.5 block text-sm text-sub">{c.hvSuburb}</span>}
    <span className="mt-2 block text-base font-semibold">{c.step}</span>
    <span className="mt-0.5 block text-sm text-sub">{c.reason}{c.by ? ` · book by ${dayWords(c.by)}` : ""}{c.overdue ? <span className="font-semibold text-rose"> · overdue</span> : null}</span>
  </>);
}
