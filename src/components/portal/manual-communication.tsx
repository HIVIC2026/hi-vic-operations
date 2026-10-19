// A1 manual customer communication (STEP 17). Office prepares the approved email, copies it into their own mailbox,
// then separately records what happened. Copying is browser-only (no server call, no send record) and nothing here
// sends email/SMS or marks "Save my spot".
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pill } from "@/components/portal/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getManualCommunicationHistoryFn, prepareManualEmailFn, recordManualCommunicationFn } from "@/lib/manual-communication.functions";
import { MANUAL_NEXT_LABEL, MANUAL_OUTCOME_LABEL, MANUAL_OUTCOME_ORDER, planManualRecord, previewDisplayText, type AssumedSizeEstimate, type ManualLeadView, type ManualOutcome, type PreparedApprovedEmail } from "@/lib/manual-communication.core";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const OUTCOME_HELP: Record<ManualOutcome, string> = {
  sent_manually: "You sent the approved email from your own mailbox.",
  phoned: "You spoke to the owner by phone.",
  not_sent: "You decided not to send it – say why.",
  followup_required: "Something still needs doing – say what and when.",
};

/** Browser clipboard only. With html, puts formatted + plain text on the clipboard so it pastes formatted into an email. */
async function copyToClipboard(text: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function usePreparedEmail(jobId: string, enabled = true) {
  const prepare = useServerFn(prepareManualEmailFn);
  return useQuery({ queryKey: ["manual-email", jobId], queryFn: () => prepare({ data: { jobId } }), enabled, staleTime: 60_000, refetchOnWindowFocus: false, retry: false });
}

/** Latest Office-recorded outcome on a lead (STEP 32). Follow-up required is shown as the pending next action;
 *  phone/not sent never hide the outstanding email action, which stays in the row's main text. */
export function ManualLeadNote({ m }: { m: ManualLeadView }) {
  if (!m.latest) return null;
  const pending = m.latest.kind === "followup_pending";
  // Keep manual-send provenance visible even when a later phone/follow-up record is the latest one.
  const sentAt = m.latest.kind === "sent_manually" ? null : [m.saveSpotSentAt, m.ineligibleSentAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return (
    <>
      {sentAt && <div data-manual-note="sent_manually" className="mt-1 text-xs text-muted-foreground">{MANUAL_NEXT_LABEL.sent_manually} · {when(sentAt)}</div>}
      <div data-manual-note={m.latest.kind} className={pending ? "mt-1 rounded-md border border-warning/40 bg-warning/5 p-1.5 text-xs font-semibold" : "mt-1 text-xs text-muted-foreground"}>
        {MANUAL_NEXT_LABEL[m.latest.kind]} · {when(m.latest.at)}{m.latest.note ? `: ${m.latest.note}` : ""}
      </div>
    </>
  );
}

/** Two separate Office actions for one lead: prepare/copy the approved email, and record the outcome. */
export function ManualCommunicationActions({ jobId, jobNumber }: { jobId: string; jobNumber: string | null }) {
  const [open, setOpen] = useState<"prepare" | "record" | null>(null);
  // The email Office actually saw and copied; "Sent manually" records exactly this, even if the lead changes afterwards.
  const [copiedEmail, setCopiedEmail] = useState<PreparedApprovedEmail | null>(null);
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpen("prepare")}>Prepare email to copy</Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("record")}>Record communication outcome</Button>
      {open === "prepare" && <PrepareEmailDialog jobId={jobId} jobNumber={jobNumber} onClose={() => setOpen(null)} onRecord={() => setOpen("record")} onPrepared={setCopiedEmail} />}
      {open === "record" && <RecordOutcomeDialog jobId={jobId} jobNumber={jobNumber} prepared={copiedEmail} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CopyRow({ label, value, copyLabel, onCopy }: { label: string; value: string; copyLabel: string; onCopy: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
      <div className="min-w-0"><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="font-medium [overflow-wrap:anywhere]">{value}</div></div>
      <Button size="sm" variant="outline" onClick={onCopy}>{copyLabel}</Button>
    </div>
  );
}

/** Missing ceiling size: Office-only figures on the clearly labelled assumption. No copy action – it is not an email. */
function InternalEstimate({ e }: { e: AssumedSizeEstimate }) {
  return (
    <section data-internal-estimate aria-label="Internal indicative estimate" className="space-y-2 rounded-md border border-info/40 bg-info/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Internal indicative estimate · office use only</h3><Pill t="warn">Assumed size – not verified</Pill></div>
      <p className="font-semibold">{e.areaLabel}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>Estimated VEU rebate</dt><dd className="font-semibold">{money(e.rebate)}</dd>
        <dt>Estimated cost after rebate</dt><dd className="font-semibold">{money(e.estimatedCost)}</dd>
        <dt>Before rebate</dt><dd>{money(e.grossBeforeRebate)} <span className="text-xs text-muted-foreground">(installation {money(e.installation)} · assessment {money(e.assessmentFee)} · AP management {money(e.apFee)}, incl. GST)</span></dd>
      </dl>
      <p className="text-xs text-muted-foreground">{e.assumption}</p>
    </section>
  );
}

function PrepareEmailDialog({ jobId, jobNumber, onClose, onRecord, onPrepared }: { jobId: string; jobNumber: string | null; onClose: () => void; onRecord: () => void; onPrepared: (e: PreparedApprovedEmail) => void }) {
  const { data, isLoading, error, refetch } = usePreparedEmail(jobId);
  // Only an email with its real links can be recorded as "Sent manually".
  useEffect(() => { if (data?.ok && data.linksReady) onPrepared(data); }, [data, onPrepared]);
  const prepare = useServerFn(prepareManualEmailFn);
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const issueLinks = async () => {
    setIssuing(true);
    setIssueError(null);
    try { qc.setQueryData(["manual-email", jobId], await prepare({ data: { jobId, issueLinks: true } })); }
    catch (e) { setIssueError(e instanceof Error ? e.message : "Could not create the sending links. Try again."); }
    finally { setIssuing(false); }
  };
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string, html?: string) => setCopied((await copyToClipboard(text, html)) ? `${what} copied.` : "Copy failed – select the text and copy it yourself.");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prepare email to send yourself{jobNumber ? ` · ${jobNumber}` : ""}</DialogTitle>
          <DialogDescription>Nothing is sent from the portal. Copy the approved subject and body into your own email, send it, then record the outcome. Copying never creates a send record.</DialogDescription>
        </DialogHeader>
        {isLoading ? <p role="status" className="text-sm">Preparing the approved email…</p>
          : error || !data ? <div role="alert" className="text-sm text-destructive">Could not prepare the email. <Button variant="link" size="sm" onClick={() => refetch()}>Try again</Button></div>
          : !data.ok ? (
            <div className="min-w-0 space-y-3">
              <div role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"><strong>No email to copy.</strong> {data.reason}</div>
              {data.internalEstimate && <InternalEstimate e={data.internalEstimate} />}
            </div>
          )
          : (
            <div className="min-w-0 space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill t="good">Approved wording</Pill><span>{data.templateLabel}</span></div>
              {data.notices.map((n) => <p key={n} role="status" className="rounded-md border border-warning/40 bg-warning/5 p-2">{n}</p>)}
              {!data.linksReady && (
                <div role="status" data-links-pending className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                  <p><strong>Preview only.</strong> This lead has no unsubscribe or referral link yet, so those links show as “[link created before sending]” and the body can't be copied. Opening the preview created nothing.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={issuing} onClick={issueLinks}>{issuing ? "Creating links…" : "Create sending links"}</Button>
                    <span className="text-xs text-muted-foreground">Issues the lead's own links only. Sends nothing and records nothing.</span>
                  </div>
                  {issueError && <p role="alert" className="text-destructive">{issueError}</p>}
                </div>
              )}
              <CopyRow label="To" value={data.to} copyLabel="Copy recipient" onCopy={() => copy("Recipient", data.to)} />
              <CopyRow label="Subject" value={data.subject} copyLabel="Copy subject" onCopy={() => copy("Subject", data.subject)} />
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Full email body</span>
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!data.linksReady} onClick={() => copy("Email body (formatted)", data.plainText, data.html)}>Copy email body</Button>
                    <Button size="sm" variant="outline" disabled={!data.linksReady} onClick={() => copy("Email body (plain text)", data.plainText)}>Copy as plain text</Button>
                  </span>
                </div>
                {/* Without its links the body is shown with plain markers (never a fake link) and the designed view is withheld. */}
                <pre aria-label="Full email body" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm [overflow-wrap:anywhere]">{data.linksReady ? data.plainText : previewDisplayText(data.plainText)}</pre>
              </div>
              {data.linksReady && (
                <details>
                  <summary className="cursor-pointer font-semibold">How the email looks</summary>
                  <iframe title="Approved email preview" sandbox="" srcDoc={data.html} className="mt-2 h-[60vh] w-full rounded-md border bg-background" />
                </details>
              )}
              {copied && <p role="status" className="font-semibold">{copied}</p>}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>Sent it, phoned instead, or decided not to send?</span>
          <Button size="sm" variant="outline" onClick={onRecord}>Record communication outcome</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordOutcomeDialog({ jobId, jobNumber, prepared, onClose }: { jobId: string; jobNumber: string | null; prepared: PreparedApprovedEmail | null; onClose: () => void }) {
  const record = useServerFn(recordManualCommunicationFn);
  const loadHistory = useServerFn(getManualCommunicationHistoryFn);
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["manual-comms", jobId], queryFn: () => loadHistory({ data: { jobId } }), refetchOnWindowFocus: false });
  const [outcome, setOutcome] = useState<ManualOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const needsEmail = outcome ? planManualRecord(outcome).needsApprovedEmail : false;
  const fetched = usePreparedEmail(jobId, needsEmail && !prepared);
  // Only the approved email with its real links (never preview placeholders) can be recorded as sent.
  const email = prepared ?? (fetched.data?.ok && fetched.data.linksReady ? fetched.data : null);
  const canSave = !!outcome && !busy && (needsEmail ? !!email : note.trim().length >= 3);
  const save = async () => {
    if (!outcome || !canSave) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await record({ data: needsEmail && email ? { jobId, outcome, template: email.template, subject: email.subject, body: email.plainText } : { jobId, outcome, note } });
      setMsg({ ok: true, text: `Recorded “${r.label}” against ${r.jobNumber ?? "this job"} at ${when(r.recordedAt)}. Manual record only – the portal sent nothing.` });
      setOutcome(null);
      setNote("");
      // Leads status follows recorded outcomes (STEP 32), so refresh the list as well as this lead.
      await Promise.all([qc.invalidateQueries({ queryKey: ["manual-comms", jobId] }), qc.invalidateQueries({ queryKey: ["manual-email", jobId] }), qc.invalidateQueries({ queryKey: ["leads-one-list"] })]);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not record the outcome. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record communication outcome{jobNumber ? ` · ${jobNumber}` : ""}</DialogTitle>
          <DialogDescription>Records what you did outside the portal, with your name and the time. It never sends anything and never marks “Save my spot” – only the owner can save their spot.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-semibold">What happened?</legend>
          {MANUAL_OUTCOME_ORDER.map((o) => (
            <label key={o} className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
              <input type="radio" name={`manual-outcome-${jobId}`} value={o} checked={outcome === o} onChange={() => { setOutcome(o); setMsg(null); }} className="mt-1" />
              <span><span className="font-semibold">{MANUAL_OUTCOME_LABEL[o]}</span><span className="block text-xs text-muted-foreground">{OUTCOME_HELP[o]}</span></span>
            </label>
          ))}
        </fieldset>
        {needsEmail && (
          !email && fetched.isLoading ? <p role="status" className="text-sm">Loading the approved email…</p>
            : email ? (
              <div className="min-w-0 rounded-md border bg-muted/30 p-3 text-sm [overflow-wrap:anywhere]">
                <p>Records this approved email as sent by you to <strong>{email.to}</strong>:</p>
                <p className="mt-1 font-semibold">{email.subject}</p>
                <details className="mt-1"><summary className="cursor-pointer text-xs">Show the full body</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs [overflow-wrap:anywhere]">{email.plainText}</pre></details>
              </div>
            )
            : <p role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">“Sent manually” records the approved email you prepared here, and none is available for this lead: {fetched.data && !fetched.data.ok ? fetched.data.reason : fetched.data?.ok && !fetched.data.linksReady ? "its sending links haven't been created yet – open “Prepare email to copy”, create the links and copy it first." : "it could not be prepared."} If you already contacted the owner another way, choose “Follow-up required” and describe what happened.</p>
        )}
        {outcome && !needsEmail && (
          <div className="space-y-1 text-sm">
            <label htmlFor={`manual-note-${jobId}`} className="font-semibold">Note (required)</label>
            <Textarea id={`manual-note-${jobId}`} value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="What was said, why it wasn't sent, or what follow-up is needed and when" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canSave} onClick={save}>{busy ? "Recording…" : "Record outcome"}</Button>
          {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm font-semibold" : "text-sm text-destructive"}>{msg.text}</span>}
        </div>
        <section aria-label="Communication history" className="space-y-2 border-t pt-3 text-sm">
          <h3 className="font-semibold">Communication history</h3>
          {history.isLoading ? <p role="status">Loading…</p>
            : history.error ? <p role="alert" className="text-destructive">Could not load the history. <Button variant="link" size="sm" onClick={() => history.refetch()}>Try again</Button></p>
            : !history.data?.length ? <p className="text-muted-foreground">Nothing recorded yet.</p>
            : (
              <ul className="space-y-2">
                {history.data.map((h) => (
                  <li key={h.id} className="rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Pill t={h.manual ? "warn" : "good"}>{h.originLabel}</Pill>
                      {h.outcomeLabel && <span className="font-semibold text-foreground">{h.outcomeLabel}</span>}
                      <span>{h.channel} · {h.direction}</span><span>{when(h.at)}</span>{h.by && <span>by {h.by}</span>}
                    </div>
                    {h.subject && <div className="mt-1">{h.subject}</div>}
                    {h.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{h.note}</p>}
                  </li>
                ))}
              </ul>
            )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
