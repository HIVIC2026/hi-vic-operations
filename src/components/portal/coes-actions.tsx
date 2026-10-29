// A48 batch 1 task 5: Needs me "Check electrical certificate — {why}" row actions. Open the job to see the certificate,
// then Tick (it covers the ceiling-space repairs) or Reject (with a short note; the install stays blocked). Office only.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { btnClass } from "@/components/portal/kit";
import { rejectCoes, tickCoes } from "@/lib/coes-check.functions";
import type { NeedsRow } from "@/lib/office-needs.core";

const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");

export function CoesActions({ row, onDone }: { row: NeedsRow; onDone: () => void }) {
  const tick = useServerFn(tickCoes);
  const reject = useServerFn(rejectCoes);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onDone(); }
    catch (e) { console.error("Needs me certificate action failed", e); toast.error(e instanceof Error && /newer certificate|already ticked|no longer needs/.test(e.message) ? e.message : "That didn't save. Try again, or open the job."); }
    finally { setBusy(false); }
  };
  if (!row.eventId) return null;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 md:flex">
        {row.jobId && <Link to="/admin/jobs/$jobId" params={{ jobId: row.jobId }} hash="stage-piesa" className={btn("secondary")}>Open job</Link>}
        <button type="button" disabled={busy} className={btn("primary")} onClick={() => void run(() => tick({ data: { eventId: row.eventId! } }), "Certificate ticked")}>{busy ? "Saving…" : "Tick"}</button>
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => setRejecting(!rejecting)}>Reject</button>
      </div>
      {rejecting && (
        <div className="grid gap-2 md:flex md:items-center">
          <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional)" aria-label="Why the certificate is rejected" className="min-h-11 w-full rounded-lg border border-line px-3 text-sm md:w-72" />
          <button type="button" disabled={busy} className={btn("primary")} onClick={() => void run(() => reject({ data: { eventId: row.eventId!, note } }), "Certificate rejected")}>Reject certificate</button>
        </div>
      )}
    </div>
  );
}
