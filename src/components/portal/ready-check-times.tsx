import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { chooseReadyCheckWindowsFn, getReadyCheckWindowsFn } from "@/lib/estimate.functions";
import { SPOT_HELD_MESSAGE } from '@/lib/ready-check-booking-access.core';
import {
  PIESA_SLOTS, PIESA_WINDOW_MAX, PIESA_WINDOW_MIN, PIESA_WINDOW_MIN_DAYS, allowedPiesaDays, formatPiesaWindow, piesaWindowBlockers,
  type PiesaSlot, type PiesaWindowPick,
} from "@/lib/piesa-windows.core";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** Owner picks 3–5 Ready Check times (same windows and rules as the PIESA picker). Controlled; no fetching. */
export function ReadyCheckTimesPicker({ value, onChange, disabled = false }: { value: PiesaWindowPick[]; onChange: (v: PiesaWindowPick[]) => void; disabled?: boolean }) {
  const days = allowedPiesaDays();
  const has = (date: string, slot: PiesaSlot) => value.some((p) => p.date === date && p.slot === slot);
  const toggle = (date: string, slot: PiesaSlot) => onChange(has(date, slot) ? value.filter((p) => !(p.date === date && p.slot === slot)) : value.length >= PIESA_WINDOW_MAX ? value : [...value, { date, slot }]);
  const blockers = piesaWindowBlockers(value);
  return (
    <div data-testid="ready-check-times">
      <h2 className="text-base font-bold text-estimate-navy">Choose times for your Ready Check</h2>
      <p className="mt-1 text-[13px] leading-relaxed">Please choose {PIESA_WINDOW_MIN} to {PIESA_WINDOW_MAX} times that suit you, on at least {PIESA_WINDOW_MIN_DAYS} different days. The first approved installer to take one of your times is booked, and we'll let you know.</p>
      <div className="mt-3 space-y-2">
        {days.map((d) => (
          <div key={d} className="grid grid-cols-2 items-center gap-2 rounded-xl border border-estimate-line bg-estimate-white p-2 text-sm sm:grid-cols-[6rem_1fr_1fr] sm:border-0 sm:bg-transparent sm:p-0">
            <div className="col-span-2 font-bold sm:col-span-1">{dayLabel(d)}</div>
            {(Object.keys(PIESA_SLOTS) as PiesaSlot[]).map((s) => (
              <button key={s} type="button" disabled={disabled} aria-pressed={has(d, s)} onClick={() => toggle(d, s)}
                className={`min-h-12 rounded-xl border-2 px-2 py-2 text-[13px] font-bold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-estimate-navy ${has(d, s) ? "border-estimate-green bg-estimate-green text-estimate-white" : "border-estimate-line bg-estimate-white text-estimate-navy"}`}>
                {PIESA_SLOTS[s].label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs">{value.length} of {PIESA_WINDOW_MAX} chosen.{value.length > 0 && blockers.length ? ` ${blockers[0]}` : ""}</p>
    </div>
  );
}

/** After the request: shows the chosen times, or asks for more times once if no installer could take them. */
export function ReadyCheckTimesStatus({ token }: { token: string }) {
  const get = useServerFn(getReadyCheckWindowsFn);
  const choose = useServerFn(chooseReadyCheckWindowsFn);
  const { data, refetch } = useQuery({ queryKey: ["rc-windows", token], queryFn: () => get({ data: { token } }), retry: false });
  const [picks, setPicks] = useState<PiesaWindowPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  if (!data.bookingAllowed) return <p role="status" className="mt-4 text-sm font-bold">{SPOT_HELD_MESSAGE}</p>;
  if (data.canPick && data.round >= 1) return (
    <div className="mt-4 rounded-[20px] bg-estimate-white px-5 py-6">
      <p className="mb-3 text-sm font-bold">None of our installers could make your earlier times. Please choose some new times.</p>
      <ReadyCheckTimesPicker value={picks} onChange={setPicks} disabled={busy} />
      {error && <p className="mt-2 text-sm font-bold text-danger" role="alert">{error}</p>}
      <button type="button" disabled={busy || piesaWindowBlockers(picks).length > 0} className="mt-3 min-h-12 w-full rounded-xl bg-estimate-green px-5 py-3 font-extrabold text-estimate-white disabled:opacity-50"
        onClick={async () => { setBusy(true); setError(null); try { await choose({ data: { token, picks } }); setPicks([]); await refetch(); } catch (e) { setError(e instanceof Error ? e.message : "Your times could not be sent."); } finally { setBusy(false); } }}>
        Send my times
      </button>
    </div>
  );
  const open = data.windows.filter((w) => w.status === "open");
  if (!open.length) return null;
  return (
    <div className="mt-4 rounded-[20px] bg-estimate-white px-5 py-5 text-sm">
      <p className="font-bold">Your Ready Check times</p>
      <ul className="mt-2 space-y-1">{open.map((w) => <li key={w.starts_at}>{formatPiesaWindow(w.starts_at, w.ends_at)}</li>)}</ul>
      <p className="mt-2 text-[13px]">We've shared these with approved installers. You'll hear as soon as one is booked.</p>
    </div>
  );
}
