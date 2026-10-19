import { Link } from "@tanstack/react-router";
import { nextStep } from "@/lib/nextstep.core";
import { AlertTriangle, CheckCircle2, HeartPulse, XCircle } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { fmtDateTime } from "@/lib/workflow";
import { Pill, SourceBadge } from "./badges";

/** Read-only facts the Office needs at a glance. Every value comes from an existing record; null = not provided. */
export type JobEnquiryFacts = {
  ceilingM2: number | null;
  /** true when the ceiling size is the typical default, not the customer's own figure. */
  ceilingAssumed: boolean;
  insulation: "none" | "present" | "unknown" | null;
  /** null = the media read failed; never render that as "no media". */
  mediaCount: number | null;
};

export type JobRow = Omit<Database["public"]["Views"]["job_overview"]["Row"], "authority_status" | "authority_expires_at" | "deposit_cleared"> & Partial<Pick<Database["public"]["Views"]["job_overview"]["Row"], "authority_status" | "authority_expires_at" | "deposit_cleared">> & { stuck_reasons?: string[]; comms_status?: { label: string; tone: "good" | "warn" | "bad" | "neutral" } | null; installer_facts?: import("@/lib/bulk-import.core").InstallerJobFacts | null; enquiry_facts?: JobEnquiryFacts | null; /** Jo's single office status (Enquiry → Spot offered → Spot saved / Ineligible / Needs attention). */ office_status?: import("@/lib/enquiry-groups.core").EnquiryStatus | null };

export function JobCard({ job, to, coverage }: { job: JobRow; to: "/admin/jobs/$jobId" | "/field/$jobId" | "/owner/$jobId"; coverage?: "serviceable" | "unserviceable" | "partial" | "not_configured" }) {
  const stuck = job.stuck_reasons ?? [];
  const step = nextStep(job);
  const next = step.next;
  return (
    <Link to={to} params={{ jobId: job.id! }} className={`block rounded-md border bg-card p-4 shadow-sm transition hover:border-primary hover:shadow-md ${stuck.length > 0 ? "border-l-4 border-l-danger" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-bold text-primary">{job.job_number}</div>
          <div className="truncate font-semibold">{job.property_address}</div>
          <div className="text-sm text-muted-foreground">{job.owner_name}</div>
        </div>
        {job.life_support && <HeartPulse className="h-5 w-5 shrink-0 text-danger" aria-label="Life support" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5"><SourceBadge channel={job.channel} business={job.originating_business_name} /><Pill t={step.tone}>{step.label}</Pill>
        {job.eligibility_review_required && step.label !== "Review required" ? <Pill t="warn">Review required</Pill>
          : job.eligibility_outcome === "does_not_appear_eligible" ? <Pill t="bad">Ineligible</Pill>
            : job.eligibility_outcome === "needs_onsite_confirmation" ? <Pill t="info">Needs onsite confirmation</Pill>
              : job.eligibility_outcome === "likely_eligible" ? <Pill t="good">Likely eligible</Pill>
                : null}
        {job.comms_status && <Pill t={job.comms_status.tone}>{job.comms_status.label}</Pill>}
        {coverage && <Pill t={coverage === "serviceable" ? "good" : coverage === "unserviceable" ? "bad" : "warn"}>{coverage === "serviceable" ? <><CheckCircle2 className="mr-1 h-3 w-3" /> SERVICE COVERAGE</> : coverage === "unserviceable" ? <><XCircle className="mr-1 h-3 w-3" /> NO SERVICE COVERAGE</> : "COVERAGE TO CONFIRM"}</Pill>}
      </div>
      {stuck.length > 0 && (
        <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger" role="alert">
          <div className="font-bold uppercase tracking-wide">Needs attention</div>
          <ul className="mt-0.5 list-disc pl-4 font-medium">{stuck.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 border-t pt-3 text-xs">
         <div className="mb-1 font-bold uppercase text-muted-foreground">NEXT STEP</div>
         <div className="flex items-start gap-1.5 font-semibold text-foreground">{stuck.length > 0 && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}{next}</div>
      </div>
      {step.waitingOn && (
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting on: <span className="text-foreground">{step.waitingOn}</span></div>
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">Last activity {fmtDateTime(job.last_activity_at)}</div>
    </Link>
  );
}
