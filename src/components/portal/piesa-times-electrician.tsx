// Decision 333 (Jo, 25 Oct 2026): safety check (PIESA) times, electrician side — offer the owner 3 times on 3 different
// days (8am–3pm arrival, 24h+ away); take one of the owner's suggested days at a time you choose, or offer 3 new times.
// Presentation only — turns and rules come from piesa-times.core on the server.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { electricianOfferPiesaTimesFn, electricianTakePiesaDayFn, getElectricianPiesaTimes } from "@/lib/piesa-times.functions";
import { PIESA_OFFER_TIMES, allowedPiesaTimes, electricianPiesaTimesBlockers, formatPiesaTime } from "@/lib/piesa-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import { DayGrid, ErrorLine, PrimaryButton, QuietButton, TimeRows, dayTileLabel } from "@/components/trade/installer-kit";
import { Section } from "./panels";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Check your signal and try again.");
const ymdOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(iso));

/** Pick 3 days and an arrival time on each (offer page and job page). */
export function PiesaTimesForm({ days, busy, sendLabel, onSend, note }: { days: string[]; busy: boolean; sendLabel: string; onSend: (picks: { day: string; time: string }[]) => Promise<unknown>; note?: string }) {
  const [picks, setPicks] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  const toggle = (d: string) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= PIESA_OFFER_TIMES ? picks : [...picks, d]);
  const chosen = [...picks].sort().map((d) => ({ day: d, time: times[d] ?? "" }));
  const blockers = electricianPiesaTimesBlockers(chosen);
  if (!days.length) return <p className="mt-2 text-sm text-sub">There are no days available right now.</p>;
  return <div data-piesa-times-form>
    <DayGrid days={days} picked={picks} onToggle={toggle} label={dayTileLabel} />
    <TimeRows rows={chosen.map((p) => ({ key: p.day, label: dayTileLabel(p.day), value: p.time, options: allowedPiesaTimes(p.day), optionLabel: installTimeLabel, onChange: (t: string) => setTimes({ ...times, [p.day]: t }) }))} />
    <PrimaryButton className="mt-3.5" disabled={busy || blockers.length > 0} onClick={() => void onSend(chosen)}>{busy ? "Sending…" : sendLabel}</PrimaryButton>
    {note && <p className="mt-2.5 text-center text-[13px] leading-[1.45] text-sub">{note}</p>}
  </div>;
}

function TimeSelect({ day, label, value, onChange }: { day: string; label: string; value: string; onChange: (t: string) => void }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-10 rounded-[10px] border border-line bg-paper px-3 text-[15px] font-semibold text-ink">
    <option value="">Time ▾</option>
    {allowedPiesaTimes(day).map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
  </select>;
}

/** The job's electrician: offer 3 times, see them waiting with the owner, or answer the owner's suggested days. */
export function ElectricianPiesaTimesCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getElectricianPiesaTimes);
  const offer = useServerFn(electricianOfferPiesaTimesFn);
  const take = useServerFn(electricianTakePiesaDayFn);
  const { data } = useQuery({ queryKey: ["electrician-piesa-times", jobId], queryFn: () => getState({ data: { jobId } }), staleTime: 20_000 });
  const [takeTime, setTakeTime] = useState<Record<string, string>>({});
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await f(); setOffering(false); await qc.invalidateQueries(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  if (!data || !data.applies || data.turn === "booked" || data.turn === "no_electrician" || data.turn === "legacy_owner_windows") return null;
  const form = <PiesaTimesForm days={data.days} busy={busy} sendLabel="Send these times to the owner" onSend={(picks) => run(() => offer({ data: { jobId, picks } }))} note="The owner picks one or suggests other days." />;
  return (
    <Section title="Safety check times">
      <div data-piesa-times-electrician>
        {data.turn === "electrician_to_offer" && <><p className="text-sm">Offer the owner 3 times within 24 hours: three different days, arriving between 8am and 3pm.</p>{form}</>}
        {data.turn === "owner_to_answer" && <>
          <ul className="space-y-1 text-[15px]">{data.open.map((d) => <li key={d.id}>{formatPiesaTime(d.starts_at)}</li>)}</ul>
          <p className="mt-2 text-[13px] text-sub">The owner picks one or suggests other days. Nothing for you until then.</p>
        </>}
        {data.turn === "electrician_to_answer" && <>
          <p className="text-sm">The owner suggested these days. Choose your arrival time on one to book it.</p>
          <div className="mt-2">{data.open.map((d, i) => <div key={d.id} className={`flex min-h-11 items-center justify-between gap-2 text-[15px] ${i < data.open.length - 1 ? "border-b border-line" : ""}`}><span>{formatPiesaTime(d.starts_at, false)}</span><span className="flex items-center gap-2"><TimeSelect day={ymdOf(d.starts_at)} label={`Arrival time ${formatPiesaTime(d.starts_at, false)}`} value={takeTime[d.id] ?? ""} onChange={(t) => setTakeTime({ ...takeTime, [d.id]: t })} /><button type="button" className="min-h-10 rounded-[10px] border border-hiv-blue px-3 text-sm font-semibold text-hiv-blue disabled:opacity-40" disabled={busy || !takeTime[d.id]} onClick={() => run(() => take({ data: { jobId, proposalId: d.id, time: takeTime[d.id]! } }))}>Book</button></span></div>)}</div>
          {!offering ? <QuietButton className="mt-3.5" disabled={busy} onClick={() => setOffering(true)}>None of these work – offer 3 other times</QuietButton> : form}
        </>}
        <ErrorLine>{err}</ErrorLine>
      </div>
    </Section>
  );
}
