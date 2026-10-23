// Jo 23 Oct 2026 08:27 UTC: "📷 Check photos" on a Spots saved row. The office's choice only moves the
// row's rank (no email, no eligibility change — the owner already has their spot).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLeadMedia, reviewLeadMediaFn, reviewedIneligibleEmailFn } from "@/lib/enquiry-groups.functions";
import { SPOT_PHOTO_CHOICES } from "@/lib/spot-saved-rank.core";

/** Jo 23 Oct 08:51 UTC: the one photo review. Rank buttons only move the Spots saved order; nothing is emailed.
 *  "Not eligible – close" asks for a reason, closes the enquiry, and emails only if the office ticks the box. */
export function PhotoRankButtons({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const review = useServerFn(reviewLeadMediaFn);
  const ineligible = useServerFn(reviewedIneligibleEmailFn);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [emailOwner, setEmailOwner] = useState(false);
  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    try { toast.success(await f()); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the check."); }
    finally { setBusy(false); }
  };
  const pick = (outcome: (typeof SPOT_PHOTO_CHOICES)[number]["outcome"], label: string) => run(async () => { await review({ data: { jobId, outcome } }); return `${label} — rank updated. No email sent.`; });
  const close = () => run(async () => {
    await review({ data: { jobId, outcome: "over_r2", reason: reason.trim(), close: true } });
    if (!emailOwner) return "Closed — no email sent.";
    const r = await ineligible({ data: { jobId, mode: "send" } }) as { outcome?: string; detail?: string };
    return r.outcome === "sent" ? "Closed — owner emailed." : `Closed — email not sent: ${r.detail ?? r.outcome ?? "blocked"}`;
  });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {SPOT_PHOTO_CHOICES.map((c) => <Button key={c.outcome} type="button" className="h-12" variant="outline" disabled={busy} onClick={() => void pick(c.outcome, c.label)}>{c.label}</Button>)}
      </div>
      {!closing ? <Button type="button" size="sm" variant="link" className="h-9 px-0 text-destructive" disabled={busy} onClick={() => setClosing(true)}>Not eligible – close</Button> : (
        <div className="space-y-2 rounded-md border p-3">
          <label className="block text-sm font-semibold" htmlFor={`close-${jobId}`}>Reason for closing</label>
          <textarea id={`close-${jobId}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emailOwner} onChange={(e) => setEmailOwner(e.target.checked)} /> Email the owner</label>
          <div className="flex gap-2"><Button type="button" size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => void close()}>Close enquiry</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setClosing(false)}>Cancel</Button></div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Rank buttons move this job in Spots saved only. Nothing is sent to the owner.</p>
    </div>
  );
}

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
          <PhotoRankButtons jobId={jobId} onDone={() => { setOpen(false); onDone(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
