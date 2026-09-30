import { Link } from "@tanstack/react-router";
import { AlertTriangle, HeartPulse, Lock } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { fmtDateTime, waitingOn } from "@/lib/workflow";
import { PaymentBadge, SourceBadge, StageBadge, UrgencyBadge } from "./badges";

export type JobRow = Database["public"]["Views"]["job_overview"]["Row"] & { stuck_reasons?: string[] };

export function JobCard({ job, to }: { job: JobRow; to: "/admin/jobs/$jobId" | "/field/$jobId" | "/owner/$jobId" }) {
  const stuck = job.stuck_reasons ?? [];
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
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StageBadge stage={job.stage} />
        <PaymentBadge status={job.payment_status} />
        <UrgencyBadge urgency={job.urgency} days={job.days_remaining} />
        <SourceBadge channel={job.channel} business={job.originating_business_name} />
      </div>
      {stuck.length > 0 && (
        <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger" role="alert">
          <div className="font-bold uppercase tracking-wide">Needs attention</div>
          <ul className="mt-0.5 list-disc pl-4 font-medium">{stuck.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {["new_enquiry", "eligibility_review"].includes(job.stage ?? "") && (job.eligibility_review_required
        ? <div className="mt-2 rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-accent-foreground">Gate 1: REVIEW REQUIRED</div>
        : job.eligibility_outcome === "needs_onsite_confirmation" ? <div className="mt-2 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">Gate 1: Needs onsite confirmation</div>
        : job.eligibility_outcome === "likely_eligible" ? <div className="mt-2 rounded-md bg-success-soft px-2 py-1 text-xs font-semibold text-success">Gate 1: Likely eligible</div>
        : null)}
      {Array.isArray(job.eligibility_flags) && (job.eligibility_flags as { key?: string }[]).some((f) => f?.key === "rollout_hold") && ["new_enquiry", "eligibility_review"].includes(job.stage ?? "") && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold"><Lock className="h-3.5 w-3.5" /> Held until general rollout 1 Oct 2026</div>
      )}
      {job.channel === "installer_sourced" && job.commercial_model !== "hivic_invoices_owner" && !["complete", "cancelled"].includes(job.stage ?? "") && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-accent-foreground"><Lock className="h-3.5 w-3.5" /> Commercial setup required</div>
      )}
      {job.stage === "awaiting_deposit_payment" && !job.deposit_cleared && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs font-semibold text-danger"><Lock className="h-3.5 w-3.5" /> Scheduling locked – 50% deposit unpaid</div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Electrician</dt><dd className="truncate">{job.electrician_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Installer</dt><dd className="truncate">{job.installer_name ?? "—"}</dd>
      </dl>
      <div className="mt-3 border-t pt-3 text-xs">
        <div className="mb-1 font-bold uppercase text-muted-foreground">Next action</div>
        <div className="flex items-start gap-1.5 font-semibold text-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {job.next_action ?? "—"}</div>
      </div>
      {waitingOn(job.stage, job.next_action) && (
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting on: <span className="text-foreground">{waitingOn(job.stage, job.next_action)}</span></div>
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">Last activity {fmtDateTime(job.last_activity_at)}</div>
    </Link>
  );
}
