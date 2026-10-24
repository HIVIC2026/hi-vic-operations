// Owner Ready Check window picker — used only by the installer-supplied "times" link (/times/$token).
// Jo 24 Oct 2026 (decision 53): owners of our leads no longer pick Ready Check times; the installer offers them.
import {
  PIESA_SLOTS, PIESA_WINDOW_MAX, PIESA_WINDOW_MIN, PIESA_WINDOW_MIN_DAYS, allowedPiesaDays, piesaWindowBlockers,
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
