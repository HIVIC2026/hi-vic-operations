// Office Emails tab (Jo 27 Oct 2026, decision 414): every owner email in one place, apart from Enquiries and Jobs.
// "Has a job": what they wrote + the AI reply to edit and Send; Done / Apply / Ignore as before.
// "No job yet": what they wrote + an AI reply pointing to the homeowner page; Send, Match to a job, Not a customer.
// Once sent (or dealt with) the email leaves this tab; job replies are saved on the job's email history.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader, btnClass } from "@/components/portal/kit";
import { OfficeSearch } from "@/components/portal/office";
import { applyEmailChange, ignoreEmailChange, matchOutlookEmail } from "@/lib/email-office.functions";
import { getEmailsTab, matchEmailToJob, sendJobEmailReply, sendNoJobEmailReply, writeEmailDrafts } from "@/lib/emails-tab.functions";
import type { JobEmailCard, NoJobCard } from "@/lib/emails-tab.core";
import { EMAILS_TAB_KEY } from "@/components/portal/emails-count";
import { AI_REWRITTEN_NOTE, autoNoteText } from "@/lib/ai-email-reply.core";
import { saveStateText, useDraftAutosave, type SaveState } from "@/components/portal/use-draft-autosave";
import { ActionChecks, ALL_TICKED, NeedsNotes, PendingSaves, type ActionTicks, type PendingSave } from "@/components/portal/ai-needs-answer";

const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

type Rewritten = { status: "rewritten"; body: string; problems: string[] };

function useRun(onDone: () => void, onRewritten?: (r: Rewritten) => void) {
  const [busy, setBusy] = useState(false);
  /** `after` runs before onDone for this one action (Send of a draft with questions adds a pending save to the screen). */
  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      const r = await fn();
      // A blocked Send: nothing went out. The fixed reply goes back in the box for Jo to check; the card stays.
      if (onRewritten && (r as { status?: string } | null)?.status === "rewritten") { onRewritten(r as Rewritten); return; }
      // A matched email from someone other than the owner is filed on the job without a reply (decision 414 review).
      toast.success((r as { fromOwner?: boolean } | null)?.fromOwner === false ? `${ok} — not from the owner, so it's filed on the job with no reply` : ok);
      after?.();
      onDone();
    }
    catch (e) { console.error("Emails tab action failed", e); toast.error((e as Error)?.message && (e as Error).message.length < 200 ? (e as Error).message : "That didn't save. Try again."); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

function TheyWrote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="grid gap-1">
      <span className="text-xs text-sub">They wrote:</span>
      <p className="whitespace-pre-line rounded-[10px] bg-mist px-3 py-2 text-sm text-ink">{text.length > 700 ? `${text.slice(0, 700)}…` : text}</p>
    </div>
  );
}

function RewrittenNote({ note }: { note: Rewritten | null }) {
  if (!note) return null;
  return note.problems.length
    ? <p className="text-sm text-danger" role="alert">{note.problems.join(" ")}</p>
    : <p className="text-sm text-ink" role="status">{AI_REWRITTEN_NOTE}</p>;
}

function Reply({ body, setBody, busy, waiting, saved = "idle" }: { body: string | null; setBody: (s: string) => void; busy: boolean; waiting: boolean; saved?: SaveState }) {
  if (body === null) return <p className="text-sm text-sub">{waiting ? "AI reply is being written — check back in a minute." : "No AI reply for this one."}</p>;
  return (
    <label className="grid gap-1">
      <span className="text-xs text-sub">AI reply (edit if you like):</span>
      <textarea aria-label="Reply text" value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, body.split("\n").length + 2)} disabled={busy} className="w-full rounded-[10px] border border-line bg-paper p-2 text-sm text-ink" />
      {saveStateText(saved) && <span className={`text-xs ${saved === "failed" ? "text-danger" : "text-sub"}`} aria-live="polite">{saveStateText(saved)}</span>}
    </label>
  );
}

