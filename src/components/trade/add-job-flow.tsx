// Installer Add a job (Jo, 8 Oct 2026; basics only since decision 34, 24 Oct 2026): owner's name, picked address,
// mobile, email and the contact-permission tick, plus ONE optional visit day + time (decision 116).
// Everything else (measurements, insulation, removal, product, price, electrician) is answered in the Mitti form.
// Customer -> Review & save. Uses only the existing guarded server handler (startOnsiteReadyCheck).
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerFields } from "./customer-fields";
import { onsiteFormStatus, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { READY_CHECK_CONTACT_PERMISSION } from "@/lib/job-electrician.core";
import type { OnsiteInput, OnsiteState } from "@/lib/onsite-ready-check.core";
import { a1ReadyCheckTimeBlockers, allowedReadyCheckDays, allowedReadyCheckTimes } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";
import {
  ADD_JOB_STEPS, BUSY_LABEL, FORM_WITHIN_15, SAVE_LABEL, VISIT_FIELD_LABEL, VISIT_FIELD_NOTE, blankCustomer, contactPermissionSummary, customerProblems, formLabel,
  nextStep, outcomeFor, prevStep, restoreCustomer, saveErrorMessage, visitPayload, visitProblems, visitSummary, type AddJobBooking, type AddJobStep, type VisitPick,
} from "@/lib/add-job-flow.core";

const DRAFT_KEY = "hiv-onsite-draft";

type Saved = { jobId: string; jobNumber: string | null; booking: AddJobBooking; state?: OnsiteState };

export function AddJobFlow({ businessId, onExit }: { businessId: string; onExit: () => void }) {
  const [step, setStep] = useState<AddJobStep>("customer");
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
  const navigate = useNavigate();

  if (saved) return <SavedResult saved={saved} />;

  const stepProblems = (): string[] => {
    const c = customerProblems(customer);
    if (step === "customer") return c;
    const v = visitPayload(visit);
    return [...c, ...visitProblems(visit), ...(v ? a1ReadyCheckTimeBlockers(v) : [])];
  };

  const forward = () => {
    const p = stepProblems(); setShown(p); setErr(null);
    if (p.length) return;
    setStep(nextStep(step));
  };
  const back = () => { setShown([]); setErr(null); const p = prevStep(step); if (p) setStep(p); else onExit(); };

  const save = async () => {
    if (busy || inFlight.current) return; // double tap
    const p = stepProblems(); setShown(p); setErr(null);
    if (p.length) return;
    inFlight.current = true; setBusy(true);
    try {
      const r = await start({ data: { businessId, owner: customer, visit: visitPayload(visit) } });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setSaved({ jobId: r.jobId, jobNumber: r.jobNumber ?? null, booking: r.booking, state: r.state });
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  const idx = ADD_JOB_STEPS.findIndex((s) => s.key === step);

  return (
    <div className="mt-3 space-y-4 pb-24" data-add-job-flow data-step={step}>
      <ol className="grid grid-cols-2 gap-1" aria-label="Progress">
        {ADD_JOB_STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === idx ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
            <span className={`mt-1 block truncate text-xs ${i === idx ? "font-bold text-ink" : "text-sub"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      {step === "customer" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-customer>
        <h2 className="font-display text-lg font-bold">Customer</h2>
        <p className="text-sm text-sub" data-customer-lead>Enter the details perfectly and in full — they carry onto the quote and all the paperwork from here on.</p>
        <CustomerFields value={customer} consentLabel={READY_CHECK_CONTACT_PERMISSION} onChange={(n) => { setCustomer(n); setErr(null); }} />
      </section>}

      {step === "review" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-review>
        <h2 className="font-display text-lg font-bold">Review & save</h2>
        <Summary title="Customer" onEdit={() => setStep("customer")} rows={[customer.full_name, [customer.address_line, customer.suburb, customer.postcode].filter(Boolean).join(", "), customer.phone, customer.email, contactPermissionSummary(customer)]} />
        <VisitField value={visit} onChange={setVisit} disabled={busy} />
        <div className="rounded-[12px] border border-line p-3" data-next-step><p className="text-xs font-bold uppercase tracking-wide text-sub">What happens next</p><p className="mt-1 text-sm">{FORM_WITHIN_15} Fill it in at the home and press Complete only when it's fully finished — that sends the owner's quote.</p></div>
      </section>}

      {shown.length > 0 && <ul ref={problemsRef} tabIndex={-1} role="alert" className="space-y-1 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger outline-none" data-step-problems>{shown.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="status" className="rounded-[12px] border border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}

      <div className="space-y-2">
        {step === "review"
          ? <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={save}>{busy ? BUSY_LABEL : err ? "Retry submission" : SAVE_LABEL}</Button>
          : <Button size="field" className="w-full" disabled={busy} onClick={forward}>Next</Button>}
        <div className="grid grid-cols-2 gap-2">
          <Button size="field" variant="outline" disabled={busy} onClick={back}>Back</Button>
          <Button size="field" variant="ghost" disabled={busy} onClick={async () => {
            try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
            await navigate({ to: "/field" }); onExit();
          }}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

/** Decision 116: the one optional field at the end — same allowed days / exact times as the job page (decision 110). */
function VisitField({ value, onChange, disabled }: { value: VisitPick; onChange: (v: VisitPick) => void; disabled: boolean }) {
  const days = allowedReadyCheckDays();
  const times = value.day ? allowedReadyCheckTimes(value.day) : [];
  const blockers = value.day && value.time ? a1ReadyCheckTimeBlockers({ day: value.day, time: value.time }) : [];
  return (
    <fieldset className="rounded-[12px] bg-mist p-3" data-visit-field>
      <legend className="text-sm font-bold">{VISIT_FIELD_LABEL}</legend>
      <p className="mt-1 text-xs text-sub">{VISIT_FIELD_NOTE}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div><Label htmlFor="add-job-visit-day">Day</Label><Input id="add-job-visit-day" type="date" className="h-12" value={value.day} min={days[0]} max={days[days.length - 1]} disabled={disabled} onChange={(e) => onChange({ day: e.target.value, time: "" })} /></div>
        <div><Label htmlFor="add-job-visit-time">Arrival time</Label>
          <select id="add-job-visit-time" aria-label="Arrival time" className="flex h-12 w-full rounded-md border border-input bg-background px-3 text-sm" value={value.time} disabled={disabled || !value.day} onChange={(e) => onChange({ ...value, time: e.target.value })}>
            <option value="">Time…</option>
            {times.map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
          </select></div>
      </div>
      {(value.day || value.time) && <div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-sub" data-visit-summary>{visitSummary(value)}</p><button type="button" className="text-xs font-bold underline" onClick={() => onChange({ day: "", time: "" })}>Clear</button></div>}
      {blockers.length > 0 && <p className="mt-2 text-sm text-rose" data-visit-blocker>{blockers.join(" ")}</p>}
    </fieldset>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[]; onEdit: () => void }) {
  return <div className="rounded-[12px] bg-mist p-3" data-summary={title}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-sub">{title}</p><button type="button" onClick={onEdit} className="h-10 rounded-[9px] px-3 text-sm font-bold text-hiv-blue underline" aria-label={`Edit ${title.toLowerCase()}`}>Edit</button></div>
    <ul className="mt-1 space-y-0.5 text-sm">{rows.filter(Boolean).map((r, i) => <li key={i} className="break-words">{r}</li>)}</ul>
  </div>;
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
    <section className={`mt-4 space-y-3 rounded-[18px] border p-5 ${o.tone === "blocked" ? "border-rose bg-pink" : "border-line bg-paper"}`} data-saved data-outcome={o.tone} data-onsite-state={state?.kind ?? "none"} data-booking={saved.booking}>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{saved.jobNumber ?? "Job"} saved</p>
      <h2 className="font-display text-xl font-bold" data-outcome-heading>{o.heading}</h2>
      <p className="text-sm" data-outcome-body>{o.body}</p>
      {o.visit && <p className="text-sm" data-visit-outcome>{o.visit}</p>}
      {o.waitingOn && <p className="text-sm font-semibold" data-waiting-on>Waiting on: {o.waitingOn}</p>}
      {form && <p className="sr-only" data-form-state={form.label}>{form.label}</p>}
      {state?.kind === "open" && <a className="inline-flex h-12 w-full items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" href={state.url} target="_blank" rel="noreferrer">Open Mitti form</a>}
      {state?.kind === "retry" && <Button size="field" className="w-full" onClick={async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: true } })); } catch { /* keep */ } setTries(0); }}>Try again</Button>}
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line font-bold">Go to the job</Link>
      <Link to="/field" className="block text-center text-sm font-bold underline">Back to My work</Link>
    </section>
  );
}
