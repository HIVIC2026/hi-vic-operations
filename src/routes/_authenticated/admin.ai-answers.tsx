import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, Field, PageHeader, Panel, fieldInput } from "@/components/portal/kit";
import { Switch } from "@/components/ui/switch";
import { useAction, useMe } from "@/hooks/use-me";
import { getAutoSendState, listAiAnswers, removeAiAnswer, saveAiAnswer, switchAutoSend, type AiAnswerRow } from "@/lib/ai-answers.functions";

// Jo's standard answers for AI replies (Jo 29 Oct 2026). Office only.
export const Route = createFileRoute("/_authenticated/admin/ai-answers")({
  head: () => ({ meta: [{ title: "AI answers — Home Insulation Victoria Office" }, { name: "description", content: "The standard answers the AI uses when it writes replies." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AiAnswersPage,
});

function AiAnswersPage() {
  const me = useMe();
  if (me.isLoading) return <AppShell><p className="text-sm text-sub">Loading…</p></AppShell>;
  if (!me.data?.roles.includes("admin")) return <AppShell><h1 className="text-2xl font-bold">Not available</h1><p className="text-sm text-sub">This page is for office staff only.</p></AppShell>;
  return <AppShell><AiAnswersOffice /></AppShell>;
}

type Draft = { id?: string | undefined; topic: string; answer: string; active: boolean };
const EMPTY: Draft = { topic: "", answer: "", active: true };

function AiAnswersOffice() {
  const load = useServerFn(listAiAnswers);
  const q = useQuery({ queryKey: ["ai-answers"], queryFn: () => load() });
  const saveNow = useAction(saveAiAnswer);
  const removeNow = useAction(removeAiAnswer);
  // One change at a time: two quick first saves on an empty table could both copy the starting answers in.
  const [busy, setBusy] = useState(false);
  const once = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => { if (busy) return undefined; setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  const save = (d: Parameters<typeof saveNow>[0], ok?: string) => once(() => saveNow(d, ok));
  const remove = (d: Parameters<typeof removeNow>[0], ok?: string) => once(() => removeNow(d, ok));
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const available = q.data?.available ?? false;
  const valid = draft.topic.trim().length >= 2 && draft.topic.trim().length <= 80 && draft.answer.trim().length >= 2 && draft.answer.trim().length <= 2000;
  const submit = async () => {
    const r = await save({ id: draft.id, topic: draft.topic, answer: draft.answer, active: draft.active }, draft.id ? "Answer saved" : "Answer added");
    if (r) setDraft(EMPTY);
  };
  return (
    <div className="mx-auto grid max-w-[880px] gap-4 px-4 py-6 sm:px-8">
      <PageHeader title="AI answers" sub="The AI uses these when it writes replies. Changes apply to the next reply." />
      <AutoSendSection />
      {q.isLoading && <p className="text-sm text-sub">Loading…</p>}
      {q.isError && <p className="text-sm text-sub">The answers couldn't load. Refresh to try again.</p>}
      {q.data && !available && <div role="alert" className="rounded-[13px] border border-warning bg-warning-soft p-3 text-sm">Waiting for the database change — these are the starting answers and can't be edited yet.</div>}
      <section className="grid gap-3" aria-label="Answers">
        {(q.data?.answers ?? []).map((a: AiAnswerRow, i) => (
          <Panel key={a.id ?? `seed-${i}`}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <h2 className="min-w-0 text-base font-semibold text-ink">{a.topic}</h2>
              {available && a.id && (
                <label className="flex items-center gap-2 text-xs text-sub">
                  <span>{a.active ? "On" : "Off"}</span>
                  <Switch disabled={busy} checked={a.active} aria-label={`${a.topic} on or off`} onCheckedChange={(on) => void save({ id: a.id, topic: a.topic, answer: a.answer, active: on })} />
                </label>
              )}
            </div>
            <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${a.active ? "text-ink" : "text-sub"}`}>{a.answer}</p>
            {available && a.id && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn tone="secondary" disabled={busy} onClick={() => { setDraft({ id: a.id, topic: a.topic, answer: a.answer, active: a.active }); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }}>Edit</Btn>
                <Btn tone="secondary" disabled={busy} onClick={() => { if (window.confirm(`Remove "${a.topic}"?`)) void remove({ id: a.id! }, "Answer removed"); }}>Remove</Btn>
              </div>
            )}
          </Panel>
        ))}
      </section>
      <Panel title={draft.id ? "Edit answer" : "Add an answer"}>
        <div className="grid gap-3">
          <Field label="Topic" htmlFor="ai-topic" hint="A short name, up to 80 letters."><input id="ai-topic" className={fieldInput} maxLength={80} disabled={!available} value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} /></Field>
          <Field label="Answer" htmlFor="ai-answer" hint="What the AI should say about it."><textarea id="ai-answer" className={fieldInput} rows={5} maxLength={2000} disabled={!available} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2">
            <Btn disabled={busy || !available || !valid} onClick={() => void submit()}>{busy ? "Saving…" : draft.id ? "Save answer" : "Add answer"}</Btn>
            {draft.id && <Btn tone="secondary" onClick={() => setDraft(EMPTY)}>Cancel</Btn>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

const SAMPLE_STATE: Record<string, string> = { sent_as_is: "Sent as it was", sent_edited: "Sent after you edited it", edited: "You edited it", discarded: "Discarded", waiting: "Waiting" };
const KIND_LABEL: Record<string, string> = { job_status: "Where's my job up to", resend_link: "Resend a link", files_received: "Photos received" };

function AutoSendSection() {
  const load = useServerFn(getAutoSendState);
  const q = useQuery({ queryKey: ["ai-auto-send"], queryFn: () => load() });
  const switchNow = useAction(switchAutoSend);
  const [saving, setSaving] = useState(false);
  const change = async (on: boolean) => { if (saving) return; setSaving(true); try { await switchNow({ on }, on ? "Auto-send is on" : "Auto-send is off"); } finally { setSaving(false); } };
  const samples = q.data?.samples ?? [];
  const needed = q.data?.needed ?? 10;
  return (
    <Panel title="Let simple replies send themselves">
      <p className="text-sm text-ink">Only &ldquo;where&rsquo;s my job up to&rdquo;, &ldquo;resend a link&rdquo; and &ldquo;photos received&rdquo; replies send themselves, and never between 8pm and 7am. Anything else stays for you.</p>
      {q.isLoading && <p className="mt-2 text-sm text-sub">Loading…</p>}
      {q.isError && <p className="mt-2 text-sm text-sub">This couldn't load. Refresh to try again.</p>}
      {q.data && (
        <div className="mt-3 grid gap-3">
          {q.data.on && <p className="text-sm font-semibold text-ink">Auto-send is ON</p>}
          {samples.length > 0 && (
            <ul className="grid gap-2" aria-label="Sample replies">
              {samples.map((s) => (
                <li key={s.eventId} className="rounded-[13px] border border-line p-3">
                  <p className="text-xs text-sub">{[KIND_LABEL[s.kind] ?? s.kind, s.ownerFirstName, s.jobNumber ? `Job ${s.jobNumber}` : null, SAMPLE_STATE[s.state]].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{s.body}</p>
                </li>
              ))}
            </ul>
          )}
          {q.data.on ? (
            <div><Btn tone="secondary" disabled={saving} onClick={() => void change(false)}>{saving ? "Saving…" : "Turn off"}</Btn></div>
          ) : samples.length >= needed ? (
            <div><Btn disabled={saving} onClick={() => { if (window.confirm("Turn on? Simple replies will send without you.")) void change(true); }}>{saving ? "Saving…" : "Turn on auto-send"}</Btn></div>
          ) : (
            <p className="text-sm text-sub">Auto-send can be turned on once there are {needed} sample replies to check ({samples.length} so far).</p>
          )}
        </div>
      )}
    </Panel>
  );
}
