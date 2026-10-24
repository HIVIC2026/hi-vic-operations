// Owner (secure link): the installer's 3 Ready Check times on our leads (Jo 24 Oct 2026, decisions 52–53).
// Tap one to book it, or "None of these suit – suggest other days" (the installer then picks a time or offers new ones).
// The owner never picks Ready Check windows up front any more. Booking actions need the 6-digit code, like install days.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { OwnerCodeGate, signBtn } from "@/components/owner/OwnerSign";
import { ownerChangeReadyCheckFn, ownerReadyCheckTimesFn, ownerSuggestReadyCheckDaysFn, ownerTakeReadyCheckTimeFn } from "@/lib/owner-link.functions";
import { READY_CHECK_OWNER_SUGGEST_MAX, formatReadyCheckTime } from "@/lib/ready-check-times.core";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
type State = { applies: boolean; allowed?: boolean; turn?: string; bookedAt?: string | null; canChange?: boolean; open?: { id: string; starts_at: string; by: string }[]; days?: string[] } | null;

export function OwnerReadyCheckTimes({ token }: { token: string }) {
  const load = useServerFn(ownerReadyCheckTimesFn);
  const take = useServerFn(ownerTakeReadyCheckTimeFn);
  const suggest = useServerFn(ownerSuggestReadyCheckDaysFn);
  const change = useServerFn(ownerChangeReadyCheckFn);
  const [changing, setChanging] = useState(false);
  const { data, refetch } = useQuery({ queryKey: ["owner-rc-times", token], queryFn: () => load({ data: { token } }) as Promise<State>, retry: false });
  const [session, setSession] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!data?.applies || !data.allowed) return null;
  const go = async (f: () => Promise<unknown>) => { setErr(""); setBusy(true); try { await f(); setDays([]); setSuggesting(false); await refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work. Please try again."); } finally { setBusy(false); } };
  const tile = (on: boolean) => `min-h-12 rounded-2xl border px-3 text-sm font-bold ${on ? "border-estimate-green bg-estimate-mint" : "border-estimate-line bg-card"}`;
  const box = "rounded-[22px] bg-card p-5 text-sm shadow-sm";
  // Decision 80: "Change time" cancels the booking; the installer then offers 3 new times.
  if (data.turn === "booked") return <section className={box} data-owner-rc-times="booked">
    <p className="font-bold">Your Ready Check is booked{data.bookedAt ? ` for ${formatReadyCheckTime(data.bookedAt)}` : ""}.</p>
    {data.canChange && (!changing ? <button type="button" className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" onClick={() => setChanging(true)}>Change time</button> : !session ? <div className="mt-3"><OwnerCodeGate token={token} onVerified={setSession} /></div> : <>
      <p className="mt-3">This cancels the booked time. Your installer will then offer you 3 new times.</p>
      <button type="button" className={`${signBtn} mt-3`} disabled={busy} onClick={() => go(async () => { await change({ data: { token, session } }); setChanging(false); })}>Yes, change the time</button>
      <button type="button" className="mt-2 min-h-12 w-full text-sm font-bold" disabled={busy} onClick={() => setChanging(false)}>Keep it</button>
    </>)}
    {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
  </section>;
  if (data.turn === "no_installer" || data.turn === "installer_to_offer") return <section className={box} data-owner-rc-times="waiting"><p className="font-bold">Your installer will offer you 3 times for your free Ready Check.</p><p className="mt-1">We'll send you a link to choose one.</p></section>;
  if (data.turn === "installer_to_answer") return <section className={box} data-owner-rc-times="with_installer"><p className="font-bold">Your days are with your installer.</p><p className="mt-1">They'll choose a time on one of them, or offer you new times.</p></section>;
  if (data.turn !== "owner_to_answer") return null;
  return (
    <section className={box} data-owner-rc-times="choose">
      <h3 className="font-display text-lg font-extrabold">Choose your Ready Check time</h3>
      <p className="mt-1">Your installer can come at these times. Tap one to book it.</p>
      {!session ? <div className="mt-3"><OwnerCodeGate token={token} onVerified={setSession} /></div> : <>
        <div className="mt-3 grid gap-2">{(data.open ?? []).map((o) => <button key={o.id} type="button" className={tile(false)} disabled={busy} onClick={() => go(() => take({ data: { token, session, proposalId: o.id } }))}>{formatReadyCheckTime(o.starts_at)}</button>)}</div>
        {!suggesting ? <button type="button" className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} onClick={() => setSuggesting(true)}>None of these suit – suggest other days</button> : <>
          <p className="mt-4 font-semibold">Pick up to {READY_CHECK_OWNER_SUGGEST_MAX} days that suit you. Your installer will choose a time on one, or offer new times.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">{(data.days ?? []).map((d) => { const on = days.includes(d); return <button key={d} type="button" className={tile(on)} aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== d) : days.length < READY_CHECK_OWNER_SUGGEST_MAX ? [...days, d] : days)}>{dayLabel(d)}</button>; })}</div>
          <button type="button" className={`${signBtn} mt-4`} disabled={busy || !days.length} onClick={() => go(() => suggest({ data: { token, session, days } }))}>Send my {days.length || ""} day{days.length === 1 ? "" : "s"}</button>
        </>}
      </>}
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
    </section>
  );
}
