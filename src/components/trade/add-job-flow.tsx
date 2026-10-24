// Installer Add a job — ONE screen per the approved mock-up M3 (decision 198; basics only, decision 34): owner's name,
// picked address, mobile, email and the contact-permission tick, plus ONE optional Ready Check day + time (decisions
// 110/116), then the one blue "Add job" button and "what happens next" (decisions 115, 163).
// Everything else (measurements, insulation, removal, product, price, electrician) is answered in the Mitti form.
// Uses only the existing guarded server handler (startOnsiteReadyCheck); intake validation is unchanged.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CustomerFields, FIELD_LABEL } from "./customer-fields";
import { onsiteFormStatus, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { OWNER_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput, OnsiteState } from "@/lib/onsite-ready-check.core";
import { a1ReadyCheckTimeBlockers, allowedReadyCheckDays, allowedReadyCheckTimes } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import {
  BUSY_LABEL, SAVE_LABEL, VISIT_FIELD_HINT, WHAT_HAPPENS_NEXT, blankCustomer, customerProblems, dayOptionLabel, formLabel, outcomeFor, restoreCustomer,
  saveErrorMessage, visitPayload, visitProblems, type AddJobBooking, type VisitPick,
} from "@/lib/add-job-flow.core";

const DRAFT_KEY = "hiv-onsite-draft";
export const PRIMARY_BTN = "flex min-h-12 w-full items-center justify-center rounded-[12px] bg-hiv-blue text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

type Saved = { jobId: string; jobNumber: string | null; booking: AddJobBooking; state?: OnsiteState };

// `onExit` is kept for existing callers/fixtures; the one-screen mock-up has no Cancel button (My work is a tab).
export function AddJobFlow({ businessId }: { businessId: string; onExit?: () => void }) {
  const [customer, setCustomer] = useState<OnsiteInput>(blankCustomer());
  const [visit, setVisit] = useState<VisitPick>({ day: "", time: "" });
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const problemsRef = useRef<HTMLUListElement>(null);
  const inFlight = useRef(false);

  // Poor signal on site: typed details stay on the phone (never the consent tick) until saved.
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) setCustomer(restoreCustomer(JSON.parse(d))); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...customer, contact_permission: false, consent_by: null })); } catch { /* ignore */ } }, [customer]);
  useEffect(() => { if (shown.length) problemsRef.current?.focus(); }, [shown]);
  // Fixing an answer clears the old hint list; it is rebuilt on the next tap.
  useEffect(() => { setShown([]); }, [customer, visit]);

  const start = useServerFn(startOnsiteReadyCheck);

  if (saved) return <SavedResult saved={saved} />;

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
      setSaved({ jobId: r.jobId, jobNumber: r.jobNumber ?? null, booking: r.booking, state: r.state });
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  return (
    <div className="space-y-[18px]" data-add-job-flow data-step="customer">
      <CustomerFields value={customer} consentLabel={OWNER_CONTACT_PERMISSION} onChange={(n) => { setCustomer(n); setErr(null); }} />
      <VisitField value={visit} onChange={setVisit} disabled={busy} />
      {shown.length > 0 && <ul ref={problemsRef} tabIndex={-1} role="alert" className="space-y-1 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger outline-none" data-step-problems>{shown.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="status" className="rounded-[12px] border border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}
      <button type="button" className={`${PRIMARY_BTN} mt-1`} disabled={busy} aria-busy={busy} onClick={save}>{busy ? BUSY_LABEL : err ? "Retry submission" : SAVE_LABEL}</button>
      <p className="text-[13px] leading-[1.5] text-sub" data-next-step>{WHAT_HAPPENS_NEXT}</p>
    </div>
  );
}

const SELECT = "h-12 w-full appearance-none rounded-[12px] border border-line bg-paper px-3.5 pr-9 text-base text-ink outline-none focus:border-hiv-blue disabled:text-sub";
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

/** Decision 116: the one optional field — same allowed days / exact times as the job page (decision 110). */
function VisitField({ value, onChange, disabled }: { value: VisitPick; onChange: (v: VisitPick) => void; disabled: boolean }) {
  const days = allowedReadyCheckDays();
  const times = value.day ? allowedReadyCheckTimes(value.day) : [];
  const blockers = value.day && value.time ? a1ReadyCheckTimeBlockers({ day: value.day, time: value.time }) : [];
  return (
    <fieldset className="border-t border-line pt-4" data-visit-field>
      <legend className="sr-only">Ready Check visit day and time (optional)</legend>
      <p className={FIELD_LABEL} aria-hidden>Ready Check visit day and time <span className="font-medium text-sub">(optional)</span></p>
      <p className="mt-1 text-[13px] leading-[1.45] text-sub">{VISIT_FIELD_HINT}</p>
      <div className="mt-2 flex gap-2">
        <Select id="add-job-visit-day" label="Visit day" value={value.day} disabled={disabled} placeholder="Day" options={days.map((d) => ({ value: d, label: dayOptionLabel(d) }))} onChange={(day) => onChange({ day, time: "" })} />
        <Select id="add-job-visit-time" label="Arrival time" value={value.time} disabled={disabled || !value.day} placeholder="Time" options={times.map((t) => ({ value: t, label: installTimeLabel(t) }))} onChange={(time) => onChange({ ...value, time })} />
      </div>
      {blockers.length > 0 && <p className="mt-2 text-sm text-rose" data-visit-blocker>{blockers.join(" ")}</p>}
    </fieldset>
  );
}

function SavedResult({ saved }: { saved: Saved }) {
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
  return (
    <section className={`space-y-3 rounded-[18px] border p-5 ${o.tone === "blocked" ? "border-rose bg-pink" : "border-line bg-mist"}`} data-saved data-outcome={o.tone} data-onsite-state={state?.kind ?? "none"} data-booking={saved.booking}>
      <p className="text-[11px] font-bold uppercase tracking-[1.1px] text-sub">{saved.jobNumber ?? "Job"} saved</p>
      <h2 className="font-display text-[22px] font-semibold leading-[1.2]" data-outcome-heading>{o.heading}</h2>
      <p className="text-sm" data-outcome-body>{o.body}</p>
      {o.visit && <p className="text-sm" data-visit-outcome>{o.visit}</p>}
      {o.waitingOn && <p className="text-sm font-semibold" data-waiting-on>Waiting on: {o.waitingOn}</p>}
      {form && <p className="sr-only" data-form-state={form.label}>{form.label}</p>}
      {state?.kind === "open" && <a className={PRIMARY_BTN} href={state.url} target="_blank" rel="noreferrer">Open Mitti form</a>}
      {state?.kind === "retry" && <button type="button" className={PRIMARY_BTN} onClick={async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: true } })); } catch { /* keep */ } setTries(0); }}>Try again</button>}
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="flex min-h-12 w-full items-center justify-center rounded-[12px] border border-line bg-paper text-base font-semibold text-ink">Go to the job</Link>
      <Link to="/field" className="block min-h-11 py-2.5 text-center text-sm font-semibold text-hiv-blue">Back to My work</Link>
    </section>
  );
}
