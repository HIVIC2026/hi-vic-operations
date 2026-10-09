import { TradeTextsCard } from "@/components/portal/trade-texts";
import { OfficeInstallerFactsCard } from "@/components/portal/installer-job-facts";
import { OfficePrestartCard } from "@/components/portal/prestart";
import { OfficeInstallHoldCard } from "@/components/portal/install-hold";
import { OfficeAllocationPanel } from "@/components/portal/allocation";
import { ChooseTradePanel } from "@/components/portal/choose-trade";
import { OfficeInstalmentPlanCard } from "@/components/portal/instalment-plan";
import { VerifiedEligibilityCard } from "@/components/portal/verified-eligibility";
import { AdminEstimateCard } from "@/components/portal/estimate";
import { AdminBookingOverride, AdminPartnerPanel, AppointmentPanel } from "@/components/portal/partner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useState } from "react";
import { parseJobSection } from "@/lib/allocation.core";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { Pill, SourceBadge, UrgencyBadge } from "@/components/portal/badges";
import { AdminAssignmentPanel } from "@/components/portal/assignment";
import { WorkerLinksPanel } from "@/components/portal/workers";
import { OwnerEligibilityPanel } from "@/components/portal/owner-eligibility";
import { BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, PaymentsPanel, QuotesPanel, Section, TimelinePanel, useJob } from "@/components/portal/panels";
import { MittiCard, PriceItemForm } from "@/components/portal/mitti";
import { RequirementCards } from "@/components/portal/requirements";
import { EscInstallPanel } from "@/components/portal/intelligence";
import { PiisaPanel } from "@/components/portal/piisa-panel";
import { EligibilityCard } from "@/components/portal/eligibility-card";
import { IntakeSummary } from "@/components/portal/intake";
import { ClearTimeline } from "@/components/portal/waiting";
import { PaperworkStrip } from "@/components/portal/paperwork";
import { CompactJobStatus, CurrentJobBlockers } from "@/components/portal/CompactJobStatus";
import { JobIdentity, RecordDisclosure, SubHeading, usePortalTargetNavigation, type RecordGroup } from "@/components/portal/job-workspace";
import { AllDocuments, Correspondence, ExportJobPack, JobTimeline, RetentionCard, SectionDocuments } from "@/components/portal/jobfile";
import type { PortalTarget } from "@/lib/portal-presentation.core";
import { checkMittiAccess } from "@/lib/mitti-membership.functions";
import { MITTI_ACCESS_LABEL, mittiAccessOf, mittiCheckedLabel, mittiInviteLine, type MittiMemberRow } from "@/lib/mitti-membership.core";

import { useAction } from "@/hooks/use-me";
import { useServerFn } from "@tanstack/react-start";
import { RECORD_LABELS, type RecordKey } from "@/lib/compliance-timeline.core";
import {
  adjustQuote, approveHeldQuote, assignContractor, generateInstallerQuotes, regenerateRectificationQuote, runComplianceReview,
  setCommercialModel, setComplianceCheck, setEligibility, setHold, updateVeec, draftVeecReply, markVeecReplySent, listComplianceRecords, recordComplianceItem,
} from "@/lib/portal.functions";
import { ELIGIBILITY_LABEL, aud, fmtDate, type EligibilityOutcome } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getAdminAssignments, getAdminJobEligibility } from "@/lib/admin-records.functions";
import { getJobCoverage, sendNoCoverageEmail } from "@/lib/coverage.functions";
import { InstallerLedInvoicePanel } from "@/components/portal/installer-invoice";
import { InstallerIntakeReviewPanel, InstallerQuoteDraftPanel } from "@/components/portal/installer-quote";
import { AdminVisitHistory } from "@/components/portal/visit-changes";
import { OfficeJobProfitCard } from "@/components/portal/job-profit";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/admin/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job – Home Insulation Victoria Portal" }, { name: "description", content: "Job detail and workflow." }, { property: "og:title", content: "Job – Home Insulation Victoria Portal" }, { property: "og:description", content: "Job detail and workflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { section?: RecordGroup } => { const v = parseJobSection(s['section']); return v ? { section: v } : {}; },
  component: JobDetail,
});
import { JobDeleteControls } from "@/components/portal/JobDeleteControls";

