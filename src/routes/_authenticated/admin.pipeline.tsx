import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/portal/AppShell";
import { getPipeline } from "@/lib/office.functions";

export const Route = createFileRoute("/_authenticated/admin/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline – Home Insulation Victoria" }, { name: "description", content: "Live jobs by stage and status, with late counts." }, { property: "og:title", content: "Pipeline – Home Insulation Victoria" }, { property: "og:description", content: "Live jobs by stage and status, with late counts." }] }),
  validateSearch: (s: Record<string, unknown>): { test?: boolean } => (s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  beforeLoad: ({ search }) => { throw redirect({ to: "/admin/jobs", search: (search.test ? { test: true } : {}) as never, replace: true }); },
  component: Pipeline,
});

function Pipeline() {
  const { test } = Route.useSearch();
  const includeTest = !!test;
  const load = useServerFn(getPipeline);
  const { data, error } = useQuery({ queryKey: ["pipeline", includeTest], queryFn: () => load({ data: { includeTest } }) });
  if (error) return <AppShell wide><div role="alert" className="rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">The pipeline couldn't load: {(error as Error).message}</div></AppShell>;
  if (!data) return <AppShell wide><p className="text-muted-foreground">Counting jobs…</p></AppShell>;
  const max = Math.max(1, ...data.stages.flatMap((s) => s.rows.map((r) => r.total)));
  return (
    <AppShell wide>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Pipeline</h1>
          <p className="text-sm"><strong>{data.live}</strong> live jobs · <span className="font-semibold text-danger">{data.late} late</span>{" · "}<span className="font-semibold">Waiting list: {data.waitingListTotal}, not contacted yet</span>{data.waitingList.filter((r) => r.total).map((r) => <span key={r.key} className="text-muted-foreground"> ({r.total} {r.label.replace("Not contacted yet: ", "")})</span>)}{data.unmapped ? <> · <span className="font-semibold text-danger">{data.unmapped} with no status</span></> : null}</p>
        </div>
        <Link to="/admin/pipeline" search={includeTest ? {} : { test: true }} className="text-sm font-semibold text-primary underline">{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.stages.map((st) => (
          <section key={st.key} className="rounded-[22px] border bg-card p-5 shadow-sm" aria-label={st.label}>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-extrabold">{st.n} · {st.label}</h2>
              <Link to="/admin/list" search={{ stage: st.key, ...(includeTest ? { test: true } : {}) }} className="text-sm font-semibold">{st.total}{st.late ? <span className="ml-1 text-danger">· {st.late} late</span> : null}</Link>
            </div>
            <ul className="grid gap-1.5">
              {st.rows.map((r) => (
                <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
                  <Link to="/admin/list" search={{ status: r.key, ...(includeTest ? { test: true } : {}) }} className="min-w-0 truncate hover:underline">{r.label}</Link>
                  <span className="flex items-center gap-2 tabular-nums">
                    <Link to="/admin/list" search={{ status: r.key, ...(includeTest ? { test: true } : {}) }} className="w-8 text-right font-semibold">{r.total}</Link>
                    {r.late ? <Link to="/admin/list" search={{ status: r.key, late: true, ...(includeTest ? { test: true } : {}) }} className="rounded-full bg-workspace-blush px-1.5 text-xs font-bold text-danger">{r.late} late</Link> : <span className="w-10" />}
                  </span>
                  <div className="col-span-2 h-1.5 rounded-full bg-border"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.total / max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-sm text-muted-foreground">Ended: {data.ended.map((e) => <Link key={e.key} to="/admin/list" search={{ status: e.key, ...(includeTest ? { test: true } : {}) }} className="mr-3 underline">{e.label} {e.total}</Link>)}</p>
    </AppShell>
  );
}
