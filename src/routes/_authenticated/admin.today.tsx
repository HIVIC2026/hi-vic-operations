import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getTodayBrief } from "@/lib/daily-brief.functions";
import { getLaunchCampaignOffice } from "@/lib/launch-campaign.functions";
import type { BriefNeed } from "@/lib/daily-brief.core";
import { QuotesToCheck } from "@/components/portal/QuotesToCheck";
import { NewFromInstallers } from "@/components/portal/NewFromInstallers";

const T = "Today – Home Insulation Victoria Portal";
const D = "Daily brief for the Accredited Person: what needs you, what is at risk this week and yesterday's numbers.";
export const Route = createFileRoute("/_authenticated/admin/today")({
  head: () => ({ meta: [{ title: T }, { name: "description", content: D }, { property: "og:title", content: T }, { property: "og:description", content: D }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: TodayPage,
});

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }) : "");
const RISK = { clock_30_day: "30-day clock", esc_deadline: "ESC deadline", prestart_not_passed: "Pre-start check" } as const;

function NeedGroup({ title, items, tone }: { title: string; items: BriefNeed[]; tone: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className={`font-heading text-base font-bold ${tone}`}>{title} ({items.length})</h3>
      {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Nothing.</p> : (
        <ul className="mt-2 space-y-1 text-sm">{items.slice(0, 12).map((n, i) => <li key={i}><span className="font-semibold">{n.jobNumber ?? "—"}</span> · {n.why}</li>)}</ul>
      )}
      {items.length > 12 && <p className="mt-1 text-xs text-muted-foreground">+{items.length - 12} more on the needs-attention list.</p>}
    </div>
  );
}

function TodayPage() {
  const load = useServerFn(getTodayBrief);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["today-brief"], queryFn: () => load(), staleTime: 60_000 });
  const loadSpots = useServerFn(getLaunchCampaignOffice);
  const { data: spots } = useQuery({ queryKey: ["launch_campaign_office"], queryFn: () => loadSpots(), staleTime: 60_000 });
  return (
    <AppShell>
      <div className="space-y-6">
        <NewFromInstallers />
        <QuotesToCheck />
        <div>
          <h1 className="font-heading text-2xl font-bold">Today</h1>
          <p className="text-sm text-muted-foreground">
            {data?.stored ? `This morning's brief was made at ${fmt(data.stored.createdAt)}. Sending is off, so it is shown here only.` : "This morning's brief is made at 7am Melbourne. Sending is off, so it is shown here only."} Figures below are live.
          </p>
        </div>
        {!!spots?.counts.spotSaved && <section className="border bg-card p-4"><h2 className="font-heading text-lg font-bold">Spots saved: {spots.counts.spotSaved}</h2><div className="mt-2 space-y-1 text-sm">{spots.rows.filter((r) => r.spotSavedAt && !r.optedOutAt).slice(0, 10).map((r) => <p key={r.id}><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="font-semibold text-primary underline">{r.owner || r.jobNumber || "Enquiry"}</Link> · {r.property}</p>)}</div><Link to="/admin/launch-campaign" className="mt-3 inline-block text-sm text-primary underline">See all saved spots</Link></section>}
        {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Could not load the brief: {(error as Error).message} <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div>}
        {data && (() => { const b = data.brief; return (<>
          <section className="space-y-3">
            <h2 className="font-heading text-lg font-bold">What needs you</h2>
            <p className="text-sm">Jobs waiting for Final check: <span className="font-bold">{b.apQueue}</span></p>
            <div className="grid gap-3 md:grid-cols-3">
              <NeedGroup title="Urgent" items={b.needs.urgent} tone="text-danger" />
              <NeedGroup title="Today" items={b.needs.today} tone="text-foreground" />
              <NeedGroup title="Soon" items={b.needs.soon} tone="text-muted-foreground" />
            </div>
            <Link to="/admin/needs-me" className="text-sm font-semibold text-primary underline">Open Needs me</Link>
          </section>
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-bold">At risk this week</h2>
            {b.atRisk.length === 0 ? <p className="text-sm text-muted-foreground">Nothing at risk in the next 7 days.</p> : (
              <ul className="divide-y rounded-lg border bg-card text-sm">{b.atRisk.map((r, i) => <li key={i} className="flex flex-wrap gap-x-3 p-3"><span className="font-bold">{RISK[r.kind]}</span><span className="font-semibold">{r.jobNumber ?? "—"}</span><span>{r.detail}</span><span className="text-muted-foreground">{r.kind === "clock_30_day" ? r.when : fmt(r.when)}</span></li>)}</ul>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-bold">Yesterday ({b.yesterday.day})</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([["Enquiries", b.yesterday.enquiries], ["Bookings", b.yesterday.bookings], ["Installs done", b.yesterday.installs], ["VEECs submitted", b.yesterday.veecsSubmitted], ["VEECs registered", b.yesterday.veecsRegistered]] as const).map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="font-heading text-2xl font-bold">{v}</div></div>
              ))}
            </div>
          </section>
        </>); })()}
      </div>
    </AppShell>
  );
}
