import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, PlusCircle, UploadCloud, Zap } from "lucide-react";
import { TradeShell, aud, card } from "@/components/trade/TradeShell";
import { getTradeHome } from "@/lib/trade-view.functions";
import { dayTile, goneIn, tradeGreeting } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My work – Home Insulation Victoria" }, { name: "description", content: "Fresh jobs, what needs you and what's coming up." }, { property: "og:title", content: "My work – Home Insulation Victoria" }, { property: "og:description", content: "Fresh jobs, what needs you and what's coming up." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MyWork,
});

function MyWork() {
  const load = useServerFn(getTradeHome);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-home"], queryFn: () => load(), refetchInterval: 60_000 });
  if (error) return <TradeShell installer={false}><div role="alert" className={card}><p className="text-sm">Your work couldn't load. Check your signal and try again.</p><button className="mt-3 font-bold text-estimate-blue" onClick={() => refetch()}>Try again</button></div></TradeShell>;
  if (data === undefined) return <TradeShell installer={false}><p className="text-sm">Loading your work…</p></TradeShell>;
  if (data === null) return <TradeShell installer={false}><p className={`${card} text-sm`}>Your sign-in isn't linked to an approved business yet. Home Insulation Victoria will sort this out.</p></TradeShell>;
  const installer = data.kind === "installer";
  const g = tradeGreeting(data.firstName, data.week);
  const first = data.offers[0];
  return (
    <TradeShell installer={installer} boss={data.boss} test={data.isTest}>
      <div><h1 className="font-display text-3xl font-extrabold">{g.title}</h1><p className="text-sm">{g.sub}</p></div>
      {installer && data.boss && (
        <div className="grid grid-cols-2 gap-2" data-upload-actions>
          <Link to="/partner/bulk-import" className="flex h-14 items-center justify-center gap-2 rounded-[22px] bg-estimate-green px-3 font-bold text-white"><UploadCloud className="h-5 w-5" />Upload jobs</Link>
          <Link to="/partner/import" className="flex h-14 items-center justify-center gap-2 rounded-[22px] border-2 border-estimate-blue bg-card px-3 font-bold text-estimate-blue"><PlusCircle className="h-5 w-5" />Add one job</Link>
        </div>
      )}
      {first && (
        <Link to="/field/offer/$offerId" params={{ offerId: first.id }} className="flex items-center gap-3 rounded-[22px] bg-estimate-navy p-4 text-estimate-canvas shadow-sm">
          <Zap className="h-6 w-6 shrink-0 text-owner-house-pink" />
          <span className="min-w-0 flex-1"><span className="block font-display text-lg font-extrabold">{data.offers.length} fresh job{data.offers.length === 1 ? "" : "s"} up for grabs</span><span className="block truncate text-sm text-estimate-canvas/85">{first.suburb ?? "Victoria"}{installer ? " · Ready Check" : ""}{first.expiresAt ? ` · ${(goneIn(first.expiresAt) ?? "").toLowerCase()}` : ""}</span></span>
          <span className="rounded-full bg-estimate-green px-4 py-2 text-sm font-bold text-white">Grab it</span>
        </Link>
      )}
      {data.yourMove.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-extrabold">Your move <span className="rounded-full bg-owner-house-pink px-2 text-sm">{data.yourMove.length}</span></h2>
          <div className="space-y-2">{data.yourMove.map((m) => (
            <Link key={m.jobId + m.title} to="/field/$jobId" params={{ jobId: m.jobId }} className="flex items-center gap-3 rounded-[22px] border-2 border-estimate-green bg-card p-4"><span className="min-w-0 flex-1"><span className="block font-bold">{m.title}</span><span className="block truncate text-sm text-estimate-navy/70">{m.detail}</span></span><ChevronRight className="h-5 w-5" /></Link>
          ))}</div>
        </section>
      )}
      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">Coming up</h2>
        {data.coming.length ? <div className="space-y-2">{data.coming.map((b) => { const t = dayTile(b.start); return (
          <Link key={b.jobId + b.start} to="/field/day/$jobId" params={{ jobId: b.jobId }} className="flex items-center gap-3 rounded-[22px] bg-card p-3 shadow-sm">
            <span className="flex w-20 shrink-0 flex-col items-center rounded-2xl bg-estimate-mist py-2"><span className="text-xs font-bold">{t.day}</span><span className="text-xs">{t.window}</span></span>
            <span className="min-w-0 flex-1"><span className="block font-bold">{b.what} · {b.surname}</span><span className="block truncate text-sm text-estimate-navy/70">{b.address}</span></span><ChevronRight className="h-5 w-5" />
          </Link>); })}</div> : <p className={`${card} text-sm`}>Nothing booked yet.</p>}
      </section>
      {data.month && <section className="flex items-center justify-between rounded-[22px] bg-estimate-green-soft p-4">
        <span><span className="block text-xs font-bold uppercase tracking-wide">This month</span><span className="font-bold">{data.month.jobs} {installer ? `install${data.month.jobs === 1 ? "" : "s"}` : `job${data.month.jobs === 1 ? "" : "s"}`} done</span></span>
        <span className="font-display text-2xl font-extrabold">{aud(data.month.earned)}</span>
      </section>}
    </TradeShell>
  );
}
