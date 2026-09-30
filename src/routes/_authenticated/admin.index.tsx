import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, Ban, CheckCircle2, FlaskConical, Plus, Search, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard, type JobRow } from "@/components/portal/JobCard";
import { PIPELINE_PHASES, phaseForStage, type Phase } from "@/lib/workflow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-me";
import { autoAdvancePipeline, createEnquiry, getAdminPipeline, getCommsStatus, getPostIntakeHealth, sweepAuthorities } from "@/lib/portal.functions";
import { useServerFn } from "@tanstack/react-start";
import { getAdminCoverage } from "@/lib/coverage.functions";

const ACCEPTANCE_STAGES = ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"];
type WorkView = "active" | "review" | "ineligible" | "finalised" | "cancelled" | "test";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Enquiries – HI VIC Portal" }, { name: "description", content: "HI VIC active enquiry workspace." }, { property: "og:title", content: "Enquiries – HI VIC Portal" }, { property: "og:description", content: "HI VIC active enquiry workspace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Pipeline,
});

function Pipeline() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "hivic_sourced" | "installer_sourced">("all");
  const [workView, setWorkView] = useState<WorkView>("active");
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
  const { data: allJobs = [], error: pipelineError, isPending: pipelinePending, refetch: refetchPipeline } = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => loadPipeline(),
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 30_000,
  });
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
    finalised: allJobs.filter((job) => job.source !== "qa_test" && job.stage === "complete"),
    cancelled: allJobs.filter((job) => job.source !== "qa_test" && job.stage === "cancelled"),
    ineligible: allJobs.filter((job) => job.source !== "qa_test" && (job.eligibility_outcome === "does_not_appear_eligible" || job.stage === "on_hold") && job.stage !== "cancelled"),
    review: allJobs.filter((job) => job.source !== "qa_test" && job.eligibility_review_required && !["complete", "cancelled", "on_hold"].includes(job.stage ?? "")),
    active: allJobs.filter((job) => job.source !== "qa_test" && !job.eligibility_review_required && job.eligibility_outcome !== "does_not_appear_eligible" && !["complete", "cancelled", "on_hold"].includes(job.stage ?? "")),
  }), [allJobs]);
  const jobs = groups[workView];
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return jobs.filter((j) => source === "all" || j.channel === source).filter((j) => !s || [j.job_number, j.property_address, j.owner_name, j.electrician_name, j.installer_name].some((v) => v?.toLowerCase().includes(s)));
  }, [jobs, q, source]);
  const byPhase = (p: Phase) => filtered.filter((j) => phaseForStage(j.stage) === p);
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

  return (
    <AppShell wide>
      {pipelineError && (
        <div role="alert" className="mb-4 rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          <span>Enquiries could not be loaded. Your records have not been deleted.</span>
          <Button type="button" variant="outline" size="sm" className="ml-3" onClick={() => void refetchPipeline()}>Try again</Button>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-start gap-4 border-b pb-5">
        <div>
           <p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p>
           <h1 className="mt-1 text-4xl font-bold">ENQUIRIES</h1>
           <p className="mt-2 text-sm text-muted-foreground">Active enquiries first. Ineligible, finalised, cancelled and test records stay safely filed.</p>
        </div>
         <div className="ml-auto flex items-center gap-2"><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${comms?.enabled === true ? "border-success/30 bg-success-soft text-success" : "border-workspace-sun-strong/40 bg-workspace-sun text-foreground"}`}><span className={`h-2 w-2 rounded-full ${comms?.enabled === true ? "bg-success" : "bg-warning"}`} />Customer messages {comms?.enabled === true ? "on" : "off"}</span><NewEnquiry /></div>
      </div>
       <section className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Work files">
          {([{ key: "active", label: "Active enquiries", count: activeCount, icon: Workflow }, { key: "review", label: "Needs review", count: groups.review.length, icon: AlertTriangle }, { key: "ineligible", label: "Ineligible / hold", count: groups.ineligible.length, icon: Ban }, { key: "finalised", label: "Finalised", count: groups.finalised.length, icon: CheckCircle2 }, { key: "cancelled", label: "Cancelled", count: groups.cancelled.length, icon: Archive }, { key: "test", label: "Test records", count: groups.test.length, icon: FlaskConical }] as const).map((item) => <button key={item.key} type="button" onClick={() => { setWorkView(item.key); setPhase("all"); }} className={`rounded-md border p-3 text-left transition hover:border-primary ${workView === item.key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card"}`}><div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">{item.label}</span><item.icon className="h-4 w-4 text-primary" /></div><div className="mt-1 text-xl font-bold">{item.count}</div></button>)}
      </section>
       {workView === "active" && warnings > 0 && <div className="mb-4 rounded-md border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm"><b>{warnings} active job{warnings === 1 ? "" : "s"} need attention.</b> {[piesaCount && `${piesaCount} PIESA`, paymentCount && `${paymentCount} payment`, acceptanceCount && `${acceptanceCount} agreement`].filter(Boolean).join(" · ")}</div>}
      {comms?.enabled !== true && <p className="mb-3 text-xs text-muted-foreground">Pre-launch safety is active: no email, SMS or notification is sent to customers or trades.</p>}
      {intakeHealth && <div data-testid="post-intake-health" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-4 py-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Enquiry intake</span><span>Queued <b className="text-foreground">{intakeHealth.counts.queued}</b></span><span>Running <b className="text-foreground">{intakeHealth.counts.running}</b></span><span className={intakeHealth.counts.stale > 0 ? "font-semibold text-warning" : ""}>Stale <b>{intakeHealth.counts.stale}</b></span><span className={intakeHealth.counts.failed > 0 ? "font-semibold text-danger" : ""}>Failed <b>{intakeHealth.counts.failed}</b></span></div>}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-sm">
          <div className="relative min-w-64 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job number, address or person" className="pl-8" /></div>
          <select aria-label="Job source" className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">All sources</option><option value="hivic_sourced">HI VIC-sourced</option><option value="installer_sourced">Installer-sourced</option>
          </select>
           <select aria-label="Phase" className="h-9 rounded-md border bg-background px-2 text-sm" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)} disabled={workView !== "active"}>
             <option value="all">All phases</option>{lanes.map((p) => <option key={p.key} value={p.key}>{p.label} ({byPhase(p.key).length})</option>)}
          </select>
      </div>
      {pipelinePending ? (
        <div role="status" className="rounded-md border bg-card px-5 py-10 text-center text-sm font-medium text-muted-foreground">Loading enquiries…</div>
      ) : (
         <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.filter((j) => phase === "all" || phaseForStage(j.stage) === phase).map((j: JobRow) => {
           const coverage = coverageByJob.get(j.id ?? "");
           return <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" {...(coverage ? { coverage } : {})} />;
         })}{filtered.length === 0 && <div className="col-span-full rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">No records in this view.</div>}</div>
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
