import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlarmClock, ArrowRight, CalendarClock, FileText, MessageSquare, Wallet, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getJobWaiting } from "@/lib/waiting.functions";
import { useJobFile } from "@/components/portal/jobfile";
import { timelineText } from "@/lib/jobfile.core";
import type { AdminTab } from "@/lib/waiting.core";

/** Party colours, shared by the "With" badge and timeline role chips. */
export const PARTY_STYLE: Record<string, string> = {
  Owner: "bg-task-eligibility text-task-eligibility-foreground",
  Electrician: "bg-task-scheduling text-task-scheduling-foreground",
  Installer: "bg-task-measure text-task-measure-foreground",
  "Home Insulation Victoria": "bg-task-payments text-task-payments-foreground",
  System: "bg-muted text-muted-foreground",
};
const chip = (r: string | null | undefined) => PARTY_STYLE[r ?? "System"] ?? "bg-task-partners text-task-partners-foreground";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

/** Top-of-job: who has the ball, what exactly, when it's due, and the one click to move it. */
export function WhoHasTheBall({ jobId, onOpenTab }: { jobId: string; onOpenTab?: (t: AdminTab) => void }) {
  const load = useServerFn(getJobWaiting);
  const { data: w, error } = useQuery({ queryKey: ["job-waiting", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 60_000 });
  if (error) return <div role="alert" className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger">Couldn't work out who this job is waiting on. Refresh to try again.</div>;
  if (!w) return <div className="mb-4 h-24 animate-pulse rounded-2xl bg-muted" />;
  const tone = w.status === "overdue" ? "border-danger bg-danger-soft" : w.status === "warn" ? "border-warning bg-warning-soft" : "border-border bg-card";
  const isAdmin = w.viewerRole === "admin";
  return (
    <section aria-label="Who this job is waiting on" className={`mb-4 rounded-2xl border-2 p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        {w.terminal ? <span className="rounded-full bg-muted px-3 py-1 text-sm font-black uppercase tracking-wide">No one – closed</span> : <>
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{w.arranging ? "Arranging together" : "With"}</span>
          {w.parties.map((p) => <span key={p} className={`rounded-full px-3 py-1 text-sm font-black uppercase tracking-wide ${chip(p)}`}>{p}</span>)}
        </>}
        {w.dueAt && <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${w.status === "overdue" ? "bg-danger text-primary-foreground" : w.status === "warn" ? "bg-warning text-foreground" : "bg-muted"}`}>
          <AlarmClock className="h-4 w-4" />{w.status === "overdue" ? `OVERDUE by ${w.overdueBy}` : `${w.dueLabel} ${fmt(w.dueAt)}`}
        </span>}
      </div>
      <p className="mt-2 font-display text-lg font-bold leading-snug">{w.sentence}</p>
      <div className="mt-1 text-xs text-muted-foreground">
        {w.since && <>Since {fmt(w.since)}</>}{w.status === "overdue" && w.dueAt && <> · was due {fmt(w.dueAt)}</>}
      </div>
      {isAdmin && !w.terminal && onOpenTab && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => onOpenTab(w.action.tab)}>{w.action.label} <ArrowRight className="ml-1 h-4 w-4" /></Button>
          {w.parties[0] !== "Home Insulation Victoria" && w.action.label !== "Draft a nudge" && <Button variant="outline" onClick={() => onOpenTab("messages")}><MessageSquare className="mr-1 h-4 w-4" />Draft a nudge</Button>}
        </div>
      )}
    </section>
  );
}

const KIND: { k: string; l: string; icon: typeof FileText; match: (t: { source: string; tags: string[] }) => boolean }[] = [
  { k: "all", l: "All", icon: FileText, match: () => true },
  { k: "talk", l: "Conversations", icon: MessageSquare, match: (t) => t.source === "message" || t.source.startsWith("communication") },
  { k: "book", l: "Bookings", icon: CalendarClock, match: (t) => t.source === "booking" },
  { k: "docs", l: "Forms & documents", icon: FileText, match: (t) => t.tags.includes("documents") || t.tags.includes("compliance") },
  { k: "money", l: "Payments", icon: Wallet, match: (t) => t.tags.includes("money") },
];
const iconFor = (t: { source: string; tags: string[] }) => t.source === "message" || t.source.startsWith("communication") ? MessageSquare : t.source === "booking" ? CalendarClock : t.tags.includes("money") ? Wallet : t.tags.includes("trades") ? Wrench : FileText;

/** What happened, when, by whom – newest first, plain language. */
export function ClearTimeline({ jobId, initial = 8, admin = false }: { jobId: string; initial?: number; admin?: boolean }) {
  const { data, error, refetch } = useJobFile(jobId);
  const [f, setF] = useState("all");
  const [all, setAll] = useState(false);
  const [auto, setAuto] = useState(false);
  if (error && !data) return <p role="alert" className="text-sm text-danger">Couldn't load the timeline. <button type="button" className="font-semibold underline" onClick={() => void refetch()}>Try again</button></p>;
  const items = [...(data?.timeline ?? [])].filter((t) => (KIND.find((x) => x.k === f) ?? KIND[0]!).match(t)).filter((t) => auto || !(t.internal && (t.actorRole ?? "System") === "System")).reverse();
  const shown = all ? items : items.slice(0, initial);
  return (
    <section aria-label="Job timeline" className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-lg font-bold">What's happened</div>
        <div className="flex flex-wrap gap-1"><button type="button" onClick={() => setAuto(!auto)} className={`rounded-full px-3 py-1 text-xs font-semibold ${auto ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{auto ? "Hide" : "Show"} automatic checks</button>{KIND.map((x) => <button key={x.k} type="button" onClick={() => setF(x.k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${f === x.k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>{x.l}</button>)}</div>
      </div>
      {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ol className="relative ml-3 border-l-2 border-border">
          {shown.map((t) => { const Icon = iconFor(t); const { line, quote } = timelineText(t);
            return (
              <li key={t.id} className="relative mb-3 pl-5">
                <span className={`absolute -left-[13px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-card ${chip(t.actorRole)}`}><Icon className="h-3.5 w-3.5" /></span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-semibold text-muted-foreground">{fmt(t.at)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${chip(t.actorRole)}`}>{t.actorRole ?? "System"}</span>
                  <span className="text-xs text-muted-foreground">{t.actor}</span>
                  {t.internal && admin && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase">Internal</span>}
                </div>
                <div className="whitespace-pre-wrap text-sm font-medium">{line}</div>
                {quote && <blockquote className="mt-1 rounded-lg bg-muted/60 px-3 py-1.5 text-sm italic">“{quote.slice(0, 400)}”</blockquote>}
              </li>
            ); })}
        </ol>
      )}
      {items.length > initial && <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</Button>}
    </section>
  );
}
