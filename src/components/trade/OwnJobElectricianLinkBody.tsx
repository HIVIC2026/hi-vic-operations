// Join 4 Nov 2026: main's Part 2 (Jo 3 Nov 2026) own-job electrician page body, moved out of src/routes/e.$token.tsx so
// Part 6's page can show it when the token is an own-job link (`electrician_job_links`). Shows ONLY the next step: book
// the safety check (PIESA), then "do it in Mitti". Logic in own-job-electrician-link.server.ts. Rendered inside the
// page's TradePublicShell.
import { useState } from "react";
import { card, ghostBtn, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { bookOwnJobPiesaByLink, ownJobCantDoByLink } from "@/lib/own-job-electrician-link.functions";
import { readableError } from "@/lib/readable-error.core";
import { CANT_DO_REASONS, cantDoReasonLabel, type CantDoReason } from "@/lib/own-job-electrician-link.core";
import type { ElectricianLinkView as OwnJobLinkView } from "@/lib/own-job-electrician-link.server";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

export function OwnJobElectricianLinkBody({ token, d, refetch }: { token: string; d: OwnJobLinkView; refetch: () => Promise<unknown> }) {
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [cant, setCant] = useState(false);
  const [reason, setReason] = useState<CantDoReason>("busy");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentBack, setSentBack] = useState(false);
  const bad = (msg: string) => <section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-electrician-link-invalid><h1 className="font-display text-2xl font-bold">This link isn't working.</h1><p className="mt-1 text-sm">{msg}</p></section>;
  if (!d.ok) return bad(d.reason);
  if (sentBack) return <section className={card} data-electrician-link-cant-done><h1 className="font-display text-2xl font-bold">Thanks, we've let the installer know.</h1><p className="mt-1 text-sm">They'll sort out another electrician.</p></section>;
  const run = async (fn: () => Promise<unknown>, fallback: string) => { setBusy(true); setErr(null); try { await fn(); await refetch(); } catch (e) { setErr(readableError(e, fallback)); } finally { setBusy(false); } };
  return (
    <>
      <div>
        <p className="text-sm text-sub">Hi {d.electricianName}</p>
        <h1 className="font-display text-[26px] font-bold leading-tight">Safety check (PIESA){d.address ? ` — ${d.address}` : ""}</h1>
        {d.jobNumber && <p className="text-xs font-bold text-sub">{d.jobNumber}</p>}
      </div>
      {d.step === "book_piesa" && (
        <>
          <section className={`${card} space-y-1 text-sm`} data-electrician-link-owner>
            <p className="font-medium">Call the owner to book a time</p>
            <p>{d.ownerName ?? "Owner"}{d.ownerMobile ? <> · <a className="font-semibold underline" href={`tel:${d.ownerMobile}`}>{d.ownerMobile}</a></> : null}</p>
            {d.address && <p>{d.address}</p>}
          </section>
          <section className={`${card} space-y-3`} data-electrician-link-book>
            <h2 className="font-display text-xl font-bold">Book it</h2>
            {d.lastDay && <p className="text-xs text-sub">Book it on or before {d.lastDay} (30 days after the owner paid).</p>}
            <label className="block text-sm font-bold">Date<input type="date" className={inputCls} min={d.firstDay} {...(d.lastDay ? { max: d.lastDay } : {})} value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <label className="block text-sm font-bold">Time<input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button type="button" className={greenBtn} disabled={busy || !day || !time} onClick={() => run(() => bookOwnJobPiesaByLink({ data: { token, day, time } }), "That wasn't booked. Check your connection and try again.")}>Book it</button>
          </section>
          <section className={`${card} space-y-3`} data-electrician-link-cant>
            {!cant ? <button type="button" className={ghostBtn} onClick={() => setCant(true)}>Can't do this one</button> : (
              <>
                <h2 className="font-display text-xl font-bold">Can't do this one</h2>
                {CANT_DO_REASONS.map((r) => <label key={r} className="flex items-center gap-3 text-sm"><input type="radio" name="reason" className="h-5 w-5" checked={reason === r} onChange={() => setReason(r)} />{cantDoReasonLabel(r)}</label>)}
                {reason === "other" && <input className={inputCls} placeholder="Tell us why" aria-label="Why you can't do this one" value={note} onChange={(e) => setNote(e.target.value)} />}
                <button type="button" className={greenBtn} disabled={busy || (reason === "other" && !note.trim())}
                  onClick={async () => { setBusy(true); setErr(null); try { await ownJobCantDoByLink({ data: { token, reason, ...(reason === "other" ? { note } : {}) } }); setSentBack(true); } catch (e) { setErr(readableError(e, "That wasn't sent. Check your connection and try again.")); } finally { setBusy(false); } }}>Send</button>
              </>
            )}
          </section>
        </>
      )}
      {d.step === "do_piesa_in_mitti" && <section className={card} data-electrician-link-booked><p className="font-display text-2xl font-bold">{d.bookedStart ? `Booked for ${when(d.bookedStart)}.` : "Booked."}</p><p className="mt-1 text-sm">Do the safety check in Mitti on the day.</p></section>}
      {d.step === "done" && <section className={card} data-electrician-link-done><p className="font-display text-2xl font-bold">All done. Thanks.</p></section>}
      {err && <p role="alert" className="rounded-[18px] bg-owner-house-pink p-4 font-semibold">{err}</p>}
    </>
  );
}