function JobCard({ c, onDone, onSent }: { c: JobEmailCard; onDone: () => void; onSent: (p: PendingSave) => void }) {
  const send = useServerFn(sendJobEmailReply);
  const apply = useServerFn(applyEmailChange);
  const ignore = useServerFn(ignoreEmailChange);
  const [body, setBody] = useState<string | null>(c.draft?.body ?? null);
  useEffect(() => { if (c.draft && body === null) setBody(c.draft.body); }, [c.draft, body]);
  const saved = useDraftAutosave(c.draft?.eventId ?? null, body, c.draft?.body ?? null);
  const [note, setNote] = useState<Rewritten | null>(null);
  const [ticks, setTicks] = useState<ActionTicks>(ALL_TICKED);
  const { busy, run } = useRun(onDone, (r) => { setBody(r.body); setNote(r); });
  return (
    <li className="grid gap-2 rounded-[12px] border border-line bg-paper p-3" data-testid="email-card-job">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to="/admin/jobs/$jobId" params={{ jobId: c.jobId }} className="text-sm font-semibold text-ink underline">{c.jobNumber ?? "Job"}{c.name ? ` · ${c.name}` : ""}</Link>
        <span className="text-xs text-sub">{when(c.at)}</span>
      </div>
      {c.subject && <p className="text-sm text-sub">{c.subject}</p>}
      {c.intent !== "reply" && c.label && <p className="text-sm font-semibold text-ink">{c.label}</p>}
      <TheyWrote text={c.theyWrote} />
      {c.stillOpenDecline && <p className="text-sm font-semibold text-danger">Still open — Close job or Keep open</p>}
      {c.draft && <NeedsNotes needsAnswer={c.needsAnswer} needsYou={c.needsYou} />}
      {c.draft && autoNoteText(c.auto) && <p className="text-xs text-sub" data-testid="auto-send-note">{autoNoteText(c.auto)}</p>}
      {c.sentByAi && <p className="text-sm text-sub" data-testid="sent-by-ai">Sent by AI</p>}
      {c.draftClosed && !c.draft && c.stillOpenDecline ? null : c.draftClosed && !c.draft ? <p className="text-sm text-sub">{c.sentByAi ? "The AI already replied — press Done to file it away." : "No reply needed, or it was already answered — press Done to file it away."}</p> : <Reply body={body} setBody={(t) => { setNote(null); setBody(t); }} busy={busy} saved={saved} waiting={c.intent === "reply"} />}
      {c.draft && body !== null && <ActionChecks actions={c.draft.actions} ticks={ticks} onChange={setTicks} disabled={busy} />}
      <RewrittenNote note={note} />
      <div className="grid grid-cols-2 gap-2 md:flex">
        {c.draft && body !== null && <button type="button" disabled={busy} className={btn("primary")} onClick={() => { setNote(null); const sent = body; void run(() => send({ data: { requestEventId: c.requestEventId, draftEventId: c.draft!.eventId, body, applyNote: ticks.applyNote, applyArea: ticks.applyArea } }), "Reply sent and saved on the job", c.needsAnswer.length ? () => onSent({ key: c.key, label: `Reply sent to ${c.jobNumber ?? "the job"}${c.name ? ` · ${c.name}` : ""}.`, questions: c.needsAnswer, sentBody: sent }) : undefined); }}>{busy ? "Working…" : "Send"}</button>}
        {c.stillOpenDecline ? <>
          <button type="button" disabled={busy} className={btn(c.draft ? "secondary" : "primary")} onClick={() => void run(() => apply({ data: { eventId: c.requestEventId, close: c.intent === "reply" } }), "Job closed")}>Close job</button>
          <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => ignore({ data: { eventId: c.requestEventId } }), "Kept open")}>Keep open</button>
        </> : <>
        <button type="button" disabled={busy} className={btn(c.draft ? "secondary" : "primary")} onClick={() => void run(() => apply({ data: { eventId: c.requestEventId } }), c.action === "done" ? "Marked done" : c.intent === "cancel" ? "Job cancelled" : "Applied")}>{c.action === "done" ? "Done" : c.action === "apply" ? "Apply" : "Dealt with"}</button>
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => ignore({ data: { eventId: c.requestEventId } }), "Ignored")}>Ignore</button>
        </>}
      </div>
    </li>
  );
}

