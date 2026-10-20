import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card } from "@/components/trade/TradeShell";
import { useState } from "react";
import { getTradeBusiness, requestTeamLoginInvite } from "@/lib/trade-view.functions";

export const Route = createFileRoute("/_authenticated/field/business_/team")({
  head: () => ({ meta: [{ title: "Team – Home Insulation Victoria" }, { name: "description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:title", content: "Team – Home Insulation Victoria" }, { property: "og:description", content: "The people in your business who can see Home Insulation Victoria jobs." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Team,
});

function Team() {
  const load = useServerFn(getTradeBusiness);
  const { data, error } = useQuery({ queryKey: ["trade-business"], queryFn: () => load() });
  const invite = useServerFn(requestTeamLoginInvite);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const installer = data?.kind !== "electrician";
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <Link to="/field/business" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <h1 className="font-display text-[26px] font-bold leading-tight">Team</h1>
      {data?.boss && <Link to="/partner/workers" data-add-team className="flex h-12 w-full items-center justify-center rounded-[10px] bg-action px-4 text-[13px] font-bold text-action-foreground md:w-auto">Add or manage team members</Link>}
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : (<>
        <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">{data.team.map((t, i) => <li key={t.name + i} className="flex items-center justify-between gap-3 p-4"><span className="min-w-0"><span className="block font-bold">{t.name}</span><span className="block text-sm text-sub">{t.role}{t.hasLogin && t.role !== "Business owner" ? " · Has a login" : ""}</span></span>{data.boss && t.id && !t.hasLogin && (asked[t.id] ? <span className="text-sm font-bold text-estimate-green">{asked[t.id]}</span> : <button type="button" className="h-12 shrink-0 rounded-[10px] border-2 border-estimate-blue px-4 text-sm font-bold text-estimate-blue" onClick={async () => { const id = t.id!; try { await invite({ data: { workerId: id } }); setAsked((a) => ({ ...a, [id]: "Invite requested" })); } catch (e) { setAsked((a) => ({ ...a, [id]: (e as Error).message })); } }}>Send login invite</button>)}</li>)}</ul>
      </>)}
    </TradeShell>
  );
}

