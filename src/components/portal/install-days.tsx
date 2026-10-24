import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { getInstallerInstallDays, getOwnerInstallDays, installerOfferInstallDays, installerTakeInstallDay, ownerSuggestInstallDays, ownerTakeInstallDay } from "@/lib/allocation.functions";
import { INSTALLER_OFFER_DAYS, OWNER_SUGGEST_MAX, dayOfferBlockers, formatInstallDay } from "@/lib/install-days.core";
import { Button } from "@/components/ui/button";
import { Section } from "./panels";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const deadlineLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
type DayState = { turn: string; deadline: string | null; daysLeft: number | null; bookedAt: string | null; open: { id: string; starts_at: string; by: "installer" | "owner" }[]; days: string[] };

function Deadline({ s }: { s: DayState }) {
  if (!s.deadline) return null;
  return <p className="text-sm font-semibold">Install must be on or before {deadlineLabel(s.deadline)}{s.daysLeft != null ? ` · ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : ""}</p>;
}

function DayPicker({ days, max, picks, setPicks }: { days: string[]; max: number; picks: string[]; setPicks: (p: string[]) => void }) {
  const toggle = (d: string) => setPicks(picks.includes(d) ? picks.filter((x) => x !== d) : picks.length >= max ? picks : [...picks, d]);
  if (!days.length) return <p className="mt-2 text-sm text-muted-foreground">There are no days left inside the 30-day window.</p>;
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">{days.map((d) => <Button key={d} size="field" variant={picks.includes(d) ? "default" : "outline"} aria-pressed={picks.includes(d)} className="h-auto min-h-12 whitespace-normal" onClick={() => toggle(d)}>{dayLabel(d)}</Button>)}</div>;
}

const Expired = () => <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">New PIESA needed. The 30-day window to install after the Pre Insulation Electrical Safety Assessment (PIESA) has passed.</p>;

/** Owner (portal): take one of the installer's 3 days, or suggest up to 5 of their own. */
export function OwnerInstallDaysCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getOwnerInstallDays);
  const take = useAction(ownerTakeInstallDay);
  const suggest = useAction(ownerSuggestInstallDays);
  const { data } = useQuery({ queryKey: ["install-days", jobId], queryFn: () => getState({ data: { jobId } }) as Promise<DayState> });
  const [picks, setPicks] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setPicks([]); setSuggesting(false); await qc.invalidateQueries({ queryKey: ["install-days", jobId] }); } finally { setBusy(false); } };
  if (!data) return null;
  if (data.turn === "expired") return <Expired />;
  if (data.turn === "booked") return <Section title="Your installation"><p className="text-sm">Booked: <strong>{data.bookedAt ? formatInstallDay(data.bookedAt) : "confirmed"}</strong></p></Section>;
  if (data.turn === "installer_to_offer") return <Section title="Your installation days"><Deadline s={data} /><p className="mt-1 text-sm text-muted-foreground">Your installer will offer you 3 days shortly.</p></Section>;
  if (data.turn === "installer_to_answer") return (
    <Section title="Your installation days">
      <Deadline s={data} />
      <p className="mt-1 text-sm text-muted-foreground">We've sent your days to your installer. They'll take one, or offer you new days.</p>
      <ul className="mt-2 space-y-1 text-sm">{data.open.map((d) => <li key={d.id}>{formatInstallDay(d.starts_at)}</li>)}</ul>
    </Section>
  );
  if (data.turn !== "owner_to_answer") return null;
  const blockers = dayOfferBlockers(picks, data.days, "owner");
  return (
    <Section title="Choose your installation day">
      <Deadline s={data} />
      <p className="mt-1 text-sm">Your installer can do these days (8am–4pm). Tap one to book it.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.open.map((d) => <Button key={d.id} size="field" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => run(() => take({ jobId, proposalId: d.id }, "Installation booked"))}>{formatInstallDay(d.starts_at)}</Button>)}</div>
      {!suggesting ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={() => setSuggesting(true)}>None of these suit – suggest other days</Button> : <>
        <p className="mt-4 text-sm">Pick up to {OWNER_SUGGEST_MAX} days that suit you. Your installer will take one or offer new days.</p>
        <DayPicker days={data.days} max={OWNER_SUGGEST_MAX} picks={picks} setPicks={setPicks} />
        <Button size="field" className="mt-3 w-full" disabled={busy || blockers.length > 0} onClick={() => run(() => suggest({ jobId, days: picks }, "Days sent to your installer"))}>Send my days</Button>
      </>}
    </Section>
  );
}

/** Quoted installer: offer 3 days; take one of the owner's suggested days or offer 3 new ones. */
export function InstallerInstallDays({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getState = useServerFn(getInstallerInstallDays);
  const offer = useAction(installerOfferInstallDays);
  const take = useAction(installerTakeInstallDay);
  const { data } = useQuery({ queryKey: ["installer-install-days", jobId], queryFn: () => getState({ data: { jobId } }) as Promise<DayState> });
  const [picks, setPicks] = useState<string[]>([]);
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setPicks([]); setOffering(false); await qc.invalidateQueries({ queryKey: ["installer-install-days", jobId] }); await qc.invalidateQueries({ queryKey: ["job", jobId] }); } finally { setBusy(false); } };
  if (!data || data.turn === "not_ready") return null;
  if (data.turn === "expired") return <Expired />;
  if (data.turn === "booked") return <Section title="Install day"><p className="text-sm">Booked: <strong>{data.bookedAt ? formatInstallDay(data.bookedAt) : "confirmed"}</strong></p></Section>;
  if (data.turn === "owner_to_answer") return (
    <Section title="Install day">
      <Deadline s={data} />
      <p className="mt-1 text-sm text-muted-foreground">Waiting for the owner to pick one of your days:</p>
      <ul className="mt-2 space-y-1 text-sm">{data.open.map((d) => <li key={d.id}>{formatInstallDay(d.starts_at)}</li>)}</ul>
    </Section>
  );
  const need = Math.min(INSTALLER_OFFER_DAYS, data.days.length);
  const blockers = dayOfferBlockers(picks, data.days, "installer");
  const offerForm = <>
    <p className="mt-3 text-sm">Choose {need === INSTALLER_OFFER_DAYS ? `${INSTALLER_OFFER_DAYS} days` : `the ${need} day${need === 1 ? "" : "s"} left`} you can do (8am–4pm). The owner taps one and it's booked, or suggests other days.</p>
    <DayPicker days={data.days} max={need} picks={picks} setPicks={setPicks} />
    <p className="mt-2 text-xs text-muted-foreground">{picks.length} of {need} chosen.</p>
    <Button size="field" className="mt-2 w-full" disabled={busy || blockers.length > 0} onClick={() => run(() => offer({ jobId, days: picks }, "Days sent to the owner"))}>Send these days to the owner</Button>
  </>;
  if (data.turn === "installer_to_offer") return <Section title="Offer install days"><Deadline s={data} />{offerForm}</Section>;
  return (
    <Section title="The owner suggested these days">
      <Deadline s={data} />
      <p className="mt-1 text-sm">Tap a day to book it.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.open.map((d) => <Button key={d.id} size="field" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => run(() => take({ jobId, proposalId: d.id }, "Installation booked"))}>{formatInstallDay(d.starts_at)}</Button>)}</div>
      {!offering ? <Button size="field" variant="outline" className="mt-3 h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={() => setOffering(true)}>None of these work – offer other days</Button> : offerForm}
    </Section>
  );
}
