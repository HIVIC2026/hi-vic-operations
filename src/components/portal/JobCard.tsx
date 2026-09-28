import { Link } from "@tanstack/react-router";
import { AlertTriangle, HeartPulse } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { fmtDateTime } from "@/lib/workflow";
import { PaymentBadge, StageBadge, UrgencyBadge } from "./badges";

export type JobRow = Database["public"]["Views"]["job_overview"]["Row"];

export function JobCard({ job, to }: { job: JobRow; to: "/admin/jobs/$jobId" | "/field/$jobId" | "/owner/$jobId" }) {
  return (
    <Link to={to} params={{ jobId: job.id! }} className="block rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary hover:shadow-md">
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
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Electrician</dt><dd className="truncate">{job.electrician_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Installer</dt><dd className="truncate">{job.installer_name ?? "—"}</dd>
      </dl>
      <div className="mt-3 flex items-start gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {job.next_action ?? "—"}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Last activity {fmtDateTime(job.last_activity_at)}</div>
    </Link>
  );
}
