// Installer Add job (Jo, 8 Oct 2026): one phone-first flow for the three existing modes.
// Customer -> Job details -> Review & save. Uses only the existing guarded server handlers.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerFields } from "./customer-fields";
import { AttachFiles, ElectricianPicker, inviteResultMessage, useUploadFiles, type AttachedFile } from "./job-intake";
import { addImportFiles, confirmImport, createImport, discardImport, removeImportFile } from "@/lib/pilot.functions";
import { addBulkElectrician, bulkElectricianChoices, readBulkFile } from "@/lib/bulk-import.functions";
import { onsiteFormStatus, startOnsiteReadyCheck } from "@/lib/onsite-ready-check.functions";
import { addressFromReverse, type OnsiteInput, type OnsiteState } from "@/lib/onsite-ready-check.core";
import { OWNER_AGREED_TICK, OWNER_FEE_AWARENESS_TICK } from "@/lib/owner-confirm.core";
import { SAFETY_CHECK_NOTE, electricianPlanBlocker, usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import { reviewItems, type Extracted, type ImportField } from "@/lib/pilot.core";
import {
  ADD_JOB_STEPS, BUSY_LABEL, blankCustomer, bookingLabel, customerProblems, existingDetailsProblems, existingReviewProblems, formLabel,
  laterDetailsProblems, laterPayload, nextStep, parseAmount, prevStep, restoreCustomer, saveErrorMessage, submitLabel,
  type AddJobMode, type AddJobStep, type BookingOutcome, type ExistingDetails, type LaterDetails,
} from "@/lib/add-job-flow.core";

const DRAFT_KEY = "hiv-onsite-draft";
const CUSTOMER_KEYS = ["full_name", "phone", "email", "address_line", "suburb", "postcode"] as const;
const NUMERIC: ImportField[] = ["measured_area_m2", "removal_m2", "existing_r_value", "r_value"];
const HIDDEN_EXTRA: ImportField[] = [...CUSTOMER_KEYS, "measured_area_m2", "measurement_method"];

type Draft = { id: string; extracted: Extracted };
type Saved = { jobId: string; jobNumber: string | null; booking?: BookingOutcome; state?: OnsiteState; mode: AddJobMode };

export function AddJobFlow({ businessId, initialMode, onExit }: { businessId: string; initialMode: AddJobMode; onExit: () => void }) {
  const [mode, setMode] = useState<AddJobMode>(initialMode);
  const [step, setStep] = useState<AddJobStep>("customer");
  const [customer, setCustomer] = useState<OnsiteInput>(blankCustomer());
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  // Job details, per mode — kept while moving back and forward.
  const [ex, setEx] = useState<ExistingDetails>({ siteCheck: null, quoted: null, area: "", method: "", amount: "", includes: "" });
  const [later, setLater] = useState<LaterDetails>({ date: "", manual: false, area: "", method: "", notes: "" });
  const [siteDate, setSiteDate] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [fileText, setFileText] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extraVals, setExtraVals] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState({ feeAwareness: false, belowR2: false, ownerAgreed: false });
  const [notVisited, setNotVisited] = useState(false);
  const problemsRef = useRef<HTMLUListElement>(null);

  const getEl = useServerFn(bulkElectricianChoices), addEl = useServerFn(addBulkElectrician);
  const { data: el, refetch } = useQuery({ queryKey: ["bulk-electricians", businessId], queryFn: () => getEl({ data: { businessId } }) });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  useEffect(() => { if (plan || !el) return; const u = usualElectrician(el.approved); setPlan(u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "hivic" }); }, [el, plan]);

  // Poor signal on site: typed details stay on the phone (never the consent tick) until saved.
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) setCustomer(restoreCustomer(JSON.parse(d))); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...customer, contact_permission: false, consent_by: null })); } catch { /* ignore */ } }, [customer]);
  useEffect(() => { if (shown.length) problemsRef.current?.focus(); }, [shown]);
  // Fixing an answer clears the old hint list; it is rebuilt on the next tap.
  useEffect(() => { setShown([]); }, [ticks, customer, ex, later]);

  const start = useServerFn(startOnsiteReadyCheck);
  const create = useServerFn(createImport), confirm = useServerFn(confirmImport), discard = useServerFn(discardImport);
  const addFiles = useServerFn(addImportFiles), dropFile = useServerFn(removeImportFile), readFile = useServerFn(readBulkFile);
  const uploadFiles = useUploadFiles(businessId);
  const navigate = useNavigate();

  const electrician = (): { mode: "hivic" } | { mode: "mine"; business_id: string | null; nomination_id: string | null } =>
    plan && plan.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" };

  if (saved) return <SavedResult saved={saved} />;

  const stepProblems = (): string[] => {
    if (step === "customer") return customerProblems(customer);
    if (step === "details") {
      if (mode === "later") return laterDetailsProblems(later);
      if (mode === "existing") { const p = existingDetailsProblems(ex); if (ex.quoted === "no") return ["Choose a Ready Check option below"]; return p; }
      return electricianPlanBlocker(plan) ? [electricianPlanBlocker(plan) as string] : [];
    }
    if (mode === "existing") return [...existingReviewProblems(ticks), ...(electricianPlanBlocker(plan) ? [electricianPlanBlocker(plan) as string] : [])];
    return [];
  };

  const ensureDraft = async (): Promise<Draft> => {
    if (draft) return draft; // never a second draft on back/forward or retry
    const r = await create({ data: { businessId, sourceSystem: "manual_import", ...(fileText ? { text: fileText } : {}), files: files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" })) } });
    const d = { id: r.id, extracted: r.extracted as Extracted };
    setDraft(d);
    const items = reviewItems(d.extracted).filter((i) => !HIDDEN_EXTRA.includes(i.key) && i.value != null);
    setExtraVals((old) => ({ ...Object.fromEntries(items.map((i) => [i.key, typeof i.value === "boolean" ? (i.value ? "yes" : "no") : String(i.value)])), ...old }));
    return d;
  };

  const forward = async () => {
    const p = stepProblems(); setShown(p); setErr(null);
    if (p.length) return;
    if (step === "details" && mode === "existing") {
      setBusy(true);
      try { await ensureDraft(); } catch (e) { setErr(saveErrorMessage((e as Error).message)); return; } finally { setBusy(false); }
    }
    setStep(nextStep(step));
  };
  const back = () => { setShown([]); setErr(null); const p = prevStep(step); if (p) setStep(p); else onExit(); };

  const save = async () => {
    if (busy) return;
    const p = stepProblems(); setShown(p); setErr(null);
    if (p.length) return;
    setBusy(true);
    try {
      if (mode === "existing") {
        const d = await ensureDraft();
        const facts: Record<string, string | number | boolean | null> = {};
        for (const i of reviewItems(d.extracted)) {
          const v = (extraVals[i.key] ?? "").trim();
          facts[i.key] = !v ? null : NUMERIC.includes(i.key) ? Number(v) : i.key === "removal_required" ? /^(y|yes|true)$/i.test(v) : v;
        }
        for (const k of CUSTOMER_KEYS) facts[k] = customer[k].trim();
        facts["measured_area_m2"] = Number(ex.area); facts["measurement_method"] = ex.method.trim();
        const amount = parseAmount(ex.amount);
        const r = await confirm({ data: { importId: d.id, facts, installer: { quoted: ex.quoted, site_check: ex.siteCheck ?? "yes", site_check_date: ex.siteCheck === "yes" && siteDate ? siteDate : null, quoted_price_inc_gst: amount, price_includes: ex.includes.trim() || null, contact_permission: customer.contact_permission, fee_awareness: ticks.feeAwareness, existing_below_r2: ticks.belowR2, owner_agreed: ticks.ownerAgreed }, electrician: electrician() } as never });
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        setSaved({ jobId: r.jobId, jobNumber: r.jobNumber ?? null, mode });
      } else {
        const r = await start({ data: { businessId, owner: customer, electrician: mode === "later" ? { mode: "hivic" } : electrician(), ...(mode === "later" ? { later: laterPayload(later) } : {}) } as never });
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        setSaved({ ...(r as Omit<Saved, "mode">), mode });
      }
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); }
  };

  const switchMode = (m: AddJobMode) => { setMode(m); setShown([]); setErr(null); setStep("details"); };
  const idx = ADD_JOB_STEPS.findIndex((s) => s.key === step);

  return (
    <div className="mt-3 space-y-4 pb-24" data-add-job-flow data-mode={mode} data-step={step}>
      <ol className="grid grid-cols-3 gap-1" aria-label="Progress">
        {ADD_JOB_STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === idx ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
            <span className={`mt-1 block truncate text-xs ${i === idx ? "font-bold text-ink" : "text-sub"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      {step === "customer" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-customer>
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg font-bold">Customer</h2>{mode === "onsite" && <LocationButton onFound={(a) => setCustomer((x) => ({ ...x, address_line: a.address_line || x.address_line, suburb: a.suburb || x.suburb, postcode: a.postcode || x.postcode }))} />}</div>
        <CustomerFields value={customer} onChange={(n) => { setCustomer(n); setErr(null); }} />
      </section>}

      {step === "details" && <section className="space-y-4 rounded-[18px] border border-line bg-paper p-4" data-step-details>
        <h2 className="font-display text-lg font-bold">Job details</h2>
        {mode === "onsite" && <p className="text-sm text-sub">You're at the property now. After saving, the Ready Check form opens here when it's ready.</p>}
        {mode === "later" && <>
          <label className="block text-sm font-bold">Booked Ready Check date and time<Input type="datetime-local" className="mt-1 h-12 w-full min-w-0" value={later.date} onChange={(e) => setLater({ ...later, date: e.target.value })} /></label>
          <div><p className="text-sm font-bold">Measurements</p><div className="mt-2 grid grid-cols-2 gap-2"><Button size="field" variant={!later.manual ? "default" : "outline"} aria-pressed={!later.manual} onClick={() => setLater({ ...later, manual: false })}>Add later</Button><Button size="field" variant={later.manual ? "default" : "outline"} aria-pressed={later.manual} onClick={() => setLater({ ...later, manual: true })}>Enter now</Button></div></div>
          {later.manual && <div className="space-y-3">
            <label className="block text-sm font-bold">Ceiling area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={later.area} onChange={(e) => setLater({ ...later, area: e.target.value })} /></label>
            <label className="block text-sm font-bold">How was it measured?<Input className="mt-1 h-12" maxLength={200} value={later.method} onChange={(e) => setLater({ ...later, method: e.target.value })} /></label>
            <label className="block text-sm font-bold">Other measurements and site details<Textarea className="mt-1" maxLength={2000} value={later.notes} onChange={(e) => setLater({ ...later, notes: e.target.value })} /></label>
            <p className="text-xs text-sub">These stay unverified until checked.</p>
          </div>}
        </>}
        {mode === "existing" && <>
          <div><p className="text-sm font-bold">Have you quoted this owner?</p><div className="mt-2 grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} size="field" variant={ex.quoted === v ? "default" : "outline"} aria-pressed={ex.quoted === v} onClick={() => { setEx({ ...ex, quoted: v }); setNotVisited(false); }}>{v === "yes" ? "Yes" : "No"}</Button>)}</div></div>
          {ex.quoted === "yes" && <div className="space-y-3" data-quoted-yes>
            <div><p className="text-sm font-bold">Have you done the site check / measure-up?</p><p className="text-xs text-sub">Your measure-up stays unverified until Home Insulation Victoria checks it.</p><div className="mt-2 grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} size="field" variant={ex.siteCheck === v ? "default" : "outline"} aria-pressed={ex.siteCheck === v} onClick={() => setEx({ ...ex, siteCheck: v })}>{v === "yes" ? "Yes" : "No"}</Button>)}</div></div>
            {ex.siteCheck === "yes" && <label className="block text-sm font-bold">Site check date (if known)<Input type="date" className="mt-1 h-12" value={siteDate} onChange={(e) => setSiteDate(e.target.value)} /></label>}
            <label className="block text-sm font-bold">Ceiling area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={ex.area} onChange={(e) => setEx({ ...ex, area: e.target.value })} /></label>
            <label className="block text-sm font-bold">How was it measured?<Input className="mt-1 h-12" placeholder="e.g. laser, tape or floor plan" maxLength={200} value={ex.method} onChange={(e) => setEx({ ...ex, method: e.target.value })} /></label>
            <label className="block text-sm font-bold">Your quoted price inc GST<span className="block text-xs font-normal text-sub">Exactly as you quoted the owner.</span><Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} /></label>
            <label className="block text-sm font-bold">What does the quote include?<Textarea className="mt-1" rows={3} maxLength={1000} value={ex.includes} onChange={(e) => setEx({ ...ex, includes: e.target.value })} /></label>
            <AttachFiles businessId={businessId} files={files} label="Upload one customer file" onAdd={async (picked) => {
              if (files.length || picked.length !== 1) throw new Error("Upload one file for this customer at a time.");
              const f = picked[0]; if (!f) return;
              const up = await uploadFiles([f]);
              if (draft) { const r = await addFiles({ data: { importId: draft.id, files: up.map((x) => ({ path: x.path, name: x.name, type: x.type ?? "" })) } }); setFiles(r.files); setFileNote("Attached to this job."); return; }
              setFiles(up);
              if (["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 10_000_000) {
                const bytes = new Uint8Array(await f.arrayBuffer()); let raw = ""; for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                const r = await readFile({ data: { businessId, onBehalf: false, name: f.name, mime: f.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", base64: btoa(raw) } });
                if (r.text) { setFileText(r.text); setFileNote("Extra details found. You can check them before saving."); } else setFileNote("Attached. Your typed details are used.");
              } else setFileNote("Attached. Your typed details are used.");
            }} onRemove={async (path) => { if (draft) { const r = await dropFile({ data: { importId: draft.id, path } }); setFiles(r.files); } else { setFiles((o) => o.filter((x) => x.path !== path)); setFileText(""); } setFileNote(null); }} />
            {fileNote && <p className="text-xs text-sub">{fileNote}</p>}
          </div>}
          {ex.quoted === "no" && <div className="space-y-2" data-quoted-no>
            <Button size="field" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => switchMode("onsite")}>I'm at the property — do the Ready Check now</Button>
            <Button size="field" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => switchMode("later")}>Book a Ready Check for later</Button>
            <Button size="field" variant="ghost" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => setNotVisited(true)}>I'll come back after I've visited</Button>
            {notVisited && <p role="status" className="text-sm text-sub">Nothing has been saved. Come back to Add a job after your visit with the area, how it was measured and your quote.</p>}
          </div>}
        </>}
        {mode !== "later" && plan && !(mode === "existing" && ex.quoted !== "yes") && <ElectricianPicker value={plan} onChange={setPlan} note={false} approved={el?.approved ?? []} pending={el?.pending ?? []} onAdd={async (d) => { const r = await addEl({ data: { businessId, name: d.name, mobile: d.mobile, email: d.email, business: d.business } }); await refetch(); setPlan({ mode: "mine", ...(r.businessId ? { business_id: r.businessId } : { nomination_id: r.nominationId }) }); return { message: inviteResultMessage(r) }; }} />}
      </section>}

      {step === "review" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-review>
        <h2 className="font-display text-lg font-bold">Review & save</h2>
        <Summary title="Customer" onEdit={() => setStep("customer")} rows={[[customer.full_name], [[customer.address_line, customer.suburb, customer.postcode].filter(Boolean).join(", ")], [customer.phone], [customer.email], ["Permission to contact given"]]} />
        <Summary title="Job details" onEdit={() => setStep("details")} rows={
          mode === "onsite" ? [["Ready Check at the property now"], [plan?.mode === "mine" ? "Electrician: your electrician" : "Electrician: Home Insulation Victoria arranges"]]
          : mode === "later" ? [[`Ready Check booked for ${later.date ? new Date(later.date).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "—"}`], [later.manual && later.area ? `Ceiling ${later.area} m² (${later.method}) — unverified` : "Measurements added later"]]
          : [[`Quoted ${ex.amount ? `$${ex.amount.replace(/^\$/, "")}` : ""} inc GST`], [`Ceiling ${ex.area} m² · ${ex.method}`], [`Includes: ${ex.includes}`], [ex.siteCheck === "yes" ? `Site check done${siteDate ? ` ${siteDate}` : ""}` : "Site check not done"], [`${files.length} file${files.length === 1 ? "" : "s"} attached`], [plan?.mode === "mine" ? `Electrician: ${([...(el?.approved ?? []), ...(el?.pending ?? [])] as { businessId?: string; nominationId?: string; name: string }[]).find((x) => (plan.business_id && x.businessId === plan.business_id) || (plan.nomination_id && x.nominationId === plan.nomination_id))?.name ?? "your electrician"}` : "Electrician: Home Insulation Victoria arranges"]]
        } />
        {mode === "existing" && draft && reviewItems(draft.extracted).some((i) => !HIDDEN_EXTRA.includes(i.key) && i.value != null) && <details className="rounded-[12px] bg-mist p-3"><summary className="cursor-pointer text-sm font-semibold">Other details found in your file</summary><div className="mt-2 grid gap-2">{reviewItems(draft.extracted).filter((i) => !HIDDEN_EXTRA.includes(i.key) && i.value != null).map((i) => <label key={i.key} className="block text-sm"><span className="text-sub">{i.label}{i.confidence === "uncertain" && <span className="ml-1 text-warning">please check</span>}</span><Input className="h-12" value={extraVals[i.key] ?? ""} onChange={(e) => setExtraVals({ ...extraVals, [i.key]: e.target.value })} /></label>)}</div></details>}
        {mode === "existing" && <div className="space-y-3 pt-1">
          <Tick data="owner-agreed" checked={ticks.ownerAgreed} onChange={(c) => setTicks({ ...ticks, ownerAgreed: c })} label={OWNER_AGREED_TICK} />
          <Tick data="owner-fee-awareness" checked={ticks.feeAwareness} onChange={(c) => setTicks({ ...ticks, feeAwareness: c })} label={OWNER_FEE_AWARENESS_TICK} />
          <Tick data="existing-below-r2" checked={ticks.belowR2} onChange={(c) => setTicks({ ...ticks, belowR2: c })} label="I confirm the existing insulation, if any, is below R2.0." />
          <p className="text-xs text-sub" data-safety-check-note>{SAFETY_CHECK_NOTE}</p>
          <p className="text-xs text-sub">Nothing is sent when you add the job. Next, Home Insulation Victoria checks eligibility, adds the rebate, AP management fee and $349 electrician PIESA fee, then sends the full quote to the owner for approval. We let you know when it is accepted.</p>
        </div>}
        {mode !== "existing" && <p className="text-xs text-sub">Nothing is sent to the owner. Saving the job does not confirm a booking or open the form by itself — you'll see both on the next screen.</p>}
      </section>}

      {shown.length > 0 && <ul ref={problemsRef} tabIndex={-1} role="alert" className="space-y-1 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger outline-none" data-step-problems>{shown.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="status" className="rounded-[12px] border border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}

      <div className="space-y-2">
        {step === "review"
          ? <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={save}>{busy ? BUSY_LABEL : submitLabel(mode)}</Button>
          : !(step === "details" && mode === "existing" && ex.quoted === "no") && <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={forward}>{busy ? BUSY_LABEL : "Continue"}</Button>}
        <div className="grid grid-cols-2 gap-2">
          <Button size="field" variant="outline" disabled={busy} onClick={back}>Back</Button>
          <Button size="field" variant="ghost" disabled={busy} onClick={async () => {
            if (draft) { try { await discard({ data: { importId: draft.id } }); } catch { /* draft stays for the office; nothing confirmed */ } }
            try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
            await navigate({ to: "/partner/import" }); onExit();
          }}>{draft ? "Discard draft" : "Cancel"}</Button>
        </div>
      </div>
    </div>
  );
}

function Tick({ data, checked, onChange, label }: { data: string; checked: boolean; onChange: (c: boolean) => void; label: string }) {
  return <label className="flex items-start gap-3 text-sm" {...{ [`data-${data}`]: "" }}><Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => onChange(c === true)} aria-label={label} /><span>{label}</span></label>;
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return <div className="rounded-[12px] bg-mist p-3" data-summary={title}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-sub">{title}</p><button type="button" onClick={onEdit} className="h-10 rounded-[9px] px-3 text-sm font-bold text-hiv-blue underline" aria-label={`Edit ${title.toLowerCase()}`}>Edit</button></div>
    <ul className="mt-1 space-y-0.5 text-sm">{rows.map((r, i) => r[0] ? <li key={i} className="break-words">{r[0]}</li> : null)}</ul>
  </div>;
}

function LocationButton({ onFound }: { onFound: (a: { address_line: string; suburb: string; postcode: string }) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return <div className="text-right">
    <Button type="button" variant="outline" size="sm" onClick={() => {
      if (!navigator.geolocation) { setMsg("This phone can't share its location — type the address."); return; }
      setMsg("Finding the address…");
      navigator.geolocation.getCurrentPosition(async (p) => {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${p.coords.latitude}&lon=${p.coords.longitude}`);
          const a = addressFromReverse(await r.json());
          if (!a) { setMsg("Couldn't find an address here — type it in."); return; }
          onFound(a); setMsg("Filled in from your location — check it.");
        } catch { setMsg("No signal for the lookup — type it in."); }
      }, () => setMsg("Location is off — type the address."), { enableHighAccuracy: true, timeout: 10000 });
    }}>Use my location</Button>
    {msg && <p className="mt-1 text-xs text-sub">{msg}</p>}
  </div>;
}

