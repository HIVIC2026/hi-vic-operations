import { Suspense, lazy, useEffect, useState } from "react";
import type { FileViewerOpen } from "./file-viewer-dialog";

type Open = FileViewerOpen;
const listeners = new Set<(f: Open) => void>();

/** Show an uploaded document inside the portal (PDF/image preview + Download). Links are app-domain only. */
export function openFileViewer(url: string | null | undefined, title?: string) {
  if (!url) return;
  listeners.forEach((l) => l({ url, title }));
}

// Decision 280 (speed): the dialog code loads the first time a file is opened, not with every page. The listener is
// registered at mount as before, so no open request is missed; the viewer simply appears once its code has arrived.
const FileViewerDialog = lazy(() => import("./file-viewer-dialog"));

export function FileViewerHost() {
  const [f, setF] = useState<Open | null>(null);
  useEffect(() => { const l = (x: Open) => setF(x); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (!f) return null;
  return (
    <Suspense fallback={null}>
      <FileViewerDialog f={f} onClose={() => setF(null)} />
    </Suspense>
  );
}
