import { createFileRoute, Link } from "@tanstack/react-router";
import { InstallerFactsLine } from "@/components/portal/installer-job-facts";
import { Badge } from "@/components/ui/badge";
import { listInterests } from "@/lib/interest.functions";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { type JobRow } from "@/components/portal/JobCard";
import { StaffJobRow } from "@/components/portal/StaffJobRow";
import { PIPELINE_PHASES, type Phase } from "@/lib/workflow";
import { boardPhase } from "@/lib/board-phase.core";
import { getBoardStages } from "@/lib/office.functions";
import type { OfficeStage } from "@/lib/office-status.core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { autoAdvancePipeline, createEnquiry, getAdminPipeline, getCommsStatus, getPostIntakeHealth, sweepAuthorities } from "@/lib/portal.functions";
import { useServerFn } from "@tanstack/react-start";
import { getAdminCoverage } from "@/lib/coverage.functions";
import { bulkJobAction } from "@/lib/bulk.functions";
import { toast } from "sonner";
import { filterVisibleJobs } from "@/lib/portal-presentation.core";
import { nextStep } from "@/lib/nextstep.core";
import { Pill } from "@/components/portal/badges";
import { EnquiryResponseOverview } from "@/components/portal/EnquiryResponseOverview";

const ACCEPTANCE_STAGES = ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"];
type WorkView = "all" | "active" | "review" | "ineligible" | "finalised" | "cancelled" | "test";
type Tab = "board" | "jobs" | "quotes" | "enquiries" | "ineligible";
const QUOTE_STAGES = ["awaiting_quote_acceptance", "measured_estimate_ready"];
const JOB_STAGES = [...ACCEPTANCE_STAGES, "measured_quote_accepted", "piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending", "awaiting_owner_rectification_approval"];
const tabOf = (stage: string | null | undefined): Tab => QUOTE_STAGES.includes(stage ?? "") ? "quotes" : JOB_STAGES.includes(stage ?? "") ? "jobs" : "enquiries";
const TAB_TITLE: Record<Tab, string> = { board: "JOB PIPELINE", jobs: "ACTIVE JOBS", quotes: "PENDING QUOTE APPROVAL", enquiries: "ENQUIRIES", ineligible: "INELIGIBLE" };

const PRIMARY_VIEWS: { key: WorkView; label: string }[] = [{ key: "active", label: "In progress" }, { key: "review", label: "Needs review" }, { key: "ineligible", label: "Exceptions" }];
const SECONDARY_VIEWS: { key: WorkView; label: string }[] = [{ key: "all", label: "All non-test records" }, { key: "finalised", label: "Finalised" }, { key: "cancelled", label: "Cancelled" }, { key: "test", label: "Test records" }];

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Job Pipeline – Home Insulation Victoria Portal" }, { name: "description", content: "Home Insulation Victoria job pipeline and enquiry workspace." }, { property: "og:title", content: "Job Pipeline – Home Insulation Victoria Portal" }, { property: "og:description", content: "Home Insulation Victoria job pipeline and enquiry workspace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (["board", "jobs", "quotes", "enquiries", "ineligible"].includes(s["tab"] as string) ? { tab: s["tab"] as Tab } : {}),
  component: Pipeline,
});

