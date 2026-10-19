// P1-S23B — the FFS partner's minimum "what happened on site" recorder.
//
// Audience: an approved partner business admin (FFS) whose business is actively assigned to the job.
// Scope: one non-regulated progress/result line + a short note. It is INFORMATIONAL — it never
// completes an install, never records an electrical result, never moves the job stage, never
// sends anything to the homeowner. The office sees it in the job's existing audit timeline.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ClipboardList } from "lucide-react";
import { useState } from "react";
import { Button, Section } from "@/components/trade/trade-ui";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { listFfsProgress, recordFfsProgress } from "@/lib/ffs-progress.functions";
import { FFS_NOTE_MAX, FFS_RESULTS, type FfsResult } from "@/lib/ffs-progress.core";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  });

export function FfsProgressCard({ jobId }: { jobId: string }) {
  const load = useServerFn(listFfsProgress);
  const submit = useAction(recordFfsProgress);
  const { data, error } = useQuery({
    queryKey: ["ffs-progress", jobId],
    queryFn: () => load({ data: { jobId } }),
    retry: false,
  });
  const [result, setResult] = useState<FfsResult>("site_visited");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Not an FFS member of an assigned business: the server refuses, so the card stays out of the way.
  if (error || !data) return null;

  const send = async () => {
    setBusy(true);
    const ok = await submit(
      { jobId, result, note },
      "Update recorded — Home Insulation Victoria can see it on this job.",
    );
    setBusy(false);
    if (ok) setNote("");
  };

  return (
    <Section title="Record a field update">
      <p className="mb-3 text-sm text-sub">
        Tell Home Insulation Victoria what happened on site. This is a note only — it doesn't
        complete the job or sign anything off.
      </p>
      {data.canRecord ? (
        <div className="space-y-3" data-ffs-form>
          <div>
            <Label>What's the update?</Label>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {FFS_RESULTS.map((r) => (
                <Button
                  key={r.value}
                  type="button"
                  size="field"
                  variant={result === r.value ? "default" : "outline"}
                  onClick={() => setResult(r.value)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea
              className="mt-1 min-h-24"
              value={note}
              maxLength={FFS_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you checked, progress so far, or anything the office should know."
            />
            <p className="mt-1 text-xs text-sub">
              {note.length}/{FFS_NOTE_MAX}
            </p>
          </div>
          <Button size="field" className="w-full" disabled={busy || !note.trim()} onClick={send}>
            <Check /> Record update
          </Button>
        </div>
      ) : (
        <p className="text-sm text-sub">Only the business admin can add an update.</p>
      )}
      {!!data.items.length && (
        <div className="mt-4" data-ffs-history>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Your updates</p>
          <ol className="space-y-2">
            {data.items.map((i) => (
              <li
                key={i.id}
                className="rounded-[13px] border border-line bg-mist px-3 py-2 text-sm"
              >
                <p className="flex items-center gap-1 font-semibold">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {i.label}
                </p>
                {i.note && <p className="mt-1 whitespace-pre-wrap">{i.note}</p>}
                <p className="mt-1 text-xs text-sub">{when(i.at)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}
