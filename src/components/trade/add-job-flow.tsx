// Installer Add a job — ONE screen per the approved heavier design (decision 237; basics only, decision 34): two mist
// cards "Owner" / "Ready Check visit (optional)", bold labels, 52px bordered fields, the green address-found box, the
// full-width permission row, one 56px "Add job" button; error state = red 2px borders + one short line per field + a
// summary banner; "Job added" = green tick header, "Open Mitti form", "What we do now", "Go to the job", "Add another job".
// Everything else (measurements, insulation, removal, product, price, electrician) is answered in the Mitti form.
// Uses only the existing guarded server handler (startOnsiteReadyCheck); intake validation is unchanged.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CustomerFields, FieldError } from "./customer-fields";
import { onsiteFormStatus, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput, OnsiteState } from "@/lib/onsite-ready-check.core";
import { a1ReadyCheckTimeBlockers, allowedReadyCheckDays, allowedReadyCheckTimes } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import {
  ADD_JOB_OFFLINE_NOTE, BUSY_LABEL, OWNER_CARD_TITLE, SAVE_LABEL, VISIT_CARD, VISIT_FIELD_HINT, WHAT_HAPPENS_NEXT, addedView, blankCustomer, customerProblems, dayOptionLabel, errorSummary, fieldErrors, formLabel, outcomeFor, restoreCustomer,
  saveErrorMessage, visitPayload, visitProblems, type AddJobBooking, type VisitPick,
} from "@/lib/add-job-flow.core";
import { firstName } from "@/lib/installer-screens.core";

const DRAFT_KEY = "hiv-onsite-draft";
/** 56px blue button (approved heavier design). */
export const PRIMARY_BTN = "flex min-h-14 w-full items-center justify-center rounded-[14px] bg-hiv-blue text-[17px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const CARD = "rounded-[18px] bg-mist p-4";
const CARD_TITLE = "font-display text-[17px] font-bold text-ink";

type Saved = { jobId: string; jobNumber: string | null; booking: AddJobBooking; state?: OnsiteState; customer: OnsiteInput; visit: VisitPick };

