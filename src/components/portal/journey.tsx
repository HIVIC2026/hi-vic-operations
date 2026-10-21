import { Check, ChevronDown, Circle, Minus, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildJourney, type GateKey, type JourneyGate, type JourneyInput } from "@/lib/journey.core";

/** Each gate has its own colour family (same palette as the To action tags). */
const GATE_COLOUR: Record<GateKey, { soft: string; text: string; solid: string; ring: string }> = {
  enquiry: { soft: "bg-task-eligibility", text: "text-task-eligibility-foreground", solid: "bg-task-eligibility-foreground", ring: "border-task-eligibility-foreground/40" },
  ready_check: { soft: "bg-task-measure", text: "text-task-measure-foreground", solid: "bg-task-measure-foreground", ring: "border-task-measure-foreground/40" },
  quote: { soft: "bg-task-pricing", text: "text-task-pricing-foreground", solid: "bg-task-pricing-foreground", ring: "border-task-pricing-foreground/40" },
  deposit: { soft: "bg-task-payments", text: "text-task-payments-foreground", solid: "bg-task-payments-foreground", ring: "border-task-payments-foreground/40" },
  piesa: { soft: "bg-task-scheduling", text: "text-task-scheduling-foreground", solid: "bg-task-scheduling-foreground", ring: "border-task-scheduling-foreground/40" },
  rectification: { soft: "bg-warning-soft", text: "text-foreground", solid: "bg-warning", ring: "border-warning/50" },
  install: { soft: "bg-task-scheduling", text: "text-task-scheduling-foreground", solid: "bg-task-scheduling-foreground", ring: "border-task-scheduling-foreground/40" },
  evidence: { soft: "bg-task-compliance", text: "text-task-compliance-foreground", solid: "bg-task-compliance-foreground", ring: "border-task-compliance-foreground/40" },
  veec: { soft: "bg-task-partners", text: "text-task-partners-foreground", solid: "bg-task-partners-foreground", ring: "border-task-partners-foreground/40" },
};

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" }) : null;

function GateIcon({ s }: { s: JourneyGate["status"] }) {
  if (s === "done") return <Check className="h-4 w-4" />;
  if (s === "blocked") return <OctagonAlert className="h-4 w-4" />;
  if (s === "skipped") return <Minus className="h-4 w-4" />;
  return <Circle className={s === "current" ? "h-3.5 w-3.5 fill-current" : "h-3.5 w-3.5"} />;
}

/** Stage-entry dates from the permanent audit trail (RLS-scoped). */
function useStageDates(jobId?: string | null) {
  return useQuery({
    queryKey: ["journey-dates", jobId], enabled: !!jobId, staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_events").select("to_stage, created_at").eq("job_id", jobId!).not("to_stage", "is", null).order("created_at");
      if (error) throw error;
      const first: Record<string, string> = {}, last: Record<string, string> = {};
      for (const e of data ?? []) { const k = e.to_stage as string; first[k] ??= e.created_at; last[k] = e.created_at; }
      return { first, last };
    },
  });
}

type DeadlineJob = { stage?: string | null; piesa_date?: string | null; install_deadline?: string | null; days_remaining?: number | null; piesa_expired?: boolean | null };
const DAY = 86_400_000;
const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

/** Countdowns everyone on the job sees: PIESA 30-day window, PIESA copy 24h before install, same-day rectification quote. */
function KeyDeadlines({ job, jobId }: { job: DeadlineJob; jobId?: string | null | undefined }) {
  const install = useQuery({
    queryKey: ["journey-install", jobId], enabled: !!jobId, staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings").select("scheduled_start").eq("job_id", jobId!).eq("kind", "installation").neq("status", "cancelled").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data?.scheduled_start ?? null;
    },
  });
  const items: { label: string; detail: string; tone: "good" | "warn" | "bad" }[] = [];
  if (job.install_deadline) {
    const d = job.days_remaining ?? daysUntil(job.install_deadline);
    items.push({
      label: job.piesa_expired || d < 0 ? "PIESA window expired" : `${d} day${d === 1 ? "" : "s"} left to install`,
      detail: `PIESA ${fmt(job.piesa_date) ?? "done"} · install by ${fmt(job.install_deadline)} (PIESA + 30 days)`,
      tone: job.piesa_expired || d < 0 ? "bad" : d <= 7 ? "warn" : "good",
    });
  }
  if (install.data) {
    const due = new Date(new Date(install.data).getTime() - DAY);
    const h = Math.floor((due.getTime() - Date.now()) / 3_600_000);
    items.push({
      label: h < 0 ? "PIESA copy deadline passed" : h < 48 ? `PIESA copy due in ${h}h` : `PIESA copy due in ${Math.ceil(h / 24)} days`,
      detail: `Owner must have their PIESA copy by ${fmt(due.toISOString())} (24h before install on ${fmt(install.data)})`,
      tone: h < 0 ? "bad" : h < 48 ? "warn" : "good",
    });
  }
  if (job.stage === "assessment_booked") items.push({ label: "Electrical fixes quote due on the day", detail: "Electrician submits priced electrical fixes items — or confirms none — in the portal on assessment day.", tone: "warn" });
  if (!items.length) return null;
  const toneCls = { good: "border-success/40 bg-success-soft", warn: "border-warning/50 bg-warning-soft", bad: "border-danger bg-danger-soft text-danger" };
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2" aria-label="Key deadlines">
      {items.map((i) => (
        <div key={i.label} className={`rounded-lg border p-2.5 ${toneCls[i.tone]}`}>
          <div className="text-sm font-bold">{i.label}</div>
          <div className="text-xs text-muted-foreground">{i.detail}</div>
        </div>
      ))}
    </div>
  );
}

