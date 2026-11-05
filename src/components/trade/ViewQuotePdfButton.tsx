// Photo-quote installers Part 2 (Jo 5 Nov 2026): "View quote (PDF)" on the installer's OWN customer — the exact quote the
// owner gets, with both logos. Shown only when the page says so; the server refuses it everywhere else.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOwnQuotePdf } from "@/lib/trade-view.functions";
import { OWN_PHOTO_QUOTE_WORDS } from "@/lib/own-photo-quote.core";

export function ViewQuotePdfButton({ jobId, className = "" }: { jobId: string; className?: string }) {
  const load = useServerFn(getOwnQuotePdf);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true); setError("");
    try {
      const r = await load({ data: { jobId } });
      const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = r.fileName; a.target = "_blank"; a.rel = "noreferrer"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't open the quote."); }
    finally { setBusy(false); }
  };
  return (
    <div className={className} data-view-quote-pdf>
      <button type="button" className="min-h-12 rounded-[12px] border-2 border-hiv-blue px-4 text-[15px] font-bold text-hiv-blue disabled:opacity-50" disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : OWN_PHOTO_QUOTE_WORDS.viewQuote}</button>
      {error && <p role="alert" className="mt-1 text-sm text-rose">{error}</p>}
    </div>
  );
}
