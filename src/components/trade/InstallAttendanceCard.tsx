// Decision 327: the electrician's "Start of the install day" card on their job page (the text links to
// /field/{jobId}#install-attendance). Presentation only: reads and answers through trade-view.functions (electricians only,
// business-scoped). "Can't make it" asks a reason and 1–5 days they can do (or none) inside the 30-day window.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { Button, Section } from "@/components/trade/trade-ui";
import { useAction } from "@/hooks/use-me";
import { answerTradeInstallAttendance, getTradeInstallAttendance } from "@/lib/trade-view.functions";
import { ATTENDANCE_ANCHOR, ATTENDANCE_MAX_DAYS, ATTENDANCE_NO, ATTENDANCE_REASONS, ATTENDANCE_YES, declineBlockers, type AttendanceReason } from "@/lib/trade-shared-consts.core";
import { DayGrid, dayTileLabel } from "@/components/trade/installer-kit";

export function InstallAttendanceCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getTradeInstallAttendance);
  const { data } = useQuery({ queryKey: ["trade-install-attendance", jobId], queryFn: () => load({ data: { jobId } }), staleTime: 20_000 });
  const answer = useAction(answerTradeInstallAttendance);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<AttendanceReason | null>(null);
  const [other, setOther] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [noDays, setNoDays] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data?.show || typeof window === "undefined" || window.location.hash !== `#${ATTENDANCE_ANCHOR}`) return;
    document.getElementById(ATTENDANCE_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [data?.show]);
  if (!data?.show) return null;
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); setDeclining(false); } finally { setBusy(false); } };
  if (!data.bookingId) return (
    <div id={ATTENDANCE_ANCHOR} className="scroll-mt-4" data-install-attendance>
      <Section title="Start of the install day"><p className="text-sm text-sub">{data.released}</p></Section>
    </div>
  );
  const bookingId = data.bookingId;
  const blockers = declineBlockers({ reason, otherText: other, days, noDays, allowed: data.days, bookedDay: null });
  return (
    <div id={ATTENDANCE_ANCHOR} className="scroll-mt-4" data-install-attendance>
      <Section title="Start of the install day">
        <p className="text-[15px] font-medium">{data.line}</p>
        {data.state === "confirmed" && <p className="mt-2 text-sm text-hiv-green" data-attendance-confirmed>{data.auto ? "You're booked — this is a day you said you can do." : "Thanks — you've confirmed you'll be there."}</p>}
        {!declining && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.state !== "confirmed" && <Button size="field" disabled={busy} onClick={() => run(() => answer({ jobId, bookingId, answer: "yes" }, "Thanks — confirmed"))}><Check /> {ATTENDANCE_YES}</Button>}
            <Button size="field" variant="outline" disabled={busy} onClick={() => setDeclining(true)}><X /> {ATTENDANCE_NO}</Button>
          </div>
        )}
        {declining && (
          <div className="mt-3 space-y-3" data-attendance-decline>
            <p className="text-sm font-semibold">Why can't you make it?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(ATTENDANCE_REASONS) as AttendanceReason[]).map((r) => <Button key={r} size="field" variant={reason === r ? "default" : "outline"} aria-pressed={reason === r} onClick={() => setReason(r)}>{ATTENDANCE_REASONS[r]}</Button>)}
            </div>
            {reason === "other" && <input aria-label="Reason" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Say why" />}
            <p className="text-sm font-semibold">Which days can you do instead? Pick 1 to {ATTENDANCE_MAX_DAYS}{data.deadline ? ` (on or before ${dayTileLabel(data.deadline)})` : ""}.</p>
            {!noDays && (data.days.length ? <DayGrid days={data.days} picked={days} label={dayTileLabel} onToggle={(d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : days.length >= ATTENDANCE_MAX_DAYS ? days : [...days, d])} /> : <p className="text-sm text-sub">There are no other days left inside the 30-day window.</p>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noDays} onChange={(e) => { setNoDays(e.target.checked); setDays([]); }} /> I can't do any of these days</label>
            <p className="text-[13px] text-sub">The booked day is released and the installer offers the owner only the days you can do.</p>
            <Button size="field" className="w-full" disabled={busy || blockers.length > 0} onClick={() => run(() => answer({ jobId, bookingId, answer: "no", reason: reason!, otherText: reason === "other" ? other : null, days, noDays }, "Thanks — the installer has been told"))}>{busy ? "Sending…" : "Send"}</Button>
            <Button size="field" variant="outline" className="w-full" disabled={busy} onClick={() => setDeclining(false)}>Back</Button>
          </div>
        )}
      </Section>
    </div>
  );
}
