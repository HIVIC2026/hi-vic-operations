import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { chooseOwnerPiesaWindows, getOwnerPiesaWindows } from "@/lib/allocation.functions";
import {
  PIESA_SLOTS, PIESA_WINDOW_MAX, PIESA_WINDOW_MIN, PIESA_WINDOW_MIN_DAYS, allowedPiesaDays, formatPiesaWindow, piesaWindowBlockers,
  type PiesaSlot, type PiesaWindowPick,
} from "@/lib/piesa-windows.core";
import { Button } from "@/components/ui/button";
import { Section } from "./panels";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** Owner picks 3–5 PIESA times. Shown after quote acceptance, and again only if asked for more times. */
export function PiesaTimesCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getOwnerPiesaWindows);
  const choose = useAction(chooseOwnerPiesaWindows);
  const { data } = useQuery({ queryKey: ["piesa-windows", jobId], queryFn: () => getState({ data: { jobId } }) });
  const [picks, setPicks] = useState<PiesaWindowPick[]>([]);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (!data.canPick) {
    const open = data.windows.filter((w) => w.status === "proposed");
    if (!open.length) return null;
    return (
      <Section title="Your Pre Insulation Electrical Safety Assessment (PIESA) times">
        <p className="text-sm text-muted-foreground">We have shared these times with approved electricians. You'll be told as soon as one is booked.</p>
        <ul className="mt-2 space-y-1 text-sm">{open.map((w) => <li key={w.id}>{formatPiesaWindow(w.starts_at, w.ends_at)}</li>)}</ul>
      </Section>
    );
  }
  const days = allowedPiesaDays();
  const has = (date: string, slot: PiesaSlot) => picks.some((p) => p.date === date && p.slot === slot);
  const toggle = (date: string, slot: PiesaSlot) => setPicks((cur) => has(date, slot) ? cur.filter((p) => !(p.date === date && p.slot === slot)) : cur.length >= PIESA_WINDOW_MAX ? cur : [...cur, { date, slot }]);
  const blockers = piesaWindowBlockers(picks);
  return (
    <Section title="Choose times for your Pre Insulation Electrical Safety Assessment (PIESA)">
      <p className="text-sm">{data.moreTimes ? "None of the electricians could make your earlier times. Please choose some new times." : `Please choose ${PIESA_WINDOW_MIN} to ${PIESA_WINDOW_MAX} times that suit you, on at least ${PIESA_WINDOW_MIN_DAYS} different days.`} The first electrician to take one of your times is booked, and we'll let you know.</p>
      <div className="mt-3 space-y-2">
        {days.map((d) => (
          <div key={d} className="grid grid-cols-[6.5rem_1fr_1fr] items-center gap-2 text-sm">
            <div className="font-medium">{dayLabel(d)}</div>
            {(Object.keys(PIESA_SLOTS) as PiesaSlot[]).map((s) => (
              <Button key={s} size="field" variant={has(d, s) ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal" aria-pressed={has(d, s)} onClick={() => toggle(d, s)}>{PIESA_SLOTS[s].label}</Button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{picks.length} of {PIESA_WINDOW_MAX} chosen.{picks.length > 0 && blockers.length ? ` ${blockers[0]}` : ""}</p>
      <Button size="field" className="mt-2 w-full" disabled={busy || blockers.length > 0}
        onClick={async () => { setBusy(true); try { await choose({ jobId, picks }, "Times sent to our electricians"); setPicks([]); await qc.invalidateQueries({ queryKey: ["piesa-windows", jobId] }); } finally { setBusy(false); } }}>
        Send my times
      </Button>
    </Section>
  );
}
