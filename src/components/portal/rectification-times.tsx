import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getRectificationWindows } from "@/lib/allocation.functions";
import { PIESA_SLOTS, PIESA_WINDOW_MAX, PIESA_WINDOW_MIN, PIESA_WINDOW_MIN_DAYS, allowedPiesaDays, formatPiesaWindow, type PiesaSlot, type PiesaWindowPick } from "@/lib/piesa-windows.core";
import { rectPlanBlockers } from "@/lib/rectification.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

export type RectPlan = { hours: string; picks: PiesaWindowPick[] };
export const rectPlanProblems = (p: RectPlan) => rectPlanBlockers(p.hours === "" ? null : Number(p.hours), p.picks);

/** Electrician, at PIESA submit when rectification is needed: estimated hours + 3-5 windows. */
export function RectPlanFields({ value, onChange }: { value: RectPlan; onChange: (p: RectPlan) => void }) {
  const has = (d: string, s: PiesaSlot) => value.picks.some((p) => p.date === d && p.slot === s);
  const toggle = (d: string, s: PiesaSlot) => onChange({ ...value, picks: has(d, s) ? value.picks.filter((p) => !(p.date === d && p.slot === s)) : value.picks.length >= PIESA_WINDOW_MAX ? value.picks : [...value.picks, { date: d, slot: s }] });
  const problems = rectPlanProblems(value);
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <Label>Estimated hours for the electrical fixes work</Label>
        <Input className="h-12 text-base" type="number" inputMode="decimal" step="0.5" min="0.5" value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value })} />
      </div>
      <div>
        <Label>Times you can do the work</Label>
        <p className="text-xs text-muted-foreground">Choose {PIESA_WINDOW_MIN} to {PIESA_WINDOW_MAX} times on at least {PIESA_WINDOW_MIN_DAYS} different days. The owner picks one when they approve the quote.</p>
        <div className="mt-2 space-y-2">
          {allowedPiesaDays().map((d) => (
            <div key={d} className="grid grid-cols-[6.5rem_1fr_1fr] items-center gap-2 text-sm">
              <div className="font-medium">{dayLabel(d)}</div>
              {(Object.keys(PIESA_SLOTS) as PiesaSlot[]).map((s) => (
                <Button key={s} type="button" size="field" variant={has(d, s) ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" aria-pressed={has(d, s)} onClick={() => toggle(d, s)}>{PIESA_SLOTS[s].label}</Button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{value.picks.length} of {PIESA_WINDOW_MAX} chosen.{problems.length ? ` ${problems[0]}` : ""}</p>
    </div>
  );
}

export function useRectWindows(jobId: string) {
  const fn = useServerFn(getRectificationWindows);
  return useQuery({ queryKey: ["rect-windows", jobId], queryFn: () => fn({ data: { jobId } }) });
}

/** Owner: pick one of the electrician's times (24h+ away), or "None of these work". */
export function RectWindowChoice({ jobId, value, onChange }: { jobId: string; value: string | "none" | null; onChange: (v: string | "none") => void }) {
  const { data } = useRectWindows(jobId);
  if (!data?.hasWindows) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-sm font-medium">Choose a time for the electrical work</div>
      {data.hours != null && <p className="text-xs text-muted-foreground">The electrician expects it to take about {Number(data.hours)} hours.</p>}
      {data.pickable.map((w) => (
        <Button key={w.id} type="button" size="field" className="h-auto min-h-12 w-full whitespace-normal" variant={value === w.id ? "default" : "outline"} aria-pressed={value === w.id} onClick={() => onChange(w.id)}>{formatPiesaWindow(w.starts_at, w.ends_at)}</Button>
      ))}
      <Button type="button" size="field" className="w-full" variant={value === "none" ? "default" : "outline"} aria-pressed={value === "none"} onClick={() => onChange("none")}>None of these work</Button>
      {value === "none" && <p className="text-xs text-muted-foreground">We'll share your contact details with the electrician for this visit only, so you can agree a time together.</p>}
    </div>
  );
}

/** Office: hours + windows next to the draft rectification quote. */
export function RectWindowsSummary({ jobId }: { jobId: string }) {
  const { data } = useRectWindows(jobId);
  if (!data?.hasWindows) return null;
  return (
    <div className="mt-2 text-xs">
      <div className="font-medium">Electrician's estimate: {data.hours != null ? `${Number(data.hours)} hours` : "not given"}</div>
      <ul className="mt-1 space-y-0.5">{data.all.map((w) => <li key={w.id}>{formatPiesaWindow(w.starts_at, w.ends_at)} · {w.status === "proposed" ? "offered" : w.status === "accepted" ? "picked by owner" : "closed"}</li>)}</ul>
    </div>
  );
}
