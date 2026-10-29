// AI replies step 2 (Jo 29 Oct 2026): questions the AI couldn't answer and complaints after the install show above the
// reply box; after Jo sends her reply to such a question she can save it as a standard answer for next time.
import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { btnClass, fieldInput } from "@/components/portal/kit";
import { saveAiAnswer } from "@/lib/ai-answers.functions";
import { saveAnswerPrefill } from "@/lib/ai-email-reply.core";

const WAITING = "Waiting for the database change";

/** Amber note above the reply box. */
export function NeedsNotes({ needsAnswer, needsYou }: { needsAnswer: string[]; needsYou: boolean }) {
  if (!needsAnswer.length && !needsYou) return null;
  return (
    <div role="note" className="grid gap-1 rounded-[10px] border border-warning bg-warning-soft px-3 py-2 text-sm text-ink" data-tone="amber" data-testid="ai-needs-notes">
      {needsAnswer.map((q, i) => <p key={i}>{`Needs your answer: ${q}`}</p>)}
      {needsYou && <p className="font-semibold">Needs you — complaint after the install. Check with the installer before replying.</p>}
    </div>
  );
}

/** A sent reply to a question the AI couldn't answer, waiting for Save or Skip. Held by the SCREEN, not the card, so it
 *  survives the card leaving the list on the next refetch (Jo is on her phone: every focus refetches). */
export type PendingSave = { key: string; label: string; questions: string[]; sentBody: string };

/** The screen-level list of pending saves; Save or Skip removes the entry. */
export function PendingSaves({ items, onRemove }: { items: PendingSave[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-2" aria-label="Save your answers">
      {items.map((p) => (
        <li key={p.key} className="grid gap-2 rounded-[12px] border border-line bg-paper p-3">
          <p className="text-sm text-sub">{p.label}</p>
          <SaveAnswerForm questions={p.questions} sentBody={p.sentBody} onDone={() => onRemove(p.key)} />
        </li>
      ))}
    </ul>
  );
}

/** Save or Skip calls onDone. */
export function SaveAnswerForm({ questions, sentBody, onDone }: { questions: string[]; sentBody: string; onDone: () => void }) {
  const save = useServerFn(saveAiAnswer);
  const start = saveAnswerPrefill(questions, sentBody);
  const [topic, setTopic] = useState(start.topic);
  const [answer, setAnswer] = useState(start.answer);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const id = useId();
  const valid = topic.trim().length >= 2 && topic.trim().length <= 80 && answer.trim().length >= 2 && answer.trim().length <= 2000;
  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { topic: topic.trim(), answer: answer.trim(), active: true } });
      toast.success("Saved to your AI answers");
      onDone();
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (msg.includes(WAITING)) setWaiting(true);
      else toast.error(msg && msg.length < 200 ? msg : "That didn't save. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-2 rounded-[10px] border border-line bg-mist p-3" aria-label="Save as a standard answer">
      <p className="text-sm font-semibold text-ink">Save as a standard answer?</p>
      <label htmlFor={`${id}-topic`} className="text-xs font-semibold text-ink">Topic</label>
      <input id={`${id}-topic`} className={fieldInput} value={topic} maxLength={80} disabled={busy} onChange={(e) => setTopic(e.target.value)} />
      <label htmlFor={`${id}-answer`} className="text-xs font-semibold text-ink">Answer</label>
      <textarea id={`${id}-answer`} className={fieldInput} value={answer} rows={Math.min(10, answer.split("\n").length + 2)} maxLength={2000} disabled={busy} onChange={(e) => setAnswer(e.target.value)} />
      {waiting && <p className="text-sm text-ink" role="alert">{WAITING} — this can't be saved yet.</p>}
      <div className="grid grid-cols-2 gap-2 md:flex">
        {!waiting && <button type="button" disabled={busy || !valid} className={btnClass("primary", "min-h-[44px]")} onClick={() => void submit()}>{busy ? "Saving…" : "Save"}</button>}
        <button type="button" disabled={busy} className={btnClass("secondary", "min-h-[44px]")} onClick={onDone}>Skip</button>
      </div>
    </div>
  );
}
