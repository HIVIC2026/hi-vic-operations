// ONE Active / Closed jobs workspace.
// Reuses the existing getAdminPipeline read and StaffJobRow presentation. No workflow or database change:
// stage stays the record detail, never a second primary navigation.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminPipeline } from "@/lib/portal.functions";
import { nextStep } from "@/lib/nextstep.core";
import type { JobRow } from "@/components/portal/JobCard";
import { StaffJobRow } from "@/components/portal/StaffJobRow";
import { cn } from "@/lib/utils";

type Mode = "active" | "closed";
type ClosedView = "completed" | "cancelled" | "ineligible" | "test";

const isTest = (j: JobRow) => j.source === "qa_test";
const isCompleted = (j: JobRow) => j.stage === "complete";
const isCancelled = (j: JobRow) => j.stage === "cancelled";
const isIneligible = (j: JobRow) =>
  j.eligibility_outcome === "does_not_appear_eligible" && !isCompleted(j) && !isCancelled(j);

const COUNT_LABEL: Record<ClosedView, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  ineligible: "Ineligible",
  test: "Removed / test",
};

function ageLabel(createdAt: string | null | undefined) {
  if (!createdAt) return "—";
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  return Number.isFinite(days) ? `${Math.max(0, days)}d` : "—";
}

export function JobsWorkspace({ mode }: { mode: Mode }) {
  const load = useServerFn(getAdminPipeline);
  const {
    data = [],
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => load(),
    staleTime: 60_000,
    retry: 2,
  });
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [closedView, setClosedView] = useState<ClosedView>("completed");

  const groups = useMemo(() => {
    const real = data.filter((j) => !isTest(j));
    const test = data.filter(isTest);
    const active = real.filter((j) => !isCompleted(j) && !isCancelled(j) && !isIneligible(j));
    return {
      active,
      completed: real.filter(isCompleted),
      cancelled: real.filter(isCancelled),
      ineligible: real.filter(isIneligible),
      test,
    };
  }, [data]);

  const base = mode === "active" ? groups.active : groups[closedView];
  const stages = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of base) m.set(j.stage ?? "unknown", (m.get(j.stage ?? "unknown") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return base
      .filter((j) => stage === "all" || (j.stage ?? "unknown") === stage)
      .filter(
        (j) =>
          !term ||
          [
            j.job_number,
            j.owner_name,
            j.owner_email,
            j.owner_phone,
            j.property_address,
            j.installer_name,
            j.electrician_name,
          ].some((v) => v?.toLowerCase().includes(term)),
      )
      .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  }, [base, q, stage]);

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

      {mode === "closed" && (
        <div
          role="tablist"
          aria-label="Closed job outcomes"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {(["completed", "cancelled", "ineligible", "test"] as ClosedView[]).map((key) => (
            <Button
              key={key}
              role="tab"
              aria-selected={closedView === key}
              variant={closedView === key ? "default" : "outline"}
              className="h-auto min-h-16 flex-col items-start px-4 py-3 text-left"
              onClick={() => {
                setClosedView(key);
                setStage("all");
              }}
            >
              <span className="font-display text-2xl font-bold">{groups[key].length}</span>
              <span className="text-sm">{COUNT_LABEL[key]}</span>
            </Button>
          ))}
        </div>
      )}

      {mode === "active" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">{groups.active.length}</div>
            <div className="text-sm text-sub">In progress</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">
              {groups.active.filter((j) => j.eligibility_review_required).length}
            </div>
            <div className="text-sm text-sub">Review required</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">
              {groups.active.filter((j) => j.payment_status === "overdue").length}
            </div>
            <div className="text-sm text-sub">Payment overdue</div>
          </div>
          <div className="rounded-md border bg-card px-4 py-3">
            <div className="font-display text-2xl font-bold">
              {groups.active.filter((j) => j.urgency === "red" || j.urgency === "expired").length}
            </div>
            <div className="text-sm text-sub">Safety/PIESA attention</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <Input
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search job, customer, address, email or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <Button
          size="sm"
          variant={stage === "all" ? "secondary" : "ghost"}
          onClick={() => setStage("all")}
        >
          All stages <span className="ml-1 text-xs">{base.length}</span>
        </Button>
        {stages.map(([key, count]) => (
          <Button
            key={key}
            size="sm"
            variant={stage === key ? "secondary" : "ghost"}
            onClick={() => setStage(key)}
            className="capitalize"
          >
            {nextStep(base.find((j) => (j.stage ?? "unknown") === key) ?? { stage: key }).label}{" "}
            <span className="ml-1 text-xs">{count}</span>
          </Button>
        ))}
        <span
          className={cn(
            "ml-auto text-xs text-sub",
            shown.length === 0 && "font-semibold text-danger",
          )}
        >
          {shown.length} of {base.length} shown
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
        <ul
          aria-label={`${title} records`}
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
          {shown.map((j) => (
            <StaffJobRow key={j.id} job={j} select={<span />} showEnquiryStatus={false} />
          ))}
          {shown.length === 0 && (
            <li className="p-10 text-center text-sm text-sub">
              No jobs match this view or filter.
              <Button
                variant="link"
                onClick={() => {
                  setQ("");
                  setStage("all");
                }}
              >
                Clear filters
              </Button>
            </li>
          )}
        </ul>
      )}

      <p className="text-xs text-sub">
        Job age:{" "}
        {mode === "active"
          ? `oldest ${ageLabel(groups.active.map((j) => j.created_at).sort()[0])}`
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
