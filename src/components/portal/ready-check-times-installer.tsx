// Our-lead Ready Check times, installer side (Jo 24 Oct 2026, decision 52). Same look as the install-day picker:
// choose 3 days and the arrival time on each; the owner taps one (booked) or suggests days back.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Section } from "./panels";
import { changeTradeReadyCheckTime, getTradeReadyCheckTimes, offerTradeReadyCheckNewTimes, takeTradeReadyCheckDay } from "@/lib/trade-view.functions";
import { READY_CHECK_INSTALLER_TIMES, allowedReadyCheckTimes, formatReadyCheckTime, installerTimesBlockers } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Check your signal and try again.");

function TimeSelect({ day, label, value, onChange }: { day: string; label: string; value: string; onChange: (t: string) => void }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 rounded-md border bg-background px-2 text-sm">
    <option value="">Time…</option>
    {allowedReadyCheckTimes(day).map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
  </select>;
}

/** Pick 3 days and an arrival time on each. */
export function ReadyCheckTimesForm({ days, busy, sendLabel, onSend }: { days: string[]; busy: boolean; sendLabel: string; onSend: (picks: { day: string; time: string }[]) => Promise<unknown> }) {
  const [picks, setPicks] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const toggle = (d: string) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= READY_CHECK_INSTALLER_TIMES ? picks : [...picks, d]);
  const chosen = [...picks].sort().map((d) => ({ day: d, time: times[d] ?? "" }));
  const blockers = installerTimesBlockers(chosen);
  if (!days.length) return <p className="mt-2 text-sm text-muted-foreground">There are no days available right now.</p>;
  return <div data-ready-check-times-form>
    <p className="mt-1 text-sm">Choose {READY_CHECK_INSTALLER_TIMES} days you can do and the time you'll arrive. The owner taps one and it's booked, or suggests other days.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{days.map((d) => <Button key={d} type="button" size="field" variant={picks.includes(d) ? "default" : "outline"} aria-pressed={picks.includes(d)} className="h-auto min-h-12 whitespace-normal" onClick={() => toggle(d)}>{dayLabel(d)}</Button>)}</div>
    {picks.length > 0 && <div className="mt-3 space-y-2">{chosen.map((p) => <div key={p.day} className="flex items-center justify-between gap-2 text-sm"><span>{dayLabel(p.day)}</span><TimeSelect day={p.day} label={`Arrival time ${dayLabel(p.day)}`} value={p.time} onChange={(t) => setTimes({ ...times, [p.day]: t })} /></div>)}</div>}
    <p className="mt-2 text-xs text-muted-foreground">{picks.length} of {READY_CHECK_INSTALLER_TIMES} chosen.</p>
    <Button type="button" size="field" className="mt-2 w-full" disabled={busy || blockers.length > 0} onClick={() => void onSend(chosen)}>{busy ? "Sending…" : sendLabel}</Button>
  </div>;
}

/** Decision 80: change a booked Ready Check — one new day and arrival time, booked straight away. */
function ChangeReadyCheckTime({ days, busy, onSend, onCancel }: { days: string[]; busy: boolean; onSend: (pick: { day: string; time: string }) => Promise<unknown>; onCancel: () => void }) {
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  if (!days.length) return <p className="mt-2 text-sm text-muted-foreground">There are no days available right now.</p>;
  return <div data-ready-check-change-form>
    <p className="mt-2 text-sm">Choose the new day and the time you'll arrive. It's booked straight away and the owner is told.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{days.map((d) => <Button key={d} type="button" size="field" variant={day === d ? "default" : "outline"} aria-pressed={day === d} className="h-auto min-h-12 whitespace-normal" onClick={() => { setDay(d); setTime(""); }}>{dayLabel(d)}</Button>)}</div>
    {day && <div className="mt-3 flex items-center justify-between gap-2 text-sm"><span>{dayLabel(day)}</span><TimeSelect day={day} label={`Arrival time ${dayLabel(day)}`} value={time} onChange={setTime} /></div>}
    <Button type="button" size="field" className="mt-3 w-full" disabled={busy || !day || !time} onClick={() => void onSend({ day, time })}>{busy ? "Saving…" : "Book the new time"}</Button>
    <Button type="button" size="field" variant="ghost" className="mt-2 w-full" disabled={busy} onClick={onCancel}>Keep the booked time</Button>
  </div>;
}

/** Assigned installer on an our-lead job: whose move it is, the owner's suggested days, or offer new times. */
export function InstallerReadyCheckTimesCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getTradeReadyCheckTimes);
  const offer = useServerFn(offerTradeReadyCheckNewTimes);
  const take = useServerFn(takeTradeReadyCheckDay);
  const change = useServerFn(changeTradeReadyCheckTime);
  const [changing, setChanging] = useState(false);
  const { data } = useQuery({ queryKey: ["installer-rc-times", jobId], queryFn: () => getState({ data: { jobId } }) });
  const [takeTime, setTakeTime] = useState<Record<string, string>>({});
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await f(); setOffering(false); setChanging(false); await qc.invalidateQueries(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  if (!data || !data.applies || data.turn === "no_installer") return null;
  if (data.turn === "booked") {
    if (!data.canChange) return null;
    return (
      <Section title="Ready Check time">
        <p className="text-sm">Booked{data.bookedAt ? ` for ${formatReadyCheckTime(data.bookedAt)}` : ""}.</p>
        {!changing ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" onClick={() => setChanging(true)}>Change time</Button>
          : <ChangeReadyCheckTime days={data.days} busy={busy} onSend={(pick) => run(() => change({ data: { jobId, ...pick } }))} onCancel={() => setChanging(false)} />}
        {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      </Section>
    );
  }
  const form = <ReadyCheckTimesForm days={data.days} busy={busy} sendLabel="Send these times to the owner" onSend={(picks) => run(() => offer({ data: { jobId, picks } }))} />;
  return (
    <Section title="Ready Check time">
      {data.turn === "owner_to_answer" && <>
        <p className="text-sm text-muted-foreground">Waiting for the owner to pick one of your times:</p>
        <ul className="mt-2 space-y-1 text-sm">{data.open.map((d) => <li key={d.id}>{formatReadyCheckTime(d.starts_at)}</li>)}</ul>
      </>}
      {data.turn === "installer_to_offer" && <><p className="text-sm">Offer the owner {READY_CHECK_INSTALLER_TIMES} times for the free Ready Check.</p>{form}</>}
      {data.turn === "installer_to_answer" && <>
        <p className="text-sm">None of your times suited. The owner suggested these days — choose your arrival time on one to book it.</p>
        <div className="mt-3 space-y-2">{data.open.map((d) => { const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(d.starts_at)); return <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{formatReadyCheckTime(d.starts_at, false)}</span><span className="flex gap-2"><TimeSelect day={ymd} label={`Arrival time ${formatReadyCheckTime(d.starts_at, false)}`} value={takeTime[d.id] ?? ""} onChange={(t) => setTakeTime({ ...takeTime, [d.id]: t })} /><Button size="field" disabled={busy || !takeTime[d.id]} onClick={() => run(() => take({ data: { jobId, proposalId: d.id, time: takeTime[d.id]! } }))}>Book</Button></span></div>; })}</div>
        {!offering ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={() => setOffering(true)}>None of these work – offer 3 other times</Button> : form}
      </>}
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
    </Section>
  );
}
