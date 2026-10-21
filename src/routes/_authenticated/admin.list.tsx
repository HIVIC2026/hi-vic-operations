import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/portal/AppShell";
import { listByStatus } from "@/lib/office.functions";
import { fmtDate } from "@/lib/workflow";
import { RowDeleteButton } from "@/components/portal/JobDeleteControls";

type S = { status?: string; stage?: string; late?: boolean; test?: boolean };
export const Route = createFileRoute("/_authenticated/admin/list")({
  head: () => ({ meta: [{ title: "Jobs list – Home Insulation Victoria" }, { name: "description", content: "Jobs filtered by status." }, { property: "og:title", content: "Jobs list – Home Insulation Victoria" }, { property: "og:description", content: "Jobs filtered by status." }] }),
  validateSearch: (s: Record<string, unknown>): S => ({
    ...(typeof s["status"] === "string" ? { status: s["status"] } : {}), ...(typeof s["stage"] === "string" ? { stage: s["stage"] } : {}),
    ...(s["late"] === true || s["late"] === "true" ? { late: true } : {}), ...(s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  }),
  component: JobList,
});

function JobList() {
  const sp = Route.useSearch();
  const load = useServerFn(listByStatus);
  const { data, error } = useQuery({ queryKey: ["office-list", sp], queryFn: () => load({ data: { status: sp.status, stage: sp.stage, lateOnly: sp.late, includeTest: sp.test } }) });
  return (
    <AppShell wide>
      <Link to="/admin/pipeline" className="text-sm font-semibold text-muted-foreground">← Pipeline</Link>
      {error ? <div role="alert" className="mt-3 rounded-[22px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Couldn't load this list: {(error as Error).message}</div>
        : !data ? <p className="mt-3 text-muted-foreground">Loading…</p>
        : <>
          <h1 className="mb-3 mt-1 font-display text-2xl font-extrabold">{data.title}{sp.late ? " — late" : ""} <span className="text-base font-semibold text-muted-foreground">({data.total})</span></h1>
          {data.rows.length === 0 ? <p className="rounded-[22px] border bg-card p-5 text-sm text-muted-foreground">No jobs here.</p> : (
            <div className="relative min-w-0 max-w-full overflow-x-auto rounded-[22px] border bg-card shadow-sm">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Job</th><th className="p-3">Owner</th><th className="p-3">Suburb</th><th className="p-3">Status</th><th className="p-3">Waiting on</th><th className="p-3 text-right">Days in status</th><th className="p-3">Due</th><th className="p-3"><span className="sr-only">Delete</span></th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-workspace-mist">
                      <td className="p-3 font-semibold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="text-primary underline">{r.jobNumber}</Link></td>
                      <td className="p-3">{r.owner ?? "—"}</td><td className="p-3">{r.suburb ?? "—"}</td>
                      <td className="p-3">{r.status}{r.detail ? <span className="text-muted-foreground"> · {r.detail}</span> : null}</td>
                      <td className="p-3">{r.waitingOn}</td><td className="p-3 text-right tabular-nums">{r.daysIn}</td>
                      <td className={`p-3 ${r.late ? "font-semibold text-danger" : ""}`}>{r.dueAt ? fmtDate(r.dueAt) : "—"}{r.late ? " · late" : ""}</td>
                      <td className="p-3"><RowDeleteButton jobId={r.id} jobNumber={r.jobNumber} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>}
    </AppShell>
  );
}
