// ONE Active / Closed jobs workspace.
//
// The list is paged by the SERVER: the database applies the scope, the search, the stage and the sort,
// and only the rows for the current page are sent. Reuses the existing pipeline card read and
// StaffJobRow presentation. No workflow or database change: stage stays the record detail, never a
// second primary navigation.
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getJobListPage } from "@/lib/portal.functions";
import { getInstallerQuotesToCheck } from "@/lib/installer-quote-review.functions";
import { getMittiPickups, linkMittiPickup, getMittiSyncProblems, retryMittiSyncFn } from "@/lib/mitti-pickup.functions";
import { pickupLabel } from "@/lib/mitti-pickup.core";
import { CLOSED_VIEWS, JOB_SORT_KEYS, JOB_SORT_LABEL, VISIBLE_JOB_STAGES, type JobClosedView } from "@/lib/job-list-page.core";
import { useListControls } from "@/hooks/use-list-controls";
import { ListPagination } from "@/components/portal/ListPagination";
import { nextStep } from "@/lib/nextstep.core";
import type { JobRow } from "@/components/portal/JobCard";
import { StaffJobRow } from "@/components/portal/StaffJobRow";
import { cn } from "@/lib/utils";
import type { ListControls, ListSearchSpec } from "@/lib/list-paging.core";

type Mode = "active" | "closed";

const COUNT_LABEL: Record<JobClosedView, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  ineligible: "Ineligible",
  test: "Removed / test",
};

