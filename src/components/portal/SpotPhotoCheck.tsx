// Jo 23 Oct 2026 08:27 UTC: "📷 Check photos" on a Spots saved row. The office's choice only moves the
// row's rank (no email, no eligibility change — the owner already has their spot).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLeadMedia, reviewLeadMediaFn } from "@/lib/enquiry-groups.functions";
import { SPOT_PHOTO_CHOICES } from "@/lib/spot-saved-rank.core";

export function SpotPhotoCheck({ jobId, owner, count, onDone }: { jobId: string; owner: string | null; count: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useServerFn(getLeadMedia);
  const review = useServerFn(reviewLeadMediaFn);
  const media = useQuery({ queryKey: ["lead-media", jobId], queryFn: () => load({ data: { jobId } }), enabled: open });
  const pick = async (outcome: (typeof SPOT_PHOTO_CHOICES)[number]["outcome"]) => {
    setBusy(true);
    try {
      await review({ data: { jobId, outcome } });
      toast.success("Photos checked — rank updated. No email sent.");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the check.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setOpen(true)}>📷 Check photos ({count})</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{owner ?? "Owner"} — photos</DialogTitle></DialogHeader>
          {media.isLoading ? <p role="status" className="text-sm">Loading photos…</p> : media.isError ? <p role="alert" className="text-sm text-destructive">Could not load the photos.</p> : (
            <div className="flex flex-wrap gap-2">
              {(media.data?.files ?? []).map((f) => f.mimeType?.startsWith("video/")
                ? <video key={f.id} controls playsInline preload="metadata" className="h-32 rounded-md border"><source src={f.url} /></video>
                : <a key={f.id} href={f.url} target="_blank" rel="noopener"><img src={f.url} alt="Owner upload" className="h-32 rounded-md border object-cover" /></a>)}
              {media.data && media.data.files.length === 0 && <p className="text-sm text-muted-foreground">No files found.</p>}
            </div>
          )}
          <div className="grid gap-2">
            {SPOT_PHOTO_CHOICES.map((c) => <Button key={c.outcome} type="button" className="h-12" variant="outline" disabled={busy} onClick={() => pick(c.outcome)}>{c.label}</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">Moves this spot's rank only. Nothing is sent to the owner.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