function JobDetail() {
  const { jobId } = Route.useParams();
  const { data: job, error, refetch } = useJob(jobId);
  const [updating, setUpdating] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [eligibilityOpen, setEligibilityOpen] = useState(false);
  const [open, setOpen] = useState<Set<RecordGroup>>(new Set());
  const toggle = (g: RecordGroup) => setOpen((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const ensureOpen = useCallback((group: RecordGroup) => setOpen((current) => new Set(current).add(group)), []);
  const openTarget = usePortalTargetNavigation(ensureOpen);
  const { section } = Route.useSearch();
  useEffect(() => {
    if (!section || !job) return;
    ensureOpen(section);
    const t = window.setTimeout(() => document.getElementById(`records-${section}`)?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(t);
  }, [section, !!job, ensureOpen]);
  if (error) return <AppShell wide><div role="alert" className="rounded-md border border-danger bg-danger-soft p-4 text-sm text-danger">This job could not be loaded. Its records have not been deleted.<Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div></AppShell>;
  if (!job) return <AppShell wide><p role="status" className="text-muted-foreground">Loading…</p></AppShell>;
  const g = (k: RecordGroup) => ({ id: k, open: open.has(k), onToggle: () => toggle(k) });
  return (
    <AppShell wide>
      <div className="mx-auto max-w-5xl">
      <Link to="/admin/operations" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Overview</Link>
      <JobIdentity jobId={jobId} job={job} onOpen={openTarget} />
      <CompactJobStatus jobId={jobId} onOpen={openTarget} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Current blockers</h2><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setClassifying(!classifying)} aria-expanded={classifying} aria-controls="job-classification">Change classification</Button><Button size="sm" onClick={() => setUpdating(!updating)} aria-expanded={updating} aria-controls="job-update-controls">Update job</Button></div></div>
      {classifying && <div id="job-classification"><EligibilityForm jobId={jobId} /></div>}
      <JobDeleteControls jobId={jobId} />
      <CurrentJobBlockers jobId={jobId} />
      {updating && <section id="job-update-controls" aria-label="Guarded job controls" className="my-3 border-y border-line py-3">
        <h2 className="text-sm font-bold">Existing guarded controls</h2>
        <p className="my-2 text-sm text-sub">Eligibility correction, hold, resume and cancellation use the existing audited actions. A manual Check ↔ Save spot move is not available: saving a spot is an owner response, not a stage switch.</p>
        <EligibilityForm jobId={jobId} /><HoldControls jobId={jobId} stage={job.stage ?? ""} />
        <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openTarget("ready-check")}>Ready Check controls</Button><Button size="sm" variant="outline" onClick={() => openTarget("quotes")}>Quote controls</Button><Button size="sm" variant="outline" onClick={() => openTarget("ap-evidence")}>AP controls</Button></div>
      </section>}
      <details className="my-3 text-sm" onToggle={(event) => setEligibilityOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold text-sub">Eligibility evidence & verified decision</summary>{eligibilityOpen && <EligibilityCard jobId={jobId} override={<EligibilityForm jobId={jobId} />} verifiedControls={<VerifiedEligibilityCard jobId={jobId} />} />}</details>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <SourceBadge channel={job.channel} business={job.originating_business_name} />{job.urgency && <UrgencyBadge urgency={job.urgency} days={job.days_remaining} />}
      </div>
      <div className="mb-3 rounded-md border bg-card">
        <RecordDisclosure {...g("people")} title="Contacts, source & exceptions" summary={`Electrician ${job.electrician_name ?? "unassigned"} · Installer ${job.installer_name ?? "unassigned"} · last activity ${fmtDate(job.last_activity_at)}`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <JobSource jobId={jobId} channel={job.channel} model={job.commercial_model} business={job.originating_business_name} />
            {job.channel === "installer_sourced" && <OfficeInstallerFactsCard jobId={jobId} />}
            <JobCoverage jobId={jobId} />
            <Assignments jobId={jobId} />
            <OfficeInstallHoldCard jobId={jobId} />
            <OfficePrestartCard jobId={jobId} />
            <TradeTextsCard jobId={jobId} />
            <AdminPartnerPanel jobId={jobId} />
            
            <RetentionCard jobId={jobId} />
          </div>
        </RecordDisclosure>
      </div>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Job record shortcuts"><Button variant="outline" size="sm" onClick={() => openTarget("quotes")}>Quotes & payments</Button><Button variant="outline" size="sm" onClick={() => openTarget("documents")}>Forms & evidence</Button><Button variant="outline" size="sm" onClick={() => openTarget("correspondence")}>Communications</Button><Button variant="outline" size="sm" onClick={() => openTarget("history")}>History</Button></div>
      <h2 className="mb-1 text-sm font-bold">Forms & evidence</h2>
      <div className="mb-6 rounded-md border bg-card">
        <RecordDisclosure {...g("enquiry")} title="Enquiry" summary="Estimate, website intake and consent">
          <PaperworkStrip jobId={jobId} /><AdminEstimateCard jobId={jobId} />
          <SubHeading>Contact consent and photos</SubHeading>
          <div id="panel-intake-consent" className="scroll-mt-4"><IntakeSummary jobId={jobId} /></div><SectionDocuments jobId={jobId} categories={["Property"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("ready_check")} title="Ready Check" summary="Requirements, appointment, booking, Mitti and measure-up">
          <ChooseTradePanel jobId={jobId} /><RequirementCards jobId={jobId} isAdmin job={job} /><AppointmentPanel jobId={jobId} /><BookingPanel jobId={jobId} kind="assessment" canBook={false} isAdmin /><AdminBookingOverride jobId={jobId} /><MittiCard jobId={jobId} isAdmin /><AssessmentView jobId={jobId} part="assessment" /><SectionDocuments jobId={jobId} categories={["Measure-up"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("quote")} title="Quotes & payments" summary="Exact quotes, payment mirror, signing and source-specific invoice controls">
          <div id="target-quotes" data-portal-focus="target" tabIndex={-1} className="scroll-mt-4 outline-none"><AdminQuotes jobId={jobId} /></div><InstallerIntakeReviewPanel jobId={jobId} /><InstallerQuoteDraftPanel jobId={jobId} /><InstallerLedInvoicePanel jobId={jobId} /><div id="panel-deposit-request" className="scroll-mt-4"><PaymentsPanel jobId={jobId} isAdmin /></div><OfficeInstalmentPlanCard jobId={jobId} /><SectionDocuments jobId={jobId} categories={["Quotes", "Payments"]} />
          <SubHeading>Electronic signing</SubHeading>
          <div id="target-electronic-signing" tabIndex={-1} className="scroll-mt-4 outline-none"><AdminAssignmentPanel jobId={jobId} /></div><SectionDocuments jobId={jobId} categories={["Customer / Consent"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("piesa")} title="PIESA" summary={job.piesa_date ? `PIESA ${fmtDate(job.piesa_date)} · install by ${fmtDate(job.install_deadline)}` : "No PIESA recorded yet"}>
          <OfficeAllocationPanel jobId={jobId} />
          <Section title="PIESA 30-day installation window">
            {job.piesa_date ? <p className="text-sm">Current PIESA {fmtDate(job.piesa_date)} → install by <strong>{fmtDate(job.install_deadline)}</strong> ({job.days_remaining} days) <UrgencyBadge urgency={job.urgency} days={job.days_remaining} /></p> : <p className="text-sm text-muted-foreground">No PIESA recorded yet.</p>}
          </Section>
          <AssessmentView jobId={jobId} part="piesa" />
          <SubHeading>Rectification</SubHeading>
          <AssessmentView jobId={jobId} part="rectification" /><BookingPanel jobId={jobId} kind="rectification" canBook isAdmin />
          <SectionDocuments jobId={jobId} categories={["Electrical / PIESA"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("installation")} title="Installation" summary="Pre-install ESC controls, PIISA, booking and installation evidence">
          <EscInstallPanel jobId={jobId} /><PiisaPanel jobId={jobId} /><BookingPanel jobId={jobId} kind="installation" canBook isAdmin /><div id="target-installation-evidence" tabIndex={-1} className="scroll-mt-4 outline-none"><EvidencePanel jobId={jobId} role="admin" gates={["installation"]} /></div><SectionDocuments jobId={jobId} categories={["Installation"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("ap_veec")} title="AP review & VEECs" summary="Other evidence, Activity 48 records, compliance review, VEEC lodgement">
          <SubHeading>Evidence (installation evidence is under Installation)</SubHeading>
          <Button type="button" size="sm" variant="outline" onClick={() => openTarget("installation-evidence")}>Open installation evidence</Button>
          <div id="target-ap-evidence" tabIndex={-1} className="scroll-mt-4 outline-none"><EvidencePanel jobId={jobId} role="admin" excludeGates={["installation"]} /></div><SectionDocuments jobId={jobId} categories={["Evidence"]} />
          <SubHeading>Compliance and VEEC</SubHeading>
          <ComplianceRecords jobId={jobId} /><Compliance jobId={jobId} /><Veec jobId={jobId} /><OfficeJobProfitCard jobId={jobId} /><SectionDocuments jobId={jobId} categories={["ESC / VEEC"]} />
        </RecordDisclosure>
        <RecordDisclosure {...g("history")} title="Correspondence & history" summary="Worker links, messages, timeline, audit history, all documents and export">
          <OwnerEligibilityPanel jobId={jobId} /><WorkerLinksPanel jobId={jobId} /><MessagesPanel jobId={jobId} isAdmin /><div id="target-correspondence" tabIndex={-1} className="scroll-mt-4 outline-none"><Correspondence jobId={jobId} /></div>
          <SubHeading>What's happened</SubHeading>
          <div id="target-history" tabIndex={-1} className="scroll-mt-4 outline-none"><ClearTimeline jobId={jobId} /></div>
          <AdminVisitHistory jobId={jobId} />
          <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Detailed and raw audit history</summary><div className="mt-3 space-y-4"><JobTimeline jobId={jobId} /><TimelinePanel jobId={jobId} /></div></details>
          <SubHeading>All documents</SubHeading>
          <div id="target-documents" tabIndex={-1} className="scroll-mt-4 outline-none"><AllDocuments jobId={jobId} /></div><ExportJobPack jobId={jobId} />
        </RecordDisclosure>
      </div>
      </div>
    </AppShell>
  );
}

function JobCoverage({ jobId }: { jobId: string }) {
  const load = useServerFn(getJobCoverage);
  const send = useAction(sendNoCoverageEmail);
  const { data, error, isPending } = useQuery({ queryKey: ["job-coverage", jobId], queryFn: () => load({ data: { jobId } }), retry: 2 });
  if (isPending) return <Section title="Trade coverage"><p className="text-sm text-muted-foreground">Checking REC and installer coverage…</p></Section>;
  if (error || !data) return <Section title="Trade coverage"><p role="alert" className="text-sm text-danger">Coverage could not be checked. Do not offer this job until coverage is confirmed.</p></Section>;
  const label = (state: string) => ({ serviceable: "Serviceable", partial: "Needs verification", unserviceable: "Not covered", not_configured: "Not configured" }[state] ?? state);
  const provenUnavailable = [data.rec.state, data.installer.state].includes("unserviceable") && ![data.rec.state, data.installer.state].some((state) => state === "partial" || state === "not_configured");
  return <Section title="Trade coverage"><div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs font-bold uppercase text-muted-foreground">REC / electrician</div><div className="font-semibold">{label(data.rec.state)}</div><div className="text-xs text-muted-foreground">{data.rec.matches.map((item) => item.name).join(", ") || "No eligible verified REC"}</div></div><div><div className="text-xs font-bold uppercase text-muted-foreground">Installer</div><div className="font-semibold">{label(data.installer.state)}</div><div className="text-xs text-muted-foreground">{data.installer.matches.map((item) => item.name).join(", ") || "No eligible verified installer"}</div></div></div><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link to="/admin/coverage">Open coverage view</Link></Button>{provenUnavailable && <Button size="sm" variant="outline" onClick={() => send({ jobId }, "Service-area update sent")}>Email service-area update</Button>}</div>{provenUnavailable && <p className="mt-2 text-xs text-muted-foreground">This action still checks the communications lock, owner consent, suppression status and delivery setup before sending.</p>}</Section>;
}

function EligibilityForm({ jobId }: { jobId: string }) {
  const save = useAction(setEligibility);
  const load = useServerFn(getAdminJobEligibility);
  const { data, error, refetch } = useQuery({ queryKey: ["jobraw", jobId], queryFn: () => load({ data: { jobId } }), retry: 3, staleTime: 30_000 });
  const [outcome, setOutcome] = useState<EligibilityOutcome | "">("");
  const [reason, setReason] = useState("");
  const [next, setNext] = useState("");
  if (error) return <Section title="Gate 1 · Eligibility"><p className="text-sm text-danger">Eligibility details could not be loaded.</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>Try again</Button></Section>;
  if (!data) return <Section title="Gate 1 · Eligibility"><p className="text-sm text-muted-foreground">Loading eligibility details…</p></Section>;
  const p = data.properties as { occupancy: string | null; year_built: number | null; is_residential: boolean | null } | null;
  return (
    <Section title="Gate 1 · Eligibility">
      <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Residential</dt><dd>{p?.is_residential == null ? "To verify" : p.is_residential ? "Yes" : "No (commercial)"}</dd>
        <dt className="text-muted-foreground">Year built (relevant ceiling may differ)</dt><dd>{p?.year_built ?? "To verify"}{p?.year_built && new Date().getFullYear() - p.year_built < 5 && <Pill t="bad" className="ml-1">&lt; 5 yrs</Pill>}</dd>
        <dt className="text-muted-foreground">Est. area</dt><dd>{data.estimated_area_unknown ? "Unknown" : `${data.estimated_area_m2} m²`}</dd>
        <dt className="text-muted-foreground">Current</dt><dd>{data.eligibility_review_required ? "Review required (no customer category yet)" : data.eligibility_outcome ? ELIGIBILITY_LABEL[data.eligibility_outcome] : "Not set"}</dd>
      </dl>
      {data.eligibility_reason && <p className="mb-3 rounded bg-muted p-2 text-sm">{data.eligibility_reason}</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (outcome) save({ jobId, outcome, reason, nextAction: next }, "Eligibility saved"); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ELIGIBILITY_LABEL) as EligibilityOutcome[]).map((o) => (
            <button type="button" key={o} onClick={() => setOutcome(o)} className={`rounded-lg border p-2 text-sm font-medium ${outcome === o ? "border-primary bg-secondary" : ""}`}>{ELIGIBILITY_LABEL[o]}</button>
          ))}
        </div>
        <Textarea placeholder="Reason (e.g. residential, built 1985, existing R-value to verify onsite)" value={reason} onChange={(e) => setReason(e.target.value)} required />
        <Input placeholder="NEXT ACTION" value={next} onChange={(e) => setNext(e.target.value)} required />
        <Button type="submit" disabled={!outcome}>Save outcome</Button>
      </form>
    </Section>
  );
}

const MODEL_LABEL: Record<string, string> = {
  hivic_invoices_owner: "Home Insulation Victoria invoices the owner (Xero)",
  installer_invoices_owner: "Installer invoices the owner; Home Insulation Victoria charges installer an AP fee",
  not_configured: "Commercial setup required",
};

function JobSource({ jobId, channel, model, business }: { jobId: string; channel: string | null; model: string | null; business: string | null }) {
  const set = useAction(setCommercialModel);
  const [m, setM] = useState(model ?? "not_configured");
  const [reason, setReason] = useState("");
  return (
    <Section title="Job source">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Channel</dt><dd><SourceBadge channel={channel} /></dd>
        {channel === "installer_sourced" && <><dt className="text-muted-foreground">Originating installer</dt><dd>{business ?? "—"} <span className="text-xs text-muted-foreground">(permanent)</span></dd></>}
        <dt className="text-muted-foreground">Invoice route</dt><dd>{MODEL_LABEL[model ?? ""] ?? "—"}</dd>
      </dl>
      {channel === "installer_sourced" && (
        <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); await set({ jobId, model: m as "not_configured", reason }, "Invoice route updated"); setReason(""); }}>
          {model !== "hivic_invoices_owner" && <p className="rounded bg-warning-soft p-2 text-xs">Payment, deposit and rectification/installation scheduling stay locked until an invoice route is set. Installer-invoices route is recorded but not yet supported – it stays locked.</p>}
          <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={m} onChange={(e) => setM(e.target.value)}>
            {Object.entries(MODEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" required minLength={5} />
          <Button type="submit" size="sm" variant="outline">Save invoice route</Button>
        </form>
      )}
    </Section>
  );
}

function Assignments({ jobId }: { jobId: string }) {
  const assign = useAction(assignContractor);
  const check = useAction(checkMittiAccess);
  const load = useServerFn(getAdminAssignments);
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["assign", jobId],
    queryFn: () => load({ data: { jobId } }), retry: 3, staleTime: 30_000,
  });
  const [pending, setPending] = useState<{ role: "electrician" | "installer"; userId: string; name: string } | null>(null);
  const [why, setWhy] = useState("");
  const prof = (userId?: string | null): MittiMemberRow & { full_name: string | null } =>
    (data?.roles.find((x) => x.user_id === userId)?.profiles as (MittiMemberRow & { full_name: string | null }) | null | undefined) ?? { full_name: null };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["assign", jobId] }); };
  const pick = async (role: "electrician" | "installer", userId: string) => {
    if (!userId) return;
    if (mittiAccessOf(prof(userId)) === "member") { await assign({ jobId, userId, role }, "Assigned"); return; }
    setWhy("");
    setPending({ role, userId, name: prof(userId).full_name ?? "This person" });
  };
  return (
    <Section title="Assigned trades">
      {error && <div role="alert" className="mb-2 text-sm text-danger">Assignments could not be loaded. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>}
      {data?.rr.map((r) => <p key={r.id} className="mb-2 rounded bg-warning-soft p-2 text-sm">Owner requested a different {r.role}: {r.reason}</p>)}
      {(["electrician", "installer"] as const).map((role) => {
        const cur = data?.a.find((x) => x.role === role && x.active);
        const acc = mittiAccessOf(prof(cur?.user_id));
        return (
          <div key={role} className="mb-3">
            <Label className="capitalize">{role}</Label>
            <select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={cur?.user_id ?? ""} onChange={(e) => void pick(role, e.target.value)}>
              <option value="">— Unassigned —</option>
              {data?.roles.filter((r) => r.role === role).map((r) => {
                const p = prof(r.user_id);
                const a = mittiAccessOf(p);
                return <option key={r.user_id} value={r.user_id}>{p.full_name ?? "Unnamed"}{a === "member" ? "" : ` — ${MITTI_ACCESS_LABEL[a]}`}</option>;
              })}
            </select>
            {cur ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={acc === "member" ? "font-semibold text-success" : "font-semibold text-warning"}>{MITTI_ACCESS_LABEL[acc]}</span>
                <span className="text-muted-foreground">{mittiCheckedLabel(prof(cur.user_id))}</span>
                <Button size="sm" variant="outline" onClick={() => void check({ userId: cur.user_id }, "Mitti access checked").then(refresh)}>Check Mitti access</Button>
              </div>
            ) : null}
            {cur && acc !== "member" ? <p className="mt-1 text-xs text-muted-foreground">{mittiInviteLine(prof(cur.user_id).email)}</p> : null}
          </div>
        );
      })}
      {pending ? (
        <div className="mt-2 rounded-md border border-warning bg-warning-soft p-3">
          <p className="text-sm font-semibold">{pending.name} is not confirmed in the Home Insulation Victoria Mitti organisation.</p>
          <p className="mt-1 text-xs text-muted-foreground">They cannot be sent the {pending.role === "electrician" ? "electrical safety (PIESA)" : "Ready Check / installer safety"} form until invited with their exact email. Assigning anyway is recorded with your reason.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why assign them anyway? (required)" className="h-9 max-w-sm" />
            <Button size="sm" onClick={async () => { await assign({ jobId, userId: pending.userId, role: pending.role, mittiOverrideReason: why }, "Assigned with a recorded exception"); setPending(null); }}>Assign anyway</Button>
            <Button size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {!data?.roles.length && <p className="text-xs text-muted-foreground">No electricians/installers yet — grant roles on the Users page.</p>}
    </Section>
  );
}

function HoldControls({ jobId, stage }: { jobId: string; stage: string }) {
  const act = useAction(setHold);
  return (
    <Section title="Exceptions">
      <div className="flex flex-wrap gap-2">
        {stage === "on_hold" ? <Button onClick={() => act({ jobId, action: "resume" }, "Resumed")}>Resume job</Button> : stage !== "cancelled" && (
          <>
            <Button variant="outline" onClick={() => { const r = prompt("Reason for hold"); if (r) act({ jobId, action: "hold", reason: r }, "On hold"); }}>Put on hold</Button>
            <Button variant="destructive" onClick={() => { const r = prompt("Reason for cancelling"); if (r) act({ jobId, action: "cancel", reason: r }, "Cancelled"); }}>Cancel job</Button>
          </>
        )}
      </div>
    </Section>
  );
}

function AssessmentView({ jobId, part }: { jobId: string; part: "assessment" | "piesa" | "rectification" }) {
  const { data } = useQuery({
    queryKey: ["assessment", jobId],
    queryFn: async () => {
      const [{ data: a }, { data: items }, { data: piesa }] = await Promise.all([
        supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("rectification_items").select("*").eq("job_id", jobId).neq("status", "removed"),
        supabase.from("piesa_records").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
      ]);
      return { a, items: items ?? [], piesa: piesa ?? [] };
    },
  });
  if (!data) return null;
  if (!data.a && part === "assessment") return <Section title="Assessment"><p className="text-sm text-muted-foreground">Not started by the electrician yet.</p></Section>;
  const a = data.a ?? ({} as NonNullable<typeof data.a>);
  const rows: [string, unknown][] = [
    ["Status", a.status], ["Downlights", a.downlights_qty != null && `${a.downlights_qty} × ${a.downlights_type ?? ""} (${a.downlights_upgrade_qty ?? 0} to upgrade)`],
    ["Exhaust fans", a.exhaust_fans_qty != null && `${a.exhaust_fans_qty} (${a.exhaust_fans_clearance_qty ?? 0} need clearance)`], ["Hazards", a.hazards], ["Switchboard", a.switchboard_condition], ["RCDs present", a.rcds_present],
    ["RCDs required", a.rcds_required_qty], ["Life support", a.life_support_confirmed], ["PIESA outcome", a.piesa_outcome], ["Assessed on", a.assessed_on], ["Mitti ID", a.external_mitti_id ? `${a.external_mitti_id} (${a.mitti_sync_status})` : a.mitti_sync_status], ["Notes", a.notes],
  ];
  const fmt = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
  if (part === "piesa")
    return (
      <Section title="PIESA records (entered once by the electrician)">
        {data.piesa.length ? data.piesa.map((p) => <p key={p.id} className="text-sm">{fmtDate(p.completed_date)} · {p.kind.replace("_", " ")} · <strong>{p.outcome}</strong> {p.external_mitti_id && `· Mitti ${p.external_mitti_id}`} {p.is_current && <Pill t="good">current</Pill>}</p>) : <p className="text-sm text-muted-foreground">None.</p>}
      </Section>
    );
  if (part === "rectification")
    return (
      <Section title="Rectification items">
        {data.items.length ? <ul className="space-y-1 text-sm">{data.items.map((i) => <li key={i.id}><div className="flex justify-between gap-2"><span>{i.description} × {Number(i.quantity)}{i.is_other && <span className="text-xs text-muted-foreground"> — {i.other_unit_price_inc_gst != null ? `${aud(i.other_unit_price_inc_gst)} ea · ` : ""}{i.explanation}</span>}{i.source === "mitti" && <span className="text-xs text-muted-foreground"> · from Mitti</span>}</span><span className="flex gap-1">{i.needs_office_pricing && <Pill t="bad">needs office pricing</Pill>}<Pill t={i.status === "completed" ? "good" : "warn"}>{i.status}</Pill></span></div>{i.needs_office_pricing && i.status === "required" && <PriceItemForm itemId={i.id} />}</li>)}</ul> : <p className="text-sm text-muted-foreground">No rectification required.</p>}
      </Section>
    );
  return (
    <Section title="Electrical assessment record">
      <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{fmt(v)}</dd></Fragment>)}</dl>
    </Section>
  );
}