function Pipeline() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "hivic_sourced" | "installer_sourced">("all");
  const { tab = "board" } = Route.useSearch();
  const [workView, setWorkView] = useState<WorkView>("active");
  useEffect(() => { setWorkView(tab === "ineligible" ? "ineligible" : "active"); }, [tab]);
  const sweep = useServerFn(sweepAuthorities);
  const advance = useServerFn(autoAdvancePipeline);
  const loadPipeline = useServerFn(getAdminPipeline);
  const commsStatus = useServerFn(getCommsStatus);
  const { data: comms } = useQuery({ queryKey: ["comms_status"], queryFn: () => commsStatus() });
  const postIntakeHealth = useServerFn(getPostIntakeHealth);
  const loadCoverage = useServerFn(getAdminCoverage);
  const { data: coverageData } = useQuery({ queryKey: ["admin-coverage"], queryFn: () => loadCoverage(), staleTime: 30_000 });
  const coverageByJob = useMemo(() => new Map((coverageData?.rows ?? []).map((row) => [row.id, row.overall])), [coverageData]);
  const { data: intakeHealth } = useQuery({ queryKey: ["post_intake_health"], queryFn: () => postIntakeHealth(), refetchInterval: 60_000 });
  const [phase, setPhase] = useState<Phase | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "cancel" | "hold" | "mark_test" | "delete">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const runBulk = useServerFn(bulkJobAction);
  useEffect(() => { setSelected(new Set()); }, [workView, tab]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { data: allJobs = [], error: pipelineError, isPending: pipelinePending, refetch: refetchPipeline } = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => loadPipeline(),
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 30_000,
  });
  const loadBoardStages = useServerFn(getBoardStages);
  const { data: boardStages, error: boardStagesError } = useQuery({ queryKey: ["board-stages"], queryFn: () => loadBoardStages({ data: { includeTest: true } }), staleTime: 30_000, retry: 2 });
  // Column = facts-based office stage. Until facts load, stored Ready Check stages are not shown in Ready Check.
  const phaseOf = useCallback((j: JobRow) => boardPhase(j.stage, boardStages ? ((boardStages[j.id!] ?? null) as OfficeStage | null) : undefined), [boardStages]);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([sweep(), advance()]).then((results) => {
      if (!active || !results.some((result) => result.status === "fulfilled")) return;
      void refetchPipeline();
    });
    return () => { active = false; };
  }, [advance, refetchPipeline, sweep]);
  const groups = useMemo(() => ({
    test: allJobs.filter((job) => job.source === "qa_test"),
    all: allJobs.filter((job) => job.source !== "qa_test"),
    finalised: allJobs.filter((job) => job.source !== "qa_test" && job.stage === "complete"),
    cancelled: allJobs.filter((job) => job.source !== "qa_test" && job.stage === "cancelled"),
    ineligible: allJobs.filter((job) => job.source !== "qa_test" && (job.eligibility_outcome === "does_not_appear_eligible" || job.stage === "on_hold") && job.stage !== "cancelled"),
    review: allJobs.filter((job) => job.source !== "qa_test" && job.eligibility_review_required && !["complete", "cancelled", "on_hold"].includes(job.stage ?? "")),
    active: allJobs.filter((job) => job.source !== "qa_test" && !job.eligibility_review_required && job.eligibility_outcome !== "does_not_appear_eligible" && !["complete", "cancelled", "on_hold"].includes(job.stage ?? "")),
  }), [allJobs]);
  const boardJobs = useMemo(() => [...groups.review, ...groups.active], [groups]);
  const jobs = workView === "active" && tab !== "ineligible" ? groups.active.filter((j) => tabOf(j.stage) === tab) : groups[workView];
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return jobs.filter((j) => source === "all" || j.channel === source).filter((j) => !s || [j.job_number, j.property_address, j.owner_name, j.electrician_name, j.installer_name].some((v) => v?.toLowerCase().includes(s)));
  }, [jobs, q, source]);
  const visibleJobs = useMemo(() => filterVisibleJobs(filtered, phase, (_s, j) => phaseOf(j)), [filtered, phase, phaseOf]);
  const byPhase = (p: Phase) => filtered.filter((j) => phaseOf(j) === p);
  const loadInterests = useServerFn(listInterests);
  const { data: interests = [] } = useQuery({ queryKey: ["calculator-interests"], queryFn: () => loadInterests(), staleTime: 30_000 });
  const shownInterests = useMemo(() => {
    if (tab !== "enquiries" || !(workView === "active" || workView === "all") || phase !== "all" || source === "installer_sourced") return [];
    const s = q.toLowerCase();
    return interests.filter((i) => i.status !== "closed").filter((i) => !s || [i.full_name, i.address_line, i.suburb, i.email, i.mobile].some((v) => v?.toLowerCase().includes(s)));
  }, [interests, tab, workView, phase, source, q]);
  const lanes = PIPELINE_PHASES.filter((p) => p.key !== "complete" && p.key !== "exceptions" && (phase === "all" || p.key === phase));
  const { data: signedJobs } = useQuery({
    queryKey: ["pipeline_assignments"],
    queryFn: async () => new Set(((await supabase.from("customer_agreements").select("job_id, status")).data ?? []).filter((a) => a.status === "signed").map((a) => a.job_id)),
  });
  // Customer Agreement / Quote Acceptance is only required once an installation quote has been accepted.
  const needsAcceptance = (j: JobRow) => ACCEPTANCE_STAGES.includes(j.stage ?? "") && !!signedJobs && !signedJobs.has(j.id!);
  const piesaIssue = (j: JobRow) => j.urgency === "red" || j.urgency === "expired";
  const paymentIssue = (j: JobRow) => j.payment_status === "overdue" || j.payment_status === "xero_sync_error";
  const piesaCount = jobs.filter(piesaIssue).length, paymentCount = jobs.filter(paymentIssue).length, acceptanceCount = jobs.filter(needsAcceptance).length;
  const warnings = jobs.filter((j) => piesaIssue(j) || paymentIssue(j) || needsAcceptance(j)).length;
  const activeCount = groups.active.length;
  // The in-progress card counts only what this page lists; the total across Enquiries/Quotes/Jobs is shown beside it.
  const activeHere = tab !== "ineligible" ? groups.active.filter((j) => tabOf(j.stage) === tab).length : activeCount;
  const activeByTab = { enquiries: groups.active.filter((j) => tabOf(j.stage) === "enquiries").length, quotes: groups.active.filter((j) => tabOf(j.stage) === "quotes").length, jobs: groups.active.filter((j) => tabOf(j.stage) === "jobs").length };
  const cardCount = (key: keyof typeof groups) => key === "active" ? activeHere : groups[key].length;
  const ineligibleOnly = groups.ineligible.filter((job) => job.eligibility_outcome === "does_not_appear_eligible").length;
  const onHoldOnly = groups.ineligible.filter((job) => job.stage === "on_hold" && job.eligibility_outcome !== "does_not_appear_eligible").length;
  const uncounted = useMemo(() => {
    const seen = new Set([...groups.active, ...groups.review, ...groups.ineligible, ...groups.finalised, ...groups.cancelled].map((j) => j.id));
    return groups.all.filter((j) => !seen.has(j.id)).length;
  }, [groups]);

  return (
    <AppShell wide>
      {pipelineError && (
        <div role="alert" className="mb-4 rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          <span>The Pipeline could not be loaded. Your enquiries have not been deleted.</span>
          <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => void refetchPipeline()}>Try again</Button>
        </div>
      )}
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b pb-3 sm:flex sm:flex-wrap">
         <div className="min-w-0 sm:flex-1">
           <p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p>
           <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{TAB_TITLE[tab]}</h1>
           <p className="mt-2 text-sm text-muted-foreground">Active enquiries first. Ineligible, finalised, cancelled and test records stay safely filed.</p>
           {tab === "enquiries" && <Link to="/admin/enquiry-groups" className="mt-1 inline-block text-sm font-semibold text-primary underline">Open enquiry email groups</Link>}
        </div>
         <div className="flex shrink-0 flex-col items-end gap-2 sm:ml-auto sm:flex-row sm:items-center"><span className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-bold ${comms?.enabled === true ? "border-success/30 bg-success-soft text-success" : "border-workspace-sun-strong/40 bg-workspace-sun text-foreground"}`}><span className={`h-2 w-2 rounded-full ${comms?.enabled === true ? "bg-success" : "bg-warning"}`} />Messages {comms?.enabled === true ? "on" : "off"}</span><NewEnquiry /></div>
      </div>
      <EnquiryResponseOverview />
      {tab !== "board" && <section className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Work views">
        {PRIMARY_VIEWS.map((item) => <Button key={item.key} type="button" size="sm" variant={workView === item.key ? "default" : "outline"} onClick={() => { setWorkView(item.key); setPhase("all"); }} aria-pressed={workView === item.key}>{item.label} <Badge variant="secondary">{cardCount(item.key)}</Badge></Button>)}
        <label className="sr-only" htmlFor="retained-view">Retained records view</label><select id="retained-view" aria-label="Retained and complete records" className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={SECONDARY_VIEWS.some((item) => item.key === workView) ? workView : ""} onChange={(e) => { if (e.target.value) { setWorkView(e.target.value as WorkView); setPhase("all"); } }}><option value="">More records…</option>{SECONDARY_VIEWS.map((item) => <option key={item.key} value={item.key}>{item.label} ({cardCount(item.key)})</option>)}</select>
        <span className="text-xs text-muted-foreground">Ineligible {ineligibleOnly} · On hold {onHoldOnly}</span>
      </section>}
      {workView === "active" && tab !== "ineligible" && tab !== "board" && activeHere !== activeCount && <p data-testid="active-split" className="mb-3 text-xs text-muted-foreground">{activeCount} records are in progress in total: {activeByTab.enquiries} at enquiry stage, {activeByTab.quotes} at quote stage, {activeByTab.jobs} at job stage. {tab !== "enquiries" && activeByTab.enquiries > 0 && <Link to="/admin" search={{ tab: "enquiries" }} className="font-semibold text-primary underline">View the {activeByTab.enquiries} enquiries</Link>}</p>}
      {tab !== "board" && (q || source !== "all" || phase !== "all") && <div data-testid="active-filters" className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">Filters on:</span>{q && <Badge variant="outline">Search “{q}”</Badge>}{source !== "all" && <Badge variant="outline">{source === "hivic_sourced" ? "Home Insulation Victoria-sourced" : "Installer-sourced"}</Badge>}{phase !== "all" && <Badge variant="outline">Phase: {PIPELINE_PHASES.find((p) => p.key === phase)?.label ?? phase}</Badge>}<Button type="button" size="sm" variant="ghost" onClick={() => { setQ(""); setSource("all"); setPhase("all"); }}>Clear filters</Button></div>}
      {uncounted > 0 && <div role="alert" className="mb-3 rounded-md border-l-4 border-destructive bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive">{uncounted} non-test record{uncounted === 1 ? " is" : "s are"} not in any status group. Open “All non-test records” to find {uncounted === 1 ? "it" : "them"}.</div>}
       {workView === "active" && warnings > 0 && <div className="mb-4 rounded-md border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm"><b>{warnings} active job{warnings === 1 ? "" : "s"} need attention.</b> {[piesaCount && `${piesaCount} PIESA`, paymentCount && `${paymentCount} payment`, acceptanceCount && `${acceptanceCount} agreement`].filter(Boolean).join(" · ")}</div>}
      {comms?.enabled !== true && <p className="mb-3 text-xs text-muted-foreground">Pre-launch safety is active: no email, SMS or notification is sent to customers or trades.</p>}
      {intakeHealth && <details data-testid="post-intake-health" className="mb-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-semibold text-foreground">System health {intakeHealth.counts.stale > 0 || intakeHealth.counts.failed > 0 ? `— ${intakeHealth.counts.stale + intakeHealth.counts.failed} need attention` : "— normal"}</summary><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><span>Queued <b className="text-foreground">{intakeHealth.counts.queued}</b></span><span>Running <b className="text-foreground">{intakeHealth.counts.running}</b></span><span className={intakeHealth.counts.stale > 0 ? "font-semibold text-warning" : ""}>Stale <b>{intakeHealth.counts.stale}</b></span><span className={intakeHealth.counts.failed > 0 ? "font-semibold text-danger" : ""}>Failed <b>{intakeHealth.counts.failed}</b></span></div></details>}
      {tab !== "board" && <details className="group mb-3 rounded-md border bg-card sm:hidden" open>
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-semibold sm:hidden">Search and filters <ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary>
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
          <div className="relative min-w-0 basis-full sm:min-w-64 sm:basis-auto sm:flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job number, address or person" className="pl-8" /></div>
          <select aria-label="Job source" className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">All sources</option><option value="hivic_sourced">Home Insulation Victoria-sourced</option><option value="installer_sourced">Installer-sourced</option>
          </select>
           <select aria-label="Phase" className="h-9 rounded-md border bg-background px-2 text-sm" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)} disabled={workView !== "active"}>
             <option value="all">All phases</option>{lanes.map((p) => <option key={p.key} value={p.key}>{p.label} ({byPhase(p.key).length})</option>)}
          </select>
      </div>
      </details>}
      {tab !== "board" && <div className="mb-3 hidden flex-wrap items-center gap-2 rounded-md border bg-card p-3 sm:flex">
          <div className="relative min-w-64 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job number, address or person" className="pl-8" /></div>
          <select aria-label="Job source" className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">All sources</option><option value="hivic_sourced">Home Insulation Victoria-sourced</option><option value="installer_sourced">Installer-sourced</option>
          </select>
          <select aria-label="Phase" className="h-9 rounded-md border bg-background px-2 text-sm" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)} disabled={workView !== "active"}>
            <option value="all">All phases</option>{lanes.map((p) => <option key={p.key} value={p.key}>{p.label} ({byPhase(p.key).length})</option>)}
          </select>
      </div>}
      {tab !== "board" && (() => {
        const all = visibleJobs.length > 0 && visibleJobs.every((j) => selected.has(j.id!));
        return <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium"><Checkbox checked={all} onCheckedChange={() => setSelected(all ? new Set() : new Set(visibleJobs.map((j) => j.id!)))} aria-label="Select all shown" />Select all shown</label>
          {selected.size > 0 && <>
            <span className="font-bold">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => setBulk("hold")}>Put on hold</Button>
            <Button size="sm" variant="outline" onClick={() => setBulk("cancel")}>Cancel</Button>
            <Button size="sm" variant="outline" onClick={() => setBulk("mark_test")}>Mark as test</Button>
            <Button size="sm" variant="destructive" onClick={() => setBulk("delete")}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </>}
        </div>;
      })()}
      <Dialog open={!!bulk} onOpenChange={(o) => { if (!o) setBulk(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{bulk === "delete" ? "Delete" : bulk === "cancel" ? "Cancel" : bulk === "hold" ? "Put on hold" : "Mark as test"} {selected.size} job{selected.size === 1 ? "" : "s"}?</DialogTitle></DialogHeader>
          {bulk === "delete" && <p className="text-sm text-muted-foreground">Only test records can be deleted, and it can't be undone. Real jobs will be skipped — cancel them instead so their history is kept.</p>}
          <Label htmlFor="bulk-reason">Reason (saved in each job's history)</Label>
          <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dummy jobs from testing" />
          <Button disabled={busy || reason.trim().length < 3} variant={bulk === "delete" ? "destructive" : "default"} onClick={async () => {
            if (!bulk) return; setBusy(true);
            try {
              const r = await runBulk({ data: { jobIds: [...selected], action: bulk, reason } });
              if (r.done) toast.success(`${r.done} job${r.done === 1 ? "" : "s"} updated`);
              if (r.failed.length) toast.error(`${r.failed.length} skipped: ${r.failed[0]!.error}`);
              setSelected(new Set(r.failed.map((f) => f.jobId))); setBulk(null); setReason(""); void refetchPipeline();
            } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
          }}>Confirm</Button>
        </DialogContent>
      </Dialog>
      {tab === "board" ? (
        pipelinePending ? (
          <div role="status" className="rounded-md border bg-card px-5 py-10 text-center text-sm font-medium text-muted-foreground">Loading pipeline…</div>
        ) : (
          <>
            {boardStagesError && <div role="alert" className="mb-3 rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">Ready Check bookings could not be checked, so Ready Check jobs are not shown: {(boardStagesError as Error).message}</div>}
            {!boardStages && !boardStagesError && <p role="status" className="mb-3 text-sm text-muted-foreground">Checking real Ready Check bookings…</p>}
            <PipelineBoard jobs={boardJobs} phaseOf={phaseOf} />
          </>
        )
      ) : pipelinePending ? (
        <div role="status" className="rounded-md border bg-card px-5 py-10 text-center text-sm font-medium text-muted-foreground">Loading enquiries…</div>
      ) : (
         <ul aria-label="Records" className="divide-y overflow-hidden rounded-md border bg-card">
           <li aria-hidden className="hidden grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-x-3 bg-muted/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground lg:grid"><span className="w-4" /><span>Property · job · owner</span><span>Stage · eligibility</span><span>Next action · waiting on</span><span>Coverage · warnings</span></li>
           {shownInterests.map((i) => (
           <li key={`interest-${i.id}`} className="relative px-3 py-3 pl-10 hover:bg-muted/40">
             <Link to="/admin/interests" className="after:absolute after:inset-0"><span className="mr-2 inline-flex rounded bg-workspace-blush px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">Registered interest</span><span className="font-semibold">{i.full_name}</span></Link>
             <p className="truncate text-xs text-muted-foreground">{i.address_line} · {i.ceiling_m2} m² · {i.status === "new" ? "New" : i.status === "contacted" ? "Contacted" : "Booked"} · {new Date(i.created_at).toLocaleDateString("en-AU")}</p>
           </li>
         ))}{visibleJobs.map((j: JobRow) => {
           const coverage = coverageByJob.get(j.id ?? "");
           return <StaffJobRow key={j.id} job={j} {...(coverage ? { coverage } : {})} select={<Checkbox checked={selected.has(j.id!)} onCheckedChange={() => toggle(j.id!)} aria-label={`Select job ${j.job_number ?? ""}`} />} />;
         })}{visibleJobs.length === 0 && shownInterests.length === 0 && <li className="p-10 text-center text-sm text-muted-foreground">No records match this view or its filters.{(q || source !== "all" || phase !== "all") && <Button type="button" size="sm" variant="ghost" className="ml-2" onClick={() => { setQ(""); setSource("all"); setPhase("all"); }}>Clear filters</Button>}</li>}</ul>
      )}
    </AppShell>
  );
}

function NewEnquiry() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", unknown: false, life: false });
  const create = useAction(createEnquiry);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New enquiry</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New enquiry (phone / manual)</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          await create({ full_name: f.full_name, email: f.email, phone: f.phone || null, address_line: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.unknown || !f.area ? null : Number(f.area), area_unknown: f.unknown || !f.area, life_support: f.life }, "Enquiry created");
          setOpen(false);
        }}>
          <div><Label>Name</Label><Input value={f.full_name} onChange={set("full_name")} required /></div>
          <div><Label>Email</Label><Input type="email" value={f.email} onChange={set("email")} required /></div>
          <div><Label>Phone</Label><Input value={f.phone} onChange={set("phone")} /></div>
          <div><Label>Occupancy</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.occupancy} onChange={(e) => setF({ ...f, occupancy: e.target.value as "owner_occupied" | "rental" })}>
              <option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option>
            </select></div>
          <div className="sm:col-span-2"><Label>Street address</Label><Input value={f.address_line} onChange={set("address_line")} required /></div>
          <div><Label>Suburb</Label><Input value={f.suburb} onChange={set("suburb")} /></div>
          <div><Label>Postcode</Label><Input value={f.postcode} onChange={set("postcode")} /></div>
          <div><Label>Est. ceiling area m²</Label><Input type="number" value={f.area} onChange={set("area")} disabled={f.unknown} /></div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.unknown} onCheckedChange={(v) => setF({ ...f, unknown: !!v })} /> I don't know the area</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.life} onCheckedChange={(v) => setF({ ...f, life: !!v })} /> Life support at property</label>
          </div>
          <Button type="submit" className="sm:col-span-2">Create job</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PipelineBoard({ jobs, phaseOf }: { jobs: JobRow[]; phaseOf: (j: JobRow) => Phase | null }) {
  const columns = PIPELINE_PHASES.filter((p) => p.key !== "complete");
  const jobIds = useMemo(() => jobs.map((j) => j.id!).filter(Boolean), [jobs]);
  const { data: readyCheckBookings } = useQuery({
    queryKey: ["board_ready_check_bookings", jobIds],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const rows = (await supabase.from("bookings").select("job_id, scheduled_start, status").in("job_id", jobIds).eq("kind", "ready_check").order("scheduled_start", { ascending: false })).data ?? [];
      const byJob = new Map<string, string>();
      for (const b of rows) if (b.status !== "cancelled" && !byJob.has(b.job_id)) byJob.set(b.job_id, b.scheduled_start);
      return byJob;
    },
  });
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-6 sm:-mx-7 sm:px-7">
      <div className="flex min-w-max items-start gap-4">
        {columns.map((col) => {
          const cards = jobs.filter((j) => phaseOf(j) === col.key);
          return (
            <section key={col.key} className="flex w-72 shrink-0 flex-col" aria-label={`${col.label} (${cards.length})`}>
              <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold text-foreground">
                {col.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{cards.length}</span>
              </h3>
              <div className="flex min-h-24 flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-2">
                {cards.map((j) => <BoardCard key={j.id} job={j} readyCheckAt={col.key === "ready_check" ? readyCheckBookings?.get(j.id!) ?? null : null} />)}
                {cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No jobs here</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ job, readyCheckAt }: { job: JobRow; readyCheckAt?: string | null }) {
  const step = nextStep(job);
  const booked = !!readyCheckAt; // a real Ready Check booking, never the stored stage alone
  return (
    <Link to="/admin/jobs/$jobId" params={{ jobId: job.id! }} className="block rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-primary">{job.job_number}</span>
        <Pill t={step.tone}>{step.label}</Pill>
      </div>
      <p className="mt-1.5 font-bold leading-tight text-foreground">{job.property_address}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.owner_name}</p>
      {booked && (
        <p className="mt-2 rounded-md bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
          Booked{readyCheckAt ? `: ${new Date(readyCheckAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : " — date on the job page"}
        </p>
      )}
      <div className="mt-3 border-t pt-3">
        <p className="text-xs font-semibold text-foreground">{step.next}</p>
        {step.waitingOn && <p className="mt-1 text-[11px] text-muted-foreground">Waiting on {step.waitingOn}</p>}
        <div className="mt-1"><InstallerFactsLine facts={job.installer_facts} /></div>
      </div>
    </Link>
  );
}
