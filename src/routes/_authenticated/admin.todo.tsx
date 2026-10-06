import { createFileRoute, Link } from "@tanstack/react-router";
import { NEEDS_TAB_SECTION } from "@/lib/allocation.core";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getTodos } from "@/lib/todo.functions";
import { getNeedsHivic } from "@/lib/allocation.functions";
import type { TodoItem } from "@/lib/todo.core";

const categoryStyle: Record<TodoItem["category"], string> = {
  Eligibility: "bg-task-eligibility text-task-eligibility-foreground",
  Scheduling: "bg-task-scheduling text-task-scheduling-foreground",
  Payments: "bg-task-payments text-task-payments-foreground",
  Pricing: "bg-task-pricing text-task-pricing-foreground",
  "Measure-up": "bg-task-measure text-task-measure-foreground",
  Compliance: "bg-task-compliance text-task-compliance-foreground",
  Partners: "bg-task-partners text-task-partners-foreground",
};

const categoryOrder: TodoItem["category"][] = ["Eligibility", "Scheduling", "Payments", "Pricing", "Measure-up", "Compliance", "Partners"];

export const Route = createFileRoute("/_authenticated/admin/todo")({
  head: () => ({ meta: [
    { title: "To action – Home Insulation Victoria Portal" }, { name: "description", content: "Every task waiting on Home Insulation Victoria staff, in one list." },
    { property: "og:title", content: "To action – Home Insulation Victoria Portal" }, { property: "og:description", content: "Every task waiting on Home Insulation Victoria staff, in one list." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: TodoPage,
});

export function useTodos() {
  const load = useServerFn(getTodos);
  return useQuery({ queryKey: ["todos"], queryFn: () => load(), refetchInterval: 60_000, refetchOnWindowFocus: true, retry: 3 });
}

function NeedsQueue({ overdue }: { overdue: TodoItem[] }) {
  const load = useServerFn(getNeedsHivic);
  const q = useQuery({ queryKey: ["needs-hivic"], queryFn: () => load(), refetchInterval: 60_000, retry: 3 });
  if (q.error) return <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"><p className="font-semibold">The exception queue could not be checked — do not assume nothing is waiting.</p><p>{(q.error as Error).message}</p></div>;
  if (q.isPending) return <p className="text-sm text-muted-foreground">Checking for exceptions…</p>;
  type Row = { key: string; jobId: string | null; jobNumber: string | null; why: string; next: string; tab: string; since: string | null; urgency?: string; stage?: string | null; suburb?: string | null };
  const rows: Row[] = [
    ...q.data.items,
    ...overdue.map((t) => ({ key: `overdue:${t.key}`, jobId: t.jobId, jobNumber: t.jobNumber, why: `Overdue office task: ${t.title}.`, next: t.action, tab: t.tab ?? "overview", since: t.since, urgency: "soon" })),
  ];
  const urgencyLabel: Record<string, string> = { urgent: "Urgent", today: "Act today", soon: "This week" };
  if (!rows.length) return <div className="flex items-center gap-3 rounded-xl border bg-card p-6"><CheckCircle2 className="h-6 w-6 text-primary" /><p className="font-semibold">No exceptions. Routine waiting is handled automatically.</p></div>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="rounded-xl border border-destructive/40 bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <AlertTriangle className="h-4 w-4 text-destructive" />{r.jobNumber ?? "Office"}
            {r.suburb && <span className="text-muted-foreground">· {r.suburb}</span>}
            {r.stage && <span className="text-muted-foreground">· {r.stage.replace(/_/g, " ")}</span>}
            {r.urgency && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">{urgencyLabel[r.urgency] ?? r.urgency}</span>}
            {r.since && <span className="text-muted-foreground">since {new Date(r.since).toLocaleString()}</span>}
          </div>
          <p className="mt-1"><span className="font-semibold">Why: </span>{r.why}</p>
          <p className="mt-1"><span className="font-semibold">Do next: </span>{r.next}</p>
          {r.jobId && <Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} search={{ section: NEEDS_TAB_SECTION[r.tab] ?? "people" }} className="mt-2 inline-block text-xs font-semibold underline">Open job at {SECTION_LABEL[NEEDS_TAB_SECTION[r.tab] ?? "people"]}</Link>}
        </li>
      ))}
    </ul>
  );
}

