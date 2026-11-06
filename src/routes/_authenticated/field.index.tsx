import { createFileRoute, Link } from "@tanstack/react-router";
import { readTradeCache, writeTradeCache } from "@/lib/trade-cache";
import { headStartOr, startTradeScreen } from "@/lib/trade-route-prefetch";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell, card, inputCls } from "@/components/trade/TradeShell";
import { useMemo, useState } from "react";
import { getTradeHome, getTradeStops } from "@/lib/trade-view.functions";
import { NO_LOGIN_NEEDED } from "@/lib/trade-access-role.core";
import { actionItems, thisWeek, type ActionCard, type ActionRow, type WaitingCard, type WeekItem } from "@/lib/action-items.core";
import { RELEASED_SCREENS } from "@/lib/trade-menu.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "Action items – Home Insulation Victoria" }, { name: "description", content: "What needs you today and what's on this week." }, { property: "og:title", content: "Action items – Home Insulation Victoria" }, { property: "og:description", content: "What needs you today and what's on this week." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  // Speed: the screen's server call starts as soon as the route matches, while this page's code downloads (trade-route-prefetch).
  loader: ({ context, params, preload }) => startTradeScreen(context, "home", params, preload),
  component: ActionItems,
});

// Action items (installer redesign, spec v2 §4.2; canvas "Action items" + "Action items · phone"): greeting, search,
// Fix before work starts · Your turn · Waiting on someone else (folded), and This week. Every fact comes from tradeHome.
const squash = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); // same rule as matchesSearch
const hit = (q: string, ...parts: (string | null | undefined)[]) => { const n = squash(q); return !n || parts.some((p) => squash(p).includes(n)); };

