// Office job page: "Choose a trade" — offer to ONE eligible trade instead of everyone. Default stays "offer to all".
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { chooseTrade, listTradeChoices, sendOfferToAll } from "@/lib/trade-choice.functions";
import { CHOICE_KIND_LABEL, type ChoiceKind } from "@/lib/trade-choice.core";

export function ChooseTradePanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ChoiceKind>("ready_check");
  const [open, setOpen] = useState(false);
  const list = useServerFn(listTradeChoices);
  const pick = useServerFn(chooseTrade);
  const toAll = useServerFn(sendOfferToAll);
  const q = useQuery({ queryKey: ["trade-choices", jobId, kind], queryFn: () => list({ data: { jobId, kind } }), enabled: open });
  const run = async (f: () => Promise<unknown>, ok: string) => {
    try { await f(); toast.success(ok); void qc.invalidateQueries(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
  };
  const trade = kind === "ready_check" ? "installer" : "electrician";
  return (
    <div id="choose-trade">
      <Section title="Choose a trade">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Normally the offer goes to every eligible {trade}. Pick one here to send it only to them — same offer, same owner times, same time to reply.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Which visit">
            {(Object.keys(CHOICE_KIND_LABEL) as ChoiceKind[]).map((k) => (
              <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => { setKind(k); setOpen(true); }}>{CHOICE_KIND_LABEL[k]}</Button>
            ))}
          </div>
          {open && q.isLoading && <p className="text-muted-foreground">Finding eligible trades…</p>}
          {open && q.error && <p className="text-danger">{(q.error as Error).message}</p>}
          {open && q.data && (
            q.data.trades.length === 0
              ? <p>No eligible {trade}s for this job right now{q.data.notEligible ? ` (${q.data.notEligible} not eligible)` : ""}.</p>
              : <ul className="space-y-2">
                  {q.data.trades.map((t, i) => (
                    <li key={t.id} className="flex flex-col gap-2 rounded-[18px] border bg-card p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{i === 0 ? "Nearest · " : ""}{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.covers ? "Covers this postcode" : "Nearby"} · Area: {t.area} · {t.load} live job{t.load === 1 ? "" : "s"}</div>
                      </div>
                      <Button size="sm" className="h-10" onClick={() => void run(() => pick({ data: { jobId, kind, businessId: t.id } }), `Offer sent only to ${t.name}`)}>Send to {t.name}</Button>
                    </li>
                  ))}
                </ul>
          )}
          {open && <Button size="sm" variant="outline" onClick={() => void run(() => toAll({ data: { jobId, kind } }), "Sent to all eligible trades")}>Send to all instead</Button>}
          <p className="text-xs text-muted-foreground">Nearest is by postcode for now. If they say no or don't reply in time, it shows in Needs me.</p>
        </div>
      </Section>
    </div>
  );
}