/** Ready Checks an installer started straight in Mitti (no portal job yet) — office links each one. */
function MittiPickupsToLink() {
  const fetchRows = useServerFn(getMittiPickups);
  const link = useServerFn(linkMittiPickup);
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => fetchRows(), staleTime: 60_000, retry: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, { ok: string } | { err: string }>>({});
  const act = async (auditId: string) => {
    setBusy(auditId); setResult((r) => ({ ...r, [auditId]: { err: "" } as { err: string } }));
    try {
      const out = await link({ data: { auditId, jobId: (jobNumber[auditId] ?? "").trim() } });
      setResult((r) => ({ ...r, [auditId]: { ok: `Linked to ${out.jobNumber}. ${out.issues.length ? `Sync notes: ${out.issues.join(" · ")}` : "Answers synced."}` } }));
      await refetch();
    } catch (e) { setResult((r) => ({ ...r, [auditId]: { err: e instanceof Error ? e.message : "Linking failed." } })); }
    finally { setBusy(null); }
  };
  if (isError) return (
    <section aria-label="Ready Checks started in Mitti" className="rounded-md border-2 border-warning/40 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Ready Checks started in Mitti</h2>
      <p role="alert" className="mt-2 text-sm">Mitti could not be checked. <Button variant="link" onClick={() => refetch()}>Try again</Button> <span className="text-xs">{(error as Error)?.message}</span></p>
    </section>
  );
  const rows = data?.rows ?? [];
  if (isPending || !rows.length) return null;
  return (
    <section aria-label="Ready Checks started in Mitti" className="rounded-md border-2 border-warning/50 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Ready Checks started in Mitti <span className="ml-1 rounded-full bg-warning px-2 py-0.5 text-sm text-warning-foreground">{rows.length}</span></h2>
      <p className="mt-1 text-sm text-sub">Started in Mitti without a portal job. Enter the job number to link the form — its answers then sync onto the job. Nothing is sent to anyone.</p>
      <ul className="mt-2 divide-y">
        {rows.map((r) => {
          const res = result[r.auditId];
          return (
            <li key={r.auditId} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{pickupLabel(r)}</p>
                  <p className="text-sm text-sub">
                    {r.business ? `${r.business.name} · ` : "Mitti user not matched · "}
                    {r.templateKind === "hivic_form" ? "Home Insulation Victoria form" : "Installer form"} · checked {r.modifiedAt ? r.modifiedAt.slice(0, 10) : "—"}
                    {r.assessorName ? ` · assessor ${r.assessorName}` : ""}
                  </p>
                  {r.duplicates.length > 0 && (
                    <p className="text-sm font-semibold text-warning">Possible duplicate — {r.duplicates.map((d) => `${d.jobNumber} (${d.owner ?? "unknown owner"})`).join(", ")}. Check before linking; linking never blocks.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Job number for Mitti form ${r.mittiRef ?? r.auditId}`}
                    placeholder="HV number"
                    value={jobNumber[r.auditId] ?? ""}
                    onChange={(e) => setJobNumber((m) => ({ ...m, [r.auditId]: e.target.value }))}
                    className="h-10 w-32"
                  />
                  <Button size="sm" className="h-10" disabled={busy === r.auditId} onClick={() => act(r.auditId)}>{busy === r.auditId ? "Linking…" : "Link to job"}</Button>
                </div>
              </div>
              {res && "ok" in res && <p role="status" className="text-sm text-success">{res.ok}</p>}
              {res && "err" in res && res.err && <p role="alert" className="text-sm text-danger">{res.err}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Jobs whose Mitti sync last failed — one Retry per job; the same guarded sync runs again. */
function MittiSyncProblems() {
  const fetchRows = useServerFn(getMittiSyncProblems);
  const retry = useServerFn(retryMittiSyncFn);
  const { data, refetch } = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => fetchRows(), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const rows = data?.rows ?? [];
  if (!rows.length) return null;
  const act = async (jobId: string) => {
    setBusy(jobId);
    try {
      const out = await retry({ data: { jobId } });
      setDone((d) => ({ ...d, [jobId]: out.issues.length ? `Retried ${out.jobNumber}. Sync notes: ${out.issues.join(" · ")}` : `Retried ${out.jobNumber}. Synced.` }));
      await refetch();
    } catch (e) { setDone((d) => ({ ...d, [jobId]: e instanceof Error ? e.message : "Retry failed." })); }
    finally { setBusy(null); }
  };
  return (
    <section aria-label="Mitti sync problems" className="rounded-md border-2 border-destructive/50 bg-card p-4">
      <h2 className="font-display text-lg font-bold">Mitti sync problems <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-sm text-destructive-foreground">{rows.length}</span></h2>
      <p className="mt-1 text-sm text-sub">The last Mitti sync for these jobs failed. Retry runs the same sync again — it never completes anything or sends anything.</p>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li key={r.jobId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-semibold">{r.jobNumber} · {r.owner ?? "Owner"}{r.address ? ` · ${r.address}` : ""}</p>
              <p className="text-sm text-danger">{r.message}</p>
              {done[r.jobId] && <p role="status" className="text-sm text-sub">{done[r.jobId]}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-10" disabled={busy === r.jobId} onClick={() => act(r.jobId)}>{busy === r.jobId ? "Retrying…" : "Retry"}</Button>
              <Button asChild size="sm" className="h-10"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }}>Open job</Link></Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
function InstallerQuotesToCheck() {
  const fetchRows = useServerFn(getInstallerQuotesToCheck);
  const { data } = useQuery({ queryKey: ["installer-quotes-to-check"], queryFn: () => fetchRows(), staleTime: 60_000 });
  const rows = data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <section aria-label="Installer quotes to check" className="rounded-md border-2 border-primary bg-card p-4">
      <h2 className="font-display text-lg font-bold">Installer quotes to check <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-sm text-primary-foreground">{rows.length}</span></h2>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li key={r.jobId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-semibold">{r.jobNumber} · {r.owner ?? "Owner"}{r.address ? ` · ${r.address}` : ""}</p>
              <p className={cn("text-sm", r.kind === "ready" ? "text-success" : "text-warning")}>{r.note}</p>
            </div>
            <Button asChild size="sm" className="h-10"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }}>Open job</Link></Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Which URL parameter carries the page-local filter differs per mode, so the route states it. */
export function jobsSearchSpec(mode: Mode): ListSearchSpec {
  return mode === "active"
    ? { scopeKey: "stage", scopes: ["all", ...VISIBLE_JOB_STAGES], defaultScope: "all" }
    : { scopeKey: "view", scopes: CLOSED_VIEWS, defaultScope: "completed" };
}

function ageLabel(createdAt: string | null | undefined) {
  if (!createdAt) return "—";
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  return Number.isFinite(days) ? `${Math.max(0, days)}d` : "—";
}

export function JobsWorkspace({
  mode,
  controls,
  navigate,
}: {
  mode: Mode;
  controls: ListControls;
  navigate: (search: Record<string, string | number>) => void;
}) {
  const spec = useMemo(() => jobsSearchSpec(mode), [mode]);
  const ui = useListControls(controls, spec, navigate);
  const load = useServerFn(getJobListPage);
  const {
    data,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    // The whole control set is the key, so React Query discards a response that arrives after the
    // office has already moved on (a slow page 1 can never overwrite a fast page 2).
    queryKey: ["job-list-page", mode, controls],
    queryFn: () =>
      load({
        data: {
          mode,
          closedView: (mode === "closed" ? controls.scope : "completed") as JobClosedView,
          stage: mode === "active" ? controls.scope : "all",
          search: controls.search,
          sort: controls.sort || "last_activity_at",
          direction: controls.direction,
          page: controls.page,
          pageSize: controls.pageSize,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 2,
  });

  const rows = data?.rows ?? [];
  const busy = isFetching && !isPending;
  const closedTiles = mode === "closed" ? (data?.tiles as Record<JobClosedView, number> | undefined) : undefined;
  const activeTiles =
    mode === "active"
      ? (data?.tiles as
          | { inProgress: number; reviewRequired: number; paymentOverdue: number; safetyAttention: number }
          | undefined)
      : undefined;
  const stages = Object.entries(data?.stageCounts ?? {}).sort((a, b) => b[1] - a[1]);

  const title = mode === "active" ? "Active jobs" : "Closed jobs";
  const subtitle =
    mode === "active"
      ? "Every operational job, its current stage, next action and who it is waiting on."
      : "Completed, cancelled and ineligible records stay separate — nothing is marked complete by this page.";

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p>
        <h1 className="mt-1 font-display text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-sub">{subtitle}</p>
      </header>

      {mode === "closed" && closedTiles && (
        <div
          role="tablist"
          aria-label="Closed job outcomes"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {CLOSED_VIEWS.map((key) => (
            <Button
              key={key}
              role="tab"
              aria-selected={controls.scope === key}
              variant={controls.scope === key ? "default" : "outline"}
              className="h-auto min-h-16 flex-col items-start px-4 py-3 text-left"
              onClick={() => ui.setScope(key)}
            >
              <span className="font-display text-2xl font-bold">{closedTiles[key]}</span>
              <span className="text-sm">{COUNT_LABEL[key]}</span>
            </Button>
          ))}
        </div>
      )}

      {mode === "active" && activeTiles && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">{activeTiles.inProgress}</div>
            <div className="text-sm text-sub">In progress</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">{activeTiles.reviewRequired}</div>
            <div className="text-sm text-sub">Review required</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">{activeTiles.paymentOverdue}</div>
            <div className="text-sm text-sub">Payment overdue</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">{activeTiles.safetyAttention}</div>
            <div className="text-sm text-sub">Safety/PIESA attention</div>
          </div>
        </div>
      )}

      {mode === "active" && <MittiPickupsToLink />}
      {mode === "active" && <InstallerQuotesToCheck />}

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <Input
          type="search"
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search job, customer, address, email or phone"
          value={ui.term}
          onChange={(e) => ui.setTerm(e.target.value)}
          className="max-w-md"
        />
        {mode === "active" && (
          <Button size="sm" variant={controls.scope === "all" ? "secondary" : "ghost"} onClick={() => ui.setScope("all")}>
            All stages <span className="ml-1 text-xs">{data?.total ?? 0}</span>
          </Button>
        )}
        {mode === "active" &&
          stages.map(([key, count]) => (
            <Button
              key={key}
              size="sm"
              variant={controls.scope === key ? "secondary" : "ghost"}
              onClick={() => ui.setScope(key)}
              className="capitalize"
            >
              {nextStep({ stage: key } as JobRow).label} <span className="ml-1 text-xs">{count}</span>
            </Button>
          ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-sub">
          Sort
          <select
            aria-label="Sort jobs"
            value={controls.sort || "last_activity_at"}
            onChange={(e) => ui.setSort(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {JOB_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {JOB_SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          aria-label={controls.direction === "asc" ? "Sort descending" : "Sort ascending"}
          onClick={ui.toggleDirection}
        >
          {controls.direction === "asc" ? "Ascending" : "Descending"}
        </Button>
        <span className={cn("text-xs text-sub", (data?.total ?? 0) === 0 && !isPending && "font-semibold text-danger")}>
          {busy ? "Updating…" : `${data?.total ?? 0} matching`}
        </span>
      </div>

      {isPending ? (
        <p role="status" className="rounded-md border bg-card p-8 text-center text-sm">
          Loading jobs…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          Jobs could not be loaded.{" "}
          <Button variant="link" onClick={() => refetch()}>
            Try again
          </Button>
          <span className="block text-xs">{(error as Error)?.message}</span>
        </div>
      ) : (
        <>
          <ul
            aria-label={`${title} records`}
            aria-busy={busy}
            className="divide-y overflow-hidden rounded-md border bg-card"
          >
            <li
              aria-hidden
              className="hidden grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-x-3 bg-muted/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground lg:grid"
            >
              <span className="w-4" />
              <span>Property · job · owner</span>
              <span>Stage · status</span>
              <span>Next action · waiting on</span>
              <span>Assignment · last activity</span>
            </li>
            {rows.map((j) => (
              <StaffJobRow key={j.id} job={j} select={<span />} showEnquiryStatus={false} />
            ))}
            {rows.length === 0 && (
              <li className="p-10 text-center text-sm text-sub">
                No jobs match this view or filter.
                <Button variant="link" onClick={ui.clear}>
                  Clear search and filters
                </Button>
              </li>
            )}
          </ul>
          {data && (
            <ListPagination
              paged={data}
              busy={busy}
              onPage={ui.setPage}
              onPageSize={ui.setPageSize}
              label={mode === "active" ? "active jobs" : "closed jobs"}
            />
          )}
        </>
      )}

      <p className="text-xs text-sub">
        Job age:{" "}
        {mode === "active"
          ? `oldest ${ageLabel(data?.oldestActiveCreatedAt)}`
          : "records are kept with their recorded outcome"}
        . Open a job for its full history.{" "}
        <Link to="/admin/enquiries" className="font-semibold text-primary underline">
          Enquiries
        </Link>{" "}
        keeps pre-handoff records out of this list.
      </p>
    </div>
  );
}
