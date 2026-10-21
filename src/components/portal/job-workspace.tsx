/**
 * Staff job workspace (presentation only). Every value shown here comes from
 * existing authenticated queries (same query keys as the original panels) and
 * existing pure rules (nextStep via getJobWaiting, buildJourney, Gate 1 evidence).
 * Nothing here decides eligibility, stage or readiness.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlarmClock, AlertCircle, ArrowRight, Check, ChevronDown, HeartPulse, MessageSquare, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/portal/badges";
import { getJobWaiting } from "@/lib/waiting.functions";
import { getGate1Evidence, getIntakeSummary } from "@/lib/portal.functions";
import { getJobContactConsent, getJobFileHeader } from "@/lib/jobfile.functions";
import { buildJourney, type JourneyInput } from "@/lib/journey.core";
import { ELIGIBILITY_LABEL, fmtDate } from "@/lib/workflow";
import type { AdminTab } from "@/lib/waiting.core";
import { evidenceSourceLabel, ownerAnswerForGate1, targetForAction, type PortalTarget } from "@/lib/portal-presentation.core";

type JobRow = import("@/integrations/supabase/types").Database["public"]["Views"]["job_overview"]["Row"];

export type RecordGroup = "enquiry" | "ready_check" | "quote" | "piesa" | "installation" | "ap_veec" | "history" | "people";

export const TARGET_TO_GROUP: Record<PortalTarget, RecordGroup> = {
  people: "people", "gate1-evidence": "enquiry", "intake-consent": "enquiry", "ready-check": "ready_check",
  quotes: "quote", "deposit-request": "quote", "electronic-signing": "quote", piesa: "piesa",
  installation: "installation", "installation-evidence": "installation", "ap-evidence": "ap_veec", veec: "ap_veec",
  correspondence: "history", documents: "history", history: "history",
};

/** Every legacy tab destination has exactly one record group. */
export const TAB_TO_GROUP: Record<AdminTab | "documents" | "history", RecordGroup> = {
  overview: "people", eligibility: "enquiry", assessment: "ready_check", quotes: "quote", authority: "quote",
  piesa: "piesa", installation: "installation", evidence: "ap_veec", veec: "ap_veec", messages: "history", documents: "history", history: "history",
};

