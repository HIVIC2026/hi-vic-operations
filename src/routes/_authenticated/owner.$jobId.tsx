import { VisitContactsCard } from "@/components/portal/allocation";
import { PiesaTimesCard } from "@/components/portal/piesa-times";
import { OwnerVisitChangeCard } from "@/components/portal/visit-changes";
import { OwnerInstallDaysCard } from "@/components/portal/install-days";
import { OwnerEstimateCard } from "@/components/portal/estimate";
import { nextStep } from "@/lib/nextstep.core";
import { OWNER_JOB_UNAVAILABLE_MESSAGE, jobLoadState } from "@/lib/uxfix-state.core";
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

export const Route = createFileRoute("/_authenticated/owner/$jobId")({
  head: () => ({ meta: [{ title: "My job – Home Insulation Victoria" }, { name: "description", content: "Approve quotes, pay deposits and book dates." }, { property: "og:title", content: "My job – Home Insulation Victoria" }, { property: "og:description", content: "Approve quotes, pay deposits and book dates." }] }),
  component: OwnerJob,
});

function OwnerJob() {
  const { jobId } = Route.useParams();
  const jobQ = useJob(jobId);
  if (jobLoadState({ error: jobQ.error, hasData: !!jobQ.data }) === "unavailable") return <AppShell><p className="text-muted-foreground" data-testid="owner-job-unavailable">{OWNER_JOB_UNAVAILABLE_MESSAGE}</p></AppShell>;
  const job = jobQ.data;
  if (!job) return <AppShell><p className="text-muted-foreground">Loading…</p></AppShell>;
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
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-primary/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">What's next: {nextStep(job).next}</p>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-sm"><dt className="text-muted-foreground">Electrician</dt><dd>{job.electrician_name ?? "Being arranged"}</dd><dt className="text-muted-foreground">Installer</dt><dd>{job.installer_name ?? "Being arranged"}</dd></dl>
      </div>
      <div className="space-y-4">
        {(s === "new_enquiry" || s === "eligibility_review" || s === "awaiting_electrician" || s === "assessment_booking") && <OwnerEstimateCard jobId={jobId} />}
        <OwnerAssignmentCard jobId={jobId} />
        <QuotesPanel jobId={jobId} canRespond />
        <PaymentsPanel jobId={jobId} isAdmin={false} />
        {(s === "measured_quote_accepted" || s === "piesa_and_install_window_pending") && !job.inHouseDispatch && <PiesaTimesCard jobId={jobId} />}
        {["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(s ?? "") && !job.inHouseDispatch && <OwnerVisitChangeCard jobId={jobId} />}
        {s === "installation_scheduling" && !job.inHouseDispatch && <OwnerInstallDaysCard jobId={jobId} />}
        {bookKind && bookKind !== "installation" && job.deposit_cleared && <BookingPanel jobId={jobId} kind={bookKind} canBook={!job.inHouseDispatch} />}
        {s === "installation_booked" && job.deposit_cleared && <BookingPanel jobId={jobId} kind="installation" canBook={!job.inHouseDispatch} />}
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
      <Button className="mt-2 min-h-12 h-auto w-full whitespace-normal break-words py-2 text-center" size="field" variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await req({ jobId, role: "installer", reason }, "Request sent to Home Insulation Victoria"); setReason(""); }}>Ask Home Insulation Victoria about a different installer</Button>
    </Section>
  );
}
