// A48 batch 2, part 2 (Jo 30 Oct 2026): the installer's run page — the link in the "you've got a run" text. Only the run's own
// business sees it (installer-run.server, trade context). Each home in route order: address, owner name + phone where the
// owner agreed to share (Call / Directions), m² with its source (best first) and the owner's quick-tap answers (the roof
// tap is the roof shape). The installer can take homes out before choosing a day (back in the pool; the owner isn't told)
// or say "Not for me" (back to the office). Task 7: "Portal books" — pick a day (≥ 2 days ahead) and the first arrival time
// (default 8:00); each home gets a 1-hour window in route order and its owner is texted to confirm. Task 8: "Our team
// books" — the team enters each agreed day + exact time per home (the owner gets the confirm text); "Move run" — a new day,
// every owner gets a new window to confirm; a window the owner cancelled shows "Fill from nearby waiting owners".
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { TradeShell } from "@/components/trade/TradeShell";
import { chooseTradeRunDay, chooseTradeRunTeam, declineTradeRun, enterTradeRunTime, fillTradeRunSlot, getTradeRun, moveTradeRun, removeTradeRunHome } from "@/lib/installer-run.functions";
import { READY_CHECK_TIMES } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import { MAX_PER_DAY, NO_EXPIRY } from "@/lib/run-route.core";
import { goneIn } from "@/lib/trade-view.core";
import { NOT_FOR_ME_SHEET, offerClosed } from "@/lib/installer-screens.core";
import { CheckLine, ContactButtons, DayGrid, ErrorLine, Group, PrimaryButton, QuietButton, Row, Screen, ScreenHead, TimeRows, dayTileLabel, outlineLinkClass } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/run/$runId")({
  head: () => ({ meta: [{ title: "Your run – Home Insulation Victoria" }, { name: "robots", content: "noindex" }] }),
  component: RunPage,
});

