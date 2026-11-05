import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getReadyCheckPhotos } from "@/lib/ready-check-photos.functions";
import { Panel } from "@/components/portal/kit";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Ready Check photos from the Mitti form: a thumbnail grid (2 across on a phone, more on a computer), tap to enlarge.
 *  `quietOnError` hides the card when the sign-in is not allowed to see photos (the server refuses; nothing leaks). */
export function ReadyCheckPhotos({ jobId, quietOnError = false }: { jobId: string; quietOnError?: boolean }) {
  const load = useServerFn(getReadyCheckPhotos);
  const { data, error, isLoading } = useQuery({ queryKey: ["ready-check-photos", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 60_000, refetchInterval: 240_000, retry: false });
  const [open, setOpen] = useState<number | null>(null);
  if (isLoading) return null;
  if (data?.refused) return quietOnError ? null : <Panel title="Ready Check photos"><p className="text-sm text-sub">Ready Check photos are only for the office and the installer business on this job.</p></Panel>;
  if (error) {
    return <Panel title="Ready Check photos"><p role="alert" className="text-sm text-danger">{(error as Error).message}</p></Panel>;
  }
  const photos = data?.photos ?? [];
  const current = open != null ? photos[open] : undefined;
  return (
    <Panel title={photos.length ? `Ready Check photos (${photos.length})` : "Ready Check photos"} className="mt-4" >
      {photos.length === 0 ? (
        <p className="text-sm text-sub" data-ready-check-photos-empty>No Ready Check photos yet</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-ready-check-photos>
          {photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(i)} className="block w-full overflow-hidden rounded-[12px] border border-line bg-mist" aria-label={`Enlarge ${p.label}`}>
                <img src={p.url} alt={p.label} loading="lazy" className="aspect-square w-full object-cover" />
              </button>
              <p className="mt-1 truncate text-xs text-sub">{p.label}</p>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!current} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-[95vw] p-3 sm:max-w-3xl">
          <DialogTitle className="truncate pr-6 text-sm">{current?.label}</DialogTitle>
          {current && <img src={current.url} alt={current.label} className="max-h-[75vh] w-full rounded-[10px] object-contain" />}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
