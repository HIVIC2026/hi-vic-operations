// STEP 56: Office review of a Save my spot email whose delivery outcome is unknown. The portal never resends it on its
// own; the Office checks the email service and records what it shows. Recording never sends anything.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { resolveSaveSpotOutcomeFn } from "@/lib/save-spot-delivery.functions";
import { DELIVERED_HELP, NOT_DELIVERED_HELP, RESOLUTION_LABEL, RESOLVE_NOTE_MIN, SEND_KIND_LABEL, type SaveSpotResolution, type SendKind } from "@/lib/save-spot-delivery.core";

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "an unknown time";
type Unknown = { sendId: string; at: string | null; detail: string | null; kind: SendKind };
const help = (o: SaveSpotResolution, kind: SendKind) => o === "delivered" ? DELIVERED_HELP : NOT_DELIVERED_HELP[kind];

export function SaveSpotOutcomeResolve({ jobId, jobNumber, unknown, onDone }: { jobId: string; jobNumber: string | null; unknown: Unknown; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 space-y-1" data-save-spot-outcome-unknown>
      <p className="text-xs font-semibold text-destructive">{SEND_KIND_LABEL[unknown.kind]}: outcome unknown (attempted {when(unknown.at)}). Not resent automatically.</p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Resolve email outcome</Button>
      {open && <ResolveDialog jobId={jobId} jobNumber={jobNumber} unknown={unknown} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />}
    </div>
  );
}

function ResolveDialog({ jobId, jobNumber, unknown, onClose, onDone }: { jobId: string; jobNumber: string | null; unknown: Unknown; onClose: () => void; onDone: () => void }) {
  const resolve = useServerFn(resolveSaveSpotOutcomeFn);
  const [choice, setChoice] = useState<SaveSpotResolution | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSave = !!choice && note.trim().length >= RESOLVE_NOTE_MIN && !busy;
  const save = async () => {
    if (!choice) return;
    setBusy(true); setErr(null);
    try { await resolve({ data: { jobId, sendId: unknown.sendId, attemptAt: unknown.at, resolution: choice, note } }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save. Nothing changed; try again."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve email outcome{jobNumber ? ` · ${jobNumber}` : ""}</DialogTitle>
          <DialogDescription>{SEND_KIND_LABEL[unknown.kind]}, attempted {when(unknown.at)}: the portal didn’t get a clear answer from the email service, so it may or may not have reached the owner. Check the email service for this address and time first. Saving here never sends anything.</DialogDescription>
        </DialogHeader>
        {unknown.detail && <p className="min-w-0 rounded-md border bg-muted/30 p-2 text-xs [overflow-wrap:anywhere]">Last recorded: {unknown.detail}</p>}
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-semibold">What does the email service show?</legend>
          {(["delivered", "not_delivered"] as const).map((o) => (
            <label key={o} className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
              <input type="radio" name={`save-spot-outcome-${jobId}`} value={o} checked={choice === o} onChange={() => { setChoice(o); setErr(null); }} className="mt-1" />
              <span><span className="font-semibold">{RESOLUTION_LABEL[o]}</span><span className="block text-xs text-muted-foreground">{help(o, unknown.kind)}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="space-y-1 text-sm">
          <label htmlFor={`save-spot-outcome-note-${jobId}`} className="font-semibold">What did you check? (required)</label>
          <Textarea id={`save-spot-outcome-note-${jobId}`} value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Resend shows delivered 12 Oct 10:41" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Save resolution"}</Button>
          {err && <span role="alert" className="text-sm text-destructive">{err}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
