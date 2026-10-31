import { createFileRoute, Link } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { TradeShell, aud, card } from "@/components/trade/TradeShell";
import { NowPanel, Pill, btnClass } from "@/components/portal/kit";
import { useMemo, useState, type ReactNode } from "react";
import { StatusLineView } from "@/components/trade/job-status";
import { getTradeHome } from "@/lib/trade-view.functions";
import { ELECTRICIAN_WORK_WORDS, dayTile, goneIn, tradeGreeting } from "@/lib/trade-view.core";
import { electricianYourJobs } from "@/lib/work-places.core";
import { GROUP_LABEL, HOME_EMPTY, doneSub, homeIsEmpty, monthStripWords, offerPanelWords, offersListView, sourceLabel, type InstallerHomeRow } from "@/lib/installer-home.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My work – Home Insulation Victoria" }, { name: "description", content: "New job offers, what needs you and what's coming up." }, { property: "og:title", content: "My work – Home Insulation Victoria" }, { property: "og:description", content: "New job offers, what needs you and what's coming up." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "home", params, preload),
  component: MyWork,
});

// Mock-up M1 (Jo approved, decision 198): greeting · one job offer panel · Coming up (exact times) · Action needed /
// In progress / Done with one "Next:" line each · This month (business owner, own pay only). Presentation only — every
// fact comes from tradeHome (business-scoped) and the pure installer-home.core rules.
const EYEBROW = "text-xs font-bold uppercase tracking-[1.1px] text-sub";
const ROW = "flex items-center gap-3 border-b border-line py-3 min-h-[72px]";
const CHEVRON = <span aria-hidden className="text-xl leading-none text-sub">›</span>;

