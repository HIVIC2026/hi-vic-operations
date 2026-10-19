import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/portal/panels";
import { useAction } from "@/hooks/use-me";
import {
  getVerifiedEligibility,
  recordPriorActivityCheck,
  recordVerifiedEligibility,
} from "@/lib/verified-eligibility.functions";
import { reopenReadyCheckDraft } from "@/lib/ready-check-draft.functions";
import {
  PRIOR_ACTIVITY_CHECKS,
  PRIOR_ACTIVITY_LABEL,
  VERIFIED_LABEL,
  type PriorActivityCheck,
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
            {r.ok === false && r.value !== "Missing" ? " (missing)" : ""}
            {r.ok === null ? " (needs review)" : ""}
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
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: ["verified-eligibility", jobId],
    queryFn: () => load({ data: { jobId } }) as Promise<View>,
  });
  const [outcome, setOutcome] = useState<VerifiedOutcome | null>(null);
  const [text, setText] = useState("");
  const recordPrior = useAction(recordPriorActivityCheck);
  const [prior, setPrior] = useState<PriorActivityCheck | null>(null);
  const [priorNote, setPriorNote] = useState("");
  const reopen = useAction(reopenReadyCheckDraft);
  const [reopenReason, setReopenReason] = useState("");
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
  const submitPrior = async () => {
    if (!prior) return;
    const ok = await recordPrior(
      { jobId, answer: prior, note: priorNote.trim() || null },
      "Previous Activity 48 check recorded",
    );
    if (ok) {
      setPrior(null);
      setPriorNote("");
      await queryClient.invalidateQueries({ queryKey: ["verified-eligibility", jobId] });
    }
  };
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
      await queryClient.invalidateQueries({
        queryKey: ["verified-eligibility", jobId],
      });
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
          Office check: previous Activity 48 / VEU ceiling insulation
        </div>
        <p className="text-sm">
          Recorded:{" "}
          <strong>
            {data.evidence.priorActivity
              ? PRIOR_ACTIVITY_LABEL[data.evidence.priorActivity]
              : "Not checked yet"}
          </strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Check the VEU register, Ready Check findings and any office records for this property.
          Needed before verified eligibility and before VEEC creation.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRIOR_ACTIVITY_CHECKS.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={prior === c ? "default" : "outline"}
              onClick={() => setPrior(c)}
            >
              {PRIOR_ACTIVITY_LABEL[c]}
            </Button>
          ))}
        </div>
        {prior && (
          <div className="mt-2">
            <Label htmlFor="pa-note">
              {prior === "none_known" ? "Note (optional)" : "Describe the evidence (required)"}
            </Label>
            <Textarea id="pa-note" value={priorNote} onChange={(e) => setPriorNote(e.target.value)} />
            <Button
              className="mt-2"
              size="sm"
              disabled={prior !== "none_known" && !priorNote.trim()}
              onClick={() => void submitPrior()}
            >
              Record check
            </Button>
          </div>
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
      {data.evidence.readyCheck.final && data.evidence.readyCheck.submissionRef?.startsWith("portal:") && (
        <div className="mt-3 rounded-md border p-2" data-rc-reopen>
          <Label htmlFor="rc-reopen">Send the installer's Ready Check back for correction (reason required)</Label>
          <Textarea id="rc-reopen" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          <Button className="mt-2" size="sm" variant="outline" disabled={reopenReason.trim().length < 3} onClick={async () => { const r = await reopen({ jobId, reason: reopenReason.trim() }, "Ready Check reopened for the installer"); if (r) { setReopenReason(""); await queryClient.invalidateQueries({ queryKey: ["verified-eligibility", jobId] }); } }}>
            Reopen Ready Check
          </Button>
        </div>
      )}
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
