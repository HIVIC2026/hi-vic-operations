import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { chooseOwnerInstallDays, getOwnerInstallDays, installerDeclineInstallDays, installerTakeInstallDay, ownerNoneInstallDays } from "@/lib/allocation.functions";
import { INSTALL_DAY_MAX, INSTALL_DAY_MIN, formatInstallDay, installDayBlockers } from "@/lib/install-days.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookingPanel, Section } from "./panels";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const deadlineLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** Owner: pick 3–5 install days. The quoted installer taking one books it. Fallback: arrange a day directly. */
export function OwnerInstallDaysCard({ jobId, depositCleared }: { jobId: string; depositCleared: boolean }) {
  const qc = useQueryClient();
  const getState = useServerFn(getOwnerInstallDays);
  const choose = useAction(chooseOwnerInstallDays);
  const none = useAction(ownerNoneInstallDays);
  const { data } = useQuery({ queryKey: ["install-days", jobId], queryFn: () => getState({ data: { jobId } }) });
  const [picks, setPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["install-days", jobId] });
  if (!data) return null;
  if (data.expired) return <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm font-medium text-danger">New PIESA needed. The 30-day window to install after the Pre Insulation Electrical Safety Assessment (PIESA) has passed. We'll be in touch to arrange a new check.</p>;
  if (data.booked || data.fallback) return depositCleared ? <BookingPanel jobId={jobId} kind="installation" canBook /> : null;
  if (data.openDays.length) return (
    <Section title="Your installation days">
      <p className="text-sm text-muted-foreground">We've sent these days to your installer. You'll be told as soon as one is booked.</p>
      <ul className="mt-2 space-y-1 text-sm">{data.openDays.map((d) => <li key={d.id}>{formatInstallDay(d.starts_at)}</li>)}</ul>
    </Section>
  );
  if (!data.canPick) return null;
  const toggle = (d: string) => setPicks((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : cur.length >= INSTALL_DAY_MAX ? cur : [...cur, d]);
  const blockers = installDayBlockers(picks, data.days);
  return (
    <Section title="Choose days for your installation">
      <p className="text-sm">Please choose {INSTALL_DAY_MIN} to {INSTALL_DAY_MAX} days that suit you (8am–4pm). Your installer will take one and it is booked straight away.{data.deadline ? ` Installation must be on or before ${deadlineLabel(data.deadline)}.` : ""}</p>
      {data.days.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">There are no days available right now.</p> : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.days.map((d) => <Button key={d} size="field" variant={picks.includes(d) ? "default" : "outline"} aria-pressed={picks.includes(d)} className="h-auto min-h-12 whitespace-normal" onClick={() => toggle(d)}>{dayLabel(d)}</Button>)}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{picks.length} of {INSTALL_DAY_MAX} chosen.{picks.length > 0 && blockers.length ? ` ${blockers[0]}` : ""}</p>
      <Button size="field" className="mt-2 w-full" disabled={busy || blockers.length > 0}
        onClick={async () => { setBusy(true); try { await choose({ jobId, days: picks }, "Days sent to your installer"); setPicks([]); await refresh(); } finally { setBusy(false); } }}>Send my days</Button>
      <Button size="field" variant="outline" className="mt-2 h-auto min-h-12 w-full whitespace-normal" disabled={busy}
        onClick={async () => { setBusy(true); try { await none({ jobId }, "Your installer will contact you to arrange a day"); await refresh(); } finally { setBusy(false); } }}>None of these work</Button>
    </Section>
  );
}

/** Quoted installer: owner's install days as buttons. One tap = booked. */
export function InstallerDayOffer({ o, onDone }: { o: { job_id: string; job_number: string | null; suburb: string | null; postcode: string | null; days: { id: string; starts_at: string }[] }; onDone: () => void }) {
  const take = useAction(installerTakeInstallDay);
  const decline = useAction(installerDeclineInstallDays);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="font-semibold">Installation · {o.suburb ?? "Victoria"} {o.postcode}</div>
      <div className="text-muted-foreground">{o.job_number}</div>
      <div className="mt-2 text-xs font-medium">Owner's available days — tap one to book it:</div>
      {!declining ? (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">{o.days.map((d) => (
            <Button key={d.id} size="field" className="h-auto min-h-12 whitespace-normal" onClick={async () => { await take({ jobId: o.job_id, proposalId: d.id }, "Installation booked"); onDone(); }}>{formatInstallDay(d.starts_at)}</Button>
          ))}</div>
          <Button size="field" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => setDeclining(true)}>None of these work</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="field" variant="outline" className="w-full" onClick={async () => { await decline({ jobId: o.job_id, reason: reason || null }, "Home Insulation Victoria has been told"); onDone(); }}>Confirm none of these days work</Button>
        </div>
      )}
    </div>
  );
}
