import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type Open = { url: string; title?: string | undefined };
const listeners = new Set<(f: Open) => void>();

/** Show an uploaded document inside the portal (PDF/image preview + Download). Links are app-domain only. */
export function openFileViewer(url: string | null | undefined, title?: string) {
  if (!url) return;
  listeners.forEach((l) => l({ url, title }));
}

const kindOf = (url: string) => {
  const ext = decodeURIComponent(url.split("?")[0]!.split("/").pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  return "other";
};

export function FileViewerHost() {
  const [f, setF] = useState<Open | null>(null);
  useEffect(() => { const l = (x: Open) => setF(x); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (!f) return null;
  const kind = kindOf(f.url);
  const name = decodeURIComponent(f.url.split("?")[0]!.split("/").pop() ?? "document");
  const dl = `${f.url}${f.url.includes("?") ? "&" : "?"}download=1`;
  return (
    <Dialog open onOpenChange={(o) => !o && setF(null)}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-3">
        <DialogHeader><DialogTitle className="truncate pr-8">{f.title ?? name}</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted">
          {kind === "pdf" && <iframe title={f.title ?? name} src={f.url} className="h-full w-full rounded-md" />}
          {kind === "image" && <img src={f.url} alt={f.title ?? name} className="mx-auto max-h-full object-contain" />}
          {kind === "video" && <video src={f.url} controls playsInline preload="metadata" className="mx-auto max-h-full" />}
          {kind === "other" && <p className="p-6 text-sm">This file can't be previewed here. Use Download to open it.</p>}
        </div>
        <div className="flex justify-end">
          <Button asChild><a href={dl} download={name}><Download className="h-4 w-4" /> Download</a></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