function ActionItems() {
  const load = useServerFn(getTradeHome);
  const loadStops = useServerFn(getTradeStops);
  const [q, setQ] = useState("");
  const [showWaiting, setShowWaiting] = useState(false);
  // staleTime (decision 280): coming back from a job shows the last answer at once; the 60s poll and every action's invalidation still refresh it.
  // Return visit: the last copy (this user only, under 24 h) shows at once; it is old, so a fresh copy still loads straight away.
  const uid = Route.useRouteContext().user.id;
  const seed = useMemo(() => readTradeCache<Awaited<ReturnType<typeof load>>>(uid, "home"), [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, refetch } = useQuery({ queryKey: ["trade-home"], queryFn: async () => { const d = await headStartOr(uid, ["trade-home"], () => load()); if (d) writeTradeCache(uid, "home", d); return d; }, refetchInterval: 60_000, staleTime: 20_000, ...(seed ? { initialData: seed.data, initialDataUpdatedAt: seed.at } : {}) });
  const home = data?.actionHome ?? null;
  // The stop check is read after the home, so the home never waits on it; until it lands, jobs sit in Your turn / Waiting.
  const ids = useMemo(() => (home?.rows ?? []).filter((r) => r.installAt).map((r) => r.jobId), [home]);
  const { data: stops } = useQuery({ queryKey: ["trade-stops", ids], queryFn: () => loadStops({ data: { jobIds: ids } }), enabled: ids.length > 0, staleTime: 60_000 });
  if (error) return <TradeShell installer={false}><div role="alert" className={card}><p className="text-sm">Your work couldn't load. Check your signal and try again.</p><button className="mt-3 min-h-11 font-bold text-estimate-blue" onClick={() => refetch()}>Try again</button></div></TradeShell>;
  if (data === undefined) return <TradeShell installer={false}><p className="text-sm">Loading your work…</p></TradeShell>;
  if (data === null) return <TradeShell installer={false}><p className={`${card} text-sm`}>Your sign-in isn't linked to an approved business yet. Home Insulation Victoria will sort this out.</p></TradeShell>;
  if (data.kind !== "installer") {
    // Electricians never log in (new job flow Part 6): an old electrician login that still gets here sees one plain line.
    return <TradeShell installer={false}><p className={`${card} text-base`} data-no-login>{NO_LOGIN_NEEDED}</p></TradeShell>;
  }
  if (!home) return <TradeShell installer boss={data.boss} money={data.money} test={data.isTest} redesign business={data.business}><p className="text-sm">Loading your work…</p></TradeShell>;

  const s = (stops ?? {}) as Record<string, string>;
  const ai = actionItems((home.rows as ActionRow[]).map((r) => ({ ...r, stop: s[r.jobId] ?? null })));
  const week = thisWeek((data.weekBookings ?? []).map((b) => ({ ...b, flag: b.kind === "installation" && s[b.jobId] ? "Fix before work starts" : null, flagTone: b.kind === "installation" && s[b.jobId] ? "red" as const : null })), new Date());
  const fix = ai.fix.filter((c) => hit(q, c.address, c.meta, c.action));
  const turn = ai.turn.filter((c) => hit(q, c.address, c.meta, c.action));
  const waiting = ai.waiting.filter((c) => hit(q, c.address, c.status));

  return (
    <TradeShell installer boss={data.boss} money={data.money} test={data.isTest} redesign actionCount={ai.count} business={data.business}>
      <div data-action-items className="space-y-4">
        <div>
          <h1 className="text-[24px] font-bold leading-[1.2] text-ink md:text-[28px]">{home.greeting}</h1>
          <p className="mt-1 text-[15px] text-sub">{ai.sub}</p>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, address or HV number" aria-label="Search name, address or HV number" className={`${inputCls} md:max-w-[420px]`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-6">
          {fix.length > 0 && (
            <section aria-labelledby="ai-fix" className="rounded-[14px] border border-rose/40 bg-danger-soft p-4">
              <h2 id="ai-fix" className="text-[15px] font-bold text-rose">Fix before work starts</h2>
              <ul className="mt-3 space-y-2">{fix.map((c) => <ActionRowView key={c.jobId} c={c} />)}</ul>
            </section>
          )}
          <section aria-labelledby="ai-turn">
            <h2 id="ai-turn" className="text-[15px] font-bold text-ink">Your turn</h2>
            {turn.length ? <ul className="mt-3 space-y-2">{turn.map((c) => <ActionRowView key={c.jobId} c={c} />)}</ul>
              : <p className="mt-2 text-sm text-sub">{q ? "No jobs match that." : "Nothing needs you right now."}</p>}
          </section>
          {waiting.length > 0 && (
            <section aria-labelledby="ai-waiting">
              <h2 id="ai-waiting" className="sr-only">Waiting on someone else</h2>
              <button type="button" aria-expanded={showWaiting} onClick={() => setShowWaiting((o) => !o)} className="flex min-h-11 w-full items-center justify-between rounded-[12px] border border-line bg-paper px-4 text-left text-[15px] font-bold text-ink">
                <span>Waiting on someone else</span><span className="text-sub">{waiting.length} {showWaiting ? "▴" : "▾"}</span>
              </button>
              {showWaiting && <ul className="mt-2 space-y-2">{waiting.map((c) => <WaitingRowView key={c.jobId} c={c} />)}</ul>}
            </section>
          )}
        </div>
        <ThisWeek items={week} />
      </div>
    </TradeShell>
  );
}

/** One job that needs the installer: what to do, where, who · HV · source, the due chip, and one button. */
function ActionRowView({ c }: { c: ActionCard }) {
  return (
    <li data-action-row className={`flex flex-col gap-3 rounded-[12px] border bg-paper p-4 sm:flex-row sm:items-center ${c.overdue ? "border-rose" : "border-line"}`}>
      <Link to="/field/$jobId" params={{ jobId: c.jobId }} className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-ink">{c.action}</span>
        <span className="mt-0.5 block text-sm text-ink">{c.address}</span>
        <span className="mt-0.5 block text-[13px] text-sub">{c.meta}</span>
        {c.due && <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${c.stop ? "bg-paper text-rose" : c.overdue ? "bg-danger-soft text-rose" : "bg-warning-soft text-warning"}`}>{c.due}{c.overdue ? " · overdue" : ""}</span>}
      </Link>
      <Link to="/field/$jobId" params={{ jobId: c.jobId }} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] bg-hiv-blue px-4 text-sm font-bold text-white hover:opacity-90">{c.button}</Link>
    </li>
  );
}

function WaitingRowView({ c }: { c: WaitingCard }) {
  return (
    <li data-waiting-row>
      <Link to="/field/$jobId" params={{ jobId: c.jobId }} className="block rounded-[12px] border border-line bg-paper p-4">
        <span className="block text-sm font-semibold text-ink">{c.address}</span>
        <span className="mt-0.5 block text-[13px] text-sub">{c.status}</span>
        <span className="mt-0.5 block text-[13px] text-sub">Waiting on {c.waitingOn}</span>
      </Link>
    </li>
  );
}

function ThisWeek({ items }: { items: WeekItem[] }) {
  return (
    <aside aria-labelledby="ai-week" className="rounded-[14px] border border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 id="ai-week" className="text-[15px] font-bold text-ink">This week</h2>
        {RELEASED_SCREENS.calendar && <Link to={"/field/calendar" as never} className="text-sm font-bold text-hiv-blue">Calendar</Link>}
      </div>
      {items.length ? (
        <ul className="mt-3 divide-y divide-line">
          {items.map((w, i) => (
            <li key={i} className="flex gap-3 py-2.5">
              <span className="w-10 shrink-0 text-center"><span className="block text-[11px] font-semibold uppercase text-sub">{w.day}</span><span className="block text-[17px] font-bold text-ink">{w.date}</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{w.kind} · {w.time}</span>
                <span className="block truncate text-[13px] text-sub">{[w.place, w.who].filter(Boolean).join(" · ")}</span>
                {w.flag && <span className={`mt-1 inline-flex text-xs font-semibold ${w.flagTone === "red" ? "text-rose" : "text-warning"}`}>{w.flag}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-sub">Nothing booked this week.</p>}
    </aside>
  );
}
