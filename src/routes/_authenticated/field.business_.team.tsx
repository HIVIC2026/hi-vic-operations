import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { navyBtn } from "@/components/trade/business-pages";
import { getTradeBusiness } from "@/lib/trade-view.functions";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

function Team() {
  const load = useServerFn(getTradeBusiness);
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const installer = data?.kind !== "electrician";
  return (
    <TradeShell installer={installer} boss={data?.boss ?? true}>
      <Link to="/field/business" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <div><h1 className="font-display text-3xl font-extrabold">Team</h1><p className="mt-1 text-sm text-estimate-navy/70">Everyone here sees the jobs you give them.</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : (<>
        <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">{data.team.map((t, i) => <li key={t.name + i} className="flex items-center justify-between p-4"><span className="font-bold">{t.name}</span><span className="text-sm text-estimate-navy/70">{t.role}</span></li>)}</ul>
        {data.boss && <Link to="/partner/workers" className={navyBtn}>Add someone</Link>}
      </>)}
    </TradeShell>
  );
}
