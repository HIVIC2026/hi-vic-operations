// Job offer = approved mock-up M5 (Jo 24 Oct 2026, decisions 200–202): an our-lead Ready Check the office picked this
// installer for. Two plain lines up top (decision 201), one Next panel to take the job by offering 3 times, what happens
// next, the 24-hour note and "Not for me". The electrician's PIESA offer shares the route (times from the owner).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { TradeShell, aud } from "@/components/trade/TradeShell";
import { getTradeOffer, offerTradeReadyCheckTimes, replyTradeOffer, takeTradeTime } from "@/lib/trade-view.functions";
import { InstallerReadyCheckTimesCard, ReadyCheckTimesForm } from "@/components/portal/ready-check-times-installer";
import { distanceLine, goneIn } from "@/lib/trade-view.core";
import { NOT_FOR_ME_SHEET, OFFER_ONLY_YOU, OFFER_PAY_LINE, OFFER_STEPS, dayAndTime, offerAcceptedView, offerClosed, offerTopLines, shortDay, clock } from "@/lib/installer-screens.core";
import { ContactButtons, ErrorLine, Group, NextPanel, NoFormNoPay, Note, QuietButton, Row, Screen, ScreenHead, outlineLinkClass } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/offer/$offerId")({
  head: () => ({ meta: [{ title: "New job offer – Home Insulation Victoria" }, { name: "description", content: "A Ready Check near you. Offer the owner 3 times to take the job." }, { property: "og:title", content: "New job offer – Home Insulation Victoria" }, { property: "og:description", content: "A Ready Check near you. Offer the owner 3 times to take the job." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
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
  const { data, error, refetch } = useQuery({ queryKey: ["trade-offer", offerId], queryFn: () => load({ data: { offerId } }), staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [took, setTook] = useState<string | null>(null);
  const [tooSlow, setTooSlow] = useState(false);
  const [mode, setMode] = useState<"tiles" | "cant" | "cant_sent" | "declined">("tiles");
  const [note, setNote] = useState("");
  const [fail, setFail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const flight = useRef(false); // one booking/reply at a time, even for same-tick double taps
  const rc = data?.kind === "ready_check";
  if (error) return <TradeShell installer={false}><p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p></TradeShell>;
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
  if (data.status === "accepted" && data.locked) {
    return (
      <TradeShell installer={rc}>
        <Screen>
          <ScreenHead pill={took ? "Job accepted" : "Booked"} title={`${what} · ${dayAndTime(data.locked.start)}`} line1={data.locked.owner ?? undefined} line2={data.locked.address}>
            <ContactButtons phone={data.locked.phone} address={data.locked.address} />
          </ScreenHead>
          <a className={outlineLinkClass} href={ics(`${what} – Home Insulation Victoria`, data.locked.start, data.locked.end, data.locked.address)} download="job.ics">Add to calendar</a>
          <p className="text-center text-sm text-sub">The owner has been told the time.</p>
          <Link to="/field/$jobId" params={{ jobId: data.jobId }} className={outlineLinkClass}>Open the job page</Link>
        </Screen>
      </TradeShell>
    );
  }
  // Approved state M5-accepted (decision 52): times sent, the owner picks; address released on booking (decision 82).
  if (rc && data.accepted && !data.locked) {
    const v = offerAcceptedView({ ownerFirstName: null, suburb: data.suburb, jobNumber: data.jobNumber, times: data.offeredTimes });
    return (
      <TradeShell installer>
        <Screen>
          <ScreenHead pill={v.pill} title={v.title} line2={v.line2} />
          <NextPanel title={v.next.title} sub={v.next.sub}>
            {v.times.length > 0 && <ul className="mt-3" data-offered-times>{v.times.map((t) => <li key={t} className="flex min-h-10 items-center border-b border-line text-[15px] font-medium last:border-b-0">{t}</li>)}</ul>}
            <InstallerReadyCheckTimesCard jobId={data.jobId} />
          </NextPanel>
          <Group title="Owner">{v.owner.map(([k, val], i) => <Row key={k} label={k} value={val} tone="sub" last={i === v.owner.length - 1} />)}</Group>
          <Group title="What happens next">{v.what.map(([k, val], i) => <Row key={k} label={k} value={val} last={i === v.what.length - 1} />)}</Group>
          <Link to="/field" className={outlineLinkClass}>Back to My work</Link>
        </Screen>
      </TradeShell>
    );
  }
  if (tooSlow || data.status !== "pending") {
    const c = offerClosed(data.status, mode === "declined");
    return (
      <TradeShell installer={rc}>
        <Screen>
          <section className="rounded-[18px] bg-mist p-4 text-center"><h1 className="text-[17px] font-semibold">{c.title}</h1><p className="mt-1 text-sm text-sub">{c.body}</p></section>
          <Link to="/field" className={outlineLinkClass}>Back to My work</Link>
        </Screen>
      </TradeShell>
    );
  }
  const left = goneIn(data.expiresAt);
  return (
    <TradeShell installer={rc}>
      <Screen>
        <ScreenHead pill={rc ? "New job offer" : "New job"} pillNote={left} title={`${what} in ${data.suburb ?? "Victoria"}`} line2={`${distanceLine(data.distanceKm)}${rc ? " · Home Insulation Victoria lead" : ""}`} />
        {rc ? (
          <>
            <div className="-mt-1.5" data-offer-top>
              {offerTopLines({ areaM2: data.area, insulation: data.insulation }).map((l) => <p key={l} className="flex min-h-7 items-center text-[15px]">{l}</p>)}
              <p className="mt-2 text-[13px] leading-[1.5] text-sub">{OFFER_PAY_LINE}</p>
              {/* Decision 318: one short line on every offer. */}
              <NoFormNoPay line className="mt-1.5" />
            </div>
            <NextPanel eyebrow="To take this job" title="Offer the owner 3 Ready Check times" sub="Three different days in the next 3 weeks, 7am–5pm. The owner picks one or suggests other days.">
              <div data-ready-check-offer>
                <ErrorLine>{fail}</ErrorLine>
                <ReadyCheckTimesForm days={data.rcDays} busy={!!busy || sending} sendLabel="Accept this job" note="Sends these 3 times to the owner. The address and the owner's details show once you accept." onSend={async (picks) => {
                  if (busy || flight.current) return;
                  flight.current = true; setBusy("times"); setFail(null);
                  try { await offerTimes({ data: { offerId, picks } }); await refetch(); }
                  catch (e) { setFail(`Couldn't send your times: ${(e as Error).message || "check your signal and try again."}`); }
                  finally { setBusy(null); flight.current = false; }
                }} />
              </div>
            </NextPanel>
            <Group title="What happens next">
              {OFFER_STEPS.map((s, i) => <div key={s} className={`flex min-h-11 items-center gap-3 text-sm leading-[1.45] ${i < OFFER_STEPS.length - 1 ? "border-b border-line" : ""}`}><span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-mist text-xs font-bold">{i + 1}</span>{s}</div>)}
            </Group>
            <p className="text-center text-[13px] leading-[1.5] text-sub">{OFFER_ONLY_YOU}</p>
            {/* Approved state M5-not-for-me (decision 51): one confirmation sheet before the offer goes back to the office. */}
            {confirmDecline ? (
              <section className="rounded-[18px] border border-line p-4" role="dialog" aria-label={NOT_FOR_ME_SHEET.title} data-not-for-me-sheet>
                <h2 className="text-[17px] font-semibold">{NOT_FOR_ME_SHEET.title}</h2>
                <p className="mt-1 text-sm leading-[1.45] text-sub">{NOT_FOR_ME_SHEET.body}</p>
                <QuietButton className="mt-3" disabled={sending || !!busy} data-not-for-me onClick={() => send("not_for_me", async () => { setMode("declined"); await refetch(); })}>{sending ? "Sending…" : NOT_FOR_ME_SHEET.yes}</QuietButton>
                <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub" onClick={() => setConfirmDecline(false)}>{NOT_FOR_ME_SHEET.keep}</button>
              </section>
            ) : (
              <button type="button" className="flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub disabled:opacity-50" disabled={sending || !!busy} data-not-for-me-open onClick={() => setConfirmDecline(true)}>Not for me</button>
            )}
          </>
        ) : (
          <>
            <p className="-mt-1.5 text-[15px]"><span className="text-[22px] font-semibold text-hiv-green">{data.pay != null ? aud(data.pay) : "Rate to confirm"}</span> <span className="text-sub">your rate for this job</span></p>
            <NoFormNoPay line className="-mt-2" />
            {mode === "cant" ? (
              <section className="rounded-[18px] border border-line p-4">
                <h2 className="text-[17px] font-semibold">Suggest another time</h2>
                <p className="mt-1 text-sm text-sub">Tell us a time that works and we'll check with the owner.</p>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} placeholder="e.g. Thursday morning" className="mt-3 w-full rounded-xl border border-line p-3 text-base" />
                <QuietButton className="mt-3" disabled={sending} aria-busy={sending} onClick={() => send("cant_make", () => setMode("cant_sent"))}>{sending ? "Sending…" : "Send to the office"}</QuietButton>
              </section>
            ) : mode === "cant_sent" ? (
              <section className="rounded-[18px] bg-mist p-4"><p className="font-semibold">Thanks, we've got it.</p><p className="text-sm text-sub">We'll check with the owner and come back to you. The times below are still open if one works.</p></section>
            ) : null}
            <NextPanel eyebrow="To take this job" title="Pick one of the owner's times" sub="Tap a time and it's booked. The address shows once you accept.">
              <ErrorLine>{fail}</ErrorLine>
              {data.windows.length === 0 && <p className="mt-3 text-sm text-sub" data-no-times>No times are open on this offer right now. Suggest a time or check back soon.</p>}
              <div className="mt-3.5 grid grid-cols-2 gap-2">{data.windows.map((w) => (
                <button key={w.id} type="button" disabled={!!busy || sending} onClick={() => tap(w.id, w.start)} className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-line bg-paper px-2 text-sm font-semibold"><span>{shortDay(w.start)}</span><span className="text-hiv-blue">{busy === w.id ? "Booking…" : clock(w.start)}</span></button>))}</div>
              <div className="mt-2 flex justify-between gap-2 text-sm font-semibold text-hiv-blue">
                {data.canSuggest ? <button type="button" className="min-h-11 px-1" disabled={sending || !!busy} onClick={() => setMode("cant")}>Suggest another time</button> : <span />}
                <button type="button" className="min-h-11 px-1" disabled={sending || !!busy} data-not-for-me onClick={() => send("not_for_me", async () => { setMode("declined"); await refetch(); })}>{sending && mode !== "cant" ? "Sending…" : "Not for me"}</button>
              </div>
              {!data.canSuggest && <Note>Can't make these? If nobody takes it, you can suggest another time from {data.suggestUnlockLabel}.</Note>}
            </NextPanel>
          </>
        )}
      </Screen>
    </TradeShell>
  );
}
