import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { OfferCard, TradeTabs } from "@/components/portal/trade-work";
import { InstallerDayOffer } from "@/components/portal/install-days";
import { useMe } from "@/hooks/use-me";
import { partnerDashboard } from "@/lib/pilot.functions";
import { tradeTask } from "@/lib/trade-work.core";

export const Route = createFileRoute("/_authenticated/field/")({
  head: () => ({ meta: [{ title: "My work – Home Insulation Victoria" }, { name: "description", content: "Your job offers, things to do and booked visits." }, { property: "og:title", content: "My work – Home Insulation Victoria" }, { property: "og:description", content: "Your job offers, things to do and booked visits." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: MyWork,
});

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

function MyWork() {
  const { data: me } = useMe();
  const load = useServerFn(partnerDashboard);
  const { data, error, refetch } = useQuery({ queryKey: ["partner-dashboard"], queryFn: () => load(), refetchInterval: 60_000 });
  const [showWaiting, setShowWaiting] = useState(false);
  const installer = !!me?.roles.includes("installer");
  if (error) return <AppShell><div role="alert" className="rounded-[22px] border bg-card p-6 text-sm"><p>Your work couldn't load. Check your signal and try again.</p><button className="mt-3 font-semibold text-primary underline" onClick={() => refetch()}>Try again</button></div><TradeTabs installer={installer} /></AppShell>;
  if (data === undefined) return <AppShell><p className="text-muted-foreground">Loading your work…</p><TradeTabs installer={installer} /></AppShell>;
  if (data === null) return <AppShell><p className="rounded-[22px] border bg-card p-6 text-sm text-muted-foreground">Your sign-in isn't linked to an approved business yet. Home Insulation Victoria will sort this out. Use "Message us" if it's urgent.</p></AppShell>;
  const tasks = data.jobs.map((j) => ({ j, t: tradeTask({ stage: j.stage, bookings: j.bookings, blockers: j.blockers, proposalPending: j.proposal_pending, trade: installer ? "installer" : "electrician" }) }));
  const needs = tasks.filter((x) => x.t.bucket === "needs_you");
  const coming = tasks.filter((x) => x.t.bucket === "coming_up");
  const waiting = tasks.filter((x) => x.t.bucket === "waiting");
  const card = ({ j, t }: (typeof tasks)[number]) => {
    const p = j.property as { address_line?: string | null; suburb?: string | null } | null;
    return (
      <Link key={j.id} to="/field/$jobId" params={{ jobId: j.id }} className="flex items-center gap-3 rounded-[22px] border bg-card p-4 shadow-sm">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t.label}</div>
          <div className="truncate text-sm text-muted-foreground">{[j.owner, p?.address_line ?? p?.suburb].filter(Boolean).join(" · ") || "Address shows once the visit is arranged"}</div>
          {t.reason && <div className="mt-1 text-sm text-danger">{t.reason}</div>}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
    );
  };
  return (
    <AppShell>
      <div className="pb-20">
        <h1 className="font-display text-2xl font-extrabold">My work</h1>
        <p className="mb-4 text-sm text-muted-foreground">{(data.business as { name?: string }).name}</p>
        {data.blocker && <p className="mb-4 rounded-[22px] border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">{data.blocker}</p>}
        {(data.offers.length > 0 || !!data.installDays?.length) && <section className="mb-6"><h2 className="mb-2 font-display text-lg font-extrabold">New job offers</h2><div className="grid gap-3 sm:grid-cols-2">{data.offers.map((o) => <OfferCard key={o.id} o={o} onDone={refetch} />)}{data.installDays?.map((o) => <InstallerDayOffer key={o.job_id} o={o} onDone={refetch} />)}</div></section>}
        <section className="mb-6"><h2 className="mb-2 font-display text-lg font-extrabold">Needs you</h2>{needs.length ? <div className="grid gap-3">{needs.map(card)}</div> : <p className="rounded-[22px] border bg-card p-4 text-sm text-muted-foreground">Nothing for you to do right now.</p>}</section>
        <section className="mb-6"><h2 className="mb-2 font-display text-lg font-extrabold">Coming up</h2>{coming.length ? <div className="grid grid-cols-1 gap-3">{coming.map(({ j, t }) => { const b = j.bookings[0]; const p = j.property as { address_line?: string | null; suburb?: string | null } | null; return <Link key={j.id} to="/field/$jobId" params={{ jobId: j.id }} className="flex min-w-0 items-center gap-3 rounded-[22px] border bg-card p-4 shadow-sm"><CalendarDays className="h-6 w-6 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="font-semibold">{b ? when(b.scheduled_start) : t.label}</div><div className="line-clamp-2 break-words text-sm text-muted-foreground">{t.label} · {[j.owner, p?.address_line ?? p?.suburb].filter(Boolean).join(" · ")}</div></div><ChevronRight className="h-5 w-5 text-muted-foreground" /></Link>; })}</div> : <p className="rounded-[22px] border bg-card p-4 text-sm text-muted-foreground">No booked visits.</p>}</section>
        {waiting.length > 0 && <section><button className="mb-2 flex w-full items-center justify-between rounded-[22px] border bg-card p-4 text-left font-semibold" aria-expanded={showWaiting} onClick={() => setShowWaiting((v) => !v)}>Waiting on others ({waiting.length})<ChevronDown className={`h-5 w-5 transition ${showWaiting ? "rotate-180" : ""}`} /></button>{showWaiting && <div className="grid gap-3">{waiting.map(card)}</div>}</section>}
      </div>
      <TradeTabs installer={installer} />
    </AppShell>
  );
}
