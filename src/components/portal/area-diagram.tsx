import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAreaDiagrams, regenerateAreaDiagram } from "@/lib/area-diagram.functions";
import { Button } from "@/components/ui/button";

const KEY = (jobId: string) => ["area-diagrams", jobId];

/** Office: the generated Table 4 area diagram (decision 211). The SVG is produced by the portal from recorded facts, never from user HTML. */
export function AreaDiagramCard({ jobId, kind }: { jobId: string; kind: "ready_check" | "final" }) {
  const load = useServerFn(getAreaDiagrams);
  const regen = useServerFn(regenerateAreaDiagram);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY(jobId), queryFn: () => load({ data: { jobId } }) });
  const [busy, setBusy] = useState(false);
  const d = kind === "final" ? q.data?.final : q.data?.readyCheck;
  const title = kind === "final" ? "Final installation plan (generated)" : "Upgrade area diagram (generated)";
  const run = async () => {
    setBusy(true);
    try {
      const r = await regen({ data: { jobId, kind } });
      if (r.filed) toast.success(`${title} filed — ${r.summary}`);
      else if (r.existing) toast.message("Already on file for these facts — nothing changed.");
      else toast.error(r.reason ?? "Diagram not generated.");
      await qc.invalidateQueries({ queryKey: KEY(jobId) });
    } finally { setBusy(false); }
  };
  return (
    <section className="mt-3 rounded-md border p-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-xs text-muted-foreground">Activity Guide Table 4 diagram drawn by the portal from the {kind === "final" ? "installed areas" : "measured Ready Check areas"} — filed as a PDF in the job file. {d ? `${d.summary} · generated ${d.generatedAt.slice(0, 10)}` : "Not generated yet."}</p>
        </div>
        <Button variant="outline" size="sm" disabled={busy || q.isLoading} onClick={run}>{busy ? "Drawing…" : d ? "Redraw from current facts" : "Draw now"}</Button>
      </div>
      {q.error && <p className="mt-2 text-xs text-destructive">{(q.error as Error).message}</p>}
      {d && <div className="mt-3 overflow-x-auto rounded border bg-white [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: d.svg }} />}
    </section>
  );
}
