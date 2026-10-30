// A48 batch 2 part 2 (Portal books): the owner's arrival window from the installer's run — the link in the time text.
// Confirm = booked (the existing Ready Check booking). "Can't make it" → another free window that day (tap one to book it),
// or "None of these suit" (back on the list; the owner isn't asked again). Actions need the 6-digit code, like every other
// Ready Check booking action (OwnerReadyCheckTimes). A time the installer's team entered (Task 8 fix round 1, Jo 30 Oct): Confirm or
// "Can't make it" only — "Can't make it" puts the owner back on the list, the same as "None of these suit".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { OwnerCodeGate, signBtn } from "@/components/owner/OwnerSign";
import { ownerConfirmRunSlotFn, ownerNoRunWindowFn, ownerPickRunWindowFn, ownerRunSlotFn } from "@/lib/owner-link.functions";
import type { OwnerRunSlotView } from "@/lib/run-portal.core";

export function OwnerRunTime({ token }: { token: string }) {
  const load = useServerFn(ownerRunSlotFn);
  const confirm = useServerFn(ownerConfirmRunSlotFn);
  const pick = useServerFn(ownerPickRunWindowFn);
  const none = useServerFn(ownerNoRunWindowFn);
  const { data, refetch } = useQuery({ queryKey: ["owner-run-slot", token], queryFn: () => load({ data: { token } }) as Promise<OwnerRunSlotView>, retry: false });
  const [session, setSession] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!data || data.kind === "none") return null;
  const box = "rounded-[22px] bg-card p-5 text-sm shadow-sm";
  if (data.kind === "confirmed") return <section className={box} data-owner-run-time="booked"><p className="font-bold">{data.team ? <>Your Ready Check is booked for {data.day} {data.time}.</> : <>Your Ready Check is booked for {data.day}, {data.time}.</>}</p></section>;
  const go = async (f: () => Promise<unknown>) => { setErr(""); setBusy(true); try { await f(); setOther(false); await refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work. Please try again."); } finally { setBusy(false); } };
  const tile = "min-h-12 rounded-2xl border border-estimate-line bg-card px-3 text-sm font-bold";
  return (
    <section className={box} data-owner-run-time="choose">
      <p className="font-bold">Your free Ready Check is {data.day} {data.time} with {data.installer}.</p>
      {!session ? <div className="mt-3"><OwnerCodeGate token={token} onVerified={setSession} /></div> : !other ? <>
        <button type="button" className={`${signBtn} mt-3`} disabled={busy} data-run-confirm onClick={() => go(() => confirm({ data: { token, session } }))}>Confirm</button>
        {data.team
          ? <button type="button" className="mt-2 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} data-run-team-cant onClick={() => go(() => none({ data: { token, session } }))}>Can't make it</button>
          : <button type="button" className="mt-2 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} data-run-cant onClick={() => setOther(true)}>Can't make it</button>}
      </> : <>
        {data.free.length > 0 && <p className="mt-3">Tap one to book it.</p>}
        <div className="mt-2 grid gap-2">{data.free.map((w) => <button key={w.start} type="button" className={tile} disabled={busy} onClick={() => go(() => pick({ data: { token, session, start: w.start } }))}>{data.day}, {w.label}</button>)}</div>
        <button type="button" className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} data-run-none onClick={() => go(() => none({ data: { token, session } }))}>None of these suit</button>
        <button type="button" className="mt-2 min-h-12 w-full text-sm font-bold" disabled={busy} onClick={() => setOther(false)}>Back</button>
      </>}
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
    </section>
  );
}
