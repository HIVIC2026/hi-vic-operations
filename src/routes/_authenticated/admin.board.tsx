import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { InstallerFactsLine } from "@/components/portal/installer-job-facts";
import { Badge } from "@/components/ui/badge";
import { listInterests } from "@/lib/interest.functions";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, Search } from "lucide-react";
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
import { JobFactsLine } from "@/components/portal/job-facts-line";
import { ageDays } from "@/lib/ageing.core";

const ACCEPTANCE_STAGES = ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"];
type WorkView = "all" | "active" | "review" | "ineligible" | "finalised" | "cancelled" | "test";
type Tab = "board" | "jobs" | "quotes" | "enquiries" | "ineligible";
const QUOTE_STAGES = ["awaiting_quote_acceptance", "measured_estimate_ready"];
const JOB_STAGES = [...ACCEPTANCE_STAGES, "measured_quote_accepted", "piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending", "awaiting_owner_rectification_approval"];
const tabOf = (stage: string | null | undefined): Tab => QUOTE_STAGES.includes(stage ?? "") ? "quotes" : JOB_STAGES.includes(stage ?? "") ? "jobs" : "enquiries";
const TAB_TITLE: Record<Tab, string> = { board: "Quote approvals", jobs: "ACTIVE JOBS", quotes: "PENDING QUOTE APPROVAL", enquiries: "ENQUIRIES", ineligible: "INELIGIBLE" };

const PRIMARY_VIEWS: { key: WorkView; label: string }[] = [{ key: "active", label: "In progress" }, { key: "review", label: "Needs review" }, { key: "ineligible", label: "Exceptions" }];
const SECONDARY_VIEWS: { key: WorkView; label: string }[] = [{ key: "all", label: "All non-test records" }, { key: "finalised", label: "Finalised" }, { key: "cancelled", label: "Cancelled" }, { key: "test", label: "Test records" }];