function RunPage() {
  const { runId } = Route.useParams();
  const load = useServerFn(getTradeRun);
  const remove = useServerFn(removeTradeRunHome);
  const decline = useServerFn(declineTradeRun);
  const choose = useServerFn(chooseTradeRunDay);
  const chooseTeam = useServerFn(chooseTradeRunTeam);
  const enterTime = useServerFn(enterTradeRunTime);
  const move = useServerFn(moveTradeRun);
  const fill = useServerFn(fillTradeRunSlot);
  const [portal, setPortal] = useState(false);
  const [team, setTeam] = useState(false);
  const [moving, setMoving] = useState(false);
  const [times, setTimes] = useState<Record<string, { day: string; time: string }>>({});
  const [day, setDay] = useState("");
  const [second, setSecond] = useState("");
  const [start, setStart] = useState<string>("");
  const [person, setPerson] = useState<string>("");
  const { data, error, refetch } = useQuery({ queryKey: ["trade-run", runId], queryFn: () => load({ data: { runId } }), staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // home (or "decline") waiting for the second tap
  const [fail, setFail] = useState<string | null>(null);
  const flight = useRef(false); // one action at a time, even for same-tick double taps
  const act = async (key: string, run: () => Promise<unknown>) => {
    if (flight.current) return;
    flight.current = true; setBusy(key); setFail(null);
    try { await run(); setConfirm(null); await refetch(); }
    catch (e) { setFail(`Couldn't do that: ${(e as Error).message || "check your signal and try again."}`); }
    finally { setBusy(null); flight.current = false; }
  };
  if (error) return (
    <TradeShell installer>
      <Screen>
        <p role="alert" className="rounded-[18px] border border-line bg-paper p-4 text-sm">{(error as Error).message}</p>
        <Link to="/field" className={outlineLinkClass}>Back to My work</Link>
      </Screen>
    </TradeShell>
  );
  if (!data) return <TradeShell installer><p className="text-sm">Loading…</p></TradeShell>;
  if (data.status !== "offered" && data.status !== "answered") {
    const c = offerClosed(data.status === "declined" ? "declined" : "closed");
    return (
      <TradeShell installer>
        <Screen>
          <section className="rounded-[18px] bg-mist p-4 text-center" data-run-closed={data.status}><h1 className="text-[17px] font-semibold">{c.title}</h1><p className="mt-1 text-sm text-sub">{c.body}</p></section>
          <Link to="/field" className={outlineLinkClass}>Back to My work</Link>
        </Screen>
      </TradeShell>
    );
  }
  const n = data.homes.length;
  const open = data.status === "offered";
  const teamRun = data.status === "answered" && data.mode === "team";
  const portalRun = data.status === "answered" && data.mode === "portal";
  const personPicker = data.team.length > 0 && <>
    <h3 className="mt-4 text-[15px] font-semibold">Who's doing these Ready Checks?</h3>
    <div className="mt-2 grid gap-2" data-run-person>{data.team.map((m) => <CheckLine key={m.userId} on={person === m.userId} onClick={() => setPerson(m.userId)}>{m.name}</CheckLine>)}</div>
  </>;
  const dayAndTime = (verb: string, key: string, go: () => Promise<unknown>) => (!data.days.length ? <p className="mt-2 text-sm text-sub">There are no days available right now.</p> : <>
    <DayGrid days={data.days} picked={day ? [day] : []} onToggle={(d) => setDay(d === day ? "" : d)} label={dayTileLabel} />
    {day && <TimeRows rows={[{ key: day, label: dayTileLabel(day), value: start, options: READY_CHECK_TIMES, optionLabel: installTimeLabel, onChange: setStart }]} />}
    {day && n > MAX_PER_DAY && <>
      <h3 className="mt-4 text-[15px] font-semibold">Second day</h3>
      <DayGrid days={data.days.filter((d) => d !== day)} picked={second ? [second] : []} onToggle={(d) => setSecond(d === second ? "" : d)} label={dayTileLabel} />
    </>}
    {key === "choose" && personPicker}
    <PrimaryButton className="mt-3.5" disabled={!!busy || !day || !start} data-run-choose={key} onClick={() => void act(key, go)}>{busy === key ? "Sending…" : verb}</PrimaryButton>
  </>);
  return (
    <TradeShell installer>
      <Screen>
        <ScreenHead title={`${n} Ready ${n === 1 ? "Check" : "Checks"} around ${data.suburb}`} pillNote={open && data.expiresAt !== NO_EXPIRY ? goneIn(data.expiresAt) : null} />
        <ErrorLine>{fail}</ErrorLine>
        {data.homes.map((h, i) => (
          <Group key={h.jobId} title={`${i + 1}. ${h.address}`}>
            <div data-run-home={h.jobId}>
              {h.ownerName && <Row label="Owner" value={h.ownerName} />}
              {h.slot && <Row label={teamRun ? "Ready Check time" : "Arrival window"} value={<span data-run-slot={h.slot.state}>{h.slot.window} · {h.slot.state === "confirmed" ? "Booked" : "Waiting for the owner to confirm"}</span>} />}
              {teamRun && h.slot?.state !== "confirmed" && (
                <div className="mt-2 grid gap-2" data-run-team-time={h.jobId}>
                  <label className="grid gap-1 text-[13px] text-sub">Day<input type="date" className="min-h-11 rounded-xl border border-line px-3 text-[15px] text-ink" value={times[h.jobId]?.day ?? ""} onChange={(e) => setTimes((t) => ({ ...t, [h.jobId]: { day: e.target.value, time: t[h.jobId]?.time ?? "" } }))} /></label>
                  <label className="grid gap-1 text-[13px] text-sub">Time<input type="time" className="min-h-11 rounded-xl border border-line px-3 text-[15px] text-ink" value={times[h.jobId]?.time ?? ""} onChange={(e) => setTimes((t) => ({ ...t, [h.jobId]: { day: t[h.jobId]?.day ?? "", time: e.target.value } }))} /></label>
                  <QuietButton disabled={!!busy || !times[h.jobId]?.day || !times[h.jobId]?.time} onClick={() => void act(`time-${h.jobId}`, () => enterTime({ data: { runId, jobId: h.jobId, day: times[h.jobId]!.day, time: times[h.jobId]!.time } }))}>{busy === `time-${h.jobId}` ? "Sending…" : "Send to owner"}</QuietButton>
                </div>
              )}
              {h.area.map((a) => <p key={a} className="flex min-h-10 items-center border-b border-line text-[15px]" data-run-area>{a}</p>)}
              {h.taps.map(([q, a]) => <Row key={q} label={<span className="whitespace-normal text-[13px]">{q}</span>} value={a} />)}
              <ContactButtons phone={h.phone} address={h.address} />
              {open && (confirm === h.jobId ? (
                <div className="mt-2 flex gap-2">
                  <QuietButton disabled={!!busy} data-run-remove-yes onClick={() => void act(h.jobId, () => remove({ data: { runId, jobId: h.jobId } }))}>{busy === h.jobId ? "Removing…" : "Yes, remove"}</QuietButton>
                  <QuietButton disabled={!!busy} onClick={() => setConfirm(null)}>Keep</QuietButton>
                </div>
              ) : (
                <QuietButton className="mt-2" disabled={!!busy} data-run-remove onClick={() => setConfirm(h.jobId)}>Remove from run</QuietButton>
              ))}
            </div>
          </Group>
        ))}
        {data.cancelled.map((c) => (
          <Group key={c.jobId} title="Cancelled by the owner">
            <div data-run-cancelled={c.jobId}>
              <Row label="Arrival window" value={c.window} />
              {c.filledBy ? <p className="mt-2 text-sm text-sub">Offered to {c.filledBy}</p>
                : <PrimaryButton className="mt-2" disabled={!!busy} data-run-fill onClick={() => void act(`fill-${c.jobId}`, () => fill({ data: { runId, jobId: c.jobId } }))}>{busy === `fill-${c.jobId}` ? "Sending…" : "Fill from nearby waiting owners"}</PrimaryButton>}
            </div>
          </Group>
        ))}
        {open && (portal ? (
          <section className="rounded-[18px] border border-line p-4" data-run-portal-form>
            <h2 className="text-[17px] font-semibold">Pick your day</h2>
            {dayAndTime("Send times to owners", "choose", () => choose({ data: { runId, day, start, secondDay: second || null, personId: person || null } }))}
            <QuietButton className="mt-2" disabled={!!busy} onClick={() => setPortal(false)}>Back</QuietButton>
          </section>
        ) : team ? (
          <section className="rounded-[18px] border border-line p-4" data-run-team-form>
            <h2 className="text-[17px] font-semibold">Our team books</h2>
            {personPicker}
            <PrimaryButton className="mt-3.5" disabled={!!busy} data-run-team-go onClick={() => void act("team", () => chooseTeam({ data: { runId, personId: person || null } }))}>{busy === "team" ? "Sending…" : "Our team books"}</PrimaryButton>
            <QuietButton className="mt-2" disabled={!!busy} onClick={() => setTeam(false)}>Back</QuietButton>
          </section>
        ) : (
          <section className="rounded-[18px] border border-line p-4" data-run-mode>
            <h2 className="text-[17px] font-semibold">Pick your day</h2>
            <PrimaryButton className="mt-3" disabled={!!busy} data-run-portal onClick={() => { setPortal(true); setStart(data.defaultStart); setPerson(data.me); }}>Portal books</PrimaryButton>
            <QuietButton className="mt-2" disabled={!!busy} data-run-team onClick={() => { setTeam(true); setPerson(data.me); }}>Our team books</QuietButton>
          </section>
        ))}
        {portalRun && n > 0 && (moving ? (
          <section className="rounded-[18px] border border-line p-4" data-run-move-form>
            <h2 className="text-[17px] font-semibold">Move run</h2>
            {dayAndTime("Send new times to owners", "move", async () => { await move({ data: { runId, day, start, secondDay: second || null } }); setMoving(false); })}
            <QuietButton className="mt-2" disabled={!!busy} onClick={() => setMoving(false)}>Back</QuietButton>
          </section>
        ) : (
          <QuietButton disabled={!!busy} data-run-move onClick={() => { setMoving(true); setDay(""); setSecond(""); setStart(data.defaultStart); }}>Move run</QuietButton>
        ))}
        {open && (confirm === "decline" ? (
          <section className="rounded-[18px] border border-line p-4" role="dialog" aria-label={NOT_FOR_ME_SHEET.title} data-not-for-me-sheet>
            <h2 className="text-[17px] font-semibold">{NOT_FOR_ME_SHEET.title}</h2>
            <p className="mt-1 text-sm leading-[1.45] text-sub">{NOT_FOR_ME_SHEET.body}</p>
            <QuietButton className="mt-3" disabled={!!busy} data-not-for-me onClick={() => void act("decline", () => decline({ data: { runId } }))}>{busy === "decline" ? "Sending…" : NOT_FOR_ME_SHEET.yes}</QuietButton>
            <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub" onClick={() => setConfirm(null)}>{NOT_FOR_ME_SHEET.keep}</button>
          </section>
        ) : (
          <button type="button" className="flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub disabled:opacity-50" disabled={!!busy} data-not-for-me-open onClick={() => setConfirm("decline")}>Not for me</button>
        ))}
        <Link to="/field" className={outlineLinkClass}>Back to My work</Link>
      </Screen>
    </TradeShell>
  );
}
