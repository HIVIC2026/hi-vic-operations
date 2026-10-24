// Office build B: small dialogs reused by Money (Chase › → Log a call or note) and Partners. Presentation + calls to
// EXISTING guarded server functions only; nothing here sends a customer message or changes a payment.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Btn } from "@/components/portal/kit";
import { recordManualCommunicationFn } from "@/lib/manual-communication.functions";

/** Decision 240: an overdue invoice row offers "Chase ›", which logs a call or a note on the job's contact history. */
export function LogCallDialog({ jobId, jobNumber, context, onClose }: { jobId: string; jobNumber: string; context: string; onClose: () => void }) {
  const record = useServerFn(recordManualCommunicationFn);
  const qc = useQueryClient();
  const [kind, setKind] = useState<"phoned" | "followup_required">("phoned");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await record({ data: { jobId, outcome: kind, note: `${context}: ${note.trim()}` } });
      toast.success(kind === "phoned" ? `Call logged on ${jobNumber}` : `Note logged on ${jobNumber}`);
      await qc.invalidateQueries({ queryKey: ["money-invoices"] });
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save the note"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a call or note · {jobNumber}</DialogTitle>
          <DialogDescription>{context}. Saved on the job's contact history. Nothing is sent to the owner.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="What happened" className="flex gap-2">
          {([["phoned", "I called the owner"], ["followup_required", "Note · follow up"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-[10px] border px-3 py-2 text-sm font-semibold ${kind === k ? "border-hiv-blue bg-mist text-ink" : "border-line text-sub"}`}>{l}</button>
          ))}
        </div>
        <Textarea aria-label="What was said" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said, and what we're waiting for" />
        <DialogFooter>
          <Btn tone="secondary" onClick={onClose}>Cancel</Btn>
          <Btn disabled={busy || note.trim().length < 3} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
