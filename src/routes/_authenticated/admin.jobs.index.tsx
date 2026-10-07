import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { getJobsBoard } from "@/lib/office.functions";
import { BOARD_COLUMNS, ELIG_FILTERS, filterBoard, groupBoard, plainStage, type BoardJob, type EligFilter, type SourceFilter } from "@/lib/jobs-board.core";
import { cn } from "@/lib/utils";

type S = { elig?: EligFilter | undefined; src?: SourceFilter | undefined; test?: boolean | undefined };

export const Route = createFileRoute("/_authenticated/admin/jobs/")({
  head: () => ({ meta: [{ title: "Jobs – Home Insulation Victoria office" }, { name: "description", content: "Every job on one board, by stage." }, { property: "og:title", content: "Jobs – Home Insulation Victoria office" }, { property: "og:description", content: "Every job on one board, by stage." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): S => ({
    ...(["likely", "onsite", "not"].includes(s["elig"] as string) ? { elig: s["elig"] as EligFilter } : {}),
    ...(["hiv", "upload"].includes(s["src"] as string) ? { src: s["src"] as SourceFilter } : {}),
    ...(s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  }),
  component: JobsBoard,
});

function Chip({ on, children, search }: { on: boolean; children: React.ReactNode; search: (p: S) => S }) {
  return <Link to="/admin/jobs" search={search} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", on ? "border-foreground bg-foreground text-background" : "bg-card text-foreground hover:bg-workspace-mist")}>{children}</Link>;
}

function Card({ j }: { j: BoardJob }) {
  return (
    <Link to="/admin/jobs/$jobId" params={{ jobId: j.id }} className="block rounded-2xl border bg-card p-3 text-sm shadow-sm hover:border-primary">
      <div className="flex items-baseline justify-between gap-2"><span className="font-bold">{j.job_number}</span>{j.source === "qa_test" && <span className="rounded-full bg-workspace-blush px-1.5 text-[10px] font-bold">TEST</span>}</div>
      <div className="truncate">{j.owner_name ?? "No owner"}</div>
      <div className="truncate text-xs text-muted-foreground">{j.property_address}</div>
      <div className="mt-1 text-xs font-semibold text-primary">{plainStage(j.stage)}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold text-muted-foreground">
        {j.eligibility_outcome && <span className="rounded-full bg-workspace-mist px-1.5">{ELIG_FILTERS.find((e) => e.outcome === j.eligibility_outcome)?.label}</span>}
        {j.channel === "installer_sourced" && <span className="rounded-full bg-workspace-mist px-1.5">Installer upload</span>}
      </div>
    </Link>
  );
}

function JobsBoard() {
  const s = Route.useSearch();
  const load = useServerFn(getJobsBoard);
  const { data, error } = useQuery({ queryKey: ["jobs-board", !!s.test], queryFn: () => load({ data: { includeTest: !!s.test } }) });
  const [showEnded, setShowEnded] = useState(false);
  const g = useMemo(() => groupBoard(filterBoard(data ?? [], s)), [data, s]);
  const total = BOARD_COLUMNS.reduce((a, c) => a + g[c.key].length, 0);
  return (
    <AppShell wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-extrabold">Jobs</h1><p className="text-sm text-muted-foreground">{data ? `${total} active jobs` : "Loading…"}{s.test ? " · including TEST jobs" : ""}</p></div>
        <label className="flex items-center gap-2 text-sm font-semibold"><Link to="/admin/jobs" search={(p: S) => ({ ...p, test: p.test ? undefined : true })} role="switch" aria-checked={!!s.test} className={cn("relative h-6 w-11 rounded-full", s.test ? "bg-primary" : "bg-border")}><span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-card transition-all", s.test ? "left-5" : "left-0.5")} /></Link>Show TEST jobs</label>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filters">
        <span className="text-xs font-bold uppercase text-muted-foreground">Eligibility</span>
        {ELIG_FILTERS.map((e) => <Chip key={e.key} on={s.elig === e.key} search={(p) => ({ ...p, elig: p.elig === e.key ? undefined : e.key })}>{e.label}</Chip>)}
        <span className="ml-3 text-xs font-bold uppercase text-muted-foreground">Source</span>
        <Chip on={s.src === "hiv"} search={(p) => ({ ...p, src: p.src === "hiv" ? undefined : "hiv" })}>HIV lead</Chip>
        <Chip on={s.src === "upload"} search={(p) => ({ ...p, src: p.src === "upload" ? undefined : "upload" })}>Installer upload</Chip>
      </div>
      {error ? <div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">{(error as Error).message}</div> : (
        <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(6,minmax(220px,1fr))]">
          {BOARD_COLUMNS.map((c) => (
            <section key={c.key} aria-label={c.label} className="min-w-0 rounded-[22px] bg-workspace-mist/60 p-2">
              <h2 className="flex items-baseline justify-between px-1 pb-2 text-sm font-extrabold"><span>{c.label}</span><span className="tabular-nums text-muted-foreground">{g[c.key].length}</span></h2>
              <div className="grid max-h-[70vh] gap-2 overflow-y-auto">{g[c.key].slice(0, 150).map((j) => <Card key={j.id} j={j} />)}{g[c.key].length > 150 && <p className="px-1 text-xs text-muted-foreground">+{g[c.key].length - 150} more — use search or a filter.</p>}</div>
            </section>
          ))}
        </div>
      )}
      <section className="mt-5 rounded-[22px] border bg-card p-3">
        <button type="button" onClick={() => setShowEnded(!showEnded)} aria-expanded={showEnded} className="flex w-full items-center gap-2 text-sm font-bold"><ChevronDown className={cn("h-4 w-4 transition-transform", showEnded ? "" : "-rotate-90")} />Not active (on hold and cancelled) · {g.not_active.length}</button>
        {showEnded && <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{g.not_active.map((j) => <Card key={j.id} j={j} />)}</div>}
      </section>
    </AppShell>
  );
}
