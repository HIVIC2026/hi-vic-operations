import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGate1Evidence } from "@/lib/portal.functions";
import { Pill } from "./badges";

const RESULT: Record<string, { t: "ok" | "bad" | "warn"; l: string }> = { pass: { t: "ok", l: "Pass" }, fail: { t: "bad", l: "Fail" }, review: { t: "warn", l: "Review" } };
const OUTCOME: Record<string, string> = { likely_eligible: "Auto-pass", does_not_appear_eligible: "Auto-fail (held)" };

/** Per-rule Gate 1 evidence: fact, source, declared/verified basis and result. Read-only. */
export function Gate1EvidencePanel({ jobId }: { jobId: string }) {
  const fn = useServerFn(getGate1Evidence);
  const { data, isLoading } = useQuery({ queryKey: ["gate1_evidence", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (isLoading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Loading Gate 1 evidence…</div>;
  if (!data) return null;
  const { live, recorded } = data;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Gate 1 evidence</h3>
        <Pill t={live.outcome === "likely_eligible" ? "ok" : live.outcome ? "bad" : "warn"}>Rules now: {live.outcome ? OUTCOME[live.outcome] : "Human review"}</Pill>
        {recorded.source && <span className="text-xs text-muted-foreground">Recorded decision: {recorded.outcome?.replace(/_/g, " ") ?? "—"} ({recorded.source})</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="py-1 pr-3">Rule</th><th className="pr-3">Fact</th><th className="pr-3">Source</th><th className="pr-3">Basis</th><th className="pr-3">Result</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {live.rules.map((r) => (
              <tr key={r.key} className="border-t align-top">
                <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                <td className="pr-3">{r.fact}</td>
                <td className="pr-3 text-muted-foreground">{r.source}</td>
                <td className="pr-3"><Pill t={r.basis === "verified" ? "ok" : r.basis === "unknown" ? "warn" : "info"}>{r.basis}</Pill></td>
                <td className="pr-3"><Pill t={RESULT[r.result]!.t}>{RESULT[r.result]!.l}</Pill></td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Owner declarations are shown as “declared” and never count as verified. Uncertain rules always go to human review.</p>
    </section>
  );
}
