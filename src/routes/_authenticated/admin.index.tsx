import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, List, Plus, Search, SlidersHorizontal, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { JobCard, type JobRow } from "@/components/portal/JobCard";
import { EXCEPTION_PHASE, PIPELINE_PHASES, phaseForStage, type Phase } from "@/lib/workflow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/hooks/use-me";
import { autoAdvancePipeline, createEnquiry, getAdminPipeline, getCommsStatus, getPostIntakeHealth, sweepAuthorities } from "@/lib/portal.functions";
import { useServerFn } from "@tanstack/react-start";

const ACCEPTANCE_STAGES = ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"];

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Pipeline – HI VIC Portal" }, { name: "description", content: "HI VIC operational job pipeline." }, { property: "og:title", content: "Pipeline – HI VIC Portal" }, { property: "og:description", content: "HI VIC operational job pipeline." }] }),
  component: Pipeline,
});

function Pipeline() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [source, setSource] = useState<"all" | "hivic_sourced" | "installer_sourced">("all");
  const [showTest, setShowTest] = useState(false);
  const sweep = useServerFn(sweepAuthorities);
  const advance = useServerFn(autoAdvancePipeline);
  const loadPipeline = useServerFn(getAdminPipeline);
  const [showExceptions, setShowExceptions] = useState(false);
  const commsStatus = useServerFn(getCommsStatus);
  const { data: comms } = useQuery({ queryKey: ["comms_status"], queryFn: () => commsStatus() });
  const postIntakeHealth = useServerFn(getPostIntakeHealth);
  const { data: intakeHealth } = useQuery({ queryKey: ["post_intake_health"], queryFn: () => postIntakeHealth(), refetchInterval: 60_000 });
  const [phase, setPhase] = useState<Phase | "all">("all");
  const { data: allJobs = [], error: pipelineError } = useQuery({
    queryKey: ["pipeline"],
    queryFn: async () => {
      await sweep().catch(() => null);
      await advance().catch(() => null);
      return loadPipeline();
    },
  });
  const jobs = useMemo(() => allJobs.filter((j) => showTest || j.source !== "qa_test"), [allJobs, showTest]);
  const hiddenTest = allJobs.length - jobs.length;
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return jobs.filter((j) => source === "all" || j.channel === source).filter((j) => !s || [j.job_number, j.property_address, j.owner_name, j.electrician_name, j.installer_name].some((v) => v?.toLowerCase().includes(s)));
  }, [jobs, q, source]);
  const byPhase = (p: Phase) => filtered.filter((j) => phaseForStage(j.stage) === p);
  const lanes = PIPELINE_PHASES.filter((p) => phase === "all" || p.key === phase);
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
  const activeCount = jobs.filter((j) => !["complete", "cancelled"].includes(j.stage ?? "")).length;

  return (
    <AppShell wide>
      {pipelineError && (
        <div role="alert" className="mb-4 rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          The Pipeline could not be loaded. Refresh the page or sign in again.
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-start gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold">Operations pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every job from enquiry to VEEC completion, with blockers shown before work moves.</p>
        </div>
        <div className="ml-auto flex items-center gap-2"><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${comms?.enabled === true ? "border-success/30 bg-success-soft text-success" : "border-warning/40 bg-warning-soft text-foreground"}`}><span className={`h-2 w-2 rounded-full ${comms?.enabled === true ? "bg-success" : "bg-warning"}`} />Customer messages {comms?.enabled === true ? "on" : "off"}</span><NewEnquiry /></div>
      </div>
      <section className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Pipeline summary">
        <button type="button" onClick={() => { setPhase("all"); setShowExceptions(false); }} className="rounded-md border bg-card p-4 text-left shadow-sm transition hover:border-primary"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted-foreground">Active jobs</span><Workflow className="h-4 w-4 text-primary" /></div><div className="mt-1 text-2xl font-bold">{activeCount}</div><div className="text-xs text-muted-foreground">Across the full workflow</div></button>
        <button type="button" onClick={() => setShowExceptions(false)} className={`rounded-md border bg-card p-4 text-left shadow-sm transition hover:border-warning ${warnings > 0 ? "border-l-4 border-l-warning" : ""}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted-foreground">Needs attention</span><AlertTriangle className="h-4 w-4 text-warning" /></div><div className="mt-1 text-2xl font-bold">{warnings}</div><div className="text-xs text-muted-foreground">{warnings > 0 ? [piesaCount && `${piesaCount} PIESA`, paymentCount && `${paymentCount} payment`, acceptanceCount && `${acceptanceCount} agreement`].filter(Boolean).join(" · ") : "No active blockers"}</div></button>
        <button type="button" onClick={() => { setPhase("complete"); setShowExceptions(false); }} className="rounded-md border bg-card p-4 text-left shadow-sm transition hover:border-success"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted-foreground">Completed</span><CheckCircle2 className="h-4 w-4 text-success" /></div><div className="mt-1 text-2xl font-bold">{byPhase("complete").length}</div><div className="text-xs text-muted-foreground">Ready and closed records</div></button>
      </section>
      {comms?.enabled !== true && <p className="mb-3 text-xs text-muted-foreground">Pre-launch safety is active: no email, SMS or notification is sent to customers or trades.</p>}
      {intakeHealth && <div data-testid="post-intake-health" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-4 py-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Enquiry intake</span><span>Queued <b className="text-foreground">{intakeHealth.counts.queued}</b></span><span>Running <b className="text-foreground">{intakeHealth.counts.running}</b></span><span className={intakeHealth.counts.stale > 0 ? "font-semibold text-warning" : ""}>Stale <b>{intakeHealth.counts.stale}</b></span><span className={intakeHealth.counts.failed > 0 ? "font-semibold text-danger" : ""}>Failed <b>{intakeHealth.counts.failed}</b></span></div>}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-sm">
          <div className="relative min-w-64 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job number, address or person" className="pl-8" /></div>
          <select aria-label="Job source" className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">All sources</option><option value="hivic_sourced">HI VIC-sourced</option><option value="installer_sourced">Installer-sourced</option>
          </select>
          <select aria-label="Phase" className="h-9 rounded-md border bg-background px-2 text-sm" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
            <option value="all">All phases</option>{PIPELINE_PHASES.map((p) => <option key={p.key} value={p.key}>{p.label} ({byPhase(p.key).length})</option>)}
          </select>
          <Button variant={showExceptions ? "secondary" : "outline"} onClick={() => setShowExceptions(!showExceptions)}><AlertTriangle /> Exceptions ({byPhase("exceptions").length})</Button>
          <label className="flex items-center gap-2 px-1 text-sm"><Checkbox checked={showTest} onCheckedChange={(v) => setShowTest(!!v)} /> Test jobs{hiddenTest > 0 && ` (${hiddenTest})`}</label>
          <Button variant="outline" onClick={() => setView(view === "board" ? "list" : "board")}>{view === "board" ? <List /> : <SlidersHorizontal />}{view === "board" ? "List" : "Board"}</Button>
      </div>
      {showExceptions && (
        <section className="mb-4 rounded-xl border bg-muted/40 p-3">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{EXCEPTION_PHASE.label}</h2>
          {byPhase("exceptions").length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{byPhase("exceptions").map((j) => <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" />)}</div> : <p className="text-sm text-muted-foreground">None.</p>}
        </section>
      )}
      {view === "board" ? (
        <div className="flex gap-5 overflow-x-auto pb-5">
          {lanes.map((p) => (
            <div key={p.key} className="w-[19rem] shrink-0">
              <div className="mb-3 flex items-center justify-between border-b px-1 pb-2 text-sm font-bold text-foreground">
                <span>{p.label}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{byPhase(p.key).length}</span>
              </div>
              <div className="space-y-3">{byPhase(p.key).map((j) => <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" />)}{byPhase(p.key).length === 0 && <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">No jobs in this phase</div>}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.filter((j) => phase === "all" || phaseForStage(j.stage) === phase).filter((j) => showExceptions || phaseForStage(j.stage) !== "exceptions").map((j: JobRow) => <JobCard key={j.id} job={j} to="/admin/jobs/$jobId" />)}</div>
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