export const Route = createFileRoute("/_authenticated/admin/board")({
  head: () => ({ meta: [{ title: "Quote approvals – Home Insulation Victoria Office" }, { name: "description", content: "Pending quote approvals for Home Insulation Victoria jobs." }, { property: "og:title", content: "Quote approvals – Home Insulation Victoria Office" }, { property: "og:description", content: "Pending quote approvals." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (["board", "jobs", "quotes", "enquiries", "ineligible"].includes(s["tab"] as string) ? { tab: s["tab"] as Tab } : {}),
  // Only the Quote approvals queue still has a function here. Every other entry goes to the
  // consolidated workspace, so the legacy board can never appear as a second Office home.
  beforeLoad: ({ search }) => {
    const tab = (search as { tab?: Tab }).tab;
    if (tab === "quotes") return;
    if (tab === "jobs") throw redirect({ to: "/admin/jobs/active", replace: true });
    if (tab === "ineligible") throw redirect({ to: "/admin/enquiries", search: { status: "ineligible" }, replace: true });
    if (tab === "enquiries") throw redirect({ to: "/admin/enquiries", replace: true });
    throw redirect({ to: "/admin/jobs/active", replace: true });
  },
  component: Pipeline,
});

function Pipeline() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "hivic_sourced" | "installer_sourced">("all");
  const [insulation, setInsulation] = useState<"all" | "none" | "present" | "unknown" | "missing">("all");
  const [media, setMedia] = useState<"all" | "has" | "none">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "waiting">("newest");
  const { tab = "board" } = Route.useSearch();
  const [workView, setWorkView] = useState<WorkView>("active");
  // A section click may change both the tab and the view; the tab effect must not overwrite the view it just set.
  useEffect(() => {
    setWorkView(tab === "ineligible" ? "ineligible" : "active");
  }, [tab]);
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
  // Search covers every identifying field already on the row (never a different dataset), then the client-side
  // filters narrow what is shown. Nothing is removed from the loaded records: the count line always says how many
  // of the loaded rows are being displayed.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = jobs
      .filter((j) => source === "all" || j.channel === source)
      .filter((j) => {
        if (insulation === "all") return true;
        const v = j.enquiry_facts?.insulation ?? null;
        return insulation === "missing" ? v === null : v === insulation;
      })
      .filter((j) => {
        if (media === "all") return true;
        const n = j.enquiry_facts?.mediaCount ?? null;
        if (n === null) return true; // unknown is never hidden as if it were "no media"
        return media === "has" ? n > 0 : n === 0;
      })
      .filter((j) => !s || [j.job_number, j.property_address, j.owner_name, j.owner_email, j.owner_phone, j.electrician_name, j.installer_name].some((v) => v?.toLowerCase().includes(s)));
    const at = (v: string | null | undefined) => v ?? "";
    return [...rows].sort((a, b) =>
      sort === "oldest" ? at(a.created_at).localeCompare(at(b.created_at))
        : sort === "waiting" ? at(a.last_activity_at).localeCompare(at(b.last_activity_at))
          : at(b.last_activity_at).localeCompare(at(a.last_activity_at)));
  }, [jobs, q, source, insulation, media, sort]);
  const visibleJobs = useMemo(() => filterVisibleJobs(filtered, phase, (_s, j) => phaseOf(j)), [filtered, phase, phaseOf]);
  // One pass for lane counts + oldest age (was: one pass per lane, on every render). Counts describe the rows this
  // page has loaded, which is the whole pipeline for an admin — the label says so rather than implying a DB total.
  const phaseStats = useMemo(() => {
    const m = new Map<Phase, { count: number; oldest: number | null }>();
    for (const j of filtered) {
      const p = phaseOf(j);
      if (!p) continue;
      const e = m.get(p) ?? { count: 0, oldest: null };
      e.count += 1;
      const d = ageDays(j.created_at);
      if (d !== null && (e.oldest === null || d > e.oldest)) e.oldest = d;
      m.set(p, e);
    }
    return m;
  }, [filtered, phaseOf]);
  const byPhase = useCallback((p: Phase) => phaseStats.get(p)?.count ?? 0, [phaseStats]);
  const filtersOn = q !== "" || source !== "all" || phase !== "all" || insulation !== "all" || media !== "all";
  const section: "enquiries" | "jobs" | "closed" | null =
    workView === "finalised" || workView === "cancelled" ? "closed"
      : tab === "enquiries" && workView === "active" ? "enquiries"
        : tab === "jobs" && workView === "active" ? "jobs" : null;
  const resetFilters = () => { setQ(""); setSource("all"); setPhase("all"); setInsulation("all"); setMedia("all"); setSort("newest"); };
  // Jo (19 Oct): the dashboard must read as three plain sections — Enquiries / Active jobs / Closed jobs.
  // The legacy work-view row is still reachable but folded away so it no longer competes with them.
  const sectionTitle = section === "enquiries" ? "ENQUIRIES" : section === "jobs" ? "ACTIVE JOBS" : section === "closed" ? "CLOSED JOBS" : TAB_TITLE[tab];
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

  // One filter bar for every breakpoint (was two near-identical copies of the same controls). Labels are visible
  // so the filters are discoverable, and Reset is always one click away.
  const filterFields = (
    <>
      <div className="relative min-w-0 basis-full sm:min-w-64 sm:basis-auto sm:flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, address, job number, email or phone" aria-label="Search records" className="pl-8" />
      </div>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Source
        <select aria-label="Job source" className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="all">All sources</option><option value="hivic_sourced">Home Insulation Victoria-sourced</option><option value="installer_sourced">Installer-sourced</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Stage
        <select aria-label="Stage phase" className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)} disabled={workView !== "active"}>
          <option value="all">All stages</option>{lanes.map((p) => <option key={p.key} value={p.key}>{p.label} ({byPhase(p.key)})</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Insulation
        <select aria-label="Insulation status" className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={insulation} onChange={(e) => setInsulation(e.target.value as typeof insulation)}>
          <option value="all">Any</option><option value="none">No insulation</option><option value="present">Present</option><option value="unknown">Unknown</option><option value="missing">Not provided</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Media
        <select aria-label="Media availability" className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={media} onChange={(e) => setMedia(e.target.value as typeof media)}>
          <option value="all">Any</option><option value="has">Has media</option><option value="none">No media</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Sort
        <select aria-label="Sort order" className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest activity</option><option value="oldest">Oldest enquiry</option><option value="waiting">Longest waiting</option>
        </select>
      </label>
      {(filtersOn || sort !== "newest") && <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>Reset filters</Button>}
    </>
  );

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
           <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{sectionTitle}</h1>
           <p className="mt-2 text-sm text-muted-foreground">Active enquiries first. Ineligible, finalised, cancelled and test records stay safely filed.</p>
           <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-primary">
            {tab === "enquiries" && <Link to="/admin/enquiry-groups" className="underline">Enquiry email groups</Link>}
            <Link to="/admin/templates" className="underline">Email templates</Link>
            <Link to="/admin/communications" className="underline">Customer communications</Link>
          </div>
        </div>
         <div className="flex shrink-0 flex-col items-end gap-2 sm:ml-auto sm:flex-row sm:items-center"><span className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-bold ${comms?.enabled === true ? "border-success/30 bg-success-soft text-success" : "border-workspace-sun-strong/40 bg-workspace-sun text-foreground"}`}><span className={`h-2 w-2 rounded-full ${comms?.enabled === true ? "bg-success" : "bg-warning"}`} />Messages {comms?.enabled === true ? "on" : "off"}</span><NewEnquiry /></div>
      </div>
      {/* Legacy internal detail view: primary section navigation lives in the top bar only. */}
      {tab !== "board" && <details className="mb-2 rounded-md border bg-card px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">More views · Review required, Exceptions, On hold, Finalised, Cancelled, Test</summary>
        <section className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Work views">
        {PRIMARY_VIEWS.map((item) => <Button key={item.key} type="button" size="sm" variant={workView === item.key ? "default" : "outline"} onClick={() => { setWorkView(item.key); setPhase("all"); }} aria-pressed={workView === item.key}>{item.label} <Badge variant="secondary">{cardCount(item.key)}</Badge></Button>)}
        <label className="sr-only" htmlFor="retained-view">Retained records view</label><select id="retained-view" aria-label="Retained and complete records" className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={SECONDARY_VIEWS.some((item) => item.key === workView) ? workView : ""} onChange={(e) => { if (e.target.value) { setWorkView(e.target.value as WorkView); setPhase("all"); } }}><option value="">More records…</option>{SECONDARY_VIEWS.map((item) => <option key={item.key} value={item.key}>{item.label} ({cardCount(item.key)})</option>)}</select>
        <span className="text-xs text-muted-foreground">Ineligible {ineligibleOnly} · On hold {onHoldOnly}</span>
        </section>
      </details>}
      {workView === "active" && tab !== "ineligible" && tab !== "board" && activeHere !== activeCount && <p data-testid="active-split" className="mb-3 text-xs text-muted-foreground">{activeCount} records are in progress in total: {activeByTab.enquiries} at enquiry stage, {activeByTab.quotes} at quote stage, {activeByTab.jobs} at job stage. {tab !== "enquiries" && activeByTab.enquiries > 0 && <Link to="/admin" search={{ tab: "enquiries" }} className="font-semibold text-primary underline">View the {activeByTab.enquiries} enquiries</Link>}</p>}
      {tab !== "board" && (filtersOn || sort !== "newest") && <div data-testid="active-filters" className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold" data-testid="shown-count">Showing {visibleJobs.length} of {jobs.length} loaded:</span>{q && <Badge variant="outline">Search “{q}”</Badge>}{source !== "all" && <Badge variant="outline">{source === "hivic_sourced" ? "Home Insulation Victoria-sourced" : "Installer-sourced"}</Badge>}{phase !== "all" && <Badge variant="outline">Stage: {PIPELINE_PHASES.find((p) => p.key === phase)?.label ?? phase}</Badge>}{insulation !== "all" && <Badge variant="outline">Insulation: {insulation === "missing" ? "not provided" : insulation}</Badge>}{media !== "all" && <Badge variant="outline">Media: {media === "has" ? "has media" : "no media"}</Badge>}{sort !== "newest" && <Badge variant="outline">Sort: {sort === "oldest" ? "oldest enquiry" : "longest waiting"}</Badge>}<Button type="button" size="sm" variant="ghost" onClick={resetFilters}>Reset filters</Button></div>}
      {workView === "review" && <p className="mb-3 text-xs text-muted-foreground">These records are waiting on an Office decision. Open one to see its photos/videos and eligibility evidence, then record the decision — nothing advances automatically.</p>}
      {uncounted > 0 && <div role="alert" className="mb-3 rounded-md border-l-4 border-destructive bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive">{uncounted} non-test record{uncounted === 1 ? " is" : "s are"} not in any status group. Open “All non-test records” to find {uncounted === 1 ? "it" : "them"}.</div>}
       {workView === "active" && warnings > 0 && <div className="mb-4 rounded-md border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm"><b>{warnings} active job{warnings === 1 ? "" : "s"} need attention.</b> {[piesaCount && `${piesaCount} PIESA`, paymentCount && `${paymentCount} payment`, acceptanceCount && `${acceptanceCount} agreement`].filter(Boolean).join(" · ")}</div>}
      {comms?.enabled !== true && <p className="mb-3 text-xs text-muted-foreground">Pre-launch safety is active: no email, SMS or notification is sent to customers or trades.</p>}
      {intakeHealth && <details data-testid="post-intake-health" className="mb-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-semibold text-foreground">System health {intakeHealth.counts.stale > 0 || intakeHealth.counts.failed > 0 ? `— ${intakeHealth.counts.stale + intakeHealth.counts.failed} need attention` : "— normal"}</summary><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><span>Queued <b className="text-foreground">{intakeHealth.counts.queued}</b></span><span>Running <b className="text-foreground">{intakeHealth.counts.running}</b></span><span className={intakeHealth.counts.stale > 0 ? "font-semibold text-warning" : ""}>Stale <b>{intakeHealth.counts.stale}</b></span><span className={intakeHealth.counts.failed > 0 ? "font-semibold text-danger" : ""}>Failed <b>{intakeHealth.counts.failed}</b></span></div></details>}
      {tab !== "board" && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">{filterFields}</div>}
      {tab !== "board" && (() => {
        const all = visibleJobs.length > 0 && visibleJobs.every((j) => selected.has(j.id!));
        return <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium"><Checkbox checked={all} onCheckedChange={() => setSelected(all ? new Set() : new Set(visibleJobs.map((j) => j.id!)))} aria-label="Select all shown" />Select all shown</label>
          {selected.size > 0 && <>
            <span className="font-bold" data-testid="selected-count">{selected.size} of {visibleJobs.length} shown selected</span>
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
         })}{visibleJobs.length === 0 && shownInterests.length === 0 && <li className="p-10 text-center text-sm text-muted-foreground">No records match this view or its filters.{(filtersOn || sort !== "newest") && <Button type="button" size="sm" variant="ghost" className="ml-2" onClick={resetFilters}>Reset filters</Button>}</li>}</ul>
      )}
    </AppShell>
  );
}

function NewEnquiry() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", unknown: false, life: "unknown" as "yes" | "no" | "unknown" });
  const create = useAction(createEnquiry);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New enquiry</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New enquiry (phone / manual)</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          await create({ full_name: f.full_name, email: f.email, phone: f.phone || null, address_line: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.unknown || !f.area ? null : Number(f.area), area_unknown: f.unknown || !f.area, life_support: f.life === "yes" ? true : f.life === "no" ? false : null, life_support_status: f.life }, "Enquiry created");
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
            <div><Label>Life support at property</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.life} onChange={(e) => setF({ ...f, life: e.target.value as "yes" | "no" | "unknown" })}>
                <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
              </select></div>
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
  // Group once per render instead of filtering the whole list once per lane.
  const byStage = useMemo(() => {
    const m = new Map<Phase, JobRow[]>();
    for (const j of jobs) {
      const p = phaseOf(j);
      if (!p) continue;
      const list = m.get(p);
      if (list) list.push(j);
      else m.set(p, [j]);
    }
    return m;
  }, [jobs, phaseOf]);
  const oldestByStage = useMemo(() => {
    const m = new Map<Phase, number>();
    for (const [key, list] of byStage) {
      let oldest = 0;
      for (const j of list) oldest = Math.max(oldest, ageDays(j.created_at) ?? 0);
      m.set(key, oldest);
    }
    return m;
  }, [byStage]);
  return (
    <div className="-mx-4 px-4 pb-6 sm:-mx-7 sm:px-7">
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 sm:hidden" aria-label="Jump to stage">
        {columns.map((col) => (
          <button key={col.key} type="button" className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-xs font-semibold" onClick={() => document.getElementById(`lane-${col.key}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}>
            {col.label} {byStage.get(col.key)?.length ?? 0}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-start gap-4">
          {columns.map((col) => {
            const cards = byStage.get(col.key) ?? [];
            const oldest = oldestByStage.get(col.key) ?? 0;
            return (
              <section key={col.key} id={`lane-${col.key}`} className="flex w-72 shrink-0 scroll-ml-4 flex-col" aria-label={`${col.label} (${cards.length})`}>
                <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold text-foreground">
                  {col.label}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{cards.length}</span>
                  {oldest > 0 && (
                    <span className={oldest >= 30 ? "text-xs font-semibold text-danger" : oldest >= 14 ? "text-xs font-semibold text-warning" : "text-xs text-muted-foreground"} title="Age of the oldest enquiry in this stage">
                      oldest {oldest}d
                    </span>
                  )}
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
    </div>
  );
}

function BoardCard({ job, readyCheckAt }: { job: JobRow; readyCheckAt?: string | null }) {
  const step = nextStep(job);
  const booked = !!readyCheckAt; // a real Ready Check booking, never the stored stage alone
  return (
    <Link to="/admin/jobs/$jobId" params={{ jobId: job.id! }} className="block rounded-xl border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-primary">{job.job_number}</span>
        <Pill t={step.tone}>{step.label}</Pill>
      </div>
      <p className="mt-1 font-bold leading-tight text-foreground">{job.property_address}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.owner_name}</p>
      <div className="mt-1"><JobFactsLine job={job} compact /></div>
      {booked && (
        <p className="mt-2 rounded-md bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
          Booked{readyCheckAt ? `: ${new Date(readyCheckAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : " — date on the job page"}
        </p>
      )}
      <div className="mt-2 border-t pt-2">
        <p className="text-xs font-semibold text-foreground">{step.next}</p>
        {step.waitingOn && <p className="mt-1 text-[11px] text-muted-foreground">Waiting on {step.waitingOn}</p>}
        <div className="mt-1"><InstallerFactsLine facts={job.installer_facts} /></div>
      </div>
    </Link>
  );
}
