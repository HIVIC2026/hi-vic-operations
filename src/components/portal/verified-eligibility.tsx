import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/portal/panels";
import { useAction } from "@/hooks/use-me";
import {
  getVerifiedEligibility,
  recordVerifiedEligibility,
} from "@/lib/verified-eligibility.functions";
import {
  VERIFIED_LABEL,
  electricalSummary,
  evidenceSummary,
  readyCheckPresent,
  type ReadyCheckEvidence,
  type SummaryRow,
  type VerifiedOutcome,
} from "@/lib/verified-eligibility.core";

function Rows({ rows }: { rows: SummaryRow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd
            className={
              r.ok === false
                ? "text-danger font-medium"
                : r.ok === null
                  ? "text-warning font-medium"
                  : ""
            }
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type View = {
  evidence: ReadyCheckEvidence;
  assessment: {
    missing: string[];
    reviewReasons: string[];
    flags: string[];
    eligibleAllowed: boolean;
    suggested: VerifiedOutcome;
  };
  current: {
    outcome: VerifiedOutcome;
    reason: string | null;
    note: string | null;
    recorded_at: string;
  } | null;
  stale: boolean;
  history: {
    id: string;
    outcome: VerifiedOutcome;
    reason: string | null;
    note: string | null;
    recorded_at: string;
    is_current: boolean;
    ready_check_version: number;
  }[];
};

/** Office-only. Records the verified result; never moves the job, quotes, PIESA, payments or messages. */
export function VerifiedEligibilityCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getVerifiedEligibility);
  const record = useAction(recordVerifiedEligibility);
  const { data, error, isPending } = useQuery({
    queryKey: ["verified-eligibility", jobId],
    queryFn: () => load({ data: { jobId } }) as Promise<View>,
  });
  const [outcome, setOutcome] = useState<VerifiedOutcome | null>(null);
  const [text, setText] = useState("");
  if (isPending)
    return (
      <Section title="Verified eligibility">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Section>
    );
  if (error || !data)
    return (
      <Section title="Verified eligibility">
        <p role="alert" className="text-sm text-danger">
          Verified eligibility could not be loaded. PIESA stays blocked.
        </p>
      </Section>
    );
  if (!readyCheckPresent(data.evidence)) return null;
  const a = data.assessment;
  const needsText = outcome === "not_eligible" || outcome === "needs_review";
  const submit = async () => {
    if (!outcome) return;
    const t = text.trim() || null;
    const ok = await record(
      {
        jobId,
        outcome,
        reason: outcome === "not_eligible" ? t : null,
        note: outcome === "not_eligible" ? null : t,
      },
      "Verified eligibility recorded",
    );
    if (ok) {
      setOutcome(null);
      setText("");
    }
  };
  return (
    <Section title="Verified eligibility">
      <p className="text-sm">
        Current:{" "}
        <strong>{data.current ? VERIFIED_LABEL[data.current.outcome] : "Not recorded"}</strong>
        {data.stale && (
          <span className="ml-2 font-semibold text-danger">
            Out of date — a newer Ready Check exists
          </span>
        )}
      </p>
      {data.stale && (
        <p role="alert" className="mt-1 text-sm text-danger">
          Quote and PIESA progression stay blocked until this job is re-reviewed.
        </p>
      )}
      <div className="mt-3">
        <div className="mb-1 text-sm font-semibold">
          Ready Check evidence (property eligibility)
        </div>
        <Rows rows={evidenceSummary(data.evidence)} />
        {data.evidence.conflicts.length > 0 && (
          <p className="mt-1 text-sm text-warning">
            Conflicting evidence: {data.evidence.conflicts.join("; ")}
          </p>
        )}
      </div>
      <div className="mt-3 border-t pt-2">
        <div className="mb-1 text-sm font-semibold">
          Section D electrical observations — safety/planning only, not eligibility
        </div>
        <Rows rows={electricalSummary(data.evidence)} />
      </div>
      {a.missing.length > 0 && (
        <div className="mt-2 text-sm">
          <div className="font-semibold">Missing evidence</div>
          <ul className="list-disc pl-5">
            {a.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {a.reviewReasons.length > 0 && (
        <div className="mt-2 text-sm">
          <div className="font-semibold">Needs review</div>
          <ul className="list-disc pl-5">
            {a.reviewReasons.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {a.flags.length > 0 && (
        <div className="mt-2 text-sm text-muted-foreground">
          <div className="font-semibold">Safety/planning flags</div>
          <ul className="list-disc pl-5">
            {a.flags.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={outcome === "eligible" ? "default" : "outline"}
          disabled={!a.eligibleAllowed}
          onClick={() => setOutcome("eligible")}
        >
          Verified eligible
        </Button>
        <Button
          size="sm"
          variant={outcome === "not_eligible" ? "default" : "outline"}
          onClick={() => setOutcome("not_eligible")}
        >
          Not eligible
        </Button>
        <Button
          size="sm"
          variant={outcome === "needs_review" ? "default" : "outline"}
          onClick={() => setOutcome("needs_review")}
        >
          Needs office review
        </Button>
      </div>
      {needsText && (
        <div className="mt-2">
          <Label htmlFor="ve-text">
            {outcome === "not_eligible" ? "Office reason (required)" : "Note (required)"}
          </Label>
          <Textarea id="ve-text" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {outcome && (
        <Button
          className="mt-2"
          size="sm"
          disabled={needsText && !text.trim()}
          onClick={() => void submit()}
        >
          Record result
        </Button>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Recording a result does not send anything to the owner, create a quote, request a PIESA or
        book a visit.
      </p>
      {data.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            History ({data.history.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {data.history.map((h) => (
              <li key={h.id}>
                {new Date(h.recorded_at).toLocaleString("en-AU")} · {VERIFIED_LABEL[h.outcome]} ·
                Ready Check v{h.ready_check_version}
                {h.reason ? ` · ${h.reason}` : ""}
                {h.note ? ` · ${h.note}` : ""}
                {h.is_current ? " · current" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
