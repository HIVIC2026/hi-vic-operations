import { VisitContactsCard } from "@/components/portal/allocation";
import { OwnerInstalmentPlanCard } from "@/components/portal/instalment-plan";
import { PiesaTimesCard } from "@/components/portal/piesa-times";
import { OwnerVisitChangeCard } from "@/components/portal/visit-changes";
import { OwnerInstallDaysCard } from "@/components/portal/install-days";
import { OwnerEstimateCard } from "@/components/portal/estimate";
import { nextStep } from "@/lib/nextstep.core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { ClearTimeline, WhoHasTheBall } from "@/components/portal/waiting";
import { PaymentBadge, StageBadge, UrgencyBadge } from "@/components/portal/badges";
import { BookingPanel, DocumentsPanel, MessagesPanel, PaymentsPanel, QuotesPanel, Section, TimelinePanel, useJob } from "@/components/portal/panels";
import { useAction } from "@/hooks/use-me";
import { OwnerAssignmentCard } from "@/components/portal/assignment";
import { requestReassignment } from "@/lib/portal.functions";
import { STAGE_ORDER } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { OwnerJobUnavailable } from "@/components/portal/owner-job-unavailable";
import { ownerJobView } from "@/lib/owner-job-view.core";

export const Route = createFileRoute("/_authenticated/owner/$jobId")({
  head: () => ({ meta: [{ title: "My job – Home Insulation Victoria" }, { name: "description", content: "Approve quotes, pay deposits and book dates." }, { property: "og:title", content: "My job – Home Insulation Victoria" }, { property: "og:description", content: "Approve quotes, pay deposits and book dates." }] }),
  component: OwnerJob,
});

function OwnerJob() {
  const { jobId } = Route.useParams();
  const { data: job, isError, refetch } = useJob(jobId);
  // STEP 80: a refused or missing job ends in one neutral message instead of "Loading…" forever.
  if (ownerJobView({ hasJob: !!job, isError }) === "unavailable") return <AppShell><OwnerJobUnavailable onRetry={() => void refetch()} /></AppShell>;
  if (!job) return <AppShell><p role="status" className="text-muted-foreground">Loading…</p></AppShell>;
  const s = job.stage!;
  const pct = Math.max(5, Math.round(((STAGE_ORDER.indexOf(s) + 1) / STAGE_ORDER.length) * 100));
  const bookKind = s === "rectification_scheduling" || s === "rectification_booked" ? "rectification" : s === "installation_scheduling" || s === "installation_booked" ? "installation" : null; // legacy assessment bookings retired
  return (
    <AppShell>
      <WhoHasTheBall jobId={jobId} />
      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="text-xs font-bold text-primary">{job.job_number}</div>
        <h1 className="text-xl font-bold">{job.property_address}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5"><StageBadge stage={s} /><PaymentBadge status={job.payment_status} /><UrgencyBadge urgency={job.urgency} days={job.days_remaining} /></div>
        <Progress value={pct} className="mt-3" />
        <p className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">What's next: {nextStep(job).next}</p>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-sm"><dt className="text-muted-foreground">Electrician</dt><dd>{job.electrician_name ?? "Being arranged"}</dd><dt className="text-muted-foreground">Installer</dt><dd>{job.installer_name ?? "Being arranged"}</dd></dl>
      </div>
      <div className="space-y-4">
        {(s === "new_enquiry" || s === "eligibility_review" || s === "awaiting_electrician" || s === "assessment_booking") && <OwnerEstimateCard jobId={jobId} />}
        <OwnerAssignmentCard jobId={jobId} />
        <QuotesPanel jobId={jobId} canRespond />
        <PaymentsPanel jobId={jobId} isAdmin={false} /><OwnerInstalmentPlanCard jobId={jobId} />
        {(s === "measured_quote_accepted" || s === "piesa_and_install_window_pending") && <PiesaTimesCard jobId={jobId} />}
        {["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(s ?? "") && <OwnerVisitChangeCard jobId={jobId} />}
        {s === "installation_scheduling" && <OwnerInstallDaysCard jobId={jobId} depositCleared={!!job.deposit_cleared} />}
        {bookKind && bookKind !== "installation" && job.deposit_cleared && <BookingPanel jobId={jobId} kind={bookKind} canBook />}
        {s === "installation_booked" && job.deposit_cleared && <BookingPanel jobId={jobId} kind="installation" canBook />}
        {s === "awaiting_deposit_payment" && <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">Booking opens once your approved payment option is confirmed: minimum upfront deposit, paid in full, or an active 3-instalment plan.</p>}
        {job.installer_name && !["assessment_booking", "assessment_booked", "awaiting_electrician"].includes(s) && <ChangeTrade jobId={jobId} />}
        <DocumentsPanel jobId={jobId} />
        <VisitContactsCard jobId={jobId} />
        <MessagesPanel jobId={jobId} isAdmin={false} role="owner" />
        <TimelinePanel jobId={jobId} />
      </div>
      <ClearTimeline jobId={jobId} initial={6} />
    </AppShell>
  );
}

function ChangeTrade({ jobId }: { jobId: string }) {
  // Installer only. Electrician changes during the assessment go through "Arrange the visit" (48h / can't-attend rules).
  const req = useAction(requestReassignment);
  const [reason, setReason] = useState("");
  return (
    <Section title="Can't reach your installer?">
      <Textarea placeholder="Tell us what happened" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button className="mt-2 w-full" size="field" variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await req({ jobId, role: "installer", reason }, "Request sent to Home Insulation Victoria"); setReason(""); }}>Ask Home Insulation Victoria about a different installer</Button>
    </Section>
  );
}
