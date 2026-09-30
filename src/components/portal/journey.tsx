import { Check, ChevronRight, Circle, Minus, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { buildJourney, type JourneyGate, type JourneyInput } from "@/lib/journey.core";

const GATE_STYLE: Record<JourneyGate["status"], string> = {
  done: "border-success/40 bg-success-soft text-success",
  current: "border-info bg-info text-primary-foreground shadow-md ring-2 ring-info/30",
  blocked: "border-danger bg-danger text-primary-foreground shadow-md ring-2 ring-danger/30",
  upcoming: "border-border bg-card text-muted-foreground",
  skipped: "border-dashed border-border bg-muted/40 text-muted-foreground opacity-60",
};
function GateIcon({ s }: { s: JourneyGate["status"] }) {
  if (s === "done") return <Check className="h-4 w-4" />;
  if (s === "blocked") return <OctagonAlert className="h-4 w-4" />;
  if (s === "skipped") return <Minus className="h-4 w-4" />;
  return <Circle className={s === "current" ? "h-4 w-4 fill-current" : "h-4 w-4"} />;
}

/** The job's full route, in order: done, YOU ARE HERE, and exactly what comes next. */
export function JobJourney({ input, isTest, compact }: { input: JourneyInput; isTest?: boolean; compact?: boolean }) {
  const j = buildJourney(input);
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ? j.gates.find((g) => g.key === open) : j.current;
  return (
    <section aria-label="Job journey" className="mb-4 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job journey</div>
          <div className="font-heading text-lg font-bold">{j.headline}</div>
        </div>
        {isTest && <span className="rounded-full bg-task-partners/15 px-2 py-0.5 text-xs font-bold text-task-partners">TEST JOB</span>}
      </div>

      {j.mismatches.length > 0 && <div role="alert" className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger"><b>Stage doesn't match records:</b> {j.mismatches.join(" ")}</div>}
      {j.exception && <div role="status" className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger"><b>{j.headline}.</b> {j.next}</div>}

      <ol className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-stretch">
        {j.gates.map((g, i) => (
          <li key={g.key} className="flex items-center gap-1 md:flex-1 md:min-w-[120px]">
            <button type="button" onClick={() => setOpen(open === g.key ? null : g.key)}
              aria-current={g.status === "current" || g.status === "blocked" ? "step" : undefined}
              className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${GATE_STYLE[g.status]} ${open === g.key ? "outline outline-2 outline-offset-1 outline-brand-dark" : ""}`}>
              <span className="mt-0.5"><GateIcon s={g.status} /></span>
              <span className="min-w-0">
                <span className="block font-bold">Gate {g.number}</span>
                <span className="block leading-tight">{g.title}</span>
                {(g.status === "current" || g.status === "blocked") && <span className="mt-1 block text-[10px] font-black uppercase tracking-wider">{g.status === "blocked" ? "Blocked" : "You are here"}</span>}
                {g.status === "skipped" && <span className="mt-1 block text-[10px]">Not needed</span>}
              </span>
            </button>
            {i < j.gates.length - 1 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />}
          </li>
        ))}
      </ol>

      {!compact && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {shown && (
            <div>
              <div className="mb-2 text-sm font-semibold">Gate {shown.number} – {shown.title}: steps</div>
              {shown.note && <p className="mb-2 text-xs text-muted-foreground">{shown.note}</p>}
              <ol className="space-y-1.5">
                {shown.steps.map((s, i) => (
                  <li key={s.stage} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${s.status === "current" ? "bg-info-soft font-semibold text-foreground" : s.status === "done" ? "text-success" : "text-muted-foreground"}`}>
                    <span className="mt-0.5 w-4 shrink-0 text-xs">{s.status === "done" ? <Check className="h-4 w-4" /> : `${i + 1}.`}</span>
                    <span>{s.label}{s.status === "current" && <span className="block text-xs font-normal">{input.stage === s.stage ? j.next : s.action}{s.actor ? ` · waiting on ${s.actor}` : ""}</span>}{s.legacy && <span className="ml-1 text-[10px] uppercase">(older route)</span>}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div>
            <div className="mb-2 text-sm font-semibold">Up next</div>
            {j.upNext.length === 0 ? <p className="text-sm text-muted-foreground">{j.exception ? "Nothing moves until this is resolved." : "Nothing further – journey complete."}</p> : (
              <ol className="space-y-1.5">
                {j.upNext.map((s, i) => (
                  <li key={s.stage} className="rounded-md border px-3 py-2 text-sm">
                    <span className="font-semibold">{i + 1}. {s.label}</span>
                    <span className="block text-xs text-muted-foreground">{s.action}{s.actor ? ` · ${s.actor}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
