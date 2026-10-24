import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { CalendarPlus, Check, MapPin, Phone, Zap } from "lucide-react";
import { TradeShell, aud, card, ghostBtn } from "@/components/trade/TradeShell";
import { getTradeOffer, offerTradeReadyCheckTimes, replyTradeOffer, takeTradeTime } from "@/lib/trade-view.functions";
import { InstallerReadyCheckTimesCard, ReadyCheckTimesForm } from "@/components/portal/ready-check-times-installer";
import { AREA_SOURCE_LABEL, INSULATION_LABEL, dayTile, distanceLine, goneIn, roughInstallValue, roughValueNote } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/offer/$offerId")({
  head: () => ({ meta: [{ title: "New job – Home Insulation Victoria" }, { name: "description", content: "The first trade to accept gets the job. Choose one of the owner's times to accept." }, { property: "og:title", content: "New job – Home Insulation Victoria" }, { property: "og:description", content: "The first trade to accept gets the job. Choose one of the owner's times to accept." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: OfferPage,
});

const ics = (title: string, start: string, end: string | null, where: string) => {
  const f = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${f(start)}`, `DTEND:${f(end ?? start)}`, `SUMMARY:${title}`, `LOCATION:${where}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"))}`;
};

function OfferPage() {
  const { offerId } = Route.useParams();
  const load = useServerFn(getTradeOffer);
  const take = useServerFn(takeTradeTime);
  const reply = useServerFn(replyTradeOffer);
  const offerTimes = useServerFn(offerTradeReadyCheckTimes);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-offer", offerId], queryFn: () => load({ data: { offerId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [took, setTook] = useState<string | null>(null);
  const [tooSlow, setTooSlow] = useState(false);
  const [mode, setMode] = useState<"tiles" | "cant" | "cant_sent" | "declined">("tiles");
  const [note, setNote] = useState("");
  const [fail, setFail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flight = useRef(false); // one booking/reply at a time, even for same-tick double taps
  const rc = data?.kind === "ready_check";
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading the job…</p></TradeShell>;
  const what = rc ? "Ready Check" : "Pre Insulation Electrical Safety Assessment (PIESA)";
  const tap = async (id: string, start: string) => {
    if (busy || flight.current) return;
    flight.current = true; setBusy(id); setFail(null);
    try { const r = await take({ data: { offerId, windowId: id } }); if (r.tooSlow) setTooSlow(true); else setTook(start); await refetch(); }
    catch (e) { setFail(`That time couldn't be booked: ${(e as Error).message || "check your signal and try again."}`); }
    finally { setBusy(null); flight.current = false; }
  };
  // Reply actions ("Suggest another time" / "Not for me"): one tap = one send; failures are shown, never silent.
  const send = async (r: "cant_make" | "not_for_me", after: () => void | Promise<unknown>) => {
    if (sending || busy || flight.current) return;
    flight.current = true; setSending(true); setFail(null);
    try { await reply({ data: { offerId, reply: r, note: r === "cant_make" ? note.trim() || null : null } }); await after(); }
    catch (e) { setFail(`Couldn't send that: ${(e as Error).message || "check your signal and try again."}`); }
    finally { setSending(false); flight.current = false; }
  };
  const value = rc ? roughInstallValue(data.ratePerM2, data.area) : null;
  if (data.status === "accepted" && data.locked) {
    const t = dayTile(data.locked.start);
    return (
      <TradeShell installer={rc}>
        {took && <section className="rounded-[19px] border border-line bg-mint p-5 text-ink md:p-[23px]">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-action text-action-foreground"><Check className="h-6 w-6" /></span>
          <p className="mt-2 font-display text-[26px] font-bold leading-tight">Job accepted</p>
          <p className="mt-2 text-sm font-bold">{t.day} · {t.window}</p>
        </section>}
        <section className="rounded-[19px] border border-mist-line bg-mist p-5 text-ink md:p-[23px]">
          <span className="inline-block rounded-[18px] bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-hiv-green">Booked</span>
          <h1 className="mt-3 font-display text-2xl font-bold">{what} · {t.day} · {t.window}</h1>
          <p className="mt-2 font-bold">{data.locked.owner}</p>
          <p className="text-sm text-sub">{data.locked.address}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <a className="flex h-12 flex-col items-center justify-center rounded-[10px] border border-line bg-paper font-bold text-hiv-blue" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.locked.address)}`} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" />Directions</a>
            {data.locked.phone ? <a className="flex h-12 flex-col items-center justify-center rounded-[10px] border border-line bg-paper font-bold text-hiv-blue" href={`tel:${data.locked.phone}`}><Phone className="h-4 w-4" />Call owner</a> : <span />}
            <a className="flex h-12 flex-col items-center justify-center rounded-[10px] border border-line bg-paper font-bold text-hiv-blue" href={ics(`${what} – Home Insulation Victoria`, data.locked.start, data.locked.end, data.locked.address)} download="job.ics"><CalendarPlus className="h-4 w-4" />Calendar</a>
          </div>
        </section>
        <p className="text-center text-sm text-sub">The owner has been told the time.</p>
        <Link to="/field/day/$jobId" params={{ jobId: data.jobId }} className={ghostBtn}>Open the job page</Link>
      </TradeShell>
    );
  }
  if (rc && data.accepted && !data.locked) return (
    <TradeShell installer>
      <section className={card}><h1 className="font-display text-xl font-bold">Ready Check in {data.suburb ?? "Victoria"}</h1><p className="mt-1 text-sm text-sub">You've taken this job. The owner picks one of your times.</p></section>
      <InstallerReadyCheckTimesCard jobId={data.jobId} />
      <Link to="/field/day/$jobId" params={{ jobId: data.jobId }} className={ghostBtn}>Open the job page</Link>
    </TradeShell>
  );
  if (tooSlow || data.status !== "pending") return (
    <TradeShell installer={rc}>
      <section className={`${card} text-center`}><h1 className="font-display text-xl font-bold">{mode === "declined" || data.status === "declined" ? "Offer declined" : "This job has been taken"}</h1><p className="mt-1 text-sm">{mode === "declined" || data.status === "declined" ? "We'll offer it to someone else." : "Another trade accepted it first. This offer is now closed."}</p></section>
      <Link to="/field" className={ghostBtn}>Back to my work</Link>
    </TradeShell>
  );
  const left = goneIn(data.expiresAt);
  return (
    <TradeShell installer={rc}>
      <section className="rounded-[19px] border border-mist-line bg-mist p-5 text-ink md:p-[23px]">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-[18px] bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-hiv-green">New job</span>{left && <span className="rounded-[18px] bg-pink px-2.5 py-0.5 text-[11px] font-semibold text-rose">{left}</span>}</div>
        <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold"><Zap className="h-5 w-5 text-owner-house-pink" />{what} in {data.suburb ?? "Victoria"}</h1>
        <p className="text-sm text-sub">{distanceLine(data.distanceKm)}</p>
        {rc ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-paper border border-line p-3"><p className="font-display text-xl font-bold">{data.area ? `~${data.area} m²` : "—"}</p><p className="text-xs">{AREA_SOURCE_LABEL[data.areaSource]}</p></div>
              <div className="rounded-2xl bg-paper border border-line p-3"><p className="font-display text-xl font-bold">{INSULATION_LABEL[data.insulation]}</p><p className="text-xs">Insulation there now</p></div>
            </div>
            <p className="mt-4 font-display text-[30px] font-bold text-estimate-green">{value != null ? `~${aud(value)}` : "Rate to confirm"}</p>
            <p className="text-sm font-bold">rough install value</p>
            <p className="mt-2 text-xs text-sub">{roughValueNote(data.areaSource)}</p>
          </>
        ) : (
          <><p className="mt-4 font-display text-[30px] font-bold text-estimate-green">{data.pay != null ? aud(data.pay) : "Rate to confirm"}</p><p className="text-sm font-bold">your rate for this job</p></>
        )}
      </section>
      {mode === "cant" ? (
        <section className={card}>
          <h2 className="font-display text-lg font-bold">Suggest another time</h2>
          <p className="mt-1 text-sm">Tell us a time that works and we'll check with the owner.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} placeholder="e.g. Thursday morning" className="mt-3 w-full rounded-2xl border border-estimate-line p-3 text-base" />
          <button type="button" className={`${ghostBtn} mt-3`} disabled={sending} aria-busy={sending} onClick={() => send("cant_make", () => setMode("cant_sent"))}>{sending ? "Sending…" : "Send to the office"}</button>
        </section>
      ) : mode === "cant_sent" ? (
        <section className={card}><p className="font-bold">Thanks, we've got it.</p><p className="text-sm">We'll check with the owner and come back to you. The times below are still open if one works.</p></section>
      ) : null}
      {rc ? (
        <section className={card} data-ready-check-offer>
          <h2 className="font-display text-base font-bold">Offer the owner 3 times</h2>
          {fail && <p role="alert" className="mt-2 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger" data-offer-error>{fail}</p>}
          <ReadyCheckTimesForm days={data.rcDays} busy={!!busy || sending} sendLabel="Accept and send these times" onSend={async (picks) => {
            if (busy || flight.current) return;
            flight.current = true; setBusy("times"); setFail(null);
            try { await offerTimes({ data: { offerId, picks } }); await refetch(); }
            catch (e) { setFail(`Couldn't send your times: ${(e as Error).message || "check your signal and try again."}`); }
            finally { setBusy(null); flight.current = false; }
          }} />
          <div className="flex justify-end pt-2 text-sm font-bold text-estimate-blue">
            <button type="button" className="min-h-11 px-1" disabled={sending || !!busy} data-not-for-me onClick={() => send("not_for_me", async () => { setMode("declined"); await refetch(); })}>{sending ? "Sending…" : "Not for me"}</button>
          </div>
          <p className="pt-1 text-xs text-sub">This offer is only for you and stays open 24 hours. The address shows once you accept.</p>
        </section>
      ) : (
      <section className="space-y-2">
        <p className="font-display text-base font-bold">Pick a time to accept</p>
        <p className="text-sm text-sub">The first trade to accept gets the job.</p>
        {fail && <p role="alert" className="rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger" data-offer-error>{fail}</p>}
        {data.windows.length === 0 && <p className={`${card} text-sm`} data-no-times>No times are open on this offer right now. Suggest a time or check back soon.</p>}
        <div className="grid grid-cols-2 gap-2">{data.windows.map((w) => { const t = dayTile(w.start); return (
          <button key={w.id} type="button" disabled={!!busy || sending} onClick={() => tap(w.id, w.start)} className="flex min-h-20 flex-col items-center justify-center rounded-[18px] border border-line bg-paper hover:border-action p-3 font-bold"><span className="text-sm">{t.day}</span><span className="font-display text-lg font-bold">{busy === w.id ? "Booking…" : t.window}</span></button>); })}</div>
        <div className="flex justify-between gap-2 pt-1 text-sm font-bold text-estimate-blue">
          {data.canSuggest ? <button type="button" className="min-h-11 px-1" disabled={sending || !!busy} onClick={() => setMode("cant")}>Suggest another time</button> : <span />}
          <button type="button" className="min-h-11 px-1" disabled={sending || !!busy} data-not-for-me onClick={() => send("not_for_me", async () => { setMode("declined"); await refetch(); })}>{sending && mode !== "cant" ? "Sending…" : "Not for me"}</button>
        </div>
        {!data.canSuggest && <p className="pt-1 text-xs text-sub">Can't make these? If nobody takes it, you can suggest another time from {data.suggestUnlockLabel}.</p>}
        <p className="pt-2 text-center text-xs text-sub">Address shows once you accept.</p>
      </section>
      )}
    </TradeShell>
  );
}
