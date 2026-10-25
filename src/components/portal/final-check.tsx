// Decision 372 (Jo, 25 Oct 2026): the one-screen Final check. Every pre-computed check with a tick or a cross, why it
// fails and a link to its evidence; Approve is enabled only when every check passes (a flagged job still needs a note).
// Presentation only (portal kit): the list comes from final-check.core via getFinalCheck, and Approve is the existing
// human authorised action `approveApJob`, which re-checks the same list on the server and then every stage guard.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Btn, NoteBox, Panel, Pill, fieldInput } from "@/components/portal/kit";
import { useAction } from "@/hooks/use-me";
import { approveApJob, getFinalCheck } from "@/lib/ap-queue.functions";
import type { FinalCheckItem } from "@/lib/final-check.core";
import type { CardKey } from "@/lib/office-stage-cards.core";
import { cn } from "@/lib/utils";

const MARK: Record<FinalCheckItem["state"], { sign: string; cls: string; label: string }> = {
  pass: { sign: "✓", cls: "bg-mint text-hiv-green", label: "Passed" },
  fail: { sign: "✕", cls: "bg-pink text-rose", label: "Not passed" },
  not_needed: { sign: "–", cls: "bg-mist text-sub", label: "Not needed" },
};

export function FinalCheckScreen({ jobId, onGo }: { jobId: string; onGo?: (k: CardKey | "money" | "contact") => void }) {
  const load = useServerFn(getFinalCheck);
  const approve = useAction(approveApJob);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["final-check", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 15_000, retry: 1 });
  if (q.error) return <Panel title="Final check"><p role="alert" className="text-sm text-rose">The Final check could not be worked out: {(q.error as Error).message}. Approve stays off until it can.</p><Btn tone="secondary" className="mt-2" onClick={() => void q.refetch()}>Try again</Btn></Panel>;
  if (!q.data) return <Panel title="Final check"><p role="status" className="text-sm text-sub">Checking every record…</p></Panel>;
  const d = q.data;
  const failing = d.items.filter((i) => i.state === "fail");
  const atFinalCheck = d.stage === "ap_review";
  const needsNote = d.flags.length > 0;
  const canApprove = d.ready && (!needsNote || note.trim().length > 0) && !busy;
  return (
    <Panel title="Final check" action={<Pill tone={d.ready ? "green" : failing.length ? "rose" : "plain"}>{d.ready ? "Every check passed" : failing.length ? `${failing.length} to fix` : "Not at Final check"}</Pill>}>
      <ul className="divide-y divide-line" aria-label="Final check items" data-why="decision 372: one screen, every check">
        {d.items.map((i) => (
          <li key={i.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 py-2.5">
            <span aria-label={MARK[i.state].label} className={cn("mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", MARK[i.state].cls)}>{MARK[i.state].sign}</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{i.label}</div>
              {i.state === "fail" ? <ul className="mt-0.5 space-y-0.5 text-xs text-rose">{i.why.map((w) => <li key={w}>{w}</li>)}</ul>
                : i.detail ? <div className="text-xs text-sub">{i.state === "not_needed" ? "Not needed on this job" : i.detail}</div>
                : i.state === "not_needed" ? <div className="text-xs text-sub">Not needed on this job</div> : null}
            </div>
            {i.evidence && <button type="button" className="whitespace-nowrap text-xs font-semibold text-hiv-blue hover:underline" onClick={() => onGo?.(i.evidence!.card)}>{i.evidence.label} ›</button>}
          </li>
        ))}
      </ul>
      {d.flags.length > 0 && (
        <NoteBox className="mt-3">
          <div className="mb-1 font-semibold text-ink">Flags on this job (a note is needed to approve)</div>
          <ul className="list-disc pl-4">{d.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </NoteBox>
      )}
      {atFinalCheck ? (
        <div className="mt-3 grid gap-2">
          {needsNote && <textarea className={fieldInput} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is still OK to approve (required for a flagged job)" aria-label="Approval note" />}
          <Btn className="w-full" disabled={!canApprove} onClick={async () => { setBusy(true); try { await approve({ jobId, ...(note.trim() ? { note: note.trim() } : {}) }, "Approved – Ready for VEEC"); await q.refetch(); } finally { setBusy(false); } }}>
            Approve
          </Btn>
          {!d.ready && <p className="text-xs text-sub">Approve turns on once every item above has a tick. You approve as the Accredited Person — nothing here approves itself.</p>}
        </div>
      ) : <p className="mt-3 text-xs text-sub">Approve appears when the job reaches Final check (install complete and evidence in).</p>}
    </Panel>
  );
}
