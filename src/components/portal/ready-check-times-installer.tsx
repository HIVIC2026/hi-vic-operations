// Our-lead Ready Check times, installer side (Jo 24 Oct 2026, decision 52; mock-up M5 look): choose 3 days in a
// 3-column grid and the exact arrival time on each; the owner taps one (booked) or suggests days back. Decision 80:
// Change time on a booked visit. Presentation only — turns and rules come from ready-check-times.core on the server.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { changeTradeReadyCheckTime, getTradeReadyCheckTimes, offerTradeReadyCheckNewTimes, takeTradeReadyCheckDay } from "@/lib/trade-view.functions";
import { READY_CHECK_INSTALLER_TIMES, allowedReadyCheckTimes, formatReadyCheckTime, installerTimesBlockers } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import { DayGrid, ErrorLine, PrimaryButton, QuietButton, TimeRows, dayTileLabel } from "@/components/trade/installer-kit";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Check your signal and try again.");

function TimeSelect({ day, label, value, onChange }: { day: string; label: string; value: string; onChange: (t: string) => void }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-10 rounded-[10px] border border-line bg-paper px-3 text-[15px] font-semibold text-ink">
    <option value="">Time ▾</option>
    {allowedReadyCheckTimes(day).map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
  </select>;
}

/** Pick 3 days and an arrival time on each (used on the offer page and on the job page). */
export function ReadyCheckTimesForm({ days, busy, sendLabel, onSend, note }: { days: string[]; busy: boolean; sendLabel: string; onSend: (picks: { day: string; time: string }[]) => Promise<unknown>; note?: string }) {
  const [picks, setPicks] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const toggle = (d: string) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= READY_CHECK_INSTALLER_TIMES ? picks : [...picks, d]);
  const chosen = [...picks].sort().map((d) => ({ day: d, time: times[d] ?? "" }));
  const blockers = installerTimesBlockers(chosen);
  if (!days.length) return <p className="mt-2 text-sm text-sub">There are no days available right now.</p>;
  return <div data-ready-check-times-form>
    <DayGrid days={days} picked={picks} onToggle={toggle} label={dayTileLabel} />
    <TimeRows rows={chosen.map((p) => ({ key: p.day, label: dayTileLabel(p.day), value: p.time, options: allowedReadyCheckTimes(p.day), optionLabel: installTimeLabel, onChange: (t: string) => setTimes({ ...times, [p.day]: t }) }))} />
    <PrimaryButton className="mt-3.5" disabled={busy || blockers.length > 0} onClick={() => void onSend(chosen)}>{busy ? "Sending…" : sendLabel}</PrimaryButton>
    {note && <p className="mt-2.5 text-center text-[13px] leading-[1.45] text-sub">{note}</p>}
  </div>;
}

/** Decision 80: change a booked Ready Check — one new day and arrival time, booked straight away. */
function ChangeReadyCheckTime({ days, busy, onSend, onCancel }: { days: string[]; busy: boolean; onSend: (pick: { day: string; time: string }) => Promise<unknown>; onCancel: () => void }) {
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  if (!days.length) return <p className="mt-2 text-sm text-sub">There are no days available right now.</p>;
  return <div data-ready-check-change-form>
    <p className="mt-2 text-sm text-sub">Choose the new day and the time you'll arrive. It's booked straight away and the owner is told.</p>
    <DayGrid days={days} picked={day ? [day] : []} onToggle={(d) => { setDay(d === day ? "" : d); setTime(""); }} label={dayTileLabel} />
    {day && <TimeRows rows={[{ key: day, label: dayTileLabel(day), value: time, options: allowedReadyCheckTimes(day), optionLabel: installTimeLabel, onChange: setTime }]} />}
    <PrimaryButton className="mt-3.5" disabled={busy || !day || !time} onClick={() => void onSend({ day, time })}>{busy ? "Saving…" : "Book the new time"}</PrimaryButton>
    <QuietButton className="mt-2" disabled={busy} onClick={onCancel}>Keep the booked time</QuietButton>
  </div>;
}

export function useInstallerReadyCheckTimes(jobId: string) {
  const getState = useServerFn(getTradeReadyCheckTimes);
  return useQuery({ queryKey: ["installer-rc-times", jobId], queryFn: () => getState({ data: { jobId } }), staleTime: 20_000 });
}

/** Assigned installer on an our-lead job: the owner's suggested days, offer new times, or Change time once booked.
 *  Rendered inside the job page's Next panel (no heading of its own). */
export function InstallerReadyCheckTimesCard({ jobId, ownerFirstName }: { jobId: string; ownerFirstName?: string | null }) {
  const qc = useQueryClient();
  const offer = useServerFn(offerTradeReadyCheckNewTimes);
  const take = useServerFn(takeTradeReadyCheckDay);
  const change = useServerFn(changeTradeReadyCheckTime);
  const [changing, setChanging] = useState(false);
  const { data } = useInstallerReadyCheckTimes(jobId);
  const [takeTime, setTakeTime] = useState<Record<string, string>>({});
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const owner = ownerFirstName ?? "the owner";
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await f(); setOffering(false); setChanging(false); await qc.invalidateQueries(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  if (!data || !data.applies || data.turn === "no_installer") return null;
  if (data.turn === "booked") {
    if (!data.canChange) return null;
    return (
      <div data-ready-check-booked>
        {!changing ? <QuietButton className="mt-3.5" onClick={() => setChanging(true)}>Change time</QuietButton>
          : <ChangeReadyCheckTime days={data.days} busy={busy} onSend={(pick) => run(() => change({ data: { jobId, ...pick } }))} onCancel={() => setChanging(false)} />}
        <ErrorLine>{err}</ErrorLine>
      </div>
    );
  }
  const form = <ReadyCheckTimesForm days={data.days} busy={busy} sendLabel={`Send these times to ${owner}`} onSend={(picks) => run(() => offer({ data: { jobId, picks } }))} />;
  return (
    <div data-ready-check-times>
      {data.turn === "owner_to_answer" && <>
        <ul className="mt-3 space-y-1 text-[15px]">{data.open.map((d) => <li key={d.id}>{formatReadyCheckTime(d.starts_at)}</li>)}</ul>
        <p className="mt-2 text-[13px] text-sub">{owner} picks one or suggests other days. Nothing for you until then.</p>
      </>}
      {data.turn === "installer_to_offer" && form}
      {data.turn === "installer_to_answer" && <>
        <div className="mt-3">{data.open.map((d, i) => { const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(d.starts_at)); return <div key={d.id} className={`flex min-h-11 items-center justify-between gap-2 text-[15px] ${i < data.open.length - 1 ? "border-b border-line" : ""}`}><span>{formatReadyCheckTime(d.starts_at, false)}</span><span className="flex items-center gap-2"><TimeSelect day={ymd} label={`Arrival time ${formatReadyCheckTime(d.starts_at, false)}`} value={takeTime[d.id] ?? ""} onChange={(t) => setTakeTime({ ...takeTime, [d.id]: t })} /><button type="button" className="min-h-10 rounded-[10px] border border-hiv-blue px-3 text-sm font-semibold text-hiv-blue disabled:opacity-40" disabled={busy || !takeTime[d.id]} onClick={() => run(() => take({ data: { jobId, proposalId: d.id, time: takeTime[d.id]! } }))}>Book</button></span></div>; })}</div>
        {!offering ? <QuietButton className="mt-3.5" disabled={busy} onClick={() => setOffering(true)}>None of these work – offer 3 other times</QuietButton> : form}
      </>}
      <ErrorLine>{err}</ErrorLine>
    </div>
  );
}
