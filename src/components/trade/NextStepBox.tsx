// The installer Job page "Next step" box (Task 6): the box's wording comes from the pure next-step-box core; this file adds
// the actions — book the Ready Check / PIESA / install, change a booked time, change the Lead Installer, change the
// electrician. Every booking write goes through the existing guarded writers only: `inHouseBookVisit` (the in-house
// saved-work RPC, canonical gates incl. installDepositBlocker) and, for the installer's own customer outside in-house,
// `setA1ReadyCheckTimeFn` (confirmBooking). Nothing here decides a rule; refusals from the server are shown as they are.
// A greyed-out button always has a visible reason beside it (aria-describedby) — never a silent grey button.
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { card, ghostBtn, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { getInHouseBookingTeam, inHouseBookVisit, changeInHouseLeadInstaller, setA1ReadyCheckTimeFn } from "@/lib/trade-view.functions";
import { useInHouseBookingAccess } from "@/components/trade/ReturnActions";
import { getTeamElectricians, allocateElectricianFn } from "@/lib/visit-allocation.functions";
import { bookingWorkerBlocker, emptyBookingTeamBlocker, type BookingWorker } from "@/lib/in-house-booking.core";
import { NEXT_STEP_WORDS, type NextStepBox as NextStepBoxShape } from "@/lib/next-step-box.core";
import { installStartAt, installTimeLabel } from "@/lib/install-days.core";
import { fmtDay } from "@/lib/next-step-dates.core";
import { a1ReadyCheckTimeBlockers, allowedReadyCheckDays, allowedReadyCheckTimes } from "@/lib/ready-check-times.core";
import { readableError } from "@/lib/readable-error.core";
import { READY_CHECK_PERSON_WORDS } from "@/lib/ready-check-person.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { Button } from '@/components/ui/button';
import { showTradeSaved } from '@/lib/trade-save-confirmation';

// Wording. Lines from the plan are marked approved; every DRAFT line is listed for Jo (Task 12 paste) and not yet seen by her.
export const NEXT_STEP_BOX_WORDS = {
  eyebrow: "NEXT STEP", // approved (plan Task 6)
  day: "Day", arrival: "Arrival", whosGoing: "Who's going", electrician: "Electrician", leadInstaller: "Lead Installer", crew: "Crew", // approved (plan Task 6)
  book: "Book", bookInstall: "Book the install", // approved
  changeTime: "Change time", changeLead: "Change Lead Installer", changeElectrician: "Change electrician", // approved (plan Task 6)
  saveTime: "Save the new time", // DRAFT
  saveLead: "Save the Lead Installer", // DRAFT
  saveElectrician: "Save the electrician", // DRAFT
  neverMind: "Never mind", // DRAFT
  bookedLine: (first: string, installBy: string | null) => `${first} gets a "You're booked" email and text straight away.${installBy ? ` Install by ${installBy}.` : ""}`, // approved (plan Task 6)
  pickDayTime: "Choose the day and arrival time so the owner knows when to expect you.", // existing in-house booking card wording
  checkingTeam: "Checking your Team and deposit before booking.", // existing in-house booking card wording
  teamFailed: "Could not check your Team or deposit. Booking stays unavailable until those records can be checked.", // existing in-house booking card wording
  notHere: "Booking on this page isn't open for this job yet. Call Home Insulation Victoria to book it.", // DRAFT
  saveFailed: "Couldn't save that. Check your connection and try again.", // DRAFT
  saving: "Saving…", // existing
  booked: (what: string) => `${what} booked`, // existing in-house booking card wording
  changed: (what: string) => `${what} changed`, // DRAFT
  loadingElectricians: "Loading your electricians…", // DRAFT
  noPiesaTime: "Can't find the booked PIESA time. Refresh the page and try again.", // DRAFT
  chooseElectrician: "Choose your electrician", // Jo 5 Nov
  safetyCheckTitle: 'Book the safety check',
  safetyCheckLine: 'The owner has accepted the quote and paid for the safety check. Call them, agree a day and time, then add it here.',
  pickSafetyCheck: 'Pick the electrician, day and time first.',
  chooseLead: "Choose the Lead Installer", // existing in-house booking card wording (dropdown placeholder)
  choosePerson: "Choose the person going", // existing in-house booking card wording (dropdown placeholder)
  timePlaceholder: "Time…", // existing A1 Ready Check card wording (dropdown placeholder)
  visit: { ready_check: "Ready Check", assessment: "PIESA", installation: "Install" }, // visit names in the toasts (approved words)
} as const;
const W = NEXT_STEP_BOX_WORDS;

type Kind = "ready_check" | "assessment" | "installation";
const KIND_OF: Partial<Record<NextStepBoxShape["kind"], Kind>> = {
  book_ready_check: "ready_check", ready_check_booked: "ready_check",
  book_piesa: "assessment", piesa_booked: "assessment",
  book_install: "installation", install_booked: "installation",
};
const LABEL: Record<Kind, string> = W.visit;

type Team = { workers: BookingWorker[]; depositPaid: boolean; selection: { lead?: unknown; additional?: { workerId: string }[] } | null };
type Electricians = { workers: { id: string; name: string; allowed: boolean; reason: string | null; selected: boolean }[] };

/** The box: `box` is the pure core's answer; `children` are the page's extra items for this kind (Today's job, sign, price…). */
export function NextStepBox({ jobId, box, ownerFirst, installBy, ownCustomer = false, mittiAuditId = null, now, onDone, children }: {
  jobId: string; box: NextStepBoxShape; ownerFirst: string | null; installBy: string | null; ownCustomer?: boolean;
  mittiAuditId?: string | null; now?: Date | undefined; onDone?: () => void; children?: ReactNode;
}) {
  const kind = KIND_OF[box.kind] ?? null;
  const wantsInstall = kind === "installation" || !!box.alsoBookInstall;
  const access = useInHouseBookingAccess(jobId);
  const allowed = access.data?.allowed === true;
  const accessPending = access.isPending === true && access.data === undefined;
  const piesaBooking = (access.data?.bookings ?? []).find((b) => b.kind === "assessment" && b.status === "confirmed" && b.scheduled_start) ?? null;
  const loadTeam = useServerFn(getInHouseBookingTeam);
  const team = useQuery({ queryKey: ["in-house-booking-team", jobId], queryFn: () => loadTeam({ data: { jobId } }) as Promise<Team>, enabled: allowed && (!!kind || wantsInstall), retry: false });
  const loadElec = useServerFn(getTeamElectricians);
  const electricians = useQuery({ queryKey: ["team-electricians", jobId], queryFn: () => loadElec({ data: { jobId } }) as Promise<Electricians>, enabled: allowed && kind === "assessment", retry: false });
  const [change, setChange] = useState<"time" | "lead" | "electrician" | null>(null);
  const teamState: TeamState = { allowed, loading: allowed && !team.data && !team.isError, failed: team.isError, team: (team.data as Team | undefined) ?? null, electricians: (electricians.data as Electricians | undefined) ?? null, ownerFirst, piesaStart: piesaBooking?.scheduled_start ?? null };
  const booked = box.kind === "ready_check_booked" || box.kind === "piesa_booked" || box.kind === "install_booked";
  const done = () => { setChange(null); onDone?.(); };
  const [subBefore, subBookBy] = splitBookBy(box.sub);

  return (
    <section data-next-step={box.kind} className={`${card} border-2 ${box.overdue ? "border-rose" : "border-action"}`}>
      <p className="text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">{W.eyebrow}</p>
      <h2 className="mt-1 font-display text-[22px] font-semibold leading-tight">{box.kind === 'book_piesa' ? W.safetyCheckTitle : box.title}</h2>
      {box.kind === 'book_piesa' ? <p className="mt-1.5 text-[15px] text-ink">{W.safetyCheckLine}</p> : box.sub && (
        <p className="mt-1.5 text-[15px] text-ink">
          {subBefore}
          {subBookBy && <strong className={box.overdue ? "text-rose" : ""}>{subBookBy}</strong>}
        </p>
      )}
      {box.lines.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[15px]" data-next-lines>
          {box.lines.map((l) => (
            <li key={l} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-hiv-blue" />
              {l}
            </li>
          ))}
        </ul>
      )}
      {box.phone && (
        <a href={`tel:${box.phone.phone}`} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-mist px-4 text-[15px] font-semibold text-ink" data-call>
          <Phone className="h-4 w-4" aria-hidden /> {box.phone.name} · {box.phone.phone}
        </a>
      )}

      {/* The access check is still running: say so, show no form yet (nothing can be saved before it answers). */}
      {accessPending && (kind || box.alsoBookInstall) && <p className="mt-4 text-sm text-sub" data-access-pending>{W.checkingTeam}</p>}

      {/* Book the Ready Check / PIESA / install */}
      {!accessPending && kind && !booked && (
        kind === "ready_check" && !allowed && ownCustomer ? (
          <OwnCustomerReadyCheckForm jobId={jobId} now={now} onDone={done} />
        ) : (
          <BookingForm jobId={jobId} kind={kind} mode="book" state={teamState} button={kind === "installation" ? W.bookInstall : W.book}
            below={kind === "installation" ? W.bookedLine(ownerFirst ?? NEXT_STEP_WORDS.theOwner.replace(/^t/, "T"), installBy ? fmtDay(installBy) : null) : null} onDone={done} />
        )
      )}

      {/* G7: a Ready Check booked with "Not sure yet" — pick the person (same guarded writer, same day and time) */}
      {!accessPending && box.pickPerson && kind === "ready_check" && (
        <PickPersonForm jobId={jobId} start={box.pickPerson.start} state={teamState} onDone={done} />
      )}

      {/* A booked visit: change links, then the chosen change form */}
      {!accessPending && booked && kind && !(!allowed && ownCustomer) && (
        <div className="mt-4 flex flex-wrap gap-2" data-change-links>
          <button type="button" className={ghostBtn} onClick={() => setChange(change === "time" ? null : "time")}>{W.changeTime}</button>
          {kind === "installation" && (
            <button type="button" className={ghostBtn} onClick={() => setChange(change === "lead" ? null : "lead")}>{W.changeLead}</button>
          )}
          {kind === "assessment" && (
            <button type="button" className={ghostBtn} onClick={() => setChange(change === "electrician" ? null : "electrician")}>{W.changeElectrician}</button>
          )}
        </div>
      )}
      {booked && kind && change === "time" && (
        <BookingForm jobId={jobId} kind={kind} mode="change" state={teamState} button={W.saveTime} below={null} onDone={done} onCancel={() => setChange(null)} />
      )}
      {booked && kind === "installation" && change === "lead" && (
        <ChangeLeadForm jobId={jobId} state={teamState} onDone={done} onCancel={() => setChange(null)} />
      )}
      {booked && kind === "assessment" && change === "electrician" && (
        <ChangeElectricianForm jobId={jobId} state={teamState} onDone={done} onCancel={() => setChange(null)} />
      )}

      {/* Upload the certificate, and (deposit paid) book the install early: a warning above the button, never a block */}
      {!accessPending && box.alsoBookInstall && (
        <div className="mt-4 border-t border-line pt-4" data-also-book-install>
          <p className="text-sm font-medium text-ink" data-also-book-warn>{box.alsoBookInstall.warn}</p>
          <BookingForm jobId={jobId} kind="installation" mode="book" state={teamState} button={box.alsoBookInstall.button}
            below={W.bookedLine(ownerFirst ?? NEXT_STEP_WORDS.theOwner.replace(/^t/, "T"), installBy ? fmtDay(installBy) : null)} onDone={done} />
        </div>
      )}

      {(box.button === NEXT_STEP_WORDS.mittiButton || box.kind === "own_ready_check") && mittiAuditId && (
        <MittiFormLink auditId={mittiAuditId} className={`${greenBtn} mt-4`}>{box.kind === "own_ready_check" ? "Do it in Mitti" : NEXT_STEP_WORDS.mittiButton}</MittiFormLink>
      )}
      {children}
    </section>
  );
}