function NoJobCardView({ c, onDone }: { c: NoJobCard; onDone: () => void }) {
  const send = useServerFn(sendNoJobEmailReply);
  const matchToJob = useServerFn(matchEmailToJob);
  const notCustomer = useServerFn(matchOutlookEmail);
  const [body, setBody] = useState<string | null>(c.draft?.body ?? null);
  useEffect(() => { if (c.draft && body === null) setBody(c.draft.body); }, [c.draft, body]);
  const saved = useDraftAutosave(c.draft?.eventId ?? null, body, c.draft?.body ?? null);
  const [picking, setPicking] = useState(false);
  const { busy, run } = useRun(onDone);
  return (
    <li className="grid gap-2 rounded-[12px] border border-line bg-paper p-3" data-testid="email-card-nojob">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{c.fromName ? `${c.fromName} · ` : ""}{c.from ?? "Unknown sender"}</span>
        <span className="text-xs text-sub">{when(c.at)}</span>
      </div>
      {c.subject && <p className="text-sm text-sub">{c.subject}</p>}
      <TheyWrote text={c.theyWrote} />
      {c.followUp && <p className="text-sm text-sub">They already have the website link — this reply answers their question.</p>}
      {c.nothingToAnswer
        ? <p className="text-sm text-sub">Nothing to answer.</p>
        : <Reply body={body} setBody={setBody} busy={busy} saved={saved} waiting />}
      <div className="grid grid-cols-2 gap-2 md:flex">
        {c.draft && body !== null && !c.nothingToAnswer && <button type="button" disabled={busy} className={btn("primary")} onClick={() => void run(() => send({ data: { unmatchedEventId: c.unmatchedEventId, draftEventId: c.draft!.eventId, body } }), "Reply sent")}>{busy ? "Working…" : "Send"}</button>}
        {c.guess && !picking
          ? <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => matchToJob({ data: { unmatchedEventId: c.unmatchedEventId, jobId: c.guess!.jobId } }), `Matched to ${c.guess!.jobNumber ?? "the job"}`)}>Match to {c.guess.jobNumber ?? "job"}</button>
          : null}
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => setPicking(true)}>{c.guess ? "Different job" : "Match to a job"}</button>
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => notCustomer({ data: { messageEventId: c.unmatchedEventId, jobId: null } }), "Marked not a customer")}>Not a customer</button>
      </div>
      {picking && <div className="w-full md:w-72"><OfficeSearch onPick={(j) => void run(() => matchToJob({ data: { unmatchedEventId: c.unmatchedEventId, jobId: j.id } }), `Matched to ${j.jobNumber}`)} /></div>}
    </li>
  );
}

export function EmailsScreen() {
  const load = useServerFn(getEmailsTab);
  const draft = useServerFn(writeEmailDrafts);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: EMAILS_TAB_KEY, queryFn: () => load() });
  const asked = useRef(false);
  const missing = (q.data?.withJob.some((c) => !c.draft && c.intent === "reply") ?? false) || (q.data?.noJob.some((c) => !c.draft) ?? false);
  // Missing AI replies are written a few at a time in the background, then the list refreshes.
  useEffect(() => {
    if (!missing || asked.current) return;
    asked.current = true;
    void draft().then((r) => { asked.current = false; if (r.drafted > 0) void qc.invalidateQueries({ queryKey: EMAILS_TAB_KEY }); }).catch((e) => { console.error("AI drafts not written", e); });
  }, [missing, draft, qc, q.dataUpdatedAt]);
  const refresh = () => void qc.invalidateQueries({ queryKey: EMAILS_TAB_KEY });
  // Sent replies to questions the AI couldn't answer, waiting for "Save as a standard answer?" — screen state, so a refetch can't lose them.
  const [pendingSaves, setPendingSaves] = useState<PendingSave[]>([]);
  const addPendingSave = (p: PendingSave) => setPendingSaves((xs) => [...xs.filter((x) => x.key !== p.key), p]);
  const removePendingSave = (key: string) => setPendingSaves((xs) => xs.filter((x) => x.key !== key));
  const t = q.data;
  return (
    <div className="mx-auto grid max-w-[880px] gap-6 px-4 py-6 sm:px-8">
      <PageHeader title="Emails" sub="Owner emails and emails with no job yet. Nothing sends until you press Send." actions={<Link to="/admin/ai-answers" className={btn("secondary")}>AI answers</Link>} />
      <PendingSaves items={pendingSaves} onRemove={removePendingSave} />
      {q.isLoading && <p className="text-sm text-sub">Loading…</p>}
      {q.isError && <p className="text-sm text-sub">Emails couldn't load. Refresh to try again.</p>}
      {t && (
        <>
          <section className="grid gap-3" aria-label="Has a job">
            <h2 className="text-base font-semibold text-ink">Has a job ({t.withJob.length})</h2>
            {t.withJob.length === 0 ? <p className="text-sm text-sub">No owner emails waiting.</p>
              : <ul className="grid gap-3">{t.withJob.map((c) => <JobCard key={c.key} c={c} onDone={refresh} onSent={addPendingSave} />)}</ul>}
          </section>
          <section className="grid gap-3" aria-label="No job yet">
            <h2 className="text-base font-semibold text-ink">No job yet ({t.noJob.length})</h2>
            {t.noJob.length === 0 ? <p className="text-sm text-sub">No emails waiting to be matched.</p>
              : <ul className="grid gap-3">{t.noJob.map((c) => <NoJobCardView key={c.key} c={c} onDone={refresh} />)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
