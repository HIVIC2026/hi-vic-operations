// Installer-supplied customer: ONE short intake (Jo, 8 Oct 2026, approved). Customer -> Job details -> Review & submit.
// Existing portal look; existing guarded handlers (createImport / confirmImport) and shared CustomerFields.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerFields } from "./customer-fields";
import { AttachFiles, ElectricianPicker, inviteResultMessage, useUploadFiles, type AttachedFile } from "./job-intake";
import { addImportFiles, confirmImport, createImport, removeImportFile } from "@/lib/pilot.functions";
import { addBulkElectrician, bulkElectricianChoices, readBulkFile } from "@/lib/bulk-import.functions";
import { getMyIntakeReadyCheck } from "@/lib/installer-quote.functions";
import { READY_CHECK_CONTACT_PERMISSION, electricianPlanBlocker, usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";
import type { Extracted } from "@/lib/pilot.core";
import { ADD_JOB_STEPS, BUSY_LABEL, blankCustomer, customerProblems, nextStep, prevStep, restoreCustomer, saveErrorMessage, type AddJobStep } from "@/lib/add-job-flow.core";
import { COORDINATION_CHOICES, COORDINATION_VERSION, SELF_MANAGED_ACK, VEEC_NOTE, coordinationProblems, type Coordination, EVIDENCE_ACK, EXISTING_INSULATION_CHOICES, INTAKE_RULESET_VERSION, intakeProblems, multiCustomerAmbiguity, parseIntakeAmount, prefillFromExtracted, type ExistingInsulation } from "@/lib/installer-intake.core";

const DRAFT_KEY = "hiv-intake-draft";
type Details = { area: string; amount: string; includes: string; proposedR: string; insulation: ExistingInsulation | null };

export function InstallerIntakeFlow({ businessId }: { businessId: string }) {
  const [step, setStep] = useState<AddJobStep>("customer");
  const [customer, setCustomer] = useState<OnsiteInput>(blankCustomer());
  const [d, setD] = useState<Details>({ area: "", amount: "", includes: "", proposedR: "", insulation: null });
  const [ack, setAck] = useState(false);
  const [coord, setCoord] = useState<Coordination | null>(null);
  const [selfAck, setSelfAck] = useState(false);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [fileText, setFileText] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ jobId: string; jobNumber: string | null; insulation: ExistingInsulation } | null>(null);
  const problemsRef = useRef<HTMLUListElement>(null);
  const inFlight = useRef(false);

  const getEl = useServerFn(bulkElectricianChoices), addEl = useServerFn(addBulkElectrician);
  const { data: el, refetch } = useQuery({ queryKey: ["bulk-electricians", businessId], queryFn: () => getEl({ data: { businessId } }) });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  useEffect(() => { if (plan || !el) return; const u = usualElectrician(el.approved); setPlan(u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "hivic" }); }, [el, plan]);

  // Typed details survive poor signal; consent and the evidence acknowledgment are never restored.
  useEffect(() => { try { const s = localStorage.getItem(DRAFT_KEY); if (s) setCustomer(restoreCustomer(JSON.parse(s))); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...customer, contact_permission: false, consent_by: null })); } catch { /* ignore */ } }, [customer]);
  useEffect(() => { if (shown.length) problemsRef.current?.focus(); }, [shown]);
  useEffect(() => { setShown([]); }, [customer, d, ack, coord, selfAck]);

  const create = useServerFn(createImport), confirm = useServerFn(confirmImport);
  const addFiles = useServerFn(addImportFiles), dropFile = useServerFn(removeImportFile), readFile = useServerFn(readBulkFile);
  const uploadFiles = useUploadFiles(businessId);

  if (saved) return <Received saved={saved} />;

  const problems = (): string[] => {
    if (step === "customer") return customerProblems(customer);
    const p = intakeProblems({ ...d, quoteFileCount: files.length, evidenceAck: ack });
    const eb = electricianPlanBlocker(plan); if (eb) p.push(eb);
    p.push(...coordinationProblems(coord, selfAck));
    if (fileText && multiCustomerAmbiguity(fileText)) p.push("Your file names more than one customer — upload one customer's quote per job");
    return step === "details" ? p.filter((x) => !/evidence must be supplied/.test(x)) : p;
  };

  const ensureDraft = async () => {
    if (draftId) return draftId; // one draft only, even after Back or a retry
    const r = await create({ data: { businessId, sourceSystem: "manual_import", ...(fileText ? { text: fileText } : {}), files: files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" })) } });
    setDraftId(r.id);
    const pre = prefillFromExtracted(r.extracted as Extracted);
    setD((o) => ({ area: o.area || pre.area, amount: o.amount || pre.amount, includes: o.includes || pre.includes, proposedR: o.proposedR || pre.proposedR, insulation: o.insulation }));
    return r.id;
  };

  const forward = async () => {
    const p = problems(); setShown(p); setErr(null);
    if (p.length) return;
    setStep(nextStep(step));
  };
  const back = () => { setShown([]); setErr(null); const p = prevStep(step); if (p) setStep(p); };

  const submit = async () => {
    if (busy || inFlight.current) return; // double tap
    const p = problems(); setShown(p); setErr(null);
    if (p.length) return;
    inFlight.current = true; setBusy(true);
    try {
      const id = await ensureDraft();
      const amount = parseIntakeAmount(d.amount);
      const r = Number(d.proposedR.replace(/[Rr\s]/g, ""));
      const facts: Record<string, string | number | boolean | null> = {
        full_name: customer.full_name.trim(), email: customer.email.trim(), phone: customer.phone.trim(), address_line: customer.address_line.trim(), suburb: customer.suburb.trim(), postcode: customer.postcode.trim(),
        measured_area_m2: Number(d.area), measurement_method: "Installer supplied (unverified)", r_value: d.proposedR.trim() && Number.isFinite(r) ? r : null,
      };
      const hasAmount = amount != null && !Number.isNaN(amount) && amount > 0;
      const res = await confirm({ data: { importId: id, facts, installer: {
        quoted: hasAmount ? "yes" : "no", site_check: "yes", site_check_date: null, quoted_price_inc_gst: hasAmount ? amount : null, price_includes: d.includes.trim() || null,
        contact_permission: customer.contact_permission, owner_agreed: false,
        intake: { existing_insulation: d.insulation!, evidence_ack: ack, proposed_r_value: d.proposedR.trim() && Number.isFinite(r) ? r : null, version: `${INTAKE_RULESET_VERSION}+${COORDINATION_VERSION}`, coordination: coord!, self_managed_ack: coord === "self_managed" && selfAck },
      }, electrician: plan?.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" } } as never });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setSaved({ jobId: res.jobId, jobNumber: res.jobNumber ?? null, insulation: d.insulation! });
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  const idx = ADD_JOB_STEPS.findIndex((s) => s.key === step);
  const elName = plan?.mode === "mine" ? (([...(el?.approved ?? []), ...(el?.pending ?? [])] as { businessId?: string; nominationId?: string; name: string }[]).find((x) => (plan.business_id && x.businessId === plan.business_id) || (plan.nomination_id && x.nominationId === plan.nomination_id))?.name ?? "your electrician") : "Home Insulation Victoria arranges";

  return (
    <div className="mt-3 space-y-4 pb-24" data-installer-intake data-step={step}>
      <ol className="grid grid-cols-3 gap-1" aria-label="Progress">
        {ADD_JOB_STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === idx ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
            <span className={`mt-1 block truncate text-xs ${i === idx ? "font-bold text-ink" : "text-sub"}`}>{s.key === "review" ? "Review & submit" : s.label}</span>
          </li>
        ))}
      </ol>

      {step === "customer" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-customer>
        <h2 className="font-display text-lg font-bold">Customer</h2>
        <CustomerFields value={customer} consentLabel={READY_CHECK_CONTACT_PERMISSION} onChange={(n) => { setCustomer(n); setErr(null); }} />
      </section>}

      {step === "details" && <section className="space-y-4 rounded-[18px] border border-line bg-paper p-4" data-step-details>
        <h2 className="font-display text-lg font-bold">Job details</h2>
        <label className="block text-sm font-bold">Ceiling area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={d.area} onChange={(e) => setD({ ...d, area: e.target.value })} /></label>
        <fieldset data-existing-insulation><legend className="text-sm font-bold">Existing insulation</legend>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Existing insulation">
            {EXISTING_INSULATION_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={d.insulation === c.value} variant={d.insulation === c.value ? "default" : "outline"} className="px-1 text-xs leading-tight" onClick={() => setD({ ...d, insulation: c.value })}>{c.label}</Button>)}
          </div>
          {d.insulation === "unknown" && <p className="mt-1 text-xs text-sub">You can submit. The owner quote waits until the existing insulation is confirmed as none or below R2.0.</p>}
        </fieldset>
        <AttachFiles businessId={businessId} files={files} label="Upload your quote" onAdd={async (picked) => {
          const up = await uploadFiles(picked);
          if (draftId) { const r = await addFiles({ data: { importId: draftId, files: up.map((x) => ({ path: x.path, name: x.name, type: x.type ?? "" })) } }); setFiles(r.files); setFileNote("Attached to this job."); return; }
          setFiles((o) => [...o, ...up]);
          const f = picked[0];
          if (f && picked.length === 1 && ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 10_000_000) {
            const bytes = new Uint8Array(await f.arrayBuffer()); let raw = ""; for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            const r = await readFile({ data: { businessId, onBehalf: false, name: f.name, mime: f.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", base64: btoa(raw) } });
            if (r.text) {
              setFileText(r.text);
              if (multiCustomerAmbiguity(r.text)) { setFileNote("This file names more than one customer. Upload one customer's quote per job."); return; }
              // Preview what was found; the draft (created on submit) keeps the original file and text.
              const { extractFromText } = await import("@/lib/pilot.core");
              const pre = prefillFromExtracted(extractFromText(r.text));
              setD((o) => ({ ...o, area: o.area || pre.area, amount: o.amount || pre.amount, includes: o.includes || pre.includes, proposedR: o.proposedR || pre.proposedR }));
              setFileNote(pre.area || pre.amount || pre.includes ? "Details found in your quote are filled in below — check them." : "Attached. Nothing could be read clearly — fill in the boxes below.");
            } else setFileNote("Attached. Nothing could be read clearly — fill in the boxes below.");
          } else setFileNote("Attached.");
        }} onRemove={async (path) => { if (draftId) { const r = await dropFile({ data: { importId: draftId, path } }); setFiles(r.files); } else setFiles((o) => o.filter((x) => x.path !== path)); setFileNote(null); }} />
        {fileNote && <p className="text-xs text-sub" data-file-note>{fileNote}</p>}
        <p className="text-xs text-sub">No quote file? Enter the amount and what it includes.</p>
        <label className="block text-sm font-bold">Your quote inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></label>
        <label className="block text-sm font-bold">What the quote includes<Textarea className="mt-1" rows={3} maxLength={1000} value={d.includes} onChange={(e) => setD({ ...d, includes: e.target.value })} /></label>
        <label className="block text-sm font-bold">Proposed product R-rating<span className="block text-xs font-normal text-sub">Optional, e.g. R5.0</span><Input className="mt-1 h-12" inputMode="decimal" value={d.proposedR} onChange={(e) => setD({ ...d, proposedR: e.target.value })} /></label>
        <fieldset data-coordination><legend className="text-sm font-bold">Who will organise this job?</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Who will organise this job?">
            {COORDINATION_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={coord === c.value} onClick={() => { setCoord(c.value); if (c.value !== "self_managed") setSelfAck(false); }} className={`w-full rounded-[14px] border p-3 text-left ${coord === c.value ? "border-primary bg-primary/5" : "border-line bg-paper"}`}>
              <span className="flex flex-wrap items-center gap-2 text-sm font-bold">{c.title}{c.badge && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{c.badge}</span>}</span>
              <span className="mt-1 block text-xs text-sub">{c.body}</span>
            </button>)}
          </div>
          {coord === "self_managed" && <label className="mt-2 flex items-start gap-3 text-sm" data-self-managed-ack><Checkbox className="mt-0.5" checked={selfAck} onCheckedChange={(c) => setSelfAck(c === true)} aria-label={SELF_MANAGED_ACK} /><span>{SELF_MANAGED_ACK}</span></label>}
          <p className="mt-2 text-xs text-sub">{VEEC_NOTE}</p>
        </fieldset>
        {plan && <ElectricianPicker value={plan} onChange={setPlan} note={false} approved={el?.approved ?? []} pending={el?.pending ?? []} onAdd={async (x) => { const r = await addEl({ data: { businessId, name: x.name, mobile: x.mobile, email: x.email, business: x.business } }); await refetch(); setPlan({ mode: "mine", ...(r.businessId ? { business_id: r.businessId } : { nomination_id: r.nominationId }) }); return { message: inviteResultMessage(r) }; }} />}
      </section>}

      {step === "review" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-review>
        <h2 className="font-display text-lg font-bold">Review & submit</h2>
        <Summary title="Customer" onEdit={() => setStep("customer")} rows={[customer.full_name, [customer.address_line, customer.suburb, customer.postcode].filter(Boolean).join(", "), customer.phone, customer.email, "Permission to contact given"]} />
        <Summary title="Job details" onEdit={() => setStep("details")} rows={[
          `Ceiling ${d.area} m²`, `Existing insulation: ${EXISTING_INSULATION_CHOICES.find((c) => c.value === d.insulation)?.label ?? "—"}`,
          d.amount ? `Quote $${d.amount.replace(/^\$/, "")} inc GST` : "Quote amount from your uploaded file", d.includes ? `Includes: ${d.includes}` : "", d.proposedR ? `Proposed product ${/^r/i.test(d.proposedR) ? d.proposedR : `R${d.proposedR}`}` : "",
          `${files.length} file${files.length === 1 ? "" : "s"} attached`, `Electrician: ${elName}`, `Organised by: ${coord === "self_managed" ? "you" : "Home Insulation Victoria"}`,
        ]} />
        <label className="flex items-start gap-3 text-sm" data-evidence-ack><Checkbox className="mt-0.5" checked={ack} onCheckedChange={(c) => setAck(c === true)} aria-label={EVIDENCE_ACK} /><span>{EVIDENCE_ACK}</span></label>
        <div className="rounded-[12px] border border-line p-3" data-next-step><p className="text-xs font-bold uppercase tracking-wide text-sub">What happens next</p><p className="mt-1 text-sm">Nothing is sent when you submit. Home Insulation Victoria checks the owner's eligibility and prepares the quote when it's ready, then lets you know when the owner accepts.</p></div>
      </section>}

      {shown.length > 0 && <ul ref={problemsRef} tabIndex={-1} role="alert" className="space-y-1 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger outline-none" data-step-problems>{shown.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="status" className="rounded-[12px] border border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}

      <div className="space-y-2">
        {step === "review"
          ? <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={submit}>{busy ? BUSY_LABEL : "Submit job"}</Button>
          : <Button size="field" className="w-full" disabled={busy} onClick={forward}>Next</Button>}
        {step !== "customer" && <Button size="field" variant="outline" className="w-full" disabled={busy} onClick={back}>Back</Button>}
      </div>
    </div>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[]; onEdit: () => void }) {
  return <div className="rounded-[12px] bg-mist p-3" data-summary={title}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-sub">{title}</p><button type="button" onClick={onEdit} className="h-10 rounded-[9px] px-3 text-sm font-bold text-hiv-blue underline" aria-label={`Edit ${title.toLowerCase()}`}>Edit</button></div>
    <ul className="mt-1 space-y-0.5 text-sm">{rows.filter(Boolean).map((r, i) => <li key={i} className="break-words">{r}</li>)}</ul>
  </div>;
}

function Received({ saved }: { saved: { jobId: string; jobNumber: string | null; insulation: ExistingInsulation } }) {
  const get = useServerFn(getMyIntakeReadyCheck);
  const { data } = useQuery({ queryKey: ["intake-rc", saved.jobId], queryFn: () => get({ data: { jobId: saved.jobId } }), retry: false });
  return (
    <section className="mt-4 space-y-3 rounded-[18px] border border-line bg-paper p-5" data-saved data-intake-received>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{saved.jobNumber ?? "Job"} received</p>
      <h2 className="font-display text-xl font-bold">Job received</h2>
      <p className="text-sm">Home Insulation Victoria will check the owner's eligibility and prepare the quote when it's ready. Nobody has been contacted yet.</p>
      {saved.insulation === "unknown" && <p className="text-sm font-semibold">The owner quote waits until the existing insulation is confirmed as none or below R2.0.</p>}
      {data?.coordination && <p className="text-sm" data-coordination-saved>Organised by: {data.coordination === "self_managed" ? "you" : "Home Insulation Victoria"}</p>}
      {data && <p className="text-sm" data-rc-outstanding>Ready Check: {data.readyCheck.outstandingCount} item{data.readyCheck.outstandingCount === 1 ? "" : "s"} outstanding</p>}
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line font-bold">Complete Ready Check</Link>
      <Link to="/field" className="block text-center text-sm font-bold underline">Back to My work</Link>
    </section>
  );
}
