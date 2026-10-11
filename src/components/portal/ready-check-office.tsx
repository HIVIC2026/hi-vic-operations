// Office-only "Reopen Ready Check" control (W2). Wires the existing reopenReadyCheckDraft server function.
// Requires a typed reason and an explicit confirm step. All authorisation, audit, eligibility-verification
// restrictions and state-transition safeguards are enforced server-side (see reopenRcDraft); this UI only
// collects the reason and confirmation. It never moves the job, sends anything or edits answers.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Section } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-me";
import { reopenReadyCheckDraft } from "@/lib/ready-check-draft.functions";
import { refreshInstallerJob } from "@/components/trade/job-cache";

/** Office/admin reopen of a SUBMITTED portal Ready Check so the installer can correct answers. */
export function OfficeReadyCheckReopen({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const reopen = useAction(reopenReadyCheckDraft);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const canSubmit = !busy && trimmed.length >= 3; // mirror the server's min-length rule (3..1000)

  const onReopen = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const out = await reopen(
        { jobId, reason: trimmed },
        "Ready Check reopened for the installer to correct.",
      );
      if (out) {
        await qc.invalidateQueries({ queryKey: ["rc-draft", jobId] });
        await refreshInstallerJob(qc, jobId);
        setConfirming(false);
        setReason("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Reopen Ready Check (office only)">
      <p className="text-sm text-muted-foreground">
        Reopening a submitted Ready Check lets the installer correct their answers. This is recorded
        in the job history with your reason. It is refused while eligibility is recorded as verified
        (record &quot;Needs office review&quot; first) and for Ready Checks that came from Mitti.
      </p>
      {!confirming ? (
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-rc-reopen-open
            onClick={() => {
              setConfirming(true);
            }}
          >
            Reopen Ready Check
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2" data-rc-reopen-form>
          <label className="block text-sm font-medium" htmlFor="rc-reopen-reason">
            Reason (required, recorded in history)
          </label>
          <Input
            id="rc-reopen-reason"
            value={reason}
            disabled={busy}
            maxLength={1000}
            placeholder="e.g. Measured area needs correcting"
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason for reopening the Ready Check"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-rc-reopen-confirm
              disabled={!canSubmit}
              aria-busy={busy}
              onClick={onReopen}
            >
              {busy ? "Reopening…" : "Confirm reopen"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
          {trimmed.length > 0 && trimmed.length < 3 && (
            <p className="text-xs text-danger" data-rc-reopen-hint>
              Please enter a short reason (at least 3 characters).
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
