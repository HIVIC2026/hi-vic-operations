import { Link } from "@tanstack/react-router";
import { nextStep } from "@/lib/nextstep.core";
import { AlertTriangle, HeartPulse } from "lucide-react";
import { fmtDateTime } from "@/lib/workflow";
import { Pill } from "./badges";
import type { JobRow } from "./JobCard";

/** Staff-only list row. Same facts as JobCard (nextStep, Gate 1 label precedence, coverage, stuck reasons), calmer layout. */
export function StaffJobRow({ job, coverage, select }: { job: JobRow; coverage?: "serviceable" | "unserviceable" | "partial" | "not_configured"; select: React.ReactNode }) {
  const stuck = job.stuck_reasons ?? [];
  const step = nextStep(job);
  const elig = job.eligibility_review_required && step.label !== "Review required" ? <Pill t="warn">Review required</Pill>
    : job.eligibility_outcome === "does_not_appear_eligible" ? <Pill t="bad">Ineligible</Pill>
      : job.eligibility_outcome === "needs_onsite_confirmation" ? <Pill t="info">Needs onsite confirmation</Pill>
        : job.eligibility_outcome === "likely_eligible" ? <Pill t="good">Likely eligible</Pill> : null;
  return (
    <li className={`relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-3 hover:bg-muted/40 lg:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] lg:items-start ${stuck.length ? "border-l-4 border-l-danger" : "border-l-4 border-l-transparent"}`}>
      <div className="relative z-10 row-span-4 pt-0.5 lg:row-span-1">{select}</div>
      <div className="min-w-0">
        <Link to="/admin/jobs/$jobId" params={{ jobId: job.id! }} className="block truncate font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">{job.property_address}</Link>
        <div className="truncate text-xs text-muted-foreground"><span className="font-bold text-primary">{job.job_number}</span> · {job.owner_name}{job.life_support && <HeartPulse className="ml-1 inline h-3.5 w-3.5 text-danger" aria-label="Life support" />}</div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1"><Pill t={step.tone}>{step.label}</Pill>{elig}</div>
      <div className="min-w-0 text-sm">
        <div className="flex items-start gap-1 font-medium">{stuck.length > 0 && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}<span className="line-clamp-2">{step.next}</span></div>
        {step.waitingOn && <div className="text-xs text-muted-foreground">Waiting on <span className="font-semibold text-foreground">{step.waitingOn}</span></div>}
      </div>
      <div className="min-w-0 space-y-1 text-xs">
        <div className="flex flex-wrap gap-1">
          {coverage && <Pill t={coverage === "serviceable" ? "good" : coverage === "unserviceable" ? "bad" : "warn"}>{coverage === "serviceable" ? "Covered" : coverage === "unserviceable" ? "No coverage" : "Coverage to confirm"}</Pill>}
          {job.comms_status && <Pill t={job.comms_status.tone}>{job.comms_status.label}</Pill>}
        </div>
        {stuck.length > 0 && <ul role="alert" className="list-disc pl-4 font-medium text-danger">{stuck.map((r) => <li key={r}>{r}</li>)}</ul>}
        <div className="text-muted-foreground">Last activity {fmtDateTime(job.last_activity_at)}</div>
      </div>
    </li>
  );
}
