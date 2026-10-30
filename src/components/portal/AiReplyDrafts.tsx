// AI email reply drafts on the job (Jo 26 Oct 2026): each draft waits here for Jo to check, edit, then Send or Discard.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { discardAiReplyDraft, getAiReplyDrafts, sendAiReplyDraft } from "@/lib/ai-email-reply.functions";
import { btnClass } from "@/components/portal/kit";
import { AI_REWRITTEN_NOTE, aiReplyEmailHtml } from "@/lib/ai-email-reply.core";
import { panelLoad } from "@/lib/panel-load.core";
import { LoadFailed } from "@/components/portal/load-failed";
import { saveStateText, useDraftAutosave } from "@/components/portal/use-draft-autosave";
import { ActionChecks, ALL_TICKED, NeedsNotes, PendingSaves, type ActionTicks, type PendingSave } from "@/components/portal/ai-needs-answer";

type Draft = Awaited<ReturnType<typeof getAiReplyDrafts>>[number];

function DraftCard({ d, onDone, onSent }: { d: Draft; onDone: () => void; onSent: (p: PendingSave) => void }) {
  const send = useServerFn(sendAiReplyDraft);
  const discard = useServerFn(discardAiReplyDraft);
  const [body, setBody] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const saved = useDraftAutosave(d.eventId, body, d.body);
  const [note, setNote] = useState<{ problems: string[] } | null>(null);
  const [ticks, setTicks] = useState<ActionTicks>(ALL_TICKED);
  /** `after` runs before onDone for this one action (Send of a draft with questions adds a pending save to the screen). */
  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      const r = await fn();
      // A blocked Send: nothing went out. The fixed reply goes back in the box for Jo to check; the card stays.
      if ((r as { status?: string } | null)?.status === "rewritten") { setBody((r as { body: string }).body); setNote({ problems: (r as { problems: string[] }).problems }); return; }
      toast.success(ok); after?.(); onDone();
    } catch (e) { toast.error((e as Error).message || "That didn't work. Try again."); } finally { setBusy(false); }
  };
  return (
    <li className="grid gap-2 rounded-[12px] border border-line bg-paper p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-sub">
        <span><strong className="text-ink">To {d.to}</strong> · {d.subject}</span>
        <span>{d.kind === "simple" ? "Simple email" : "Needs a check"} · {new Date(d.at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <NeedsNotes needsAnswer={d.needsAnswer} needsYou={d.needsYou} />
      <textarea aria-label="Reply text" value={body} onChange={(e) => { setNote(null); setBody(e.target.value); }} rows={Math.min(14, body.split("\n").length + 2)} className="w-full rounded-[10px] border border-line bg-background p-2 text-sm" disabled={busy} />
      {saveStateText(saved) && <span className={`text-xs ${saved === "failed" ? "text-danger" : "text-sub"}`} aria-live="polite">{saveStateText(saved)}</span>}
      <ActionChecks actions={d.actions} ticks={ticks} onChange={setTicks} disabled={busy} />
      {note && (note.problems.length
        ? <p className="text-sm text-danger" role="alert">{note.problems.join(" ")}</p>
        : <p className="text-sm text-ink" role="status">{AI_REWRITTEN_NOTE}</p>)}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-hiv-blue">How the owner will see it</summary>
        <iframe title="Email preview" sandbox="" srcDoc={aiReplyEmailHtml(body, { subject: d.subject, unsubscribe: null })} className="mt-2 h-[520px] w-full max-w-[560px] rounded-[10px] border border-line bg-background" />
      </details>
      <div className="grid grid-cols-2 gap-2 md:flex">
        <button type="button" disabled={busy} className={btnClass("primary", "min-h-[44px]")} onClick={() => { setNote(null); const sent = body; void run(() => send({ data: { eventId: d.eventId, body, applyNote: ticks.applyNote, applyArea: ticks.applyArea } }), "Reply sent", d.needsAnswer.length ? () => onSent({ key: d.eventId, label: `Reply sent to ${d.to}.`, questions: d.needsAnswer, sentBody: sent }) : undefined); }}>{busy ? "Working…" : "Send"}</button>
        <button type="button" disabled={busy} className={btnClass("secondary", "min-h-[44px]")} onClick={() => void run(() => discard({ data: { eventId: d.eventId } }), "Draft discarded")}>Discard</button>
      </div>
    </li>
  );
}

export function AiReplyDrafts({ jobId }: { jobId: string }) {
  const load = useServerFn(getAiReplyDrafts);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-reply-drafts", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 15_000 });
  const waiting = (q.data ?? []).filter((d) => d.status === "waiting");
  // Sent replies to questions the AI couldn't answer, waiting for "Save as a standard answer?" — screen state, so a refetch can't lose them.
  const [pendingSaves, setPendingSaves] = useState<PendingSave[]>([]);
  const addPendingSave = (p: PendingSave) => setPendingSaves((xs) => [...xs.filter((x) => x.key !== p.key), p]);
  const removePendingSave = (key: string) => setPendingSaves((xs) => xs.filter((x) => x.key !== key));
  if (panelLoad(q) === "failed") return <section aria-label="Email replies to check" className="mb-4 grid gap-2 rounded-[14px] border border-danger p-4"><PendingSaves items={pendingSaves} onRemove={removePendingSave} /><LoadFailed what="Email replies to check" onRetry={() => void q.refetch()} /></section>;
  if (!waiting.length && !pendingSaves.length) return null;
  return (
    <section id="stage-email-drafts" aria-label="Email replies to check" className="mb-4 grid gap-2 rounded-[14px] border border-hiv-blue/30 bg-mist p-4">
      {waiting.length > 0 && (
        <>
          <h2 className="font-display text-lg font-bold text-ink">Email replies to check ({waiting.length})</h2>
          <p className="text-sm text-sub">Written by AI from this job's details and emails. Check, edit if needed, then Send.</p>
        </>
      )}
      <PendingSaves items={pendingSaves} onRemove={removePendingSave} />
      <ul className="grid gap-2">{waiting.map((d) => <DraftCard key={d.eventId} d={d} onSent={addPendingSave} onDone={() => { void qc.invalidateQueries({ queryKey: ["ai-reply-drafts", jobId] }); void qc.invalidateQueries({ queryKey: ["office-job-page", jobId] }); }} />)}</ul>
    </section>
  );
}
