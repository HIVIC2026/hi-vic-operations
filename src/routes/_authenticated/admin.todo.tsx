import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getTodos } from "@/lib/todo.functions";

export const Route = createFileRoute("/_authenticated/admin/todo")({
  head: () => ({ meta: [
    { title: "To action – HI VIC Portal" }, { name: "description", content: "Every task waiting on HI VIC staff, in one list." },
    { property: "og:title", content: "To action – HI VIC Portal" }, { property: "og:description", content: "Every task waiting on HI VIC staff, in one list." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: TodoPage,
});

export function useTodos() {
  const load = useServerFn(getTodos);
  return useQuery({ queryKey: ["todos"], queryFn: () => load(), refetchInterval: 60_000, refetchOnWindowFocus: true, retry: 3 });
}

function TodoPage() {
  const q = useTodos();
  const items = q.data?.items ?? [];
  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">TO ACTION</h1>
          <p className="text-sm text-muted-foreground">Everything waiting on HI VIC. Items clear themselves once the job shows the step is done.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      {q.error ? (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-semibold">The list could not be checked — do not assume nothing is waiting.</p>
          <p>{(q.error as Error).message}</p>
        </div>
      ) : q.isPending ? (
        <p className="text-sm text-muted-foreground">Checking every job…</p>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-6"><CheckCircle2 className="h-6 w-6 text-primary" /><div><p className="font-semibold">All clear — nothing is waiting on HI VIC.</p><p className="text-xs text-muted-foreground">Checked {new Date(q.data!.checkedAt).toLocaleTimeString()}</p></div></div>
      ) : (
        <ul className="space-y-3">
          {items.map((t) => (
            <li key={t.key} className={`rounded-xl border bg-card p-4 ${t.urgent ? "border-destructive/50" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">{t.category}</span>
                    {t.urgent && <span className="inline-flex items-center gap-1 font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                    {t.jobNumber && <span className="text-muted-foreground">Job {t.jobNumber}{t.property ? ` · ${t.property}` : ""}</span>}
                  </div>
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.action}</p>
                </div>
                {t.jobId ? (
                  <Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: t.jobId }}>Open job</Link></Button>
                ) : (
                  <Button asChild size="sm" variant="outline"><Link to="/admin/partners">Open</Link></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