function AdminQuotes({ jobId }: { jobId: string }) {
  const gen = useAction(generateInstallerQuotes);
  const regen = useAction(regenerateRectificationQuote);
  const adjust = useAction(adjustQuote);
  const approve = useAction(approveHeldQuote);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["adminquotes", jobId],
    queryFn: async () => (await supabase.from("quotes").select("*, quote_items(*), quote_internals(*), quote_adjustments(*)").eq("job_id", jobId).order("created_at", { ascending: false })).data ?? [],
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { quantity: number; unit_price_inc_gst: number }>>({});
  const [reason, setReason] = useState("");
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => gen({ jobId }, "Installer quotes generated")}>Generate installer quotes</Button>
        <Button variant="outline" onClick={() => regen({ jobId }, "Rectification quote regenerated")}>Regenerate rectification quote</Button>
      </div>
      <QuotesPanel jobId={jobId} canRespond={false} />
      <Section title="Internal pricing (admin only)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="p-2">Quote</th><th className="p-2">Status</th><th className="p-2">Cost ex GST</th><th className="p-2">AP margin</th><th className="p-2">AP fee</th><th className="p-2">Customer inc GST</th><th className="p-2" /></tr></thead>
            <tbody>
              {data?.map((q) => {
                const int = q.quote_internals as unknown as { cost_ex_gst: number; ap_margin_ex_gst: number; ap_fee_ex_gst: number } | null;
                return (
                  <Fragment key={q.id}>
                    <tr className="border-t">
                      <td className="p-2">{q.option_label} {q.manually_adjusted && <Pill t="warn">adjusted</Pill>}{q.release_hold_reason && <p className="mt-1 text-xs font-medium text-danger">{q.release_hold_reason}</p>}</td><td className="p-2">{q.release_state === "queued" ? "Ready to send" : q.release_state === "held" ? "Held" : q.status}</td>
                      <td className="p-2">{aud(int?.cost_ex_gst)}</td><td className="p-2">{aud(int?.ap_margin_ex_gst)}</td><td className="p-2">{aud(int?.ap_fee_ex_gst)}</td>
                      <td className="p-2 font-semibold">{aud(q.customer_total_inc_gst)}</td>
                      <td className="p-2"><div className="flex gap-2">{q.status === "issued" && <Button size="sm" variant="outline" onClick={() => { setEditing(editing === q.id ? null : q.id); setEdits({}); setReason(""); }}>Adjust</Button>}{q.release_state === "held" && <Button size="sm" onClick={async () => { await approve({ quoteId: q.id }, "Quote approved"); await queryClient.invalidateQueries({ queryKey: ["adminquotes", jobId] }); }}>Approve</Button>}</div></td>
                    </tr>
                    {editing === q.id && (
                      <tr><td colSpan={7} className="bg-muted p-3">
                        {q.quote_items.map((i) => (
                          <div key={i.id} className="mb-2 grid grid-cols-[1fr_90px_120px] items-center gap-2">
                            <span>{i.description}</span>
                            <Input type="number" step="0.01" defaultValue={Number(i.quantity)} onChange={(e) => setEdits({ ...edits, [i.id]: { quantity: Number(e.target.value), unit_price_inc_gst: edits[i.id]?.unit_price_inc_gst ?? Number(i.unit_price_inc_gst) } })} />
                            <Input type="number" step="0.01" defaultValue={Number(i.unit_price_inc_gst)} onChange={(e) => setEdits({ ...edits, [i.id]: { quantity: edits[i.id]?.quantity ?? Number(i.quantity), unit_price_inc_gst: Number(e.target.value) } })} />
                          </div>
                        ))}
                        <Textarea placeholder="Reason for adjustment (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button className="mt-2" disabled={reason.trim().length < 5} onClick={async () => { await adjust({ quoteId: q.id, reason, items: Object.entries(edits).map(([id, v]) => ({ id, ...v })) }, "Quote adjusted"); setEditing(null); }}>Save adjustment</Button>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function Compliance({ jobId }: { jobId: string }) {
  const run = useAction(runComplianceReview);
  const set = useAction(setComplianceCheck);
  const { data } = useQuery({ queryKey: ["compliance", jobId], queryFn: async () => (await supabase.from("compliance_checks").select("*").eq("job_id", jobId).order("sort")).data ?? [] });
  return (
    <Section title="Gate 6 · AP compliance review" action={<Button size="sm" variant="outline" onClick={() => run({ jobId }, "Automated checks updated")}>Run automated checks</Button>}>
      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <div><div className="font-medium">{c.label}{c.blocking && <span className="ml-1 text-xs text-danger">blocking</span>}</div>{c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}</div>
            <div className="flex gap-1">
              {(["pass", "fail", "pending"] as const).map((s) => (
                <button key={s} onClick={() => set({ checkId: c.id, status: s }, "Updated")} className={`rounded px-2 py-1 text-xs font-semibold ${c.status === s ? (s === "pass" ? "bg-success text-primary-foreground" : s === "fail" ? "bg-danger text-primary-foreground" : "bg-muted-foreground text-primary-foreground") : "bg-muted"}`}>{s}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Button asChild className="mt-3 w-full"><Link to="/admin/ap-queue">Approve in AP queue</Link></Button>
    </Section>
  );
}

function Veec({ jobId }: { jobId: string }) {
  const save = useAction(updateVeec);
  const { data } = useQuery({ queryKey: ["veec", jobId], queryFn: async () => (await supabase.from("veec_lodgements").select("*").eq("job_id", jobId).maybeSingle()).data });
  const [pickedStatus, setPickedStatus] = useState<string | null>(null);
  if (!data) return null;
  const shownStatus = pickedStatus ?? data.status;
  return (
    <Section title="VEEC lodgement">
      <form key={data.updated_at} className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({ jobId, quantity: f.get("quantity") ? Number(f.get("quantity")) : null, status: f.get("status") as "not_submitted", submission_reference: (f.get("ref") as string) || null, submitted_date: (f.get("date") as string) || null, notes: (f.get("notes") as string) || null, query_text: (f.get("query_text") as string) || null, query_received_at: (f.get("query_received_at") as string) || null, reason: (f.get("reason") as string) || null }, "VEEC saved");
      }}>
        <p className="text-xs text-muted-foreground">Submitted or approved needs quantity, ESC reference and submitted date. Approved is final. Changing lodged details needs a reason.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Quantity</Label><Input name="quantity" type="number" step="0.01" min="0" defaultValue={data.quantity ?? ""} /></div>
          <div><Label>Status</Label><select name="status" value={shownStatus} onChange={(e) => setPickedStatus(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{["not_submitted", "submitted", "query", "approved", "rejected"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div><Label>ESC submission ref</Label><Input name="ref" defaultValue={data.submission_reference ?? ""} /></div>
          <div><Label>Submitted date</Label><Input name="date" type="date" max={melbourneToday()} defaultValue={data.submitted_date ?? ""} /></div>
        </div>
        <Textarea name="notes" placeholder="Notes (required if rejected)" defaultValue={data.notes ?? ""} />
        {shownStatus === "query" && (
          <div className="space-y-2 rounded-md border p-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label>What the Registry asked</Label><Textarea name="query_text" defaultValue={data.query_text ?? ""} /></div>
              <div><Label>Query received</Label><Input name="query_received_at" type="date" max={melbourneToday()} defaultValue={data.query_received_at ?? ""} /></div>
            </div>
          </div>
        )}
        {["submitted", "approved"].includes(data.status) && <Input name="reason" placeholder="Reason for changing lodged details" />}
        <Button type="submit">Save lodgement</Button>
      </form>
      {data.status === "query" && <VeecQueryReply jobId={jobId} draft={data.reply_draft ?? ""} sentAt={data.reply_sent_at ?? null} />}
    </Section>
  );
}

function VeecQueryReply({ jobId, draft, sentAt }: { jobId: string; draft: string; sentAt: string | null }) {
  const qc = useQueryClient();
  const gen = useAction(draftVeecReply);
  const mark = useAction(markVeecReplySent);
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <p className="text-xs text-muted-foreground">The reply is sent in the Registry's own system. Draft it here, edit it, send it there, then record the date you sent it. Nothing is sent from the portal.</p>
      {sentAt ? <p className="text-sm">Reply sent {sentAt}.</p> : (
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await gen({ jobId }, "Draft ready"); if (r?.draft) setText(r.draft); } finally { setBusy(false); } }}>{busy ? "Drafting…" : "Draft reply (AI)"}</Button>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Draft reply" rows={6} />
          <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await mark({ jobId, replyDraft: text, sentDate: f.get("sent") as string }, "Reply recorded"); void qc.invalidateQueries({ queryKey: ["veec", jobId] }); } finally { setBusy(false); } }}>
            <div><Label>Date sent</Label><Input name="sent" type="date" required max={melbourneToday()} /></div>
            <Button type="submit" disabled={busy || text.trim().length < 5}>Mark reply sent</Button>
          </form>
        </>
      )}
    </div>
  );
}

function ComplianceRecords({ jobId }: { jobId: string }) {
  const list = useServerFn(listComplianceRecords);
  const record = useAction(recordComplianceItem);
  const { data = [] } = useQuery({ queryKey: ["compliance-records", jobId], queryFn: () => list({ data: { jobId } }) });
  const [open, setOpen] = useState<RecordKey | null>(null);
  const today = melbourneToday();
  return (
    <Section title="Activity 48 records">
      <p className="mb-2 text-xs text-muted-foreground">Permanent once saved. Missing items block the stage shown: life support plan (PIESA booking), pre-install documents (install start), safety assessment, completion documents and $200 co-payment (AP review — co-payment also clears when Xero shows ≥ $200 paid), assignment copy (Ready for VEEC).</p>
      <ul className="divide-y text-sm">
        {(Object.keys(RECORD_LABELS) as RecordKey[]).map((k) => {
          const r = data.find((x) => x.record_key === k);
          return (
            <li key={k} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <span>{RECORD_LABELS[k]}</span>
                {r ? <Pill t="good">Recorded {fmtDate(r.occurred_at)}</Pill> : <Button size="sm" variant="outline" onClick={() => setOpen(open === k ? null : k)}>Record</Button>}
              </div>
              {r?.reference && <div className="text-xs text-muted-foreground">Ref: {r.reference}</div>}
              {!r && open === k && (
                <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => {
                  e.preventDefault(); const f = new FormData(e.currentTarget);
                  record({ jobId, key: k, occurredAt: f.get("date") as string, reference: (f.get("ref") as string) || null, notes: (f.get("notes") as string) || null }, "Recorded");
                  setOpen(null);
                }}>
                  <Input name="date" type="date" required max={today} defaultValue={today} />
                  <Input name="ref" placeholder="Reference / document" />
                  <Input name="notes" placeholder="Notes" />
                  <Button type="submit" className="sm:col-span-3">Save permanently</Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
