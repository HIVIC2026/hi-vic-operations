import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGate1Evidence } from "@/lib/portal.functions";
import { Pill } from "./badges";
import { AlertCircle, Check, X } from "lucide-react";

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
const CHECK_KEYS = ["location", "residential", "relevant_ceiling", "ceiling_age", "previous_activity", "existing_insulation"] as const;
const CHECK_LABELS: Record<(typeof CHECK_KEYS)[number], string> = {
  location: "Victorian property",
  residential: "Class 1 or Class 2 sole-occupancy home",
  relevant_ceiling: "Qualifying relevant ceiling",
  ceiling_age: "Relevant ceiling or structure is over five years old",
  previous_activity: "No confirmed previous Activity 48 for the same ceiling area",
  existing_insulation: "Existing insulation meets the Activity 48 criterion",
};
const checkState = (result: string) => result === "pass" ? "pass" : result === "fail" ? "fail" : "confirm";

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
    <section className="rounded-md border bg-card p-4 sm:p-5">
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
      <div className="mb-4 divide-y rounded-md border" aria-label="Eligibility requirements">
        {CHECK_KEYS.map((key, index) => {
          const item = live.rules.find((rule) => rule.key === key);
          const state = checkState(item?.result ?? "review");
          const Icon = state === "pass" ? Check : state === "fail" ? X : AlertCircle;
          const stateLabel = state === "pass" ? "Confirmed" : state === "fail" ? "Failed" : "To be confirmed";
          return <div key={key} className="grid grid-cols-[2rem_2.5rem_1fr] gap-2 px-3 py-3 sm:grid-cols-[2rem_2.5rem_minmax(13rem,1fr)_minmax(14rem,1.5fr)] sm:items-center">
            <span className="text-lg font-bold text-muted-foreground">{index + 1}</span>
            <span className={`grid h-9 w-9 place-items-center rounded-full ${state === "pass" ? "bg-success-soft text-success" : state === "fail" ? "bg-danger-soft text-danger" : "bg-warning-soft text-foreground"}`} aria-label={stateLabel}><Icon className="h-5 w-5" /></span>
            <div><div className="font-semibold">{CHECK_LABELS[key]}</div><div className="text-xs font-semibold text-muted-foreground">{stateLabel}</div></div>
            <div className="col-start-3 text-sm sm:col-start-auto"><div>{item?.reason ?? "Evidence not available"}</div><div className="mt-0.5 text-xs text-muted-foreground">{item ? `${BASIS[item.basis] ?? item.basis} · ${item.source}` : "unknown source"}</div></div>
          </div>;
        })}
      </div>
      {(safety.length > 0 || ops.length > 0) && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {safety.length > 0 && <div className="rounded-md border border-danger/40 p-3 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-danger">Safety — not an eligibility result</div>{safety.map((f) => <div key={f.key}>{f.reason}</div>)}</div>}
          {ops.length > 0 && <div className="rounded-md border p-3 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Operational — not an eligibility result</div>{ops.map((f) => <div key={f.key}>{f.reason}</div>)}</div>}
        </div>
      )}
      <details className="mt-2 rounded-md border p-3"><summary className="cursor-pointer text-sm font-semibold">Evidence and audit detail</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-1 pr-3">Evidence</th><th className="pr-3">Source</th><th className="pr-3">Status</th><th>Reason</th></tr></thead><tbody>{live.rules.map((r) => <tr key={r.key} className="border-t align-top"><td className="py-1.5 pr-3 font-medium">{r.fact}</td><td className="pr-3 text-xs text-muted-foreground">{r.source} · {BASIS[r.basis]}</td><td className="pr-3"><Pill t={RESULT[r.result]!.t}>{RESULT[r.result]!.l}</Pill></td><td>{r.reason}</td></tr>)}</tbody></table></div>
        <pre className="mt-3 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(recorded.audit ?? live, null, 2)}</pre>
      </details>
      <p className="mt-2 text-xs text-muted-foreground">Ruleset {live.ruleset_version}. Owner declarations never count as verified; website screening is information only.</p>
    </section>
  );
}
