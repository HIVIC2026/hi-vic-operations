// Trade "where is this job up to?" pieces (Jo, 7 Oct 2026). Presentation only; facts come from job-status.core via the server.
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { Pill, btnClass } from "@/components/portal/kit";
import { askTradeReminder, getTradeJobStatus } from "@/lib/trade-view.functions";
import type { StatusLine, Tone } from "@/lib/job-status.core";

const toneOf = (t: Tone) => (t === "rose" ? "rose" : t === "amber" ? "amber" : "plain") as "rose" | "amber" | "plain";
const toneWord = (t: Tone) => (t === "rose" ? "Overdue" : t === "amber" ? "Longer than usual" : null);

export function StatusLineView({ line, compact }: { line: StatusLine; compact?: boolean }) {
  const w = toneWord(line.tone);
  return (
    <span className="block" data-status-line data-tone={line.tone}>
      <span className={`block ${compact ? "text-[13px]" : "text-sm font-semibold"}`}>{line.text}</span>
      {(w || line.money) && <span className="mt-1 flex flex-wrap gap-1">{w && <Pill tone={toneOf(line.tone)}>{w}</Pill>}{line.money && <Pill>{line.money}</Pill>}</span>}
    </span>
  );
}

export function useTradeJobStatus(jobId: string, enabled = true) {
  const load = useServerFn(getTradeJobStatus);
  return useQuery({ queryKey: ["trade-job-status", jobId], queryFn: () => load({ data: { jobId } }), enabled });
}

export function JobStatusCard({ jobId }: { jobId: string }) {
  const ask = useServerFn(askTradeReminder);
  const qc = useQueryClient();
  const { data, error } = useTradeJobStatus(jobId);
  const m = useMutation({ mutationFn: () => ask({ data: { jobId } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["trade-job-status", jobId] }) });
  if (error || !data) return null;
  const chaseable = data.line.who === "Owner" && !data.chase.coordinationSuppressed;
  return (
    <section className="rounded-[18px] border border-line bg-paper p-4" data-job-status>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">Where it's up to</p>
      <div className="mt-1"><StatusLineView line={data.line} /></div>
      {chaseable && data.chase.mode === "own_customer" && data.chase.contact && (
        <div className="mt-3 flex flex-wrap gap-2" data-chase-own>
          {data.chase.contact.phone && <a href={`tel:${data.chase.contact.phone}`} className={btnClass("secondary")}>{data.chase.contact.phone}</a>}
          {data.chase.contact.email && <a href={`mailto:${data.chase.contact.email}`} className={btnClass("secondary")}>{data.chase.contact.email}</a>}
        </div>
      )}
      {chaseable && data.chase.mode === "ask_office" && (
        <div className="mt-3" data-chase-office>
          {data.chase.askedAt && !m.isSuccess ? <p className="text-sm text-sub">You asked for a reminder on {new Date(data.chase.askedAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}.</p> : null}
          {m.isSuccess ? <p className="text-sm font-semibold">Asked. Home Insulation Victoria will follow up with the owner.</p>
            : <button className={btnClass("secondary")} disabled={m.isPending} onClick={() => m.mutate()}>Ask Home Insulation Victoria to send a reminder</button>}
          {m.error && <p role="alert" className="mt-1 text-sm text-rose">{(m.error as Error).message}</p>}
        </div>
      )}
      <ol className="mt-4 space-y-2" data-timeline>
        {data.timeline.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            {s.state === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-hiv-green" /> : s.state === "skipped" ? <MinusCircle className="h-4 w-4 shrink-0 text-sub" /> : <Circle className={`h-4 w-4 shrink-0 ${s.state === "next" ? "text-hiv-blue" : "text-sub"}`} />}
            <span className={`flex-1 ${s.state === "next" ? "font-bold" : s.state === "done" ? "" : "text-sub"}`}>{s.label}</span>
            {s.dateLabel && <span className="text-xs text-sub">{s.dateLabel}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
