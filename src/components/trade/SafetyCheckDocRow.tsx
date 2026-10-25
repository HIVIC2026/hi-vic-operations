// Decision 317: the electrician's "Safety check (PIESA)" document row on /field/{jobId}. Presentation only: the row and
// the PDF come through trade-view.functions (electricians only, business-scoped); the PDF arrives as bytes and opens
// from a local blob — no public URL. Nothing shows until the official PIESA exists.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/trade/trade-ui";
import { getTradeSafetyCheckDoc, getTradeSafetyCheckPdf } from "@/lib/trade-view.functions";

export function SafetyCheckDocRow({ jobId }: { jobId: string }) {
  const load = useServerFn(getTradeSafetyCheckDoc);
  const pdf = useServerFn(getTradeSafetyCheckPdf);
  const { data } = useQuery({ queryKey: ["trade-safety-check-doc", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 60_000 });
  const [busy, setBusy] = useState(false);
  if (!data?.show) return null;
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
    <div data-safety-check-doc>
      <Section title="Documents">
        <button type="button" disabled={busy} onClick={() => void open()} className="flex min-h-11 w-full items-center gap-3 text-left">
          <FileText className="h-5 w-5 shrink-0 text-hiv-blue" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-bold">{data.title}</span>
            <span className="block text-xs text-sub">{busy ? "Opening…" : data.line}</span>
          </span>
        </button>
      </Section>
    </div>
  );
}
