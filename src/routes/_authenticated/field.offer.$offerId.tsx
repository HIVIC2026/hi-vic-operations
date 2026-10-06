import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarPlus, Check, MapPin, Phone, Zap } from "lucide-react";
import { TradeShell, aud, card, ghostBtn } from "@/components/trade/TradeShell";
import { getTradeOffer, replyTradeOffer, takeTradeTime } from "@/lib/trade-view.functions";
import { AREA_SOURCE_LABEL, INSULATION_LABEL, dayTile, distanceLine, goneIn, roughInstallValue, roughValueNote } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/offer/$offerId")({
  head: () => ({ meta: [{ title: "Fresh job – Home Insulation Victoria" }, { name: "description", content: "First in, best dressed. Tap a time the owner can do and it's yours." }, { property: "og:title", content: "Fresh job – Home Insulation Victoria" }, { property: "og:description", content: "First in, best dressed. Tap a time the owner can do and it's yours." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
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
  const { data, error, refetch } = useQuery({ queryKey: ["trade-offer", offerId], queryFn: () => load({ data: { offerId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [took, setTook] = useState<string | null>(null);
  const [tooSlow, setTooSlow] = useState(false);
  const [mode, setMode] = useState<"tiles" | "cant" | "cant_sent" | "declined">("tiles");
  const [note, setNote] = useState("");
  const rc = data?.kind === "ready_check";
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading the job…</p></TradeShell>;
  const what = rc ? "Ready Check" : "Safety check";
  const tap = async (id: string, start: string) => {
    setBusy(id);
    try { const r = await take({ data: { offerId, windowId: id } }); if (r.tooSlow) setTooSlow(true); else setTook(start); await refetch(); } finally { setBusy(null); }
  };
  const value = rc ? roughInstallValue(data.ratePerM2, data.area) : null;
  if (data.status === "accepted" && data.locked) {
    const t = dayTile(data.locked.start);
    return (
      <TradeShell installer={rc}>
        {took && <section className="rounded-[22px] bg-estimate-green p-5 text-white shadow-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-estimate-green"><Check className="h-6 w-6" /></span>
          <p className="mt-2 font-display text-[32px] font-extrabold leading-tight">It's yours!</p>
          <p className="text-sm font-semibold">Oooft, that was fast clicking.</p>
          <p className="mt-2 text-sm font-bold">{t.day} · {t.window}</p>
        </section>}
        <section className="rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas">
          <span className="inline-block rounded-full bg-estimate-green px-3 py-1 text-xs font-bold text-white">Locked in</span>
          <h1 className="mt-3 font-display text-2xl font-extrabold">{what} · {t.day} · {t.window}</h1>
          <p className="mt-2 font-bold">{data.locked.owner}</p>
          <p className="text-sm text-estimate-canvas/85">{data.locked.address}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <a className="flex h-12 flex-col items-center justify-center rounded-2xl bg-estimate-canvas font-bold text-estimate-navy" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.locked.address)}`} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" />Directions</a>
            {data.locked.phone ? <a className="flex h-12 flex-col items-center justify-center rounded-2xl bg-estimate-canvas font-bold text-estimate-navy" href={`tel:${data.locked.phone}`}><Phone className="h-4 w-4" />Call owner</a> : <span />}
            <a className="flex h-12 flex-col items-center justify-center rounded-2xl bg-estimate-canvas font-bold text-estimate-navy" href={ics(`${what} – Home Insulation Victoria`, data.locked.start, data.locked.end, data.locked.address)} download="job.ics"><CalendarPlus className="h-4 w-4" />Calendar</a>
          </div>
        </section>
        <p className="text-center text-sm">Nice one. The owner knows you're coming, and we'll ping you the day before.</p>
        <Link to="/field/day/$jobId" params={{ jobId: data.jobId }} className={ghostBtn}>Open the job page</Link>
      </TradeShell>
    );
  }
  if (tooSlow || data.status !== "pending") return (
    <TradeShell installer={rc}>
      <section className={`${card} text-center`}><h1 className="font-display text-xl font-extrabold">{mode === "declined" || data.status === "declined" ? "No worries" : "This job has been taken"}</h1><p className="mt-1 text-sm">{mode === "declined" || data.status === "declined" ? "We'll offer it to someone else." : "Someone else grabbed it first. More coming."}</p></section>
      <Link to="/field" className={ghostBtn}>Back to my work</Link>
    </TradeShell>
  );
  const left = goneIn(data.expiresAt);
  return (
    <TradeShell installer={rc}>
      <section className="rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-estimate-green px-3 py-1 text-xs font-bold text-white">Fresh job</span>{left && <span className="rounded-full bg-owner-house-pink px-3 py-1 text-xs font-bold text-estimate-navy">{left}</span>}</div>
        <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-extrabold"><Zap className="h-5 w-5 text-owner-house-pink" />{what} in {data.suburb ?? "Victoria"}</h1>
        <p className="text-sm text-estimate-canvas/85">{distanceLine(data.distanceKm)}</p>
        {rc ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-estimate-canvas/10 p-3"><p className="font-display text-xl font-extrabold">{data.area ? `~${data.area} m²` : "—"}</p><p className="text-xs">{AREA_SOURCE_LABEL[data.areaSource]}</p></div>
              <div className="rounded-2xl bg-estimate-canvas/10 p-3"><p className="font-display text-xl font-extrabold">{INSULATION_LABEL[data.insulation]}</p><p className="text-xs">Insulation there now</p></div>
            </div>
            <p className="mt-4 font-display text-4xl font-extrabold text-estimate-green">{value != null ? `~${aud(value)}` : "Rate to confirm"}</p>
            <p className="text-sm font-bold">rough install value</p>
            <p className="mt-2 text-xs text-estimate-canvas/80">{roughValueNote(data.areaSource)}</p>
          </>
        ) : (
          <><p className="mt-4 font-display text-4xl font-extrabold text-estimate-green">{data.pay != null ? aud(data.pay) : "Rate to confirm"}</p><p className="text-sm font-bold">in your pocket</p></>
        )}
      </section>
      {mode === "cant" ? (
        <section className={card}>
          <h2 className="font-display text-lg font-extrabold">Suggest another time</h2>
          <p className="mt-1 text-sm">Tell us a time that works and we'll check with the owner.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} placeholder="e.g. Thursday morning" className="mt-3 w-full rounded-2xl border border-estimate-line p-3 text-base" />
          <button type="button" className={`${ghostBtn} mt-3`} onClick={async () => { await reply({ data: { offerId, reply: "cant_make", note: note.trim() || null } }); setMode("cant_sent"); }}>Send to the office</button>
        </section>
      ) : mode === "cant_sent" ? (
        <section className={card}><p className="font-bold">Thanks, we've got it.</p><p className="text-sm">We'll check with the owner and come back to you. The times below are still open if one works.</p></section>
      ) : null}
      <section className="space-y-2">
        <p className="font-display text-lg font-extrabold">First in, best dressed</p>
        <p className="text-sm">Tap a time the owner can do and it's yours.</p>
        <div className="grid grid-cols-2 gap-2">{data.windows.map((w) => { const t = dayTile(w.start); return (
          <button key={w.id} type="button" disabled={!!busy} onClick={() => tap(w.id, w.start)} className="flex min-h-20 flex-col items-center justify-center rounded-[18px] border-2 border-estimate-green bg-card p-3 font-bold"><span className="text-sm">{t.day}</span><span className="font-display text-lg font-extrabold">{busy === w.id ? "Booking…" : t.window}</span></button>); })}</div>
        <div className="flex justify-between px-1 pt-1 text-sm font-bold text-estimate-blue">
          {data.canSuggest ? <button type="button" onClick={() => setMode("cant")}>Suggest another time</button> : <span />}
          <button type="button" onClick={async () => { await reply({ data: { offerId, reply: "not_for_me", note: null } }); setMode("declined"); await refetch(); }}>Not for me</button>
        </div>
        {!data.canSuggest && <p className="pt-1 text-xs text-estimate-navy/70">Can't make these? If nobody takes it, you can suggest another time from {data.suggestUnlockLabel}.</p>}
        <p className="pt-2 text-center text-xs text-estimate-navy/70">Address and owner details show once you take it.</p>
      </section>
    </TradeShell>
  );
}
