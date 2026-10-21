import { InstallerFactsLine } from "@/components/portal/installer-job-facts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, PlusCircle } from "lucide-react";
import { TradeShell, aud, card } from "@/components/trade/TradeShell";
import { NowPanel, Pill, btnClass } from "@/components/portal/kit";
import { useState } from "react";
import { StatusLineView } from "@/components/trade/job-status";
import { getTradeHome } from "@/lib/trade-view.functions";
import { dayTile, goneIn, tradeGreeting } from "@/lib/trade-view.core";
import { SourceBadge } from "@/components/portal/badges";
import { INSTALLER_TABS, type InstallerTab } from "@/lib/installer-progress.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My work – Home Insulation Victoria" }, { name: "description", content: "New job offers, what needs you and what's coming up." }, { property: "og:title", content: "My work – Home Insulation Victoria" }, { property: "og:description", content: "New job offers, what needs you and what's coming up." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MyWork,
});

function MyWork() {
  const load = useServerFn(getTradeHome);
  const [onlyChasing, setOnlyChasing] = useState(false);
  const [onlyMoving, setOnlyMoving] = useState(false);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-home"], queryFn: () => load(), refetchInterval: 60_000 });
  if (error) return <TradeShell installer={false}><div role="alert" className={card}><p className="text-sm">Your work couldn't load. Check your signal and try again.</p><button className="mt-3 min-h-11 font-bold text-estimate-blue" onClick={() => refetch()}>Try again</button></div></TradeShell>;
  if (data === undefined) return <TradeShell installer={false}><p className="text-sm">Loading your work…</p></TradeShell>;
  if (data === null) return <TradeShell installer={false}><p className={`${card} text-sm`}>Your sign-in isn't linked to an approved business yet. Home Insulation Victoria will sort this out.</p></TradeShell>;
  const installer = data.kind === "installer";
  const g = tradeGreeting(data.firstName, data.week);
  const first = data.offers[0];
  const chasing = data.jobs.filter((j) => j.line && j.line.tone !== "ok");
  const moving = data.jobs.filter((j) => j.place === "moving");
  const shown = onlyMoving ? moving : onlyChasing ? chasing : data.jobs;
  return (
    <TradeShell installer={installer} boss={data.boss} test={data.isTest}>
      <div><h1 className="font-display text-[26px] font-bold leading-tight">{g.title}</h1><p className="text-sm text-sub">{g.sub}</p></div>
      {!installer && <div className="grid grid-cols-2 gap-2" data-work-tiles>
        {([
          ["Offers", data.offers.length, installer ? "Free Ready Check" : "Pre Insulation Electrical Safety Assessment (PIESA)"],
          ["Needs me", data.yourMove.length, "Your next actions"],
          ["Moving automatically", data.jobs.filter((j) => j.place === "moving").length, "No action needed now"],
          ["Coming up", data.coming.length, "Booked visits"],
        ] as [string, number, string][]).map(([k, n, s]) => (
          <div key={k} className="rounded-[18px] border border-line bg-paper p-3.5"><p className="text-xs font-semibold text-estimate-navy">{k}</p><p className="mt-1 font-display text-2xl font-bold">{n}</p><p className="mt-1 text-[11px] text-sub">{s}</p></div>
        ))}
      </div>}
      {installer && data.boss && (
        <div data-upload-actions>
          <Link to="/partner/import" className={btnClass("primary", "w-full")}><PlusCircle className="h-4 w-4" />Add a job</Link>
        </div>
      )}
      {first ? (
        <NowPanel attention eyebrow={`${data.offers.length} new job offer${data.offers.length === 1 ? "" : "s"}`} due={first.expiresAt ? goneIn(first.expiresAt) : undefined}
          status={`${installer ? "Ready Check" : "Pre Insulation Electrical Safety Assessment (PIESA)"} in ${first.suburb ?? "Victoria"}`}
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
              <span className="min-w-0 flex-1"><span className="block font-bold">{installer ? "Ready Check" : "Pre Insulation Electrical Safety Assessment (PIESA)"} in {o.suburb ?? "Victoria"}</span>{o.expiresAt && <span className="block text-sm text-sub">{goneIn(o.expiresAt)}</span>}</span><ChevronRight className="h-5 w-5" />
            </Link>))}</div>
        </section>
      )}
      {!installer && data.yourMove.length > 0 && (
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
            <span className="flex w-20 shrink-0 flex-col items-center rounded-2xl bg-estimate-mist py-2"><span className="text-xs font-bold">{t.day}</span><span className="text-xs">{t.window}</span></span>
            <span className="min-w-0 flex-1"><span className="block font-bold">{b.what} · {b.surname}</span><span className="block truncate text-sm text-sub">{b.address}</span></span><ChevronRight className="h-5 w-5" />
          </Link>); })}</div> : <p className={`${card} text-sm`}>Nothing booked yet.</p>}
      </section>
      {installer ? <InstallerJobs jobs={data.jobs} done={data.done} moves={data.yourMove} offers={data.offers.length} /> : (
      data.jobs.length > 0 && (
        <section data-your-jobs>
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-base font-bold">Your jobs <span className="text-sm font-semibold text-sub">{data.jobs.length}</span></h2>
            <div className="flex gap-1" role="group" aria-label="Filter jobs"><button className={btnClass(onlyChasing || onlyMoving ? "secondary" : "primary", "min-h-[34px] px-3")} aria-pressed={!onlyChasing && !onlyMoving} onClick={() => { setOnlyChasing(false); setOnlyMoving(false); }}>All</button><button data-moving-filter className={btnClass(onlyMoving ? "primary" : "secondary", "min-h-[34px] px-3")} aria-pressed={onlyMoving} onClick={() => { setOnlyMoving(true); setOnlyChasing(false); }}>Moving automatically ({moving.length})</button><button data-needs-chasing className={btnClass(onlyChasing ? "primary" : "secondary", "min-h-[34px] px-3")} aria-pressed={onlyChasing} onClick={() => { setOnlyChasing(true); setOnlyMoving(false); }}>Needs chasing{chasing.length ? ` (${chasing.length})` : ""}</button></div></div>
          {onlyChasing && !shown.length && <p className={`${card} text-sm`}>Nothing needs chasing right now.</p>}
          <div className="space-y-2">{shown.map((j) => (
            <Link key={j.jobId} to="/field/$jobId" params={{ jobId: j.jobId }} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3">
              <span className="min-w-0 flex-1"><span className="block font-bold">{j.jobNumber} · {j.owner ?? "Owner"}</span><span className="mt-1 block"><SourceBadge channel={j.channel} /></span><span className="block truncate text-sm text-sub">{j.address}</span><span className="mt-1 block">{j.line ? <StatusLineView line={j.line} compact /> : <Pill>{j.status}</Pill>}</span><span className="mt-1 block"><InstallerFactsLine facts={j.facts} /></span></span><ChevronRight className="h-5 w-5" />
            </Link>))}</div>
        </section>
      ))}
      {data.month && <section className="flex items-center justify-between rounded-[18px] border border-line bg-mint p-4">
        <span><span className="block text-xs font-bold uppercase tracking-wide">This month</span><span className="font-bold">{data.month.jobs} {installer ? `install${data.month.jobs === 1 ? "" : "s"}` : `job${data.month.jobs === 1 ? "" : "s"}`} done</span></span>
        <span className="font-display text-2xl font-bold">{aud(data.month.earned)}</span>
      </section>}
    </TradeShell>
  );
}