// `onExit` is kept for existing callers/fixtures; the one-screen mock-up has no Cancel button (My work is a tab).
export function AddJobFlow({ businessId, onReset }: { businessId: string; onExit?: () => void; onReset?: () => void }) {
  const [customer, setCustomer] = useState<OnsiteInput>(blankCustomer());
  const [visit, setVisit] = useState<VisitPick>({ day: "", time: "" });
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);

  // Poor signal on site: typed details stay on the phone (never the consent tick) until saved.
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) setCustomer(restoreCustomer(JSON.parse(d))); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...customer, contact_permission: false, consent_by: null })); } catch { /* ignore */ } }, [customer]);
  useEffect(() => { if (shown.length) bannerRef.current?.focus(); }, [shown]);
  // Fixing an answer clears the old hint list; it is rebuilt on the next tap.
  useEffect(() => { setShown([]); }, [customer, visit]);

  const start = useServerFn(startOnsiteReadyCheck);

  if (saved) return <SavedResult saved={saved} onAddAnother={() => { setSaved(null); setCustomer(blankCustomer()); setVisit({ day: "", time: "" }); onReset?.(); }} />;

  const problems = (): string[] => {
    const v = visitPayload(visit);
    return [...customerProblems(customer), ...visitProblems(visit), ...(v ? a1ReadyCheckTimeBlockers(v) : [])];
  };

  const save = async () => {
    if (busy || inFlight.current) return; // double tap
    const p = problems(); setShown(p); setErr(null);
    if (p.length) return;
    inFlight.current = true; setBusy(true);
    try {
      const r = await start({ data: { businessId, owner: customer, visit: visitPayload(visit) } });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setSaved({ jobId: r.jobId, jobNumber: r.jobNumber ?? null, booking: r.booking, state: r.state, customer, visit });
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  const errors = fieldErrors(shown);
  const summary = errorSummary(shown.length);
  return (
    <div className="space-y-5" data-add-job-flow data-step="customer">
      {summary && <p ref={bannerRef} tabIndex={-1} role="alert" className="rounded-[12px] border-2 px-3.5 py-3 text-[15px] font-bold leading-[1.4] outline-none" style={{ borderColor: "#8A3B4A", background: "#FBEFF1", color: "#8A3B4A" }} data-step-problems>{summary}</p>}
      <section className={CARD} data-owner-card>
        <h2 className={CARD_TITLE}>{OWNER_CARD_TITLE}</h2>
        <div className="mt-3.5"><CustomerFields value={customer} consentLabel={OWNER_CONTACT_PERMISSION} errors={errors} onChange={(n) => { setCustomer(n); setErr(null); }} /></div>
      </section>
      <VisitField value={visit} onChange={setVisit} disabled={busy} error={errors.visit} />
      {err && <p role="status" className="rounded-[12px] border-2 border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}
      <button type="button" className={PRIMARY_BTN} disabled={busy} aria-busy={busy} onClick={save}>{busy ? BUSY_LABEL : err ? "Retry submission" : SAVE_LABEL}</button>
      <p className="text-center text-[13px] leading-[1.5] text-sub" data-next-step>{summary ? ADD_JOB_OFFLINE_NOTE : WHAT_HAPPENS_NEXT}</p>
    </div>
  );
}

const SELECT = "min-h-[52px] w-full appearance-none rounded-[12px] border-2 border-line bg-paper px-3.5 pr-9 text-base text-ink outline-none focus:border-hiv-blue disabled:text-sub";
function Select({ id, label, value, onChange, disabled, placeholder, options }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string; options: { value: string; label: string }[] }) {
  return (
    <span className="relative flex-1">
      <select id={id} aria-label={label} className={SELECT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sub">▾</span>
    </span>
  );
}

/** Decision 116: the one optional field — same allowed days / exact times as the job page (decision 110). Mist card per decision 237. */
function VisitField({ value, onChange, disabled, error }: { value: VisitPick; onChange: (v: VisitPick) => void; disabled: boolean; error?: string | undefined }) {
  const days = allowedReadyCheckDays();
  const times = value.day ? allowedReadyCheckTimes(value.day) : [];
  const blockers = value.day && value.time ? a1ReadyCheckTimeBlockers({ day: value.day, time: value.time }) : [];
  return (
    <fieldset className={CARD} data-visit-field>
      <legend className="sr-only">Ready Check visit day and time (optional)</legend>
      <p className={CARD_TITLE} aria-hidden>{VISIT_CARD.title}</p>
      <p className="mt-0.5 text-[13px] leading-[1.45] text-sub">{VISIT_CARD.sub}</p>
      <div className="mt-3 flex gap-2">
        <Select id="add-job-visit-day" label="Visit day" value={value.day} disabled={disabled} placeholder="Day" options={days.map((d) => ({ value: d, label: dayOptionLabel(d) }))} onChange={(day) => onChange({ day, time: "" })} />
        <Select id="add-job-visit-time" label="Arrival time" value={value.time} disabled={disabled || !value.day} placeholder="Time" options={times.map((t) => ({ value: t, label: installTimeLabel(t) }))} onChange={(time) => onChange({ ...value, time })} />
      </div>
      <FieldError>{error}</FieldError>
      {blockers.length > 0 && !error && <p className="mt-2 text-sm text-rose" data-visit-blocker>{blockers.join(" ")}</p>}
      <p className="mt-2 text-[13px] leading-[1.45] text-sub">{VISIT_FIELD_HINT}</p>
    </fieldset>
  );
}

/** Approved "Job added" state (decision 237). Facts only from the save result and the read-only form status. */
function SavedResult({ saved, onAddAnother }: { saved: Saved; onAddAnother: () => void }) {
  const [state, setState] = useState<OnsiteState | undefined>(saved.state);
  const [tries, setTries] = useState(0);
  const status = useServerFn(onsiteFormStatus);
  // "Preparing" polls the read-only status (never Mitti) for a few minutes, then the job page takes over.
  useEffect(() => {
    if (!state || state.kind !== "preparing" || tries >= 45) return;
    const t = setTimeout(async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: false } })); } catch { /* keep */ } setTries((n) => n + 1); }, 4000);
    return () => clearTimeout(t);
  }, [state, tries, saved, status]);
  const o = outcomeFor({ booking: saved.booking, state });
  const form = state ? formLabel(state) : null;
  const c = saved.customer;
  const v = addedView({ jobNumber: saved.jobNumber, address: [c.address_line, c.suburb].filter((x) => x.trim()).join(", "), ownerName: c.full_name, phone: c.phone, ownerFirstName: firstName(c.full_name), booking: saved.booking, visit: saved.visit, state });
  return (
    <div className="space-y-5" data-saved data-outcome={o.tone} data-onsite-state={state?.kind ?? "none"} data-booking={saved.booking}>
      <section className="rounded-[18px] border-2 border-hiv-green bg-[#E9FBF1] px-4 py-[22px] text-center" data-added-header>
        <span aria-hidden className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-hiv-green text-[34px] font-bold text-white">✓</span>
        <h2 className="mt-3 font-display text-2xl font-bold leading-[1.2]" data-outcome-heading>{v.heading}</h2>
        <p className="mt-1 text-[15px] font-semibold">{v.line1}</p>
        <p className="mt-0.5 text-sm text-sub">{v.line2}</p>
      </section>
      <section className="rounded-[18px] bg-mist p-4" data-mitti-card>
        <h3 className="font-display text-[17px] font-bold">{v.card.title}</h3>
        <p className="mt-1.5 text-sm leading-[1.5] text-sub" data-outcome-body>{v.card.body}</p>
        {form && <p className="sr-only" data-form-state={form.label}>{form.label}</p>}
        {v.card.button === "Open Mitti form" && state?.kind === "open" && <a className={`${PRIMARY_BTN} mt-3.5`} href={state.url} target="_blank" rel="noreferrer">Open Mitti form</a>}
        {v.card.button === "Try again" && <button type="button" className={`${PRIMARY_BTN} mt-3.5`} onClick={async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: true } })); } catch { /* keep */ } setTries(0); }}>Try again</button>}
      </section>
      <section data-what-we-do-now>
        <h3 className="border-b border-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-sub">What we do now</h3>
        {v.steps.map((s, i) => <p key={s} className={`flex min-h-12 items-center gap-3 text-sm font-medium leading-[1.45] ${i < v.steps.length - 1 ? "border-b border-line" : ""}`}><span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-mist text-[13px] font-bold">{i + 1}</span>{s}</p>)}
      </section>
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="flex min-h-12 w-full items-center justify-center rounded-[12px] border border-line text-[15px] font-semibold text-hiv-blue">{v.goToJob}</Link>
      <button type="button" onClick={onAddAnother} className="flex min-h-11 w-full items-center justify-center text-[15px] font-semibold text-sub">{v.addAnother}</button>
    </div>
  );
}
