// AI email reply drafts on the job (Jo 26 Oct 2026): each draft waits here for Jo to check, edit, then Send or Discard.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { discardAiReplyDraft, getAiReplyDrafts, sendAiReplyDraft } from "@/lib/ai-email-reply.functions";
import { btnClass } from "@/components/portal/kit";
import { aiReplyEmailHtml } from "@/lib/ai-email-reply.core";
import { panelLoad } from "@/lib/panel-load.core";
import { LoadFailed } from "@/components/portal/load-failed";
import { saveStateText, useDraftAutosave } from "@/components/portal/use-draft-autosave";

type Draft = Awaited<ReturnType<typeof getAiReplyDrafts>>[number];

function DraftCard({ d, onDone }: { d: Draft; onDone: () => void }) {
  const send = useServerFn(sendAiReplyDraft);
  const discard = useServerFn(discardAiReplyDraft);
  const [body, setBody] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const saved = useDraftAutosave(d.eventId, body, d.body);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onDone(); } catch (e) { toast.error((e as Error).message || "That didn't work. Try again."); } finally { setBusy(false); }
  };
  return (
    <li className="grid gap-2 rounded-[12px] border border-line bg-paper p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-sub">
        <span><strong className="text-ink">To {d.to}</strong> · {d.subject}</span>
        <span>{d.kind === "simple" ? "Simple email" : "Needs a check"} · {new Date(d.at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <textarea aria-label="Reply text" value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, body.split("\n").length + 2)} className="w-full rounded-[10px] border border-line bg-background p-2 text-sm" disabled={busy} />
      {saveStateText(saved) && <span className={`text-xs ${saved === "failed" ? "text-danger" : "text-sub"}`} aria-live="polite">{saveStateText(saved)}</span>}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-hiv-blue">How the owner will see it</summary>
        <iframe title="Email preview" sandbox="" srcDoc={aiReplyEmailHtml(body, { subject: d.subject, unsubscribe: null })} className="mt-2 h-[520px] w-full max-w-[560px] rounded-[10px] border border-line bg-background" />
      </details>
      <div className="grid grid-cols-2 gap-2 md:flex">
        <button type="button" disabled={busy} className={btnClass("primary", "min-h-[44px]")} onClick={() => void run(() => send({ data: { eventId: d.eventId, body } }), "Reply sent")}>{busy ? "Working…" : "Send"}</button>
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
  if (panelLoad(q) === "failed") return <section aria-label="Email replies to check" className="mb-4 rounded-[14px] border border-danger p-4"><LoadFailed what="Email replies to check" onRetry={() => void q.refetch()} /></section>;
  if (!waiting.length) return null;
  return (
    <section id="stage-email-drafts" aria-label="Email replies to check" className="mb-4 grid gap-2 rounded-[14px] border border-hiv-blue/30 bg-mist p-4">
      <h2 className="font-display text-lg font-bold text-ink">Email replies to check ({waiting.length})</h2>
      <p className="text-sm text-sub">Written by AI from this job's details and emails. Check, edit if needed, then Send.</p>
      <ul className="grid gap-2">{waiting.map((d) => <DraftCard key={d.eventId} d={d} onDone={() => { void qc.invalidateQueries({ queryKey: ["ai-reply-drafts", jobId] }); void qc.invalidateQueries({ queryKey: ["office-job-page", jobId] }); }} />)}</ul>
    </section>
  );
}
