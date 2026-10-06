import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs } from "@/components/portal/trade-work";
import { useMe } from "@/hooks/use-me";
import { getTradeMoney } from "@/lib/jo-tradie.functions";

export const Route = createFileRoute("/_authenticated/partner/payments")({
  head: () => ({ meta: [{ title: "Money – Home Insulation Victoria" }, { name: "description", content: "What's coming your way and what you've earned." }, { property: "og:title", content: "Money – Home Insulation Victoria" }, { property: "og:description", content: "What's coming your way and what you've earned." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Money,
});

const aud = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

function Money() {
  const { data: me } = useMe();
  const load = useServerFn(getTradeMoney);
  const { data } = useQuery({ queryKey: ["trade-money"], queryFn: () => load(), refetchInterval: 30_000 });
  return (
    <AppShell>
      <div className="mx-auto max-w-md space-y-4 pb-24">
        <h1 className="font-display text-2xl font-extrabold">Money</h1>
        {!data ? <p className="text-muted-foreground">Loading…</p> : (
          <>
            <div className="rounded-[22px] bg-primary p-5 text-primary-foreground shadow-sm">
              <div className="text-xs font-semibold opacity-90">Coming your way</div>
              <div className="font-display text-3xl font-extrabold">{aud(data.upcoming)}</div>
              <div className="text-sm opacity-90">The office marks each job paid.</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[22px] border bg-card p-4"><div className="text-xs text-muted-foreground">This month</div><div className="font-display text-xl font-extrabold">{aud(data.month)}</div></div>
              <div className="rounded-[22px] border bg-card p-4"><div className="text-xs text-muted-foreground">All time</div><div className="font-display text-xl font-extrabold">{aud(data.allTime)}</div></div>
            </div>
            <section>
              <h2 className="mb-2 font-display text-lg font-extrabold">Jobs</h2>
              {data.rows.length ? <div className="space-y-2">{data.rows.map((r) => (
                <div key={r.jobId} className="flex items-center justify-between gap-3 rounded-[22px] border bg-card p-4"><div className="min-w-0"><div className="font-semibold">{r.suburb ?? "Job"} · {r.jobNumber}</div><div className="text-sm text-muted-foreground">{r.status}</div></div><div className="font-display text-lg font-extrabold">{aud(r.amount)}</div></div>
              ))}</div> : <p className="rounded-[22px] border bg-card p-4 text-sm text-muted-foreground">No jobs yet. Your first one will show here.</p>}
            </section>
          </>
        )}
      </div>
      <TradeTabs installer={!!me?.roles.includes("installer")} />
    </AppShell>
  );
}