function SavedResult({ saved }: { saved: Saved }) {
  const [state, setState] = useState<OnsiteState | undefined>(saved.state);
  const [tries, setTries] = useState(0);
  const status = useServerFn(onsiteFormStatus);
  useEffect(() => {
    if (saved.mode !== "onsite" || !state || (state.kind !== "preparing" && state.kind !== "retry") || tries >= 30) return;
    const t = setTimeout(async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: false } })); } catch { /* keep */ } setTries((n) => n + 1); }, 4000);
    return () => clearTimeout(t);
  }, [state, tries, saved, status]);
  const booking = saved.mode === "existing" ? null : bookingLabel(saved.booking);
  const form = saved.mode === "onsite" && state ? formLabel(state) : null;
  return (
    <section className="mt-4 space-y-3 rounded-[18px] border border-line bg-paper p-5" data-saved data-onsite-state={state?.kind ?? "none"}>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{saved.jobNumber ?? "Job"} saved</p>
      <h2 className="font-display text-xl font-bold">Job saved</h2>
      {booking && <p className="text-sm" data-booking-outcome>{booking}</p>}
      {form && <div className="rounded-[12px] bg-mist p-3" data-form-state={form.label}><p className="text-sm font-bold">{form.label}</p>{form.detail && <p className="text-sm text-sub">{form.detail}</p>}</div>}
      {state?.kind === "open" && <a className="inline-flex h-12 w-full items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" href={state.url}>Open Ready Check form</a>}
      {state?.kind === "retry" && <Button size="field" className="w-full" onClick={async () => { try { setState(await status({ data: { jobId: saved.jobId, retry: true } })); } catch { /* keep */ } setTries(0); }}>Try again</Button>}
      {saved.mode === "existing" && <p className="text-sm text-sub">Home Insulation Victoria checks eligibility, then sends the full quote to the owner.</p>}
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="block text-center text-sm font-bold underline">Go to the job</Link>
    </section>
  );
}
