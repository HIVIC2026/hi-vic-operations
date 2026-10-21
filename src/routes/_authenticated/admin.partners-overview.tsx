import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/portal/AppShell";
import { getPartnersOverview } from "@/lib/office.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/partners-overview")({
  head: () => ({ meta: [{ title: "Partners – Home Insulation Victoria" }, { name: "description", content: "Installers and electricians at a glance." }, { property: "og:title", content: "Partners – Home Insulation Victoria" }, { property: "og:description", content: "Installers and electricians at a glance." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PartnersOverview,
});

function PartnersOverview() {
  const load = useServerFn(getPartnersOverview);
  const { data, error } = useQuery({ queryKey: ["partners-overview"], queryFn: () => load() });
  if (error) return <AppShell wide><div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Partners couldn't load: {(error as Error).message}</div></AppShell>;
  if (!data) return <AppShell wide><p className="text-muted-foreground">Loading…</p></AppShell>;
  return (
    <AppShell wide>
      <h1 className="mb-4 font-display text-3xl font-extrabold">Partners</h1>
      {data.applications > 0 && <Link to="/admin/partners" search={{ enquiry: undefined }} className="mb-4 block rounded-[22px] border border-workspace-blush-strong bg-workspace-blush p-4 font-semibold">{data.applications} application{data.applications === 1 ? "" : "s"} waiting for approval → Review</Link>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((c) => (
          <section key={c.id} className="min-w-0 rounded-[22px] border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 data-partner-record-name className="truncate font-display text-lg font-extrabold">{c.name}</h2><p className="text-xs text-muted-foreground">{c.kind}</p></div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", c.status === "Active" ? "bg-workspace-mint" : c.status === "No rate" ? "bg-workspace-blush text-danger" : "bg-workspace-mist")}>{c.status}</span></div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Live jobs</dt><dd className="font-semibold">{c.liveJobs}</dd></div>
              <div><dt className="text-xs text-muted-foreground">On time</dt><dd className="font-semibold">{c.onTime != null ? `${c.onTime}%` : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Reply time</dt><dd className="font-semibold">{c.avgHrs != null ? `${c.avgHrs} h` : "—"}</dd></div>
            </dl>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