/** "… Book by Fri 6 Nov." → the text before, and the bold "Book by …" sentence. */
function splitBookBy(sub: string | null): [string, string | null] {
  if (!sub) return ["", null];
  const at = sub.indexOf("Book by ");
  if (at < 0) return [sub, null];
  return [sub.slice(0, at), sub.slice(at)];
}

type TeamState = { allowed: boolean; loading: boolean; failed: boolean; team: Team | null; electricians: Electricians | null; ownerFirst: string | null; piesaStart: string | null };
/** The "Who's going" value for "Not sure yet" (never sent as a worker id). */
const NOT_SURE_YET = "__not_sure_yet__";

/** One reason why the button is greyed out, or null when it can be pressed. The first reason wins. */
function bookingReason(i: { kind: Kind; state: TeamState; day: string; arrival: string; who: string; electricianChosen: boolean }): string | null {
  const { kind, state } = i;
  if (!state.allowed) return W.notHere;
  if (state.failed) return W.teamFailed;
  if (state.loading || !state.team) return W.checkingTeam;
  if (kind === "installation" && !state.team.depositPaid) return NEXT_STEP_WORDS.depositLine(state.ownerFirst ?? NEXT_STEP_WORDS.theOwner);
  const empty = emptyBookingTeamBlocker(kind, state.team.workers);
  if (empty) return empty;
  if (kind === "assessment" && !i.electricianChosen) return bookingWorkerBlocker(kind, null);
  // G7 (Jo 4 Nov 2026): a Ready Check may be booked with "Not sure yet" — the person is picked on the job by 5pm the day before.
  if (!(kind === "ready_check" && i.who === NOT_SURE_YET)) {
    const who = state.team.workers.find((w) => w.id === i.who) ?? null;
    const why = bookingWorkerBlocker(kind, who);
    if (why) return why;
  }
  if (!i.day || !i.arrival) return W.pickDayTime;
  return null;
}

