import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { getInstallerInstallDays, getOwnerInstallDays, installerChangeInstallDay, installerOfferInstallDays, installerTakeInstallDay, ownerChangeInstallDay, ownerSuggestInstallDays, ownerTakeInstallDay } from "@/lib/allocation.functions";
import { INSTALLER_OFFER_DAYS, INSTALL_TIMES, OWNER_SUGGEST_MAX, dayOfferBlockers, formatInstallDay, installTimeLabel } from "@/lib/install-days.core";
import { Button } from "@/components/ui/button";
import { Section } from "./panels";
import { DayGrid, PrimaryButton, QuietButton, TimeRows, dayTileLabel } from "@/components/trade/installer-kit";
import { thirtyDayLine, ymdShort } from "@/lib/installer-screens.core";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const deadlineLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
export type DayState = { turn: string; deadline: string | null; daysLeft: number | null; bookedAt: string | null; open: { id: string; starts_at: string; by: "installer" | "owner" }[]; days: string[];
  /** Decision 327: the electrician can't make the booked day and gave the days they can do — only those are listed. */
  electricianDays?: string[] | null };

function Deadline({ s }: { s: DayState }) {
  if (!s.deadline) return null;
  return <p className="text-sm font-semibold">Install must be on or before {deadlineLabel(s.deadline)}{s.daysLeft != null ? ` · ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : ""}</p>;
}

function DayPicker({ days, max, picks, setPicks }: { days: string[]; max: number; picks: string[]; setPicks: (p: string[]) => void }) {
  const toggle = (d: string) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= max ? picks : [...picks, d]);
  if (!days.length) return <p className="mt-2 text-sm text-muted-foreground">There are no days left inside the 30-day window.</p>;
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">{days.map((d) => <Button key={d} size="field" variant={picks.includes(d) ? "default" : "outline"} aria-pressed={picks.includes(d)} className="h-auto min-h-12 whitespace-normal" onClick={() => toggle(d)}>{dayLabel(d)}</Button>)}</div>;
}

/** Booked day + "Change day" (either side). The installer then offers 3 new days inside the same 30-day window. */
function Booked({ s, title, busy, onChange }: { s: DayState; title: string; busy: boolean; onChange: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <Section title={title}>
      <p className="text-sm">Booked: <strong>{s.bookedAt ? formatInstallDay(s.bookedAt) : "confirmed"}</strong></p>
      {!sure ? <Button size="field" variant="outline" className="mt-3 w-full" disabled={busy} onClick={() => setSure(true)}>Change day</Button> : <div className="mt-3 space-y-2">
        <p className="text-sm">This cancels the booked day. The installer then offers 3 new days{s.deadline ? `, on or before ${deadlineLabel(s.deadline)}` : ""}.</p>
        <div className="flex gap-2"><Button size="field" variant="destructive" className="flex-1" disabled={busy} onClick={onChange}>Yes, change the day</Button><Button size="field" variant="ghost" disabled={busy} onClick={() => setSure(false)}>Keep it</Button></div>
      </div>}
    </Section>
  );
}

function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-10 rounded-[10px] border border-line bg-paper px-3 text-[15px] font-semibold text-ink">
    <option value="">Time ▾</option>
    {INSTALL_TIMES.map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
  </select>;
}

const Expired = () => <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">New PIESA needed. The 30-day window to install after the Pre Insulation Electrical Safety Assessment (PIESA) has passed.</p>;

/** Owner (portal): take one of the installer's 3 days, or suggest up to 5 of their own. */
export function OwnerInstallDaysCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getOwnerInstallDays);
  const take = useAction(ownerTakeInstallDay);
  const suggest = useAction(ownerSuggestInstallDays);
  const change = useAction(ownerChangeInstallDay);
  const { data } = useQuery({ queryKey: ["install-days", jobId], queryFn: () => getState({ data: { jobId } }) as Promise<DayState> });
  const [picks, setPicks] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setPicks([]); setSuggesting(false); await qc.invalidateQueries({ queryKey: ["install-days", jobId] }); } finally { setBusy(false); } };
  if (!data) return null;
  if (data.turn === "expired") return <Expired />;
  if (data.turn === "booked") return <Booked s={data} title="Your installation" busy={busy} onChange={() => run(() => change({ jobId }, "Your installer will offer new days"))} />;
  if (data.turn === "installer_to_offer") return <Section title="Your installation days"><Deadline s={data} /><p className="mt-1 text-sm text-muted-foreground">Your installer will offer you 3 days shortly.</p></Section>;
  if (data.turn === "installer_to_answer") return (
    <Section title="Your installation days">
      <Deadline s={data} />
      <p className="mt-1 text-sm text-muted-foreground">We've sent your days to your installer. They'll take one and choose the time, or offer you new days.</p>
      <ul className="mt-2 space-y-1 text-sm">{data.open.map((d) => <li key={d.id}>{formatInstallDay(d.starts_at, false)}</li>)}</ul>
    </Section>
  );
  if (data.turn !== "owner_to_answer") return null;
  const blockers = dayOfferBlockers(picks, data.days, "owner");
  return (
    <Section title="Choose your installation day">
      <Deadline s={data} />
      <p className="mt-1 text-sm">Your installer can come at these times. Tap one to book it.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.open.map((d) => <Button key={d.id} size="field" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => run(() => take({ jobId, proposalId: d.id }, "Installation booked"))}>{formatInstallDay(d.starts_at)}</Button>)}</div>
      {!suggesting ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={() => setSuggesting(true)}>None of these suit – suggest other days</Button> : <>
        <p className="mt-4 text-sm">Pick up to {OWNER_SUGGEST_MAX} days that suit you. Your installer will take one or offer new days.</p>
        <DayPicker days={data.days} max={OWNER_SUGGEST_MAX} picks={picks} setPicks={setPicks} />
        <Button size="field" className="mt-3 w-full" disabled={busy || blockers.length > 0} onClick={() => run(() => suggest({ jobId, days: picks }, "Days sent to your installer"))}>Send my days</Button>
      </>}
    </Section>
  );
}

/** Installer's install-day state, read once per job (shared by the job page's Next panel and this form). */
export function useInstallerInstallDays(jobId: string) {
  const getState = useServerFn(getInstallerInstallDays);
  return useQuery({ queryKey: ["installer-install-days", jobId], queryFn: () => getState({ data: { jobId } }) as Promise<DayState>, staleTime: 20_000 });
}

/** Quoted installer (mock-up M2, decisions 1/19/43/163/186): offer 3 days with an exact arrival time each; take one of
 *  the owner's suggested days or offer 3 new ones; booked → Change day. Rendered INSIDE the job page's one Next panel,
 *  so it carries no heading of its own. Turn comes from installDayTurn on the server only. */
export function InstallerInstallDays({ jobId, ownerFirstName, readOnly = false }: { jobId: string; ownerFirstName?: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const offer = useAction(installerOfferInstallDays);
  const take = useAction(installerTakeInstallDay);
  const change = useAction(installerChangeInstallDay);
  const { data } = useInstallerInstallDays(jobId);
  const [picks, setPicks] = useState<string[]>([]);
  const [offering, setOffering] = useState(false);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [takeTime, setTakeTime] = useState<Record<string, string>>({});
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = ownerFirstName ?? "the owner";
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setPicks([]); setTimes({}); setOffering(false); setSure(false); await qc.invalidateQueries({ queryKey: ["installer-install-days", jobId] }); await qc.invalidateQueries({ queryKey: ["job", jobId] }); await qc.invalidateQueries({ queryKey: ["trade-job-page", jobId] }); } finally { setBusy(false); } };
  if (!data || data.turn === "not_ready" || data.turn === "expired") return null;
  const line = thirtyDayLine(data.deadline);
  const foot = line && <p className="mt-3 border-t border-line pt-2.5 text-[13px] leading-[1.45] text-sub">⏰ {line}</p>;
  if (readOnly) return data.turn === "booked" ? <div data-install-booked>{data.bookedAt && <p className="mt-3 text-sm">Booked: <strong>{formatInstallDay(data.bookedAt)}</strong></p>}{foot}</div> : null;
  if (data.turn === "booked") return (
    <div data-install-booked>
      {!sure ? <QuietButton className="mt-3.5" disabled={busy} onClick={() => setSure(true)}>Change day</QuietButton> : <div className="mt-3.5 space-y-2">
        <p className="text-sm">This cancels the booked day. You then offer {owner} 3 new days{data.deadline ? `, on or before ${ymdShort(data.deadline)}` : ""}.</p>
        <PrimaryButton disabled={busy} onClick={() => run(() => change({ jobId }, "Day cancelled – offer 3 new days"))}>Yes, change the day</PrimaryButton>
        <QuietButton disabled={busy} onClick={() => setSure(false)}>Keep it</QuietButton>
      </div>}
      {foot}
    </div>
  );
  if (data.turn === "owner_to_answer") return (
    <div data-install-waiting>
      <ul className="mt-3 space-y-1 text-[15px]">{data.open.map((d) => <li key={d.id}>{formatInstallDay(d.starts_at)}</li>)}</ul>
      <p className="mt-2 text-[13px] text-sub">{owner} picks one or suggests other days. Nothing for you until then.</p>
      {foot}
    </div>
  );
  const need = Math.min(INSTALLER_OFFER_DAYS, data.days.length);
  const blockers = dayOfferBlockers(picks, data.days, "installer");
  const chosen = [...picks].sort();
  const timesMissing = chosen.some((d) => !times[d]);
  const offerForm = <div data-install-offer-form>
    {data.electricianDays && <p className="mt-2 text-[13px] font-semibold text-ink" data-electrician-days>Only the days the electrician can do are shown.</p>}
    {data.days.length ? <DayGrid days={data.days} picked={picks} label={dayTileLabel} onToggle={(d) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= need ? picks : [...picks, d])} /> : <p className="mt-2 text-sm text-sub">There are no days left inside the 30-day window.</p>}
    <TimeRows rows={chosen.map((d) => ({ key: d, label: dayTileLabel(d), value: times[d] ?? "", options: INSTALL_TIMES, optionLabel: installTimeLabel, onChange: (t: string) => setTimes({ ...times, [d]: t }) }))} />
    {chosen.length > 0 && <p className="mt-1.5 text-[13px] text-sub">{owner} sees the exact time, e.g. {dayTileLabel(chosen[0]!)}{times[chosen[0]!] ? ` at ${installTimeLabel(times[chosen[0]!]!)}` : ""}. {ownerFirstName ? "She picks" : "They pick"} one or suggests other days.</p>}
    {need > 0 && need < INSTALLER_OFFER_DAYS && <p className="mt-1.5 text-[13px] text-sub">Only {need} day{need === 1 ? "" : "s"} left in the window — offer {need === 1 ? "it" : "them all"}.</p>}
    <PrimaryButton className="mt-3.5" disabled={busy || blockers.length > 0 || timesMissing} onClick={() => run(() => offer({ jobId, days: chosen.map((d) => ({ day: d, time: times[d]! })) }, `Days sent to ${owner}`))}>{busy ? "Sending…" : `Send these days to ${owner}`}</PrimaryButton>
  </div>;
  if (data.turn === "installer_to_offer") return <div>{offerForm}{foot}</div>;
  return (
    <div data-install-answer-owner>
      <div className="mt-3">{data.open.map((d, i) => <div key={d.id} className={`flex min-h-11 items-center justify-between gap-2 text-[15px] ${i < data.open.length - 1 ? "border-b border-line" : ""}`}><span>{formatInstallDay(d.starts_at, false)}</span><span className="flex items-center gap-2"><TimeSelect label={`Arrival time ${formatInstallDay(d.starts_at, false)}`} value={takeTime[d.id] ?? ""} onChange={(t) => setTakeTime({ ...takeTime, [d.id]: t })} /><button type="button" className="min-h-10 rounded-[10px] border border-hiv-blue px-3 text-sm font-semibold text-hiv-blue disabled:opacity-40" disabled={busy || !takeTime[d.id]} onClick={() => run(() => take({ jobId, proposalId: d.id, time: takeTime[d.id]! }, "Install day booked"))}>Book</button></span></div>)}</div>
      {!offering ? <QuietButton className="mt-3.5" disabled={busy} onClick={() => setOffering(true)}>None of these work – offer 3 other days</QuietButton> : offerForm}
      {foot}
    </div>
  );
}