const SECTION_LABEL: Record<string, string> = { people: "People & exceptions", quote: "Quotes", piesa: "PIESA", installation: "Installation", ap_veec: "AP review & VEEC", history: "Communications & history" };

function TodoPage() {
  const [view, setView] = useState<"needs" | "all">("needs");
  const q = useTodos();
  const items = q.data?.items ?? [];
  const [filter, setFilter] = useState<"All" | TodoItem["category"]>("All");
  const counts = useMemo(() => new Map(categoryOrder.map((category) => [category, items.filter((item) => item.category === category).length])), [items]);
  const availableCategories = categoryOrder.filter((category) => (counts.get(category) ?? 0) > 0);
  const visibleItems = filter === "All" ? items : items.filter((item) => item.category === filter);
  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">TO ACTION</h1>
          <p className="text-sm text-muted-foreground">Everything waiting on Home Insulation Victoria. Items clear themselves once the job shows the step is done.</p>
        </div>
        <div className="flex gap-2" role="tablist" aria-label="Office views">
          <Button size="sm" role="tab" aria-selected={view === "needs"} variant={view === "needs" ? "default" : "outline"} onClick={() => setView("needs")}>Needs Home Insulation Victoria</Button>
          <Button size="sm" role="tab" aria-selected={view === "all"} variant={view === "all" ? "default" : "outline"} onClick={() => setView("all")}>All actions</Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      {view === "needs" ? <NeedsQueue overdue={items.filter((t) => t.urgent)} /> : <>
      {!q.error && !q.isPending && items.length > 0 && (
        <div className="mb-4" aria-label="Filter tasks by status">
          <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Filter by status</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={filter === "All" ? "default" : "outline"} onClick={() => setFilter("All")} aria-pressed={filter === "All"}>All <span className="font-bold">{items.length}</span></Button>
            {availableCategories.map((category) => (
              <Button key={category} size="sm" variant="outline" onClick={() => setFilter(category)} aria-pressed={filter === category} className={`${categoryStyle[category]} border-transparent shadow-none ${filter === category ? "ring-2 ring-ring ring-offset-2" : ""}`}>
                {category} <span className="font-bold">{counts.get(category)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {q.error ? (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-semibold">The list could not be checked — do not assume nothing is waiting.</p>
          <p>{(q.error as Error).message}</p>
        </div>
      ) : q.isPending ? (
        <p className="text-sm text-muted-foreground">Checking every job…</p>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-6"><CheckCircle2 className="h-6 w-6 text-primary" /><div><p className="font-semibold">All clear — nothing is waiting on Home Insulation Victoria.</p><p className="text-xs text-muted-foreground">Checked {new Date(q.data!.checkedAt).toLocaleTimeString()}</p></div></div>
      ) : (
        <ul className="space-y-3">
          {visibleItems.map((t) => (
            <li key={t.key} className={`flex min-h-44 flex-col rounded-xl border bg-card p-4 ${t.urgent ? "border-destructive/50" : ""}`}>
              <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2.5 py-1 font-bold ${categoryStyle[t.category]}`}>{t.category}</span>
                    {t.urgent && <span className="inline-flex items-center gap-1 font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                    {t.jobNumber && <span className="text-muted-foreground">Job {t.jobNumber}{t.property ? ` · ${t.property}` : ""}</span>}
                  </div>
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.action}</p>
              </div>
              <div className="mt-4 flex justify-start border-t pt-3">
                {t.key.startsWith("worker:") ? (
                  <Button asChild size="sm" variant="outline"><Link to="/admin/workers">Open staff approvals</Link></Button>
                ) : t.jobId ? (
                  <Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: t.jobId }}>Open job</Link></Button>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/admin/partners"
                      search={{ enquiry: t.key.startsWith("penq:") ? t.key.slice(5) : undefined }}
                    >Open</Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </>}
    </AppShell>
  );
}
