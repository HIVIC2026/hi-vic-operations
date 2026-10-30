import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-me";
import { takeBackInHouseJob } from "@/lib/in-house-batch.functions";

export function InHousePullBackDialog({ jobId, jobNumber, open, onOpenChange }: {
  jobId: string; jobNumber: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const run = useAction(takeBackInHouseJob);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return <Dialog open={open} onOpenChange={v => { if (!saving) onOpenChange(v); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Take {jobNumber} back</DialogTitle><DialogDescription>Existing bookings stay unchanged.</DialogDescription></DialogHeader>
      <label className="text-sm font-semibold text-ink">Reason
        <Textarea aria-label="Reason for taking this job back" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} className="mt-2" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!reason.trim() || saving} onClick={async () => {
          setSaving(true);
          try { const result = await run({ jobId, reason: reason.trim() }, "Job taken back"); if (result?.ok) { setReason(""); onOpenChange(false); } }
          finally { setSaving(false); }
        }}><Undo2 />{saving ? "Saving…" : "Take this job back"}</Button>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Keep with partner</Button>
      </div>
    </DialogContent>
  </Dialog>;
}