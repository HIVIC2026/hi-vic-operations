import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGate1Evidence } from "@/lib/portal.functions";
import { Pill } from "./badges";

type Tone = "good" | "bad" | "warn" | "info";
const RESULT: Record<string, { t: Tone; l: string }> = {
  pass: { t: "good", l: "Pass" }, fail: { t: "bad", l: "Fail" }, review: { t: "warn", l: "Review" }, onsite: { t: "info", l: "Onsite" }, info: { t: "info", l: "Info" },
};
const CATEGORY: Record<string, { t: Tone; l: string }> = {
  likely_eligible: { t: "good", l: "Likely eligible" },
  needs_onsite_confirmation: { t: "info", l: "Needs onsite confirmation" },
  does_not_appear_eligible: { t: "bad", l: "Does not appear eligible" },
};
const BASIS: Record<string, string> = { verified: "verified", recorded: "recorded", declared: "owner-declared", unknown: "unknown" };

/** Admin-only Gate 1 categorisation: category / REVIEW REQUIRED, why, next action, flags, rule table, expandable audit. */
export function Gate1EvidencePanel({ jobId }: { jobId: string }) {
  const fn = useServerFn(getGate1Evidence);
  const { data, isLoading } = useQuery({ queryKey: ["gate1_evidence", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (isLoading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Loading Gate 1…</div>;
  if (!data) return null;
  const { live, recorded } = data;
  const admin = recorded.source === "admin";
  const review = admin ? false : recorded.source === "system" ? recorded.reviewRequired : live.reviewRequired;
  const outcome = admin || recorded.source === "system" ? recorded.outcome : live.outcome;
  const why = admin ? [recorded.reason ?? ""] : live.failed.length ? live.failed : live.review.length ? live.review : live.onsite.length ? live.onsite : ["All remotely checkable rules satisfied"];
  const flags = live.flags;
  const safety = flags.filter((f) => f.type === "safety"), ops = flags.filter((f) => f.type !== "safety");
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Gate 1 categorisation</h3>
        {review && <Pill t="warn">REVIEW REQUIRED</Pill>}
        {!review && outcome && <Pill t={CATEGORY[outcome]!.t}>{CATEGORY[outcome]!.l}</Pill>}
        {!review && !outcome && <Pill>Not decided</Pill>}
        <span className="text-xs text-muted-foreground">{admin ? "Admin decision (stands)" : recorded.source === "system" ? "System decision" : "Not yet recorded – rules preview"}</span>
      </div>
      <div className="mb-3 space-y-2 text-sm">
        <div><span className="font-medium">Why: </span>{why.join("; ")}</div>
        <div className="rounded bg-accent px-2 py-1.5 font-medium text-accent-foreground">Next action: {admin ? "As set by admin" : live.nextAction}</div>
        {admin && live.outcome !== outcome && <p className="text-xs text-muted-foreground">Rules now say: {live.reviewRequired ? "review required" : live.outcome?.replace(/_/g, " ")} (admin decision is not overwritten).</p>}
      </div>
      {(safety.length > 0 || ops.length > 0) && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {safety.length > 0 && <div className="rounded-lg border border-danger/40 p-2 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-danger">Safety</div>{safety.map((f) => <div key={f.key}>{f.reason}</div>)}</div>}
          {ops.length > 0 && <div className="rounded-lg border p-2 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Operational</div>{ops.map((f) => <div key={f.key}>{f.reason}</div>)}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="py-1 pr-3">Rule</th><th className="pr-3">Fact</th><th className="pr-3">Source / basis</th><th className="pr-3">Result</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {live.rules.map((r) => (
              <tr key={r.key} className="border-t align-top">
                <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                <td className="pr-3">{r.fact}</td>
                <td className="pr-3 text-xs text-muted-foreground">{r.source} · {BASIS[r.basis]}</td>
                <td className="pr-3"><Pill t={RESULT[r.result]!.t}>{RESULT[r.result]!.l}</Pill></td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Audit detail</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(recorded.audit ?? live, null, 2)}</pre>
      </details>
      <p className="mt-2 text-xs text-muted-foreground">Ruleset {live.ruleset_version}. Owner declarations never count as verified; website screening is information only.</p>
    </section>
  );
}
