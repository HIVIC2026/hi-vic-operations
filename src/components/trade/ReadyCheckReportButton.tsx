// Jo 5 Nov 2026 (HV-3117: "we can't see Mitti and photos"): the installer opens the portal's saved copy of the Mitti Ready
// Check report (PDF, photos included) straight from the Paperwork row — no Mitti login needed. Bytes come through
// trade-view.functions (installer business-scoped) and open from a local blob, like the PIESA document row.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getTradeReadyCheckReportPdf } from "@/lib/trade-view.functions";

export function ReadyCheckReportButton({ jobId }: { jobId: string }) {
  const pdf = useServerFn(getTradeReadyCheckReportPdf);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const w = window.open("", "_blank");
    setBusy(true);
    try {
      const r = await pdf({ data: { jobId } });
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e) { w?.close(); toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <button type="button" disabled={busy} onClick={() => void open()} className="font-semibold text-hiv-blue underline disabled:opacity-60" data-ready-check-report-pdf>
      {busy ? "Opening…" : "PDF with photos"}
    </button>
  );
}
