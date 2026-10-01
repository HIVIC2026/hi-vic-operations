import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPiisaPanel } from "@/lib/official-forms.functions";
import { Section } from "@/components/portal/panels";

const DUE: Record<string, string> = {
  not_scheduled: "Not scheduled", due_on_installation_day: "Due on installation day", due_today: "Due today, before work starts",
  overdue: "Overdue", passed: "Passed", stale: "Stale — needs a new PIISA", blocked: "Blocked",
};
const WHO: Record<string, string> = { installer: "Lead installer", electrician: "Electrician", office: "Office" };

/** Office view of the installation-day installer safety assessment (read-only). */
export function PiisaPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getPiisaPanel);
  const { data, error } = useQuery({ queryKey: ["piisa_panel", jobId], queryFn: () => load({ data: { jobId } }) });
  return (
    <Section title="Installer safety assessment (PIISA)">
      {error ? <p className="text-sm text-destructive">Couldn't load the PIISA status.</p> : !data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="text-muted-foreground">Responsible:</span> <strong>{WHO[data.responsible]}</strong></span>
            <span><span className="text-muted-foreground">Status:</span> <strong>{DUE[data.due]}</strong></span>
          </div>
          <p><span className="text-muted-foreground">Next action:</span> {data.nextAction}</p>
          {data.blockers.length > 0 && (
            <ul className="list-disc space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 pl-6 text-destructive">
              {data.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {data.hazards.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">PIESA hazards (Part 7)</p>
              <ul className="space-y-1">
                {data.hazards.map((h) => (
                  <li key={h.key} className={h.resolved ? "rounded-md border p-2" : "rounded-md border border-destructive/30 bg-destructive/5 p-2"}>
                    <strong>{h.text}</strong> — {h.resolved ? "Resolved by verified rectification." : h.reason}
                    {!h.resolved && <div className="text-muted-foreground">Next action: {h.nextAction}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.confirmations.length > 0 && <p className="text-xs text-muted-foreground">Held pending official/legal confirmation: {data.confirmations.join(", ")}.</p>}
        </div>
      )}
    </Section>
  );
}
