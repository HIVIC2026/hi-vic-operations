// Installer Add a job — ONE screen per the approved new-job-flow mock-up (installer screens Task 7): how did you get this
// customer, the owner's details, the electrician for the PIESA, the consent tick naming Home Insulation Victoria AND the
// installer, one "Add the job" button. On success the phone goes straight to the job page, where the Next step box says
// "Book the Ready Check". Error state = red 2px borders + one short line per field + a summary banner (decision 237).
// Uses only the existing guarded server handler (startOnsiteReadyCheck); intake validation is unchanged.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CustomerFields, FieldError } from "./customer-fields";
import { addJobOptions, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { LEAD_ORIGINS, leadOriginProblem, type LeadOrigin, type OnsiteInput } from "@/lib/onsite-ready-check.core";
import {
  ADD_JOB_DRAFT_WORDS, ADD_JOB_OFFLINE_NOTE, ADD_JOB_WORDS, BUSY_LABEL, OWNER_CARD_TITLE, TRY_AGAIN_LABEL, addJobConsentLine, blankCustomer, customerProblems, electricianProblem,
  errorSummary, fieldErrors, nextLine, restoreCustomer, restoreRequestKey, saveErrorMessage,
} from "@/lib/add-job-flow.core";
import { inputCls } from "@/components/trade/TradeShell";

const DRAFT_KEY = "hiv-onsite-draft";
/** 56px blue button (approved heavier design). */
export const PRIMARY_BTN = "flex min-h-14 w-full items-center justify-center rounded-[14px] bg-hiv-blue text-[17px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const CARD = "rounded-[18px] bg-mist p-4";
const CARD_TITLE = "font-display text-[17px] font-bold text-ink";

// `onExit` / `onReset` / `onSavedChange` are kept for existing callers; the screen itself has no Cancel and no "Job added" state.
export function AddJobFlow({ businessId }: { businessId: string; onExit?: () => void; onReset?: () => void; onSavedChange?: (saved: boolean) => void }) {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<OnsiteInput>(blankCustomer());
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Jo 3 Nov ruling: a job whose electrician could not be put on it is still added; the installer is told, then goes to the job.
  const [addedJobId, setAddedJobId] = useState<string | null>(null);
  const [electricianNotAllocated, setElectricianNotAllocated] = useState(false);
  const [electricianReason, setElectricianReason] = useState<string | null>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  // Task 7: the business name (for the consent line) and its Team electricians, read once before the form is used.
  const loadOptions = useServerFn(addJobOptions);
  const options = useQuery({ queryKey: ["add-job-options", businessId], queryFn: () => loadOptions({ data: { businessId } }), retry: 1 });
  const electricians = options.data?.electricians ?? [];
  const businessName = options.data?.businessName ?? null;
  const [electrician, setElectrician] = useState<string>("");
  // Consent integrity: the tick is only ever shown with the exact line for THIS business; if the name changes the tick is reset.
  useEffect(() => { setCustomer((c) => (c.contact_permission || c.consent_by ? { ...c, contact_permission: false, consent_by: null } : c)); }, [businessName]);
  // A1: asked fresh every time (not kept in the phone draft).
  const [leadOrigin, setLeadOrigin] = useState<LeadOrigin | null>(null);
  // A6: one request key per draft, kept across Try again and reloads (in the phone draft).
  const [requestKey, setRequestKey] = useState<string>(() => crypto.randomUUID());
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Poor signal on site: typed details stay on the phone (never the consent tick) until saved.
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) { const raw = JSON.parse(d); setCustomer(restoreCustomer(raw)); const k = restoreRequestKey(raw); if (k) setRequestKey(k); } } catch { /* ignore */ } finally { setDraftLoaded(true); } }, []);
  useEffect(() => { if (!draftLoaded) return; try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...customer, contact_permission: false, consent_by: null, request_key: requestKey })); } catch { /* ignore */ } }, [draftLoaded, customer, requestKey]);
  useEffect(() => { if (shown.length) bannerRef.current?.focus(); }, [shown]);
  // Fixing an answer clears the old hint list; it is rebuilt on the next tap.
  useEffect(() => { setShown([]); }, [customer, leadOrigin, electrician]);

  const start = useServerFn(startOnsiteReadyCheck);

  const problems = (): string[] => {
    const lop = leadOriginProblem(leadOrigin);
    const ecp = electricianProblem(electrician, electricians);
    return [...(lop ? [lop] : []), ...customerProblems(customer, { businessName }), ...(ecp ? [ecp] : [])];
  };

  const save = async () => {
    if (busy || inFlight.current) return; // double tap
    const p = problems(); setShown(p); setErr(null);
    if (p.length) return;
    inFlight.current = true; setBusy(true);
    try {
      const r = await start({ data: { businessId, owner: customer, leadOrigin, requestKey, electricianWorkerId: electrician } });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setElectricianNotAllocated(r.electrician === "not_allocated");
      setElectricianReason(r.electricianReason ?? null);
      setAddedJobId(r.jobId);
      toast.success(nextLine(r.ownerFirstName ?? "the owner"));
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  const ecpShown = shown.length ? electricianProblem(electrician, electricians) : null;
  const errors = { ...fieldErrors(shown), ...(ecpShown ? { electrician: ecpShown } : {}) };
  const summary = errorSummary(shown.length);
  const consentLabel = businessName ? addJobConsentLine(businessName) : undefined;
  if (addedJobId) return (
    <div className="space-y-4" data-add-job-flow data-step="added">
      <h2 className="font-display text-xl font-semibold">Added</h2>
      {electricianNotAllocated && <div role="alert" className="space-y-2 text-sm" data-electrician-not-allocated><p>{electricianReason ?? "The electrician couldn't be put on the job. Your choice is saved."}</p><Link to="/field/business/team" className="inline-flex min-h-12 items-center font-semibold text-hiv-blue underline">Open Team</Link></div>}
      <button type="button" className={PRIMARY_BTN} onClick={() => void navigate({ to: "/field/$jobId", params: { jobId: addedJobId }, search: { added: true } })}>{ADD_JOB_DRAFT_WORDS.goToJob}</button>
    </div>
  );
  return (
    <div className="space-y-5" data-add-job-flow data-step="customer">
      {summary && <p ref={bannerRef} tabIndex={-1} role="alert" className="rounded-[12px] border-2 px-3.5 py-3 text-[15px] font-bold leading-[1.4] outline-none" style={{ borderColor: "#8A3B4A", background: "#FBEFF1", color: "#8A3B4A" }} data-step-problems>{summary}</p>}
      <fieldset className={CARD} data-lead-origin>
        <legend className="sr-only">{ADD_JOB_WORDS.how}</legend>
        <p className="text-[15px] font-bold" aria-hidden>{ADD_JOB_WORDS.how}</p>
        {LEAD_ORIGINS.map((o) => (
          <label key={o.value} className="flex min-h-12 items-center gap-3 text-[15px]">
            <input type="radio" name="add-job-lead-origin" value={o.value} checked={leadOrigin === o.value} disabled={busy} onChange={() => { setLeadOrigin(o.value); setErr(null); }} />{o.label}
          </label>
        ))}
        {(leadOrigin === "door_knock" || leadOrigin === "cold_call") && <p role="alert" className="mt-1 text-[13px] leading-[1.45] text-sub">{ADD_JOB_WORDS.howNote}</p>}
        <FieldError>{errors.lead_origin}</FieldError>
      </fieldset>
      <section className={CARD} data-owner-card>
        <h2 className={CARD_TITLE}>{OWNER_CARD_TITLE}</h2>
        <div className="mt-3.5"><CustomerFields value={customer} addressHelper="Start typing, then pick it from the list." labels={{ name: ADD_JOB_WORDS.name, mobile: ADD_JOB_WORDS.mobile, email: ADD_JOB_WORDS.email, address: ADD_JOB_WORDS.address }} consentLabel={consentLabel} hideConsent={!consentLabel} errors={errors} onChange={(n) => { setCustomer(n); setErr(null); }} /></div>
        {!consentLabel && <p className="mt-3 text-sm text-sub" data-consent-loading>{ADD_JOB_DRAFT_WORDS.loadingBusiness}</p>}
      </section>
      <section className={CARD} data-electrician-picker>
        <label className="block">
          <span className={CARD_TITLE}>{ADD_JOB_WORDS.electrician}</span>
          <select className={`${inputCls} mt-2`} value={electrician} disabled={busy || options.isLoading} onChange={(e) => { setElectrician(e.target.value); setErr(null); }} aria-invalid={errors.electrician ? true : undefined}>
            <option value="">{options.isLoading ? ADD_JOB_DRAFT_WORDS.loading : ADD_JOB_DRAFT_WORDS.chooseElectrician}</option>
            {electricians.map((w) => <option key={w.id} value={w.id} disabled={!w.allowed}>{w.name}{w.reason ? ` — ${w.reason}` : ""}</option>)}
          </select>
        </label>
        {options.isSuccess && !electricians.some((w) => w.allowed) && <p className="mt-2 text-[13px] leading-[1.45] text-sub" data-no-electrician>{ADD_JOB_DRAFT_WORDS.noTeamElectrician}</p>}
        {options.isError && <p role="alert" className="mt-2 text-sm text-rose">{ADD_JOB_DRAFT_WORDS.teamFailed}</p>}
        <FieldError>{errors.electrician}</FieldError>
      </section>
      {err && <p role="status" className="rounded-[12px] border-2 border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}
      <button type="button" className={PRIMARY_BTN} disabled={busy || leadOrigin === "door_knock" || leadOrigin === "cold_call"} aria-busy={busy} onClick={save}>{busy ? BUSY_LABEL : err && !/already has an open job/i.test(err) ? TRY_AGAIN_LABEL : ADD_JOB_WORDS.button}</button>
      <p className="text-center text-[13px] leading-[1.5] text-sub" data-next-step>{ADD_JOB_OFFLINE_NOTE}</p>
    </div>
  );
}