type HomeJob = { jobId: string; jobNumber: string | number | null; owner: string | null; address: string; tab: InstallerTab; status: string; channel: string | null; place?: "offers" | "needs_me" | "coming_up" | "moving"; line: { text: string; who: string | null } | null };
export function InstallerJobs({ jobs, done, moves, offers, initialTab = "action" }: { jobs: HomeJob[]; done: { jobId: string; jobNumber: string | number | null; suburb: string | null; reason: string; open: boolean }[]; moves: { jobId: string; title: string }[]; offers: number; initialTab?: InstallerTab }) {
  const [tab, setTab] = useState<InstallerTab>(initialTab);
  const count = (k: InstallerTab) => (k === "done" ? done.length : jobs.filter((j) => j.tab === k).length);
  const shown = jobs.filter((j) => j.tab === tab);
  const nextOf = (j: HomeJob) => {
    const m = moves.find((x) => x.jobId === j.jobId);
    if (m) return { who: "You", text: m.title };
    if (j.line) return { who: j.line.who, text: j.line.text };
    return { who: "Home Insulation Victoria", text: j.status };
  };
  return (
    <section data-your-jobs>
      <h2 className="mb-2 font-display text-base font-bold">Jobs</h2>
      <div className="grid grid-cols-3 gap-1 rounded-[14px] border border-line bg-paper p-1" role="tablist" aria-label="Jobs">
        {INSTALLER_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} data-tab={t.key} onClick={() => setTab(t.key)}
            className={`min-h-[44px] rounded-[10px] px-2 text-sm font-semibold ${tab === t.key ? "bg-action text-primary-foreground" : "text-ink hover:bg-estimate-mist"}`}>
            {t.label} <span className="font-normal">({count(t.key)})</span>
          </button>
        ))}
      </div>
      {tab === "action" && offers > 0 && <p className="mt-2 text-sm text-sub">{offers} job offer{offers === 1 ? "" : "s"} waiting above.</p>}
      <div className="mt-2 space-y-2" role="tabpanel">
        {tab === "action" && !shown.length && <p className={`${card} text-sm`}>Nothing needs you right now.</p>}
        {tab === "action" && (() => {
          const needsYou = shown.filter((j) => j.place === "needs_me" || !j.place);
          const offerJobs = shown.filter((j) => j.place === "offers");
          const jobLink = (j: HomeJob) => { const n = nextOf(j); return (
            <Link key={j.jobId} to="/field/$jobId" params={{ jobId: j.jobId }} data-job-card className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3 hover:border-action">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{j.jobNumber} · {j.owner ?? "Owner"}</span>
                <span className="mt-1 block"><SourceBadge channel={j.channel} /></span>
                <span className="block truncate text-sm text-sub">{j.address}</span>
                <span className="mt-1 block text-sm"><span className="font-semibold text-estimate-navy">Next{n.who ? ` — ${n.who}` : ""}:</span> {n.text}</span>
              </span><ChevronRight className="h-5 w-5" />
            </Link>); };
          return (<>
            {needsYou.length > 0 && <p className="pt-1 text-xs font-bold uppercase tracking-wide text-sub" data-job-group="needs-you">Needs you <span className="font-semibold">({needsYou.length})</span></p>}
            {needsYou.map(jobLink)}
            {offerJobs.length > 0 && needsYou.length > 0 && <p className="pt-3 text-xs font-bold uppercase tracking-wide text-sub" data-job-group="offers">Job offers <span className="font-semibold">({offerJobs.length})</span></p>}
            {offerJobs.length > 0 && needsYou.length === 0 && <p className="pt-1 text-xs font-bold uppercase tracking-wide text-sub" data-job-group="offers">Job offers <span className="font-semibold">({offerJobs.length})</span></p>}
            {offerJobs.map(jobLink)}
          </>);
        })()}
        {tab === "progress" && !shown.length && <p className={`${card} text-sm`}>No jobs in progress.</p>}
        {tab === "progress" && shown.map((j) => { const n = nextOf(j); return (
          <Link key={j.jobId} to="/field/$jobId" params={{ jobId: j.jobId }} data-job-card className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3 hover:border-action">
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{j.jobNumber} · {j.owner ?? "Owner"}</span>
              <span className="mt-1 block"><SourceBadge channel={j.channel} /></span>
              <span className="block truncate text-sm text-sub">{j.address}</span>
              <span className="mt-1 block text-sm"><span className="font-semibold text-estimate-navy">Next{n.who ? ` — ${n.who}` : ""}:</span> {n.text}</span>
              {j.place === "coming_up" && <span className="mt-1 inline-block rounded-full bg-estimate-mist px-2 py-0.5 text-[11px] font-semibold text-estimate-navy" data-upcoming-badge>Upcoming visit</span>}
            </span><ChevronRight className="h-5 w-5" />
          </Link>); })}
        {tab === "done" && (done.length ? done.map((d) => d.open ? (
          <Link key={d.jobId} to="/field/$jobId" params={{ jobId: d.jobId }} data-done-card className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3">
            <span className="min-w-0 flex-1"><span className="block font-bold">{d.jobNumber}{d.suburb ? ` · ${d.suburb}` : ""}</span><span className="block text-sm text-sub">{d.reason}</span></span><ChevronRight className="h-5 w-5" />
          </Link>
        ) : (
          <div key={d.jobId} data-done-card data-readonly className="rounded-[14px] border border-line bg-paper p-3">
            <span className="block font-bold">{d.jobNumber}{d.suburb ? ` · ${d.suburb}` : ""}</span><span className="block text-sm text-sub">{d.reason} · summary only</span>
          </div>
        )) : <p className={`${card} text-sm`}>No finished jobs yet.</p>)}
      </div>
    </section>
  );
}
