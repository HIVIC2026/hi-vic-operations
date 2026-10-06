// Office job page: "Choose trades for this job" (Jo, 7 Oct 2026). Tick who gets the Ready Check / safety-check offer.
// Only ticked trades get it; then the 24-hour rule and first-in-best-dressed apply as normal.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/portal/panels";
import { listChooseTrades, sendChosenOffers, setJobOfficePicks } from "@/lib/offer-dispatch.functions";

type Kind = "ready_check" | "piesa";
const KIND_LABEL: Record<Kind, string> = { ready_check: "Ready Check (installers)", piesa: "Safety check (electricians)" };
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function ChooseTradePanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("ready_check");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = useServerFn(listChooseTrades);
  const send = useServerFn(sendChosenOffers);
  const override = useServerFn(setJobOfficePicks);
  const q = useQuery({ queryKey: ["choose-trades", jobId, kind], queryFn: () => list({ data: { jobId, kind } }) });
  const d = q.data;
  type T = NonNullable<typeof d>["matching"][number];
  const shown: T[] = useMemo(() => d ? [...d.matching, ...d.others.filter((o) => extra.includes(o.id))] : [], [d, extra]);
  const found = d && search.trim().length >= 2 ? d.others.filter((o) => !extra.includes(o.id) && o.business.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6) : [];
  const tickable = shown.filter((t) => !t.alreadyOffered && !t.blocker);
  const n = [...ticked].filter((id) => tickable.some((t) => t.id === id)).length;
  const toggle = (id: string) => setTicked((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const go = async () => {
    setBusy(true);
    try { const r = await send({ data: { jobId, kind, businessIds: [...ticked].filter((id) => tickable.some((t) => t.id === id)) } }); toast.success(`Offer sent to ${r.offered} trade${r.offered === 1 ? "" : "s"}`); setTicked(new Set()); void qc.invalidateQueries(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(false); }
  };
  const row = (t: T) => (
    <li key={t.id} className="rounded-[18px] border bg-card p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox className="mt-1 h-5 w-5" checked={ticked.has(t.id)} disabled={!!t.alreadyOffered || !!t.blocker} onCheckedChange={() => toggle(t.id)} aria-label={`Choose ${t.business}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{t.business}</span>{t.contact && <span className="text-xs text-muted-foreground">{t.contact}</span>}
            {t.alreadyOffered && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Already offered · {t.alreadyOffered}</span>}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-3">
            <span>Distance: {t.distanceKm != null ? `${t.distanceKm} km` : t.areaNote}</span>
            <span>Rate: {t.rate != null ? `${money(t.rate)} ${t.rateUnit}` : "not recorded"}</span>
            <span>This week: {t.weekJobs} job{t.weekJobs === 1 ? "" : "s"} · {t.openOffers} open offer{t.openOffers === 1 ? "" : "s"}</span>
            <span>Capacity: {t.capacity ?? "not given"}</span>
            <span>Accepts: {t.acceptRate != null ? `${t.acceptRate}%` : "no history"}{t.avgAcceptHours != null ? ` · avg ${t.avgAcceptHours}h` : ""}</span>
          </div>
          {t.blocker && <p className="text-xs font-semibold text-destructive">Can't be offered: {t.blocker}</p>}
          {t.warnings.length > 0 && <p className="text-xs font-semibold text-destructive">⚠ {t.warnings.join(" · ")}</p>}
        </div>
      </label>
    </li>
  );
  return (
    <div id="choose-trade">
      <Section title="Choose trades for this job">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Which offer">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => { setKind(k); setTicked(new Set()); setExtra([]); }}>{KIND_LABEL[k]}</Button>)}
          </div>
          {d && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 p-3 text-xs">
              <span>{d.officePicks ? "Office picks: nothing goes out until you send it." : "Automatic: offers go to all matching trades."}{d.ownerPrice != null ? ` Owner price: ${money(d.ownerPrice)}${kind === "ready_check" ? " per m² (R5)" : ""}.` : ""}</span>
              <label className="flex items-center gap-2 font-semibold"><Checkbox checked={d.jobOverride} onCheckedChange={async (v) => { await override({ data: { jobId, on: !!v } }); void qc.invalidateQueries(); }} />Office picks for this job</label>
            </div>
          )}
          {q.isLoading && <p className="text-muted-foreground">Finding matching trades…</p>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
          {d && (
            <>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{d.matching.length} matching approved trade{d.matching.length === 1 ? "" : "s"}</p>
                <Button size="sm" variant="outline" onClick={() => setTicked(new Set(tickable.map((t) => t.id)))} disabled={!tickable.length}>Select all</Button>
              </div>
              {shown.length ? <ul className="space-y-2">{shown.map(row)}</ul> : <p>No matching trades for this job.</p>}
              <div className="space-y-1">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search to add a trade that isn't listed" aria-label="Search trades" />
                {found.map((o) => <button key={o.id} type="button" className="block w-full rounded-lg border px-3 py-2 text-left text-xs hover:bg-muted" onClick={() => { setExtra((x) => [...x, o.id]); setSearch(""); }}>+ {o.business}{o.blocker ? ` — can't be offered: ${o.blocker}` : ""}</button>)}
              </div>
              <Button className="h-12 w-full" disabled={!n || busy} onClick={() => void go()}>{busy ? "Sending…" : `Send offer to ${n} trade${n === 1 ? "" : "s"}`}</Button>
              <p className="text-xs text-muted-foreground">Only ticked trades get it. For the first 24 hours they can take an owner time or decline; then “Suggest another time” opens. Trades already offered keep their offer when you add more.</p>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