function BookingForm({ jobId, kind, mode, state, button, below, onDone, onCancel }: {
  jobId: string; kind: Kind; mode: "book" | "change"; state: TeamState; button: string; below: string | null; onDone: () => void; onCancel?: () => void;
}) {
  const book = useServerFn(inHouseBookVisit);
  const allocate = useServerFn(allocateElectricianFn);
  const qc = useQueryClient();
  const id = useId();
  const team = state.team;
  const lead = typeof team?.selection?.lead === "string" ? team.selection.lead : "";
  const savedCrew = (team?.selection?.additional ?? []).map((a) => a.workerId);
  const current = state.electricians?.workers.find((w) => w.selected)?.id ?? "";
  const [day, setDay] = useState("");
  const [arrival, setArrival] = useState("");
  const [who, setWho] = useState(kind === "installation" ? lead : kind === "assessment" ? current : "");
  const [crew, setCrew] = useState<string[]>(kind === "installation" ? savedCrew : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const electricianChosen = kind !== "assessment" || !!who;
  const reason = bookingReason({ kind, state, day, arrival, who, electricianChosen });
  const workers = team?.workers ?? [];
  const choices = kind === "installation" ? workers.filter((w) => w.tradeRole === "installer" && w.workerRole === "lead") : kind === "ready_check" ? workers : [];
  const crewChoices = kind === "installation" ? workers.filter((w) => w.id !== who && w.tradeRole === "installer" && w.crewAllowed === true) : [];
  const disabled = busy || !!reason || (!!error && !error.startsWith("Couldn’t save") && !error.startsWith("Couldn't save"));
  const reasonId = `${id}-reason`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "assessment" && who !== current) await allocate({ data: { jobId, workerId: who } });
      const r = await book({ data: { jobId, kind, start: installStartAt(day, arrival).toISOString(), ...(who === NOT_SURE_YET ? {} : { workerId: who }), crewIds: kind === "installation" ? crew : [] } });
      if (!r.ok) { setError(r.blockers.join(" ")); return; }
      // Part 9 Task 10: the booking's plain warnings (e.g. upgrades still to come) are shown with the success, never as a refusal.
      toast.success(mode === "book" ? W.booked(LABEL[kind]) : W.changed(`${LABEL[kind]} time`), r.warnings?.length ? { description: r.warnings.join(" ") } : undefined);
      showTradeSaved(`Booking saved: ${kind === 'assessment' ? 'Safety check' : LABEL[kind]} · ${fmtDay(day)} · ${installTimeLabel(arrival)}${r.warnings?.length ? ` · ${r.warnings.join(' ')}` : ''}`);
      markOfficeChanged();
      // Go-live 5 Nov 2026 (Tom: "takes 20 secs"): the booking is saved — close the form now and let the page refresh behind it.
      void qc.invalidateQueries();
      onDone();
    } catch (err) {
      setError(readableError(err, W.saveFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 min-w-0 max-w-full space-y-3" data-booking-form={kind} onSubmit={submit}>
      {kind === "assessment" && (
        <label className="block min-w-0 text-sm font-medium">
          {W.electrician}
          <select className={`${inputCls} mt-1`} value={who} onChange={(e) => { setError(""); setWho(e.target.value); }} disabled={!state.electricians}>
            <option value="">{W.chooseElectrician}</option>
            {(state.electricians?.workers ?? []).map((w) => (
              <option key={w.id} value={w.id} disabled={!w.allowed}>{w.name}{w.reason ? ` — ${w.reason}` : ""}</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <label className="block min-w-0 text-sm font-medium">
          {W.day}
          <input type="date" className={`${inputCls} mt-1 box-border w-0 min-w-full max-w-full`} value={day} onChange={(e) => { setError(""); setDay(e.target.value); }} />
        </label>
        <label className="block min-w-0 text-sm font-medium">
          {W.arrival}
          <input type="time" className={`${inputCls} mt-1 box-border w-0 min-w-full max-w-full`} value={arrival} onChange={(e) => { setError(""); setArrival(e.target.value); }} />
        </label>
      </div>
      {(kind === "ready_check" || kind === "installation") && (
        <label className="block min-w-0 text-sm font-medium">
          {kind === "installation" ? W.leadInstaller : W.whosGoing}
          <select className={`${inputCls} mt-1`} value={who} onChange={(e) => { setError(""); setWho(e.target.value); setCrew((c) => c.filter((x) => x !== e.target.value)); }} disabled={!team}>
            <option value="">{kind === "installation" ? W.chooseLead : W.choosePerson}</option>
            {kind === "ready_check" && <option value={NOT_SURE_YET}>{READY_CHECK_PERSON_WORDS.notSureYet}</option>}
            {choices.map((w) => {
              const why = bookingWorkerBlocker(kind, w);
              return <option key={w.id} value={w.id} disabled={!!why}>{w.name}{why ? ` — ${why}` : ""}</option>;
            })}
          </select>
        </label>
      )}
      {kind === "installation" && crewChoices.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">{W.crew}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {crewChoices.map((w) => (
              <label key={w.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={crew.includes(w.id)} disabled={!crew.includes(w.id) && crew.length >= 2} onChange={(e) => setCrew(e.target.checked ? [...crew, w.id].slice(0, 2) : crew.filter((x) => x !== w.id))} />
                {w.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {disabled && !error && !(kind === 'assessment' && mode === 'book' && (!who || !day || !arrival)) && <p id={reasonId} className="text-sm text-sub">{busy ? W.saving : reason}</p>}
      {error && <p id={reasonId} role="alert" className="text-sm text-rose">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="field" className={`w-full md:w-auto ${disabled ? 'bg-muted text-muted-foreground opacity-100 disabled:opacity-100' : ''}`} disabled={disabled} aria-describedby={disabled ? reasonId : undefined}>{busy ? W.saving : button}</Button>
        {onCancel && <button type="button" className={ghostBtn} onClick={onCancel}>{W.neverMind}</button>}
      </div>
      {kind === 'assessment' && mode === 'book' && <p id={!error && (!who || !day || !arrival) ? reasonId : undefined} className="text-sm text-sub">{W.pickSafetyCheck}</p>}
      {below && <p className="text-sm text-sub" data-booked-line>{below}</p>}
    </form>
  );
}

/** G7 (Jo 4 Nov 2026): "Pick who's going" for a Ready Check booked with "Not sure yet" — the same in-house writer with the
 *  booked day and time and the chosen person (the booking is re-recorded with the person; the Mitti form is made then). */
function PickPersonForm({ jobId, start, state, onDone }: { jobId: string; start: string; state: TeamState; onDone: () => void }) {
  const book = useServerFn(inHouseBookVisit);
  const qc = useQueryClient();
  const id = useId();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reason = bookingReason({ kind: "ready_check", state, day: "x", arrival: "x", who, electricianChosen: true });
  const disabled = busy || !!reason || (!!error && !error.startsWith("Couldn’t save") && !error.startsWith("Couldn't save"));
  const reasonId = `${id}-reason`;
  const choices = state.team?.workers ?? [];
  return (
    <form className="mt-4 space-y-3" data-pick-person onSubmit={async (e) => {
      e.preventDefault();
      if (disabled) return;
      setBusy(true); setError("");
      try {
        const r = await book({ data: { jobId, kind: "ready_check", start, workerId: who, crewIds: [] } });
        if (!r.ok) { setError(r.blockers.join(" ")); return; }
        toast.success(W.changed("Who's going"));
        showTradeSaved(`Ready Check person saved: ${choices.find(w => w.id === who)?.name ?? "Team member"}`);
        markOfficeChanged();
        await qc.invalidateQueries();
        onDone();
      } catch (err) { setError(readableError(err, W.saveFailed)); } finally { setBusy(false); }
    }}>
      <label className="block min-w-0 text-sm font-medium">
        {W.whosGoing}
        <select className={`${inputCls} mt-1`} value={who} onChange={(e) => { setError(""); setWho(e.target.value); }} disabled={!state.team}>
          <option value="">{W.choosePerson}</option>
          {choices.map((w) => {
            const why = bookingWorkerBlocker("ready_check", w);
            return <option key={w.id} value={w.id} disabled={!!why}>{w.name}{why ? ` — ${why}` : ""}</option>;
          })}
        </select>
      </label>
      {disabled && !error && <p id={reasonId} className="text-sm text-sub">{busy ? W.saving : reason}</p>}
      {error && <p id={reasonId} role="alert" className="text-sm text-rose">{error}</p>}
      <button type="submit" className={greenBtn} disabled={disabled} aria-describedby={disabled ? reasonId : undefined}>{busy ? W.saving : READY_CHECK_PERSON_WORDS.pickButton}</button>
    </form>
  );
}

/** Jo 24 Oct 2026 (decision 110): the installer's own customer, outside in-house — the Ready Check day and time go straight
 *  in as the job's booking (confirmBooking inside tradeSetReadyCheckTime). Nothing goes to the owner. */
function OwnCustomerReadyCheckForm({ jobId, now, onDone }: { jobId: string; now?: Date | undefined; onDone: () => void }) {
  const save = useServerFn(setA1ReadyCheckTimeFn);
  const qc = useQueryClient();
  const id = useId();
  const at = now ?? new Date();
  const days = allowedReadyCheckDays(at);
  const [day, setDay] = useState(days[0] ?? "");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blockers = time ? a1ReadyCheckTimeBlockers({ day, time }, at) : [W.pickDayTime];
  const disabled = busy || blockers.length > 0 || (!!error && !error.startsWith("Couldn’t save") && !error.startsWith("Couldn't save"));
  const reasonId = `${id}-reason`;
  return (
    <form className="mt-4 space-y-3" data-booking-form="ready_check_own" onSubmit={async (e) => {
      e.preventDefault();
      if (disabled) return;
      setBusy(true); setError("");
      try {
        await save({ data: { jobId, day, time } });
        toast.success(W.booked(LABEL.ready_check));
        showTradeSaved(`Booking saved: Ready Check · ${fmtDay(day)} · ${installTimeLabel(time)}`);
        markOfficeChanged();
        await qc.invalidateQueries();
        onDone();
      } catch (err) { setError(readableError(err, W.saveFailed)); } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <label className="block min-w-0 text-sm font-medium">
          {W.day}
          <input type="date" className={`${inputCls} mt-1`} value={day} min={days[0]} max={days[days.length - 1]} onChange={(e) => { setError(""); setDay(e.target.value); setTime(""); }} />
        </label>
        <label className="block min-w-0 text-sm font-medium">
          {W.arrival}
          <select className={`${inputCls} mt-1`} value={time} onChange={(e) => { setError(""); setTime(e.target.value); }}>
            <option value="">{W.timePlaceholder}</option>
            {allowedReadyCheckTimes(day, at).map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
          </select>
        </label>
      </div>
      {disabled && !error && <p id={reasonId} className="text-sm text-sub">{busy ? W.saving : blockers.join(" ")}</p>}
      {error && <p id={reasonId} role="alert" className="text-sm text-rose">{error}</p>}
      <button type="submit" className={greenBtn} disabled={disabled} aria-describedby={disabled ? reasonId : undefined}>{busy ? W.saving : W.book}</button>
    </form>
  );
}

function ChangeLeadForm({ jobId, state, onDone, onCancel }: { jobId: string; state: TeamState; onDone: () => void; onCancel: () => void }) {
  const swap = useServerFn(changeInHouseLeadInstaller);
  const qc = useQueryClient();
  const id = useId();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workers = state.team?.workers ?? [];
  const leads = workers.filter((w) => w.tradeRole === "installer" && w.workerRole === "lead");
  const reason = !state.allowed ? W.notHere : state.failed ? W.teamFailed : !state.team ? W.checkingTeam : bookingWorkerBlocker("installation", workers.find((w) => w.id === who) ?? null);
  const disabled = busy || !!reason || (!!error && !error.startsWith("Couldn’t save") && !error.startsWith("Couldn't save"));
  const reasonId = `${id}-reason`;
  return (
    <form className="mt-3 space-y-3" data-change-form="lead" onSubmit={async (e) => {
      e.preventDefault();
      if (reason) return;
      setBusy(true); setError("");
      try {
        await swap({ data: { jobId, workerId: who } });
        toast.success(W.changed(W.leadInstaller));
        showTradeSaved(`Lead Installer saved: ${leads.find(w => w.id === who)?.name ?? 'Team member'}`);
        markOfficeChanged();
        await qc.invalidateQueries();
        onDone();
      } catch (err) { setError(readableError(err, W.saveFailed)); } finally { setBusy(false); }
    }}>
      <label className="block min-w-0 text-sm font-medium">
        {W.leadInstaller}
        <select className={`${inputCls} mt-1`} value={who} onChange={(e) => { setError(""); setWho(e.target.value); }} disabled={!state.team}>
          <option value="">{W.chooseLead}</option>
          {leads.map((w) => { const why = bookingWorkerBlocker("installation", w); return <option key={w.id} value={w.id} disabled={!!why}>{w.name}{why ? ` — ${why}` : ""}</option>; })}
        </select>
      </label>
      {disabled && !error && <p id={reasonId} className="text-sm text-sub">{busy ? W.saving : reason}</p>}
      {error && <p id={reasonId} role="alert" className="text-sm text-rose">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={greenBtn} disabled={disabled} aria-describedby={disabled ? reasonId : undefined}>{busy ? W.saving : W.saveLead}</button>
        <button type="button" className={ghostBtn} onClick={onCancel}>{W.neverMind}</button>
      </div>
    </form>
  );
}

/** Change electrician on a booked PIESA: re-allocate (Mitti form hand-over), then re-save the assessment booking at its
 *  existing time for the new electrician through the same guarded writer, so the booking names who is going. */
function ChangeElectricianForm({ jobId, state, onDone, onCancel }: { jobId: string; state: TeamState; onDone: () => void; onCancel: () => void }) {
  const allocate = useServerFn(allocateElectricianFn);
  const book = useServerFn(inHouseBookVisit);
  const qc = useQueryClient();
  const id = useId();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = state.electricians?.workers ?? [];
  const chosen = list.find((w) => w.id === who) ?? null;
  const reason = !state.allowed ? W.notHere : !state.electricians ? W.loadingElectricians : !state.piesaStart ? W.noPiesaTime : !chosen ? bookingWorkerBlocker("assessment", null) : !chosen.allowed ? chosen.reason ?? bookingWorkerBlocker("assessment", null) : null;
  const disabled = busy || !!reason || (!!error && !error.startsWith("Couldn’t save") && !error.startsWith("Couldn't save"));
  const reasonId = `${id}-reason`;
  return (
    <form className="mt-3 space-y-3" data-change-form="electrician" onSubmit={async (e) => {
      e.preventDefault();
      if (reason) return;
      setBusy(true); setError("");
      try {
        await allocate({ data: { jobId, workerId: who } });
        if (!state.piesaStart) return;
        const r = await book({ data: { jobId, kind: "assessment", start: state.piesaStart, workerId: who, crewIds: [] } });
        if (!r.ok) { setError(r.blockers.join(" ")); return; }
        toast.success(W.changed(W.electrician));
        showTradeSaved(`Electrician saved: ${chosen?.name ?? 'Team electrician'}`);
        markOfficeChanged();
        await qc.invalidateQueries();
        onDone();
      } catch (err) { setError(readableError(err, W.saveFailed)); } finally { setBusy(false); }
    }}>
      <label className="block min-w-0 text-sm font-medium">
        {W.electrician}
        <select className={`${inputCls} mt-1`} value={who} onChange={(e) => { setError(""); setWho(e.target.value); }} disabled={!state.electricians}>
          <option value="">{W.chooseElectrician}</option>
          {list.map((w) => <option key={w.id} value={w.id} disabled={!w.allowed}>{w.name}{w.reason ? ` — ${w.reason}` : ""}</option>)}
        </select>
      </label>
      {disabled && !error && <p id={reasonId} className="text-sm text-sub">{busy ? W.saving : reason}</p>}
      {error && <p id={reasonId} role="alert" className="text-sm text-rose">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={greenBtn} disabled={disabled} aria-describedby={disabled ? reasonId : undefined}>{busy ? W.saving : W.saveElectrician}</button>
        <button type="button" className={ghostBtn} onClick={onCancel}>{W.neverMind}</button>
      </div>
    </form>
  );
}
