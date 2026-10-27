// Every page of a PDF drawn as pictures, fitted to the box width (Jo 27 Oct 2026: on iPhone a PDF inside the viewer
// showed only its first page, cut off on the right — Safari's built-in PDF box can't scroll through pages).
// Mozilla's pdf.js (legacy build: works on older iPhones too), loaded only when a PDF is opened.
import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export default function PdfPages({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    const holder = box.current;
    if (!holder) return;
    holder.replaceChildren();
    setState("loading");
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ url }).promise;
      const width = holder.clientWidth || 360;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        const scale = width / page.getViewport({ scale: 1 }).width;
        const view = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(view.width);
        canvas.height = Math.floor(view.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.className = "block bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${title}, page ${n} of ${doc.numPages}`);
        holder.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: view }).promise;
        if (n === 1 && !cancelled) setState("ready");
      }
    })().catch((e) => { console.warn("PDF preview failed", e); if (!cancelled) setState("failed"); });
    return () => { cancelled = true; };
  }, [url, title]);

  return (
    <div className="flex flex-col gap-3 p-2">
      {state === "loading" && <p className="p-4 text-sm text-muted-foreground">Loading the report…</p>}
      {state === "failed" && <p className="p-4 text-sm">This file couldn't be shown here. Use Download to open it.</p>}
      <div ref={box} className="flex flex-col gap-3" />
    </div>
  );
}
