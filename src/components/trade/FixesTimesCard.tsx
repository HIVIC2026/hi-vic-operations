// Decision 315: the electrician picks 3–5 electrical fixes times + estimated hours on their job page (the text links to
// /field/{jobId}#fixes-times). Presentation only: reads and saves through trade-view.functions (electricians only,
// business-scoped); the fields are the same RectPlanFields the old portal PIESA submit used.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { RectPlanFields, rectPlanProblems, type RectPlan } from "@/components/portal/rectification-times";
import { Button, Section } from "@/components/trade/trade-ui";
import { useAction } from "@/hooks/use-me";
import { getTradeFixesTimes, saveTradeFixesTimes } from "@/lib/trade-view.functions";
import { FIXES_TIMES_ANCHOR } from "@/lib/fixes-times.core";
import { formatPiesaWindow } from "@/lib/piesa-windows.core";

export function useTradeFixesTimes(jobId: string) {
  const load = useServerFn(getTradeFixesTimes);
  return useQuery({ queryKey: ["trade-fixes-times", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
}

export function FixesTimesCard({ jobId }: { jobId: string }) {
  const { data } = useTradeFixesTimes(jobId);
  const save = useAction(saveTradeFixesTimes, { refresh: { jobId } });
  const [plan, setPlan] = useState<RectPlan>({ hours: "", picks: [] });
  const [busy, setBusy] = useState(false);
  // The text link opens on this card: scroll to it once it has drawn.
  useEffect(() => {
    if (!data?.show || typeof window === "undefined" || window.location.hash !== `#${FIXES_TIMES_ANCHOR}`) return;
    document.getElementById(FIXES_TIMES_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [data?.show]);
  if (!data?.show) return null;
  return (
    <div id={FIXES_TIMES_ANCHOR} className="scroll-mt-4" data-fixes-times>
      <Section title="Electrical fixes times">
        {data.given ? (
          <>
            <p className="text-sm text-sub">Thanks — the owner picks one of these when they approve the fixes quote.</p>
            <ul className="mt-2 space-y-1 text-sm">{data.windows.map((w) => <li key={w.starts_at}>{formatPiesaWindow(w.starts_at, w.ends_at)}{w.status === "accepted" ? " · picked by the owner" : w.status === "proposed" ? "" : " · closed"}</li>)}</ul>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-sub">The safety check needs electrical fixes. Pick 3 to 5 times you can do the work and how long it will take.</p>
            <RectPlanFields value={plan} onChange={setPlan} />
            <Button size="field" className="mt-3 w-full" disabled={busy || rectPlanProblems(plan).length > 0} onClick={async () => {
              setBusy(true);
              try { await save({ jobId, hours: Number(plan.hours), windows: plan.picks }, "Fixes times sent"); } finally { setBusy(false); }
            }}><Check /> {busy ? "Saving…" : "Send my fixes times"}</Button>
          </>
        )}
      </Section>
    </div>
  );
}