function MyWork() {
  const load = useServerFn(getTradeHome);
  const [onlyChasing, setOnlyChasing] = useState(false);
  const [onlyMoving, setOnlyMoving] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
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

  if (installer) {
    const home = data.home ?? { action: [], coming: [], progress: [], done: [] };
    const words = first ? offerPanelWords(first, data.offers.length) : null;
    // Approved state M1-more-offers: the "Job offers · N" list opens under the first offer and the rest folds (decision 235).
    const offersList = offersOpen ? offersListView(data.offers, goneIn) : null;
    const empty = homeIsEmpty({ offers: data.offers.length, coming: home.coming.length, action: home.action.length, progress: home.progress.length, done: data.done.length });
    return (
      <TradeShell installer boss={data.boss} test={data.isTest} redesign>
        <div data-my-work data-empty={empty || undefined}>
          <h1 className="font-display text-[22px] font-semibold leading-[1.2]">{g.title}</h1>
          <p className="mt-1 text-sm text-sub">{g.sub}</p>
        </div>

        {first && words && (
          <Link to="/field/offer/$offerId" params={{ offerId: first.id }} data-offer-panel className="block rounded-[18px] bg-mist px-4 pb-3.5 pt-4">
            <span className="block text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">{words.eyebrow}</span>
            <span className="mt-1.5 block text-[17px] font-semibold leading-[1.3]">{words.title}</span>
            <span className="mt-1 block text-sm text-sub">{words.detail}</span>
            {first.expiresAt && <span className="mt-0.5 block text-[13px] text-sub">{goneIn(first.expiresAt)}</span>}
            <span className="mt-3.5 flex min-h-12 items-center justify-center rounded-[12px] bg-hiv-blue text-base font-semibold text-white">View offer</span>
          </Link>
        )}
        {data.offers.length > 1 && (
          <button type="button" data-more-offers aria-expanded={offersOpen} onClick={() => setOffersOpen((o) => !o)} className="-mt-3 flex min-h-11 w-full items-center justify-between text-[15px] font-semibold text-hiv-blue">
            <span>{offersOpen ? "Hide the other offers" : `More offers · ${data.offers.length - 1}`}</span><span className="text-xl text-sub">{offersOpen ? "▴" : "›"}</span>
          </button>
        )}
        {offersList && (
          <section data-other-offers>
            <h2 className={`${EYEBROW} border-b border-line pb-2`}>{offersList.heading}</h2>
            {offersList.rows.map((o) => (
              <Link key={o.id} to="/field/offer/$offerId" params={{ offerId: o.id }} className="flex min-h-[60px] items-center gap-3 border-b border-line py-2.5">
                <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{o.title}</span><span className="mt-0.5 block text-sm text-sub">{o.detail}</span>{o.closes && <span className="block text-[13px] text-sub">{o.closes}</span>}</span>{CHEVRON}
              </Link>))}
            <p className="mt-2 text-[13px] leading-[1.45] text-sub">{offersList.note}</p>
          </section>
        )}

        <section data-coming-up>
          <h2 className={`${EYEBROW} border-b border-line pb-2`}>Coming up</h2>
          {data.coming.length ? data.coming.map((b) => { const t = dayTile(b.start); return (
            <Link key={b.jobId + b.start} to="/field/day/$jobId" params={{ jobId: b.jobId }} className="flex min-h-[60px] items-center gap-3.5 border-b border-line py-2.5">
              <span className="w-[74px] shrink-0 rounded-[12px] bg-mist py-2 text-center"><span className="block text-xs font-bold">{t.day}</span><span className="mt-0.5 block text-sm font-semibold text-hiv-blue">{t.time}</span></span>
              <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{b.what} · {b.surname}</span><span className="mt-0.5 block text-sm text-sub">{b.address}</span></span>{CHEVRON}
            </Link>); })
            : <p className="py-3 text-sm text-sub">{HOME_EMPTY.coming}</p>}
        </section>

        <JobGroup group="action" rows={home.action} empty={HOME_EMPTY.action} emptyAction={empty && data.boss ? <Link to="/partner/import" data-empty-add-job className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[12px] bg-hiv-blue text-base font-semibold text-white">{HOME_EMPTY.actionButton}</Link> : null} />
        <JobGroup group="progress" rows={home.progress} empty={HOME_EMPTY.progress} />
        <DoneGroup rows={data.done} />

        {data.boss && data.month && (() => { const m = monthStripWords(data.month); return (
          <Link to="/field/money" data-this-month className="flex min-h-14 items-center justify-between rounded-[14px] border border-line px-4 py-3.5">
            <span><span className="block text-[11px] font-bold uppercase tracking-[1.1px] text-sub">This month</span><span className="mt-[3px] block text-[15px] font-medium">{m.installs}</span></span>
            <span className="text-right"><span className="block text-[17px] font-semibold text-hiv-green">{m.paid}</span><span className="mt-0.5 block text-xs text-sub">Money ›</span></span>
          </Link>); })()}
      </TradeShell>
    );
  }

  // Electrician view (unchanged apart from the retired installer fact pills).
  const yourJobs = electricianYourJobs(data.jobs);
  const chasing = yourJobs.filter((j) => j.line && j.line.tone !== "ok");
  const moving = yourJobs.filter((j) => j.place === "moving");
  const shown = onlyMoving ? moving : onlyChasing ? chasing : yourJobs;
  return (
    <TradeShell installer={false} boss={data.boss} test={data.isTest}>
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

/** Action needed / In progress: address · job number + source label · one "Next:" line (blue when it's the installer's move). */
function JobGroup({ group, rows, empty, emptyAction }: { group: "action" | "progress"; rows: InstallerHomeRow[]; empty: string; emptyAction?: ReactNode }) {
  return (
    <section data-job-group={group}>
      <h2 className={`${EYEBROW} border-b border-line pb-2`}>{GROUP_LABEL[group]}{rows.length > 0 && <span className="font-medium normal-case tracking-normal"> · {rows.length}</span>}</h2>
      {rows.length ? rows.map((j) => (
        <Link key={j.jobId} to="/field/$jobId" params={{ jobId: j.jobId }} data-job-card className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{j.street ?? j.suburb ?? "Address to come"}</span>
            <span className="mt-0.5 block text-[13px] text-sub">{[j.jobNumber, sourceLabel(j.channel)].filter(Boolean).join(" · ")}</span>
            <span data-card-line className={`mt-1.5 block text-sm ${group === "action" ? "font-medium text-hiv-blue" : "text-ink"}`}>{j.next}</span>
          </span>{CHEVRON}
        </Link>
      )) : <p className="py-3 text-sm text-sub">{empty}</p>}
      {!rows.length && emptyAction}
    </section>
  );
}

/** Done: job number · suburb, then "source · Job complete {date}". Ended assignments stay read-only (no link, no owner data). */
function DoneGroup({ rows }: { rows: { jobId: string; jobNumber: string | number | null; suburb: string | null; channel: string | null; stage: string; endedAt: string | null; open: boolean }[] }) {
  const body = (d: (typeof rows)[number]) => (<>
    <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{[d.jobNumber, d.suburb].filter(Boolean).join(" · ")}</span><span className="mt-0.5 block text-[13px] text-sub">{doneSub(d.channel, d.stage, d.endedAt)}{d.open ? "" : " · summary only"}</span></span>{d.open ? CHEVRON : null}
  </>);
  return (
    <section data-job-group="done">
      <h2 className={`${EYEBROW} border-b border-line pb-2`}>{GROUP_LABEL.done} <span className="font-medium normal-case tracking-normal">· {rows.length}</span></h2>
      {rows.length ? rows.map((d) => d.open
        ? <Link key={d.jobId} to="/field/$jobId" params={{ jobId: d.jobId }} data-done-card className="flex min-h-14 items-center gap-3 border-b border-line py-2.5">{body(d)}</Link>
        : <div key={d.jobId} data-done-card data-readonly className="flex min-h-14 items-center gap-3 border-b border-line py-2.5">{body(d)}</div>)
        : <p className="py-3 text-sm text-sub">No finished jobs yet.</p>}
    </section>
  );
}
