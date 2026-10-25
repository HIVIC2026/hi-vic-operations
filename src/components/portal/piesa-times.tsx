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
import { getOwnerPiesaTimes, ownerSuggestPiesaDaysFn, ownerTakePiesaTimeFn } from "@/lib/piesa-times.functions";
import { PIESA_OWNER_SUGGEST_MAX, formatPiesaTime, ownerPiesaDaysBlockers } from "@/lib/piesa-times.core";
import { Section } from "./panels";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** Decision 333: the electrician's 3 safety check times — tap one (booked) or suggest 1–5 days; the 30-day box first (decision 307). */
function OwnerElectricianTimes({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getOwnerPiesaTimes);
  const take = useAction(ownerTakePiesaTimeFn);
  const suggest = useAction(ownerSuggestPiesaDaysFn);
  const { data } = useQuery({ queryKey: ["owner-piesa-times", jobId], queryFn: () => getState({ data: { jobId } }) });
  const [understands, setUnderstands] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setDays([]); setSuggesting(false); await qc.invalidateQueries({ queryKey: ["owner-piesa-times", jobId] }); } finally { setBusy(false); } };
  if (!data || !data.applies) return null;
  const title = "Your Pre Insulation Electrical Safety Assessment (PIESA) time";
  if (data.turn === "electrician_to_offer" || data.turn === "no_electrician") return <Section title={title}><p className="text-sm text-muted-foreground">Your electrician will offer you 3 times to choose from.</p></Section>;
  if (data.turn === "electrician_to_answer") return <Section title={title}><p className="text-sm text-muted-foreground">Your days are with your electrician. They'll take one and choose the time, or offer you new times.</p></Section>;
  if (data.turn !== "owner_to_answer") return null;
  const ackBlock = data.thirtyDayAck.needed && !understands;
  return (
    <Section title="Choose your Pre Insulation Electrical Safety Assessment (PIESA) time">
      <p className="text-sm">Your electrician can come at these times. Tap one to book it.</p>
      {data.thirtyDayAck.needed && <label className="mt-3 flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={understands} onChange={(e) => setUnderstands(e.target.checked)} /><span>{data.thirtyDayAck.wording}</span></label>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.open.map((o) => <Button key={o.id} size="field" className="h-auto min-h-12 whitespace-normal" disabled={busy || ackBlock} onClick={() => run(() => take({ jobId, proposalId: o.id, understandsThirtyDays: understands }, "Safety check booked"))}>{formatPiesaTime(o.starts_at)}</Button>)}</div>
      {!suggesting ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={() => setSuggesting(true)}>None of these suit – suggest other days</Button> : <>
        <p className="mt-4 text-sm">Pick up to {PIESA_OWNER_SUGGEST_MAX} days that suit you. Your electrician will take one or offer new times.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.days.map((d) => <Button key={d} size="field" variant={days.includes(d) ? "default" : "outline"} aria-pressed={days.includes(d)} className="h-auto min-h-12 whitespace-normal" onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : days.length >= PIESA_OWNER_SUGGEST_MAX ? days : [...days, d])}>{dayLabel(d)}</Button>)}</div>
        <Button size="field" className="mt-3 w-full" disabled={busy || ackBlock || ownerPiesaDaysBlockers(days).length > 0} onClick={() => run(() => suggest({ jobId, days, understandsThirtyDays: understands }, "Days sent to your electrician"))}>Send my days</Button>
      </>}
    </Section>
  );
}

/** Owner picks 3–5 PIESA times — old jobs only (decision 333): shown again only if asked for more times. New jobs get the
 *  electrician's 3 times (OwnerElectricianTimes). */
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
    if (!open.length) return <OwnerElectricianTimes jobId={jobId} />;
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
