import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { getPrestartSummary, rerunPrestart } from "@/lib/allocation.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section } from "./panels";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Office only: ESC notification details to copy, AP task, and the day-before pre-start result. */
export function OfficePrestartCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getPrestartSummary);
  const rerun = useAction(rerunPrestart);
  const q = useQuery({ queryKey: ["prestart", jobId], queryFn: () => load({ data: { jobId } }) });
  const d = q.data;
  if (!d) return null;
  const payload = (d.notification?.payload ?? {}) as Record<string, unknown>;
  const rows = Object.entries(payload).filter(([, v]) => v != null && typeof v !== "object");
  const copy = rows.map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join("\n");
  return (
    <Section title="ESC notification and pre-start check (office only)">
      <div className="space-y-2 text-sm">
        <div>Install: <b>{when(d.start)}</b> · pre-start check from {when(d.runAt)}</div>
        {d.task ? <p className="rounded border border-warning/40 bg-warning-soft p-2 font-medium">{d.task.detail}</p> : <p className="text-muted-foreground">No ESC action needed right now.</p>}
        {rows.length > 0 && (
          <div className="rounded border p-2">
            <div className="mb-1 flex items-center justify-between"><span className="font-medium">Notification details</span><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(copy)}>Copy</Button></div>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-2 text-xs">{rows.map(([k, v]) => <><dt key={`${k}-k`} className="text-muted-foreground">{k.replace(/_/g, " ")}</dt><dd key={`${k}-v`}>{String(v)}</dd></>)}</dl>
            <p className="mt-1 text-xs text-muted-foreground">After submitting in the Registry, record "Submitted" with the date and reference in the ESC notification panel.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {d.check ? <Badge variant={d.check.passed ? "default" : "destructive"}>{d.check.passed ? "Cleared to start" : "Pre-start check failed"}</Badge> : <Badge variant="outline">Not checked yet</Badge>}
          {d.gate.locked && <Badge variant="destructive">Installation form and evidence locked</Badge>}
          <Button size="sm" variant="outline" onClick={async () => { await rerun({ jobId }, "Check re-run"); await q.refetch(); }}>Re-run check</Button>
        </div>
        {!!d.gate.reasons.length && <ul className="list-disc pl-5 text-xs">{d.gate.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </div>
    </Section>
  );
}
