// ONE compact eligibility card for the office job page (Jo, 7 Oct 2026). Presentation only:
// Gate 1 result comes from getGate1Evidence, onsite facts from getVerifiedEligibility.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGate1Evidence, getIntakeSummary } from "@/lib/portal.functions";
import { getVerifiedEligibility } from "@/lib/verified-eligibility.functions";
import { readyCheckPresent, VERIFIED_LABEL, R_VALUE_LIMIT, type ReadyCheckEvidence, type VerifiedOutcome } from "@/lib/verified-eligibility.core";
import { CHECK_MARK_LABEL, markOf, onsiteMarkFor, ownerAnswerForGate1, type CheckMark } from "@/lib/portal-presentation.core";
import { Pill } from "./badges";

const CHECKS: [string, string][] = [
  ["location", "Victoria"], ["residential", "Home"], ["relevant_ceiling", "Ceiling under roof"],
  ["ceiling_age", "Over 5 years old"], ["previous_activity", "No previous Activity 48"], ["existing_insulation", "Existing insulation"],
];
const TONE: Record<CheckMark, "good" | "bad" | "warn"> = { pass: "good", fail: "bad", confirm: "warn" };
const OVERALL: Record<string, [string, "good" | "bad" | "warn"]> = {
  likely_eligible: ["Likely Eligible", "good"], needs_onsite_confirmation: ["Needs Onsite Confirmation", "warn"], does_not_appear_eligible: ["Does Not Appear Eligible", "bad"],
};

export function EligibilityCard({ jobId, override, verifiedControls }: { jobId: string; override: ReactNode; verifiedControls: ReactNode }) {
  const g = useServerFn(getGate1Evidence), i = useServerFn(getIntakeSummary), v = useServerFn(getVerifiedEligibility);
  const gate = useQuery({ queryKey: ["gate1_evidence", jobId], queryFn: () => g({ data: { jobId } }) });
  const intake = useQuery({ queryKey: ["intake_summary", jobId], queryFn: () => i({ data: { jobId } }) });
  const ver = useQuery({ queryKey: ["verified-eligibility", jobId], queryFn: () => v({ data: { jobId } }) as Promise<{ evidence: ReadyCheckEvidence; current: { outcome: VerifiedOutcome } | null }> });
  const [open, setOpen] = useState(false);
  if (gate.isPending) return <section className="mb-3 rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">Loading eligibility…</section>;
  if (!gate.data) return <section role="alert" className="mb-3 rounded-md border bg-card px-4 py-3 text-sm text-danger">Eligibility couldn't be loaded.</section>;
  const { live, recorded } = gate.data;
  const adminSet = recorded.source === "admin";
  const outcome = adminSet || recorded.source === "system" ? recorded.outcome : live.outcome;
  const review = !adminSet && (recorded.source === "system" ? recorded.reviewRequired : live.reviewRequired);
  const ev = ver.data && readyCheckPresent(ver.data.evidence) ? ver.data.evidence : null;
  const ls = live.rules.find((x) => x.key === "life_support")?.fact ?? "unknown";
  const overall: [string, "good" | "bad" | "warn"] | null | undefined = review ? ["Office review", "warn"] : outcome ? OVERALL[outcome] : null;
  return (
    <section id="target-gate1-evidence" tabIndex={-1} aria-label="Eligibility" className="mb-3 scroll-mt-4 rounded-md border bg-card outline-none" data-eligibility-card>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-bold">Eligibility</h2>
        {overall ? <Pill t={overall[1]}>{overall[0]}</Pill> : <Pill>Not decided</Pill>}
        {adminSet && <span className="text-xs text-muted-foreground">set by office</span>}
        {ev && <Pill t={ver.data?.current?.outcome === "eligible" ? "good" : ver.data?.current?.outcome === "not_eligible" ? "bad" : "warn"}>Onsite: {ver.data?.current ? VERIFIED_LABEL[ver.data.current.outcome] : "not recorded"}</Pill>}
        {ls === "yes" ? <Pill t="bad">Life support</Pill> : ls === "no" ? <Pill>No life support</Pill> : <Pill t="warn">Life support unknown</Pill>}
        <button type="button" className="ml-auto text-xs font-semibold text-primary underline" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Change result"}</button>
      </div>
      <table className="w-full text-sm">
        <thead className="sr-only sm:not-sr-only"><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="px-4 py-1 font-semibold">Check</th><th className="px-2 font-semibold">Owner said</th><th className="px-2 font-semibold">Result</th>{ev && <th className="px-2 font-semibold">Onsite</th>}</tr></thead>
        <tbody className="divide-y">
          {CHECKS.map(([key, label]) => {
            const r = live.rules.find((x) => x.key === key);
            const m = markOf(r?.result);
            const said = key === "location" ? (r?.fact ?? "—") : ownerAnswerForGate1(key, intake.data);
            const on = onsiteMarkFor(key, ev, R_VALUE_LIMIT);
            return (
              <tr key={key} className="align-top" data-check={key}>
                <td className="px-4 py-1.5 font-medium">{label}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{said}</td>
                <td className="whitespace-nowrap px-2 py-1.5"><Pill t={TONE[m]}>{CHECK_MARK_LABEL[m]}</Pill></td>
                {ev && <td className="px-2 py-1.5">{on ? <span className={on.mark === "fail" ? "text-danger" : on.mark === "confirm" ? "text-muted-foreground" : ""}>{on.text}</span> : <span className="text-muted-foreground">—</span>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && <div className="space-y-3 border-t p-4">{override}{ev && verifiedControls}</div>}
    </section>
  );
}