/** Opens a record once, then waits for its real async control before focusing it. */
export function usePortalTargetNavigation(openGroup: (group: RecordGroup) => void) {
  const run = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => { run.current += 1; cleanup.current?.(); }, []);
  return useCallback((target: PortalTarget) => {
    const group = TARGET_TO_GROUP[target];
    openGroup(group);
    cleanup.current?.();
    const currentRun = ++run.current;
    let frame = 0;
    let timer = 0;
    let observer: MutationObserver | null = null;
    let attempts = 0;
    const finish = (fallback = false) => {
      if (currentRun !== run.current) return false;
      const preferred = document.querySelector<HTMLElement>(`#target-${target}[data-portal-focus="target"]`)
        ?? (target === "deposit-request" || target === "intake-consent" ? null : document.getElementById(`target-${target}`));
      if (!preferred && !fallback) return false;
      const panel = document.getElementById(`panel-${target}`);
      const destination = preferred ?? panel ?? document.getElementById(`records-${group}`);
      const focusable = preferred ?? panel?.querySelector<HTMLElement>("button,a,input,select,textarea,[tabindex]:not([tabindex='-1'])") ?? document.getElementById(`records-${group}-btn`);
      destination?.scrollIntoView({ behavior: "smooth", block: "start" });
      focusable?.focus({ preventScroll: true });
      cleanup.current?.();
      return true;
    };
    const poll = () => {
      if (currentRun !== run.current || finish()) return;
      if (attempts++ < 240) frame = requestAnimationFrame(poll);
    };
    const start = () => {
      if (finish()) return;
      observer = new MutationObserver(() => { finish(); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      frame = requestAnimationFrame(poll);
      timer = window.setTimeout(() => finish(true), 4_000);
    };
    // Two frames place focus after the activating click's native focus step.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(start); });
    cleanup.current = () => { cancelAnimationFrame(frame); window.clearTimeout(timer); observer?.disconnect(); observer = null; };
  }, [openGroup]);
}

const fmtDT = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

/** 1. Compact identity: address, job no, owner contact, consent, one eligibility outcome. */
export function JobIdentity({ jobId, job, onOpen }: { jobId: string; job: JobRow; onOpen: (target: PortalTarget) => void }) {
  const intakeFn = useServerFn(getJobContactConsent);
  const headerFn = useServerFn(getJobFileHeader);
  const showReady = ["installation_scheduling", "installation_booked", "evidence_outstanding"].includes(job.stage ?? "");
  const intake = useQuery({ queryKey: ["intake_summary", jobId, "consent"], queryFn: () => intakeFn({ data: { jobId } }) });
  const { data: h } = useQuery({ queryKey: ["jobfile-header", jobId, showReady], queryFn: () => headerFn({ data: { jobId, includeReadiness: showReady } }) });
  const consent = intake.data?.consent ?? null;
  const outcome = job.eligibility_review_required ? { t: "warn" as const, l: "Gate 1 review required (internal)" }
    : job.eligibility_outcome ? { t: job.eligibility_outcome === "does_not_appear_eligible" ? "bad" as const : job.eligibility_outcome === "likely_eligible" ? "good" as const : "info" as const, l: ELIGIBILITY_LABEL[job.eligibility_outcome] }
      : { t: "neutral" as const, l: "Eligibility not decided" };
  const warnings: { t: "bad" | "warn" | "info"; text: string }[] = [];
  if (job.piesa_expired) warnings.push({ t: "bad", text: "PIESA expired – reassess before install" });
  else if (job.install_deadline) warnings.push({ t: job.urgency === "urgent" ? "bad" : "info", text: `Install by ${fmtDate(job.install_deadline)} (PIESA +30 days)` });
  if (h?.escDueBy && h.escStatus !== "sent") warnings.push({ t: "warn", text: `ESC notice due by ${fmtDT(h.escDueBy)}` });
  if (job.payment_status && !job.deposit_cleared && ["deposit_due", "invoice_created", "overdue"].includes(job.payment_status)) warnings.push({ t: "bad", text: "Approved payment option not yet verified" });
  return (
    <header className="mb-3 border-b border-line py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-muted-foreground">
        <span className="text-primary">{job.job_number}</span>
        {job.source === "qa_test" && <span className="rounded bg-muted px-1.5 py-0.5 font-bold uppercase">Test job</span>}
        {job.life_support && <span className="inline-flex items-center gap-1 font-bold text-danger"><HeartPulse className="h-3.5 w-3.5" /> Life support</span>}
      </div>
      <h1 className="mt-0.5 break-words text-xl font-bold leading-tight sm:text-2xl">{job.property_address}</h1>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Owner</dt><dd className="break-words font-medium">{job.owner_name ?? "—"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Phone (staff only)</dt><dd className="break-words">{job.owner_phone ? <a className="text-primary underline" href={`tel:${job.owner_phone}`}>{job.owner_phone}</a> : "—"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Email (staff only)</dt><dd className="break-all">{job.owner_email ? <a className="text-primary underline" href={`mailto:${job.owner_email}`}>{job.owner_email}</a> : "—"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Contact consent</dt><dd>
          {intake.isPending ? <span className="text-muted-foreground">Checking…</span>
            : intake.error ? <span role="alert" className="text-danger">Couldn't load consent — treat as missing</span>
              : consent?.consent_status === "granted" ? <span className="text-success">Granted{consent.consented_at ? ` ${fmtDate(consent.consented_at)}` : ""}</span>
                : <span className="text-danger">{consent ? `Not granted (${consent.consent_status})` : "No consent record"} — no external contact</span>}
          {" "}<Button variant="link" size="sm" type="button" className="h-auto p-0 text-xs" onClick={() => onOpen("intake-consent")}>View evidence</Button>
        </dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Eligibility (Gate 1)</dt><dd><Pill t={outcome.t}>{outcome.l}</Pill></dd></div>
      </dl>
      {(warnings.length > 0 || showReady || job.stage === "ready_for_veec") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {job.stage === "ready_for_veec" && <Pill t="good">Ready to lodge VEEC</Pill>}
          {showReady && h?.ready && (h.ready.ready ? <Pill t="good">Ready to install</Pill> : <Pill t="bad" className="whitespace-normal">Not ready to install: {h.ready.blockers[0]}</Pill>)}
          {warnings.map((w) => <Pill key={w.text} t={w.t}>{w.text}</Pill>)}
        </div>
      )}
    </header>
  );
}

/** 2. The one current next action, with responsible party and real due time. CTA opens the working record. */
export function NextActionBand({ jobId, onOpenTarget }: { jobId: string; onOpenTarget: (target: PortalTarget) => void }) {
  const load = useServerFn(getJobWaiting);
  const { data: w, error, refetch } = useQuery({ queryKey: ["job-waiting", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 60_000 });
  if (error) return <div role="alert" className="mb-3 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">Couldn't work out the next action. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>;
  if (!w) return <div role="status" aria-label="Loading next action" className="mb-3 h-20 animate-pulse rounded-md bg-muted" />;
  const overdue = w.status === "overdue";
  const border = overdue ? "border-l-danger" : w.status === "warn" ? "border-l-warning" : "border-l-success";
  const isAdmin = w.viewerRole === "admin";
  return (
    <section aria-label="Next action" className={`mb-3 rounded-md border border-l-4 bg-success-soft/60 px-4 py-3 ${border}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-bold uppercase tracking-wide text-muted-foreground">Next action</span>
        {w.terminal ? <span className="font-semibold">Closed — no one</span> : <span>{w.arranging ? "Arranging together:" : "With"} <b className="text-foreground">{w.parties.join(" + ")}</b></span>}
        {w.dueAt && <span className={`inline-flex items-center gap-1 font-semibold ${overdue ? "text-danger" : w.status === "warn" ? "text-foreground" : "text-muted-foreground"}`}><AlarmClock className="h-3.5 w-3.5" />{overdue ? `Overdue by ${w.overdueBy}` : `${w.dueLabel} ${fmtDT(w.dueAt)}`}</span>}
        {w.since && <span className="text-muted-foreground">since {fmtDT(w.since)}</span>}
      </div>
      <p className="mt-1 font-display text-base font-bold leading-snug sm:text-lg">{w.sentence}</p>
      {isAdmin && !w.terminal && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onOpenTarget(targetForAction(w.action.tab, w.action.label))}>{w.action.label} <ArrowRight className="ml-1 h-4 w-4" /></Button>
          {w.parties[0] !== "Home Insulation Victoria" && w.action.label !== "Draft a nudge" && <Button size="sm" variant="outline" onClick={() => onOpenTarget("correspondence")}><MessageSquare className="mr-1 h-4 w-4" />Draft a nudge</Button>}
        </div>
      )}
    </section>
  );
}

const CHECK_KEYS = ["location", "residential", "relevant_ceiling", "ceiling_age", "previous_activity", "existing_insulation"] as const;
const CHECK_LABELS: Record<(typeof CHECK_KEYS)[number], string> = {
  location: "Victorian property",
  residential: "Class 1 or Class 2 sole-occupancy home",
  relevant_ceiling: "Qualifying relevant ceiling",
  ceiling_age: "Relevant ceiling or structure over five years old",
  previous_activity: "No confirmed previous Activity 48 for the same ceiling area",
  existing_insulation: "Existing insulation meets the Activity 48 criterion",
};
const BASIS: Record<string, string> = { verified: "Verified", recorded: "Recorded", declared: "Owner-declared (not verified)", unknown: "Unknown" };

/** Assessment wording never upgrades a declared/recorded pass to "verified". */
function assessmentOf(result: string | undefined, basis: string | undefined): { l: string; icon: typeof Check; cls: string } {
  if (result === "pass") return basis === "verified" ? { l: "Met", icon: Check, cls: "text-success" } : { l: basis === "declared" ? "Met on owner's declaration" : "Met on recorded information", icon: Check, cls: "text-success" };
  if (result === "fail") return { l: "Not met", icon: X, cls: "text-danger" };
  if (result === "onsite") return { l: "To confirm onsite", icon: AlertCircle, cls: "text-foreground" };
  if (result === "review") return { l: "Needs office review", icon: AlertCircle, cls: "text-foreground" };
  return { l: "Unknown", icon: Minus, cls: "text-muted-foreground" };
}

/** 3 + 4. Eligibility at a glance (six existing Gate 1 checks) with safety flags kept visible. */
export function EligibilityGlance({ jobId, onOpen }: { jobId: string; onOpen: (target: PortalTarget) => void }) {
  const fn = useServerFn(getGate1Evidence);
  const intakeFn = useServerFn(getIntakeSummary);
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["gate1_evidence", jobId], queryFn: () => fn({ data: { jobId } }) });
  const intake = useQuery({ queryKey: ["intake_summary", jobId], queryFn: () => intakeFn({ data: { jobId } }) });
  return (
    <section aria-labelledby="elig-glance" className="mb-3 rounded-md border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-4 py-2">
        <h2 id="elig-glance" className="text-sm font-bold">Eligibility at a glance</h2>
        <button type="button" className="shrink-0 text-xs font-semibold text-primary underline" onClick={() => onOpen("gate1-evidence")}>Full evidence</button>
      </div>
      {isPending ? <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Loading Gate 1 checks…</p>
        : error || !data ? <div role="alert" className="px-4 py-3 text-sm text-danger">Gate 1 checks could not be loaded. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>
          : <>
            <div className="divide-y text-sm" role="list" aria-label="Eligibility requirements">
                {CHECK_KEYS.map((key) => {
                  const r = data.live.rules.find((x) => x.key === key);
                  const a = assessmentOf(r?.result, r?.basis);
                  const ownerAnswer = ownerAnswerForGate1(key, intake.data);
                  return (
                    <div key={key} role="listitem" className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_minmax(14rem,1.35fr)] sm:gap-3">
                      <div><div className="font-semibold">{CHECK_LABELS[key]}</div><div className="text-xs text-muted-foreground"><span className="font-medium">Owner answer:</span> {ownerAnswer}</div></div>
                      <div className={a.cls}><span className="inline-flex items-center gap-1 font-medium"><a.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{a.l}</span><div className="text-xs text-muted-foreground">{r?.reason ?? "No assessment reason recorded"}</div></div>
                      <div className="text-xs text-muted-foreground"><div><span className="font-medium text-foreground">Basis:</span> {r ? BASIS[r.basis] ?? r.basis : "Unknown"} · {evidenceSourceLabel(r?.source)}</div><button type="button" className="mt-0.5 font-semibold text-primary underline" onClick={() => onOpen(r?.basis === "declared" ? "intake-consent" : "gate1-evidence")}>Open answer and evidence</button></div>
                    </div>
                  );
                })}
            </div>
            {data.live.flags.filter((f) => f.type === "safety").length > 0 && (
              <div role="note" className="border-t border-l-4 border-l-danger px-4 py-2 text-sm">
                <div className="text-xs font-bold uppercase text-danger">Safety flags — not an eligibility result</div>
                {data.live.flags.filter((f) => f.type === "safety").map((f) => <div key={f.key}>{f.reason}</div>)}
              </div>
            )}
          </>}
    </section>
  );
}

/** 5. Compact phase strip from buildJourney; full JobJourney on demand. */
export function PhaseStrip({ input, details }: { input: JourneyInput; details: ReactNode }) {
  const j = buildJourney(input);
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Workflow phase" className="mb-3 rounded-md border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm"><span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current phase</span> <b>{j.headline}</b></div>
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls="journey-details" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} workflow details <ChevronDown className={`ml-1 h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></Button>
      </div>
      {j.mismatches.length > 0 && <p role="alert" className="mt-2 text-sm text-danger"><b>Stage doesn't match records:</b> {j.mismatches.join(" ")}</p>}
      <ol className="mt-2 flex flex-wrap gap-1" aria-label="Gates">
        {j.gates.map((g) => {
          const here = g.status === "current" || g.status === "blocked";
          const cls = g.status === "done" ? "border-success/40 text-success" : g.status === "blocked" ? "border-danger bg-danger-soft text-danger font-bold" : here ? "border-success bg-success-soft text-foreground font-bold" : g.status === "skipped" ? "border-dashed text-muted-foreground opacity-70" : "text-muted-foreground";
          return <li key={g.key} aria-current={here ? "step" : undefined} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${cls}`}>{g.status === "done" && <Check className="h-3 w-3" aria-hidden />}{g.number}. {g.title}{g.status === "blocked" && " · blocked"}{g.status === "skipped" && " · not needed"}</li>;
        })}
      </ol>
      <div id="journey-details" hidden={!open} className="mt-3">{open && details}</div>
    </section>
  );
}

/**
 * Collapsible record group. Content mounts on first open and then stays mounted
 * (hidden when collapsed) so entered form state survives collapse/reopen.
 */
export function RecordDisclosure({ id, title, summary, open, onToggle, children }: { id: RecordGroup; title: string; summary?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <section id={`records-${id}`} className="scroll-mt-4 border-t first:border-t-0">
      <h3>
        <button type="button" id={`records-${id}-btn`} aria-expanded={open} aria-controls={`records-${id}-panel`} onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{title}</span>{summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h3>
      <div id={`records-${id}-panel`} role="region" aria-labelledby={`records-${id}-btn`} hidden={!open} className="space-y-4 px-3 pb-4 sm:px-4">{mounted && children}</div>
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="pt-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}