/** The job's full route, in order: done (with dates), YOU ARE HERE, and exactly what comes next. */
export function JobJourney({ input, isTest, compact, jobId }: { input: JourneyInput; isTest?: boolean; compact?: boolean; jobId?: string | null }) {
  const j = buildJourney(input);
  const here = j.gates.find((g) => g.status === "current" || g.status === "blocked")?.key ?? null;
  const [open, setOpen] = useState<GateKey | null>(compact ? null : here);
  const dates = useStageDates(jobId);
  const last = dates.data?.last ?? {};

  const gateStarted = (g: JourneyGate) => g.steps.map((s) => dates.data?.first[s.stage]).filter(Boolean).sort()[0] ?? null;
  const gateDone = (i: number) => {
    const start = gateStarted(j.gates[i]!);
    const later = j.gates.slice(i + 1).flatMap((g) => g.steps.map((s) => dates.data?.first[s.stage])).filter((d): d is string => !!d && (!start || d >= start)).sort();
    return later[0] ?? null;
  };

  return (
    <section aria-label="Job journey" className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job journey</div>
          <div className="font-display text-lg font-bold">{j.headline}</div>
        </div>
        {isTest && <span className="rounded-full bg-task-partners px-2 py-0.5 text-xs font-bold text-task-partners-foreground">TEST JOB</span>}
      </div>

      {j.mismatches.length > 0 && <div role="alert" className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger"><b>Stage doesn't match records:</b> {j.mismatches.join(" ")}</div>}
      <KeyDeadlines job={input as DeadlineJob} jobId={jobId} />
      {j.exception && <div role="status" className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger"><b>{j.headline}.</b> {j.next}</div>}

      {/* Colour progress bar */}
      <div className="mb-3 flex gap-1" aria-hidden>
        {j.gates.map((g) => { const c = GATE_COLOUR[g.key]; return (
          <div key={g.key} className={`h-2 flex-1 rounded-full ${g.status === "done" ? c.solid : g.status === "current" ? `${c.solid} animate-pulse` : g.status === "blocked" ? "bg-danger" : g.status === "skipped" ? "bg-muted" : c.soft}`} />
        ); })}
      </div>

      <ol className="space-y-1.5">
        {j.gates.map((g, i) => {
          const c = GATE_COLOUR[g.key];
          const isHere = g.status === "current" || g.status === "blocked";
          const isOpen = open === g.key;
          const done = g.status === "done" ? gateDone(i) : null;
          const started = gateStarted(g);
          return (
            <li key={g.key} className={`overflow-hidden rounded-xl border transition ${isHere ? `${c.ring} border-2 shadow-md` : "border-border"} ${g.status === "skipped" ? "opacity-60" : ""}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen} aria-current={isHere ? "step" : undefined}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${isHere || g.status === "done" ? c.soft : "bg-card hover:bg-muted/40"}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${g.status === "done" || isHere ? `${c.solid} text-primary-foreground` : g.status === "blocked" ? "bg-danger text-primary-foreground" : `${c.soft} ${c.text}`}`}><GateIcon s={g.status} /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-bold ${c.text}`}>Gate {g.number} · {g.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {g.status === "done" ? (done ? `Done ${fmt(done)}` : "Done") : isHere ? (started ? `Started ${fmt(started)}` : "In progress") : g.status === "skipped" ? "Not needed" : "Not started"}
                  </span>
                </span>
                {isHere && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary-foreground ${g.status === "blocked" ? "bg-danger" : c.solid}`}>{g.status === "blocked" ? "Blocked" : "You are here"}</span>}
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="border-t bg-card px-3 py-3">
                  {g.note && <p className="mb-2 text-xs text-muted-foreground">{g.note}</p>}
                  <ol className="space-y-1">
                    {g.steps.map((s, k) => (
                      <li key={s.stage} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${s.status === "current" ? `${c.soft} font-semibold` : s.status === "done" ? "" : "text-muted-foreground"}`}>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${s.status === "done" ? `${c.solid} text-primary-foreground` : `${c.soft} ${c.text}`}`}>{s.status === "done" ? <Check className="h-3 w-3" /> : k + 1}</span>
                        <span className="min-w-0 flex-1">
                          {s.label}{s.legacy && <span className="ml-1 text-[10px] uppercase">(older route)</span>}
                          {s.status === "current" && <span className="block text-xs font-normal">{input.stage === s.stage ? j.next : s.action}{s.actor ? ` · waiting on ${s.actor}` : ""}</span>}
                          {s.status === "upcoming" && <span className="block text-xs">{s.action}{s.actor ? ` · ${s.actor}` : ""}</span>}
                        </span>
                        {last[s.stage] && s.status !== "upcoming" && <span className="shrink-0 text-xs text-muted-foreground">{fmt(last[s.stage])}</span>}
                      </li>
                    ))}
                  </ol>
                  {isHere && j.upNext.length > 0 && (
                    <div className="mt-3 rounded-lg border border-dashed p-2">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</div>
                      <ol className="space-y-0.5 text-sm">{j.upNext.map((s, n) => <li key={s.stage}><b>{n + 1}. {s.label}</b> <span className="text-xs text-muted-foreground">– {s.action}{s.actor ? ` · ${s.actor}` : ""}</span></li>)}</ol>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {dates.error && <p className="mt-2 text-xs text-danger">Couldn't load dates from the audit history.</p>}
    </section>
  );
}
