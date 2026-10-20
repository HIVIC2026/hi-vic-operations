// Installer-supplied customer: ONE short intake. Agreed order (Jo, 9 Oct 2026 01:17 Sydney):
// Customer -> How would you like to organise this job? -> Have you measured and quoted? (+ electrician, fees) -> Review.
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
import { addImportFiles, confirmImport, createImport, getImportDraft, removeImportFile } from "@/lib/pilot.functions";
import { supabase } from "@/integrations/supabase/client";
import { addBulkElectrician, bulkElectricianChoices, readBulkFile } from "@/lib/bulk-import.functions";
import { getMyIntakeReadyCheck } from "@/lib/installer-quote.functions";
import { electricianPlanBlocker, usualElectrician, type ElectricianPlan } from "@/lib/job-electrician.core";
import type { OnsiteInput } from "@/lib/onsite-ready-check.core";
import type { IntakeApi } from "./intake-preview-adapter";
import { BUSY_LABEL, blankCustomer, customerProblems, restoreCustomer, saveErrorMessage } from "@/lib/add-job-flow.core";
import { ELECTRICIAN_PAYER_CHOICES, FEE_AWARENESS_VERSION, INSTALLER_CONTACT_PERMISSION, ATTENDED_CHOICES, ATTENDED_QUESTION, PRELIMINARY_QUOTE_NOTE, QUOTE_PREPARED_CHOICES, QUOTE_PREPARED_QUESTION, intakeBranches, melbourneToday, quoteFileCount, visitDateProblem, type AttendanceAnswer, NOT_MEASURED_NOTE, ORGANISE_QUESTION, feeAwarenessText, intakeNextAction, type ElectricianPayer } from "@/lib/installer-intake.core";

import { ProposedRField, QuoteCommercialFields, RemovalQuoteFields } from "./intake-quote-fields";
import { blankCommercialInput, commercialInputProblems, commercialPayload, removalFactSummary, type CommercialInput } from "@/lib/installer-quote-commercial.core";
import { blankRemoval, removalPayload, removalProblems, type RemovalInput } from "@/lib/intake-quote-details.core";

type AddJobStep = "customer" | "organise" | "job" | "review";
const ADD_JOB_STEPS: { key: AddJobStep; label: string }[] = [
  { key: "customer", label: "Customer" }, { key: "organise", label: "Who organises?" }, { key: "job", label: "Job details" }, { key: "review", label: "Review & submit" },
];
const ORDER = ADD_JOB_STEPS.map((s) => s.key);
const nextStep = (s: AddJobStep): AddJobStep => ORDER[Math.min(ORDER.indexOf(s) + 1, ORDER.length - 1)] ?? s;
const prevStep = (s: AddJobStep): AddJobStep | null => (ORDER.indexOf(s) > 0 ? ORDER[ORDER.indexOf(s) - 1] ?? null : null);
import { COORDINATION_CHOICES, COORDINATION_VERSION, SELF_MANAGED_ACK, VEEC_NOTE, coordinationProblems, type Coordination, EVIDENCE_ACK, EXISTING_INSULATION_CHOICES, INTAKE_RULESET_VERSION, intakeProblems, multiCustomerAmbiguity, prefillFromExtracted, intakeConfirmFacts, type ExistingInsulation, QUOTE_STATUS_CHOICES, JOB_DETAILS_LEAD, intakeArea, intakeQuotePayload, type QuoteStatus, applicableIntakeDetails } from "@/lib/installer-intake.core";

// Resume after refresh: scoped to the signed-in USER and business (never shared between people or businesses).
// The server owns the draft id's files; consent and both acknowledgements are never stored or restored.
const resumeKey = (userId: string, businessId: string) => `hiv-intake:${userId}:${businessId}`;
const LEGACY_KEYS = (businessId: string) => ["hiv-intake-draft", `hiv-intake-draft:${businessId}`, `hiv-intake-draft-id:${businessId}`];
type Details = { area: string; amount: string; includes: string; proposedR: string; insulation: ExistingInsulation | null; quoteStatus?: QuoteStatus | null; attended?: AttendanceAnswer | null; attendedOn?: string; removal?: RemovalInput; commercial?: CommercialInput };

/** `preview` swaps every server/storage call for a local adapter (no auth, saving or sending). */
export function InstallerIntakeFlow({ businessId, preview }: { businessId: string; preview?: IntakeApi }) {
  const [step, setStep] = useState<AddJobStep>("customer");
  const [customer, setCustomer] = useState<OnsiteInput>(() => ({ ...blankCustomer(), ...(preview?.sampleCustomer ?? {}), contact_permission: false, consent_by: null }));
  const [d, setD] = useState<Details>({ area: "", amount: "", includes: "", proposedR: "", insulation: null, removal: blankRemoval() });
  const [ack, setAck] = useState(false);
  const [coord, setCoord] = useState<Coordination | null>(null);
  const [selfAck, setSelfAck] = useState(false);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [fileTexts, setFileTexts] = useState<Record<string, string>>({});
  const fileText = Object.values(fileTexts).join("\n");
  const [derived, setDerived] = useState<Record<string, { path: string; value: string }>>({});
  const typed = useRef(new Set<string>());
  const stored = useRef(new WeakMap<File, AttachedFile>());
  const [fileBusy, setFileBusy] = useState(false);
  const fileFlight = useRef(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const filesRef = useRef<AttachedFile[]>([]);
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const problemsRef = useRef<HTMLUListElement>(null);
  const inFlight = useRef(false);
  const draftFlight = useRef<Promise<string> | null>(null); // must stay above the early returns (hook order)
  // Both file controls share one synchronous lock; a rejected overlap must not release its owner's lock.
  const changeFiles = async (action: () => Promise<void>) => {
    if (fileFlight.current || inFlight.current) throw new Error("A file change or save is still running. Wait for it to finish, then try again.");
    fileFlight.current = true; setFileBusy(true);
    try { await action(); }
    finally { fileFlight.current = false; setFileBusy(false); }
  };

  const realGetEl = useServerFn(bulkElectricianChoices), realAddEl = useServerFn(addBulkElectrician);
  const getEl = (preview?.getEl ?? realGetEl) as typeof realGetEl, addEl = (preview?.addEl ?? realAddEl) as typeof realAddEl;
  const { data: el, refetch } = useQuery({ queryKey: ["bulk-electricians", businessId, !!preview], queryFn: () => getEl({ data: { businessId } }) });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  const [payer, setPayer] = useState<ElectricianPayer | null>(null);
  const [feeAck, setFeeAck] = useState(false);
  const elLater = payer === "undecided";
  // Own electrician: the usual approved REC is prefilled (never auto-chooses "own" for them).
  useEffect(() => { if (payer !== "own" || (plan?.mode === "mine")) return; const u = usualElectrician(el?.approved ?? []); setPlan(u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "mine" }); }, [payer, el]); // eslint-disable-line react-hooks/exhaustive-deps
  const feeText = feeAwarenessText(payer);

  // Typed details survive refresh/poor signal; consent and the acknowledgements are never restored.
  const [userId, setUserId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const realLoadDraft = useServerFn(getImportDraft);
  const loadDraft = (preview?.loadDraft ?? realLoadDraft) as typeof realLoadDraft;
  useEffect(() => { if (preview) { setHydrated(true); return; } let live = true; supabase.auth.getUser().then(({ data }) => { if (live) setUserId(data.user?.id ?? null); if (live && !data.user) setHydrated(true); }).catch(() => { if (live) setRestoreError(true); }); return () => { live = false; }; }, [restoreAttempt]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      try {
        for (const k of LEGACY_KEYS(businessId)) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
        const raw = localStorage.getItem(resumeKey(userId, businessId));
        if (raw) {
          const r = JSON.parse(raw) as { customer?: unknown; d?: Details; coord?: Coordination | null; draftId?: string | null; step?: AddJobStep; fileTexts?: Record<string, string>; derived?: Record<string, { path: string; value: string }>; typed?: string[]; payer?: ElectricianPayer | null; plan?: ElectricianPlan | null };
          if (r.customer) setCustomer(restoreCustomer(r.customer as never));
          if (r.d) setD({ area: r.d.area ?? "", amount: r.d.amount ?? "", includes: r.d.includes ?? "", proposedR: r.d.proposedR ?? "", insulation: r.d.insulation ?? null, quoteStatus: r.d.quoteStatus ?? null, attended: r.d.attended ?? null, attendedOn: r.d.attendedOn ?? "", ...(r.d.removal ? { removal: r.d.removal } : {}), ...(r.d.commercial ? { commercial: r.d.commercial } : {}) });
          if (r.coord) setCoord(r.coord);
          if (r.payer) setPayer(r.payer);
          if (r.plan) setPlan(r.plan);
          typed.current = new Set(r.typed ?? Object.keys(r.d ?? {}));
          if (r.step && r.step !== "review" && ORDER.includes(r.step)) setStep(r.step);
          if (r.draftId) {
            const srv = await loadDraft({ data: { importId: r.draftId, businessId } });
            if (!live) return;
            if (srv.status === "confirmed" && srv.jobId) { localStorage.removeItem(resumeKey(userId, businessId)); setSaved({ jobId: srv.jobId, jobNumber: srv.jobNumber, ...(srv.receipt ?? { insulation: "unknown" as const, quoted: null, next: intakeNextAction(null, false), feeHeld: true }) }); }
            else if (srv.status === "draft") { draftRef.current = r.draftId; filesRef.current = srv.files; setDraftId(r.draftId); setFiles(srv.files); setFileTexts(Object.fromEntries(Object.entries(r.fileTexts ?? {}).filter(([path]) => srv.files.some((f) => f.path === path)))); setDerived(r.derived ?? {}); if (srv.files.length) setFileNote("Your attached files were kept."); }
          }
        }
      } catch { if (live) setRestoreError(true); return; }
      if (live) setHydrated(true);
    })();
    return () => { live = false; };
  }, [userId, businessId, restoreAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!userId || !hydrated) return;
    try { localStorage.setItem(resumeKey(userId, businessId), JSON.stringify({ customer: { ...customer, contact_permission: false, consent_by: null }, d, coord, payer, plan, draftId, step, fileTexts, derived, typed: [...typed.current] })); } catch { /* ignore */ }
  }, [customer, d, coord, payer, plan, draftId, step, fileTexts, derived, userId, hydrated, businessId]);
  useEffect(() => { if (shown.length) problemsRef.current?.focus(); }, [shown]);
  useEffect(() => { setShown([]); }, [customer, d, ack, coord, selfAck, payer, plan]);
  useEffect(() => { setFeeAck(false); }, [payer]); // a declaration is for ONE electrician arrangement

  const rCreate = useServerFn(createImport), rConfirm = useServerFn(confirmImport);
  const rAddFiles = useServerFn(addImportFiles), rDropFile = useServerFn(removeImportFile), rReadFile = useServerFn(readBulkFile);
  const rUploadFiles = useUploadFiles(businessId);
  const create = (preview?.create ?? rCreate) as typeof rCreate, confirm = (preview?.confirm ?? rConfirm) as typeof rConfirm;
  const addFiles = (preview?.addFiles ?? rAddFiles) as typeof rAddFiles, dropFile = (preview?.dropFile ?? rDropFile) as typeof rDropFile;
  const readFile = (preview?.readFile ?? rReadFile) as typeof rReadFile, uploadFiles = preview?.uploadFiles ?? rUploadFiles;

  if (saved) return <Received saved={saved} preview={!!preview} />;
  if (!hydrated) return <div role="status" className="mt-3 space-y-2"><p>{restoreError ? "Your saved details could not load. Try again before continuing." : "Loading your saved details…"}</p>{restoreError && <Button onClick={() => { setRestoreError(false); setRestoreAttempt((n) => n + 1); }}>Retry</Button>}</div>;

  const branches = intakeBranches(d.attended, d.quoteStatus);
  const live = applicableIntakeDetails(d); // hidden Yes-branch facts never validate or save when No is chosen
  const problems = (): string[] => {
    const c = customerProblems(customer);
    if (step === "customer") return c;
    const org = coordinationProblems(coord, selfAck);
    if (step === "organise") return org;
    const p = intakeProblems({ ...live, quoteStatus: d.quoteStatus ?? null, quoteFileCount: quoteFileCount(files), evidenceAck: ack, requireMeasured: true, attended: d.attended ?? null }).map((x) => x === "Choose the quote status" ? "Choose whether you have prepared a quote" : x);
    if (!d.attended) p.unshift("Choose whether you have attended and assessed this property");
    { const dp = d.attended === "attended" ? visitDateProblem(d.attendedOn ?? null, melbourneToday()) : null; if (dp) p.unshift(dp); }
    if (d.quoteStatus === "have_quote") p.push(...commercialInputProblems(commercialPayload(d.commercial ?? blankCommercialInput(), live.includes || null, d.removal?.answer === "yes"), removalPayload(d.removal ?? blankRemoval(), true)));
    p.push(...removalProblems(removalPayload(d.removal ?? blankRemoval(), d.quoteStatus === "have_quote", d.attended === "attended"), d.insulation, intakeArea(live.area), intakeQuotePayload({ ...live, quoteStatus: d.quoteStatus ?? null }).quoted_price_inc_gst, false, false)); // drafts may omit removal m²; quote readiness re-checks
    if (!payer) p.push("Choose who arranges the electrician");
    else if (payer === "own") { const eb = electricianPlanBlocker(plan); if (eb) p.push(eb); }
    if (fileText && d.quoteStatus === "have_quote" && multiCustomerAmbiguity(fileText)) p.push("Your file names more than one customer — upload one customer's quote per job");
    if (step === "job") return p.filter((x) => !/evidence must be supplied/.test(x));
    return [...c, ...org, ...p];
  };

  // Single-flight: concurrent callers share one create, so two controls can never make competing drafts.
  const ensureDraft = (extra: AttachedFile[] = [], text = fileText): Promise<string> => {
    if (draftRef.current) return Promise.resolve(draftRef.current); // one draft only, even after Back, a refresh or a retry
    if (!draftFlight.current) draftFlight.current = createDraft(extra, text).finally(() => { draftFlight.current = null; });
    return draftFlight.current;
  };
  const createDraft = async (extra: AttachedFile[], text: string) => {
    const r = await create({ data: { businessId, sourceSystem: "manual_import", ...(text ? { text } : {}), files: [...filesRef.current, ...extra].filter((f, i, all) => all.findIndex((x) => x.path === f.path) === i).map((f) => ({ path: f.path, name: f.name, type: f.type ?? "", ...(f.purpose ? { purpose: f.purpose } : {}) })) } });
    draftRef.current = r.id; setDraftId(r.id);
    if (userId) try { const k = resumeKey(userId, businessId); const cur = JSON.parse(localStorage.getItem(k) ?? "{}"); localStorage.setItem(k, JSON.stringify({ ...cur, draftId: r.id })); } catch { /* ignore */ }

    return r.id;
  };

  const forward = async () => {
    if (!hydrated || busy || fileFlight.current) return;
    const p = problems(); setShown(p); setErr(null);
    if (p.length) return;
    setStep(nextStep(step));
  };
  const back = () => { if (busy || fileFlight.current) return; setShown([]); setErr(null); const p = prevStep(step); if (p) setStep(p); };

  const submit = async () => {
    if (!hydrated || busy || fileFlight.current || inFlight.current) return; // double tap
    const p = problems(); setShown(p); setErr(null);
    if (p.length || !d.quoteStatus || !d.attended || !coord || !payer) return;
    inFlight.current = true; setBusy(true);
    try {
      const id = await ensureDraft();
      if (files.length) await addFiles({ data: { importId: id, files: files.map((f) => ({ ...f, type: f.type ?? "" })) } });
      const q = intakeQuotePayload({ quoteStatus: d.quoteStatus ?? null, amount: live.amount, includes: live.includes, proposedR: live.proposedR });
      const facts = intakeConfirmFacts(customer, intakeArea(live.area), q.proposed_r_value); // r_value = PROPOSED product R; no area -> null, never 0
      const res = await confirm({ data: { importId: id, facts, installer: {
        quoted: q.quoted, site_check: "no", site_check_date: null, // visit not asked here; server records it as unknown
        quoted_price_inc_gst: q.quoted_price_inc_gst,
        price_includes: q.price_includes,
        contact_permission: customer.contact_permission, owner_agreed: false,
        intake: { existing_insulation: d.insulation ?? "unknown", evidence_ack: ack, proposed_r_value: q.proposed_r_value, quote_status: d.quoteStatus, attended: d.attended, attended_on: d.attended === "attended" && d.attendedOn ? d.attendedOn : null, version: `${INTAKE_RULESET_VERSION}+${COORDINATION_VERSION}`, coordination: coord, self_managed_ack: coord === "self_managed" && selfAck,
          measured_required: true, electrician_payer: payer, ...(d.removal ? { removal_quote: removalPayload(d.removal, d.quoteStatus === "have_quote", d.attended === "attended") } : {}),
          ...(d.quoteStatus === "have_quote" ? { commercial: commercialPayload(d.commercial ?? blankCommercialInput(), live.includes || null, d.removal?.answer === "yes") } : {}),
          ...(d.quoteStatus === "have_quote" && feeAck && feeText ? { fee_awareness: { declared: true, payer: payer, text: feeText, version: FEE_AWARENESS_VERSION } } : {}) },
      }, electrician: payer === "undecided" ? { mode: "later" } : payer === "own" && plan?.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" } } as never });
      try { if (userId) localStorage.removeItem(resumeKey(userId, businessId)); } catch { /* ignore */ }
      setSaved({ jobId: res.jobId, jobNumber: res.jobNumber ?? null, insulation: d.insulation ?? "unknown", quoted: d.quoteStatus === "have_quote", attended: d.attended ?? null, next: intakeNextAction(coord, d.quoteStatus === "have_quote", d.attended ?? null), feeHeld: d.quoteStatus === "have_quote" && !(feeAck && feeText) });
    } catch (e) { setErr(saveErrorMessage(e instanceof Error ? e.message : null)); }
    finally { setBusy(false); inFlight.current = false; }
  };

  const addPicked = async (picked: File[], purpose: "quote" | "supporting") => {
          const failures: string[] = [];
          for (const f of picked) {
            let ref = stored.current.get(f);
            try {
              if (!ref) { const up = await uploadFiles([f]); ref = up[0]; if (!ref) throw new Error("No stored file returned"); stored.current.set(f, ref); }
            } catch { failures.push(`${f.name} did not upload. Choose only this file to retry.`); continue; }
            const attached: AttachedFile = { ...ref, purpose };
            filesRef.current = filesRef.current.some((x) => x.path === attached.path) ? filesRef.current : [...filesRef.current, attached];
            setFiles(filesRef.current);
            try {
              if (draftRef.current) { const r = await addFiles({ data: { importId: draftRef.current, files: [{ ...attached, type: attached.type ?? "" }] } }); const pending = filesRef.current.filter((x) => !r.files.some((y) => y.path === x.path) && x.path !== attached.path); filesRef.current = [...(r.files as AttachedFile[]), ...pending]; setFiles(filesRef.current); }
              else await ensureDraft([attached], "");
            } catch { const m = `${f.name} uploaded and is kept here, but its job attachment could not be confirmed. Submit will retry attaching it without uploading again.`; failures.push(m); setFileNote(m); continue; }
            if (purpose !== "quote") { setFileNote("Supporting file attached — it is reviewed before it is accepted."); continue; }
            setFileNote("File uploaded. Checking optional quote details…");
            try {
              if (["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 10_000_000) {
                const bytes = new Uint8Array(await f.arrayBuffer()); let raw = ""; for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                const r = await readFile({ data: { businessId, onBehalf: false, name: f.name, mime: f.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", base64: btoa(raw) } });
                setFileTexts((old) => ({ ...old, [attached.path]: r.text ?? "" }));
                if (r.text && !multiCustomerAmbiguity(r.text)) {
                  const { extractFromText } = await import("@/lib/pilot.core");
                  const pre = prefillFromExtracted(extractFromText(r.text), r.text);
                  setD((old) => { const next = { ...old }; for (const key of ["area", "amount", "includes", "proposedR"] as const) if (!old[key] && pre[key] && !typed.current.has(key)) { next[key] = pre[key]; setDerived((o) => ({ ...o, [key]: { path: attached.path, value: pre[key] } })); } return next; });
                  setFileNote("File attached. Any details found are provisional — check them below.");
                } else setFileNote(r.text ? "This file names more than one customer. Remove it and attach one customer's quote." : "File attached. No details could be read clearly; you can enter them or leave the price for office review.");
              } else setFileNote("File attached.");
            } catch { setFileNote("File uploaded and kept. The optional quote read failed; you can enter details or leave the price for office review. Do not upload it again."); }
          }
          if (failures.length) throw new Error(failures.join(" "));
  };
  const removeAttached = async (path: string) => {
          if (draftRef.current) { const r = await dropFile({ data: { importId: draftRef.current, path } }); filesRef.current = r.files; } else filesRef.current = filesRef.current.filter((x) => x.path !== path);
          setFiles(filesRef.current);
          setFileTexts((old) => Object.fromEntries(Object.entries(old).filter(([key]) => key !== path)));
          setD((old) => { const next = { ...old }; for (const key of ["area", "amount", "includes", "proposedR"] as const) if (derived[key]?.path === path && !typed.current.has(key) && next[key] === derived[key]?.value) next[key] = ""; return next; });
          setDerived((old) => Object.fromEntries(Object.entries(old).filter(([, value]) => value.path !== path))); setFileNote("File removed. Details you entered were kept.");
          };

  const idx = ADD_JOB_STEPS.findIndex((s) => s.key === step);
  const elName = elLater ? "To be arranged" : plan?.mode === "mine" ? (([...(el?.approved ?? []), ...(el?.pending ?? [])] as { businessId?: string; nominationId?: string; name: string }[]).find((x) => (plan.business_id && x.businessId === plan.business_id) || (plan.nomination_id && x.nominationId === plan.nomination_id))?.name ?? "your electrician") : "Home Insulation Victoria arranges";

  return (
    <div className="mt-3 space-y-4 pb-24" data-installer-intake data-step={step}>
      <ol className="grid grid-cols-4 gap-1" aria-label="Progress">
        {ADD_JOB_STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === idx ? "step" : undefined} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-line"}`} />
            <span className={`mt-1 hidden truncate text-xs sm:block ${i === idx ? "font-bold text-ink" : "text-sub"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="-mt-2 text-xs font-bold text-ink sm:hidden" data-step-label>Step {idx + 1} of {ADD_JOB_STEPS.length} · {ADD_JOB_STEPS[idx]?.label}</p>

      {step === "customer" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-customer>
        <h2 className="font-display text-lg font-bold">Customer</h2>
        <p className="text-sm text-sub" data-customer-lead>Who the job is for and where it is.</p>
        <CustomerFields offline={!!preview} value={customer} consentLabel={INSTALLER_CONTACT_PERMISSION} onChange={(n) => { setCustomer(n); setErr(null); }} />
      </section>}

      {step === "organise" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-organise>
        <fieldset data-coordination><legend className="font-display text-lg font-bold">{ORGANISE_QUESTION}</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label={ORGANISE_QUESTION}>
            {COORDINATION_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={coord === c.value} onClick={() => { setCoord(c.value); if (c.value !== "self_managed") setSelfAck(false); }} className={`w-full rounded-[14px] border p-3 text-left ${coord === c.value ? "border-primary bg-primary/5" : "border-line bg-paper"}`}>
              <span className="flex flex-wrap items-center gap-2 text-sm font-bold">{c.title}{c.badge && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{c.badge}</span>}</span>
              <span className="mt-1 block text-xs text-sub">{c.body}</span>
            </button>)}
          </div>
          {coord === "self_managed" && <label className="mt-2 flex items-start gap-3 text-sm" data-self-managed-ack><Checkbox className="mt-0.5" checked={selfAck} onCheckedChange={(c) => setSelfAck(c === true)} aria-label={SELF_MANAGED_ACK} /><span>{SELF_MANAGED_ACK}</span></label>}
          <p className="mt-2 text-xs text-sub">{VEEC_NOTE}</p>
        </fieldset>
      </section>}

      {step === "job" && <section className="space-y-4 rounded-[18px] border border-line bg-paper p-4" data-step-job>
        <p className="text-sm text-sub" data-job-lead>{JOB_DETAILS_LEAD}</p>
        <fieldset data-attended><legend className="font-display text-lg font-bold">{ATTENDED_QUESTION}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={ATTENDED_QUESTION}>
            {ATTENDED_CHOICES.map((c) => <Button key={c.value} disabled={busy || fileBusy} size="field" role="radio" aria-checked={d.attended === c.value} variant={d.attended === c.value ? "default" : "outline"} onClick={() => setD({ ...d, attended: c.value })}>{c.label}</Button>)}
          </div>
          {d.attended === "not_attended" && <p className="mt-2 text-sm text-sub" data-not-attended-note>That’s fine — we’ll save the job and a Ready Check will be needed.</p>}
          {d.attended === "attended" && <label className="mt-2 block text-sm font-bold">Date of the visit<span className="block text-xs font-normal text-sub">Optional — leave blank if unsure</span><Input type="date" className="mt-1 h-12" max={melbourneToday()} value={d.attendedOn ?? ""} onChange={(e) => setD({ ...d, attendedOn: e.target.value })} /></label>}
        </fieldset>
        <fieldset data-measured-quoted><legend className="font-display text-lg font-bold">{QUOTE_PREPARED_QUESTION}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={QUOTE_PREPARED_QUESTION}>
            {QUOTE_PREPARED_CHOICES.map((c) => <Button key={c.value} disabled={busy || fileBusy} size="field" role="radio" aria-checked={d.quoteStatus === c.value} variant={d.quoteStatus === c.value ? "default" : "outline"} onClick={() => setD({ ...d, quoteStatus: c.value })}>{c.label}</Button>)}
          </div>
          {d.quoteStatus === "not_quoted" && <p className="mt-2 text-sm text-sub" data-not-measured-note>{NOT_MEASURED_NOTE}</p>}
          {branches.preliminary && <p className="mt-2 text-sm text-sub" data-preliminary-note>{PRELIMINARY_QUOTE_NOTE}</p>}
        </fieldset>
        <div className="space-y-4" data-measured-branch data-estimate-only={branches.estimateOnly ? "true" : undefined}>
        {branches.estimateOnly && <p className="text-xs text-sub" data-estimate-note>Optional. Without a site visit these are saved as a preliminary, unverified estimate — never as a measurement.</p>}
        <label className="block text-sm font-bold">{branches.estimateOnly ? "Estimated ceiling area (m²) — optional" : "Measured ceiling area (m²)"}<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 120" value={d.area} onChange={(e) => { typed.current.add("area"); setD({ ...d, area: e.target.value }); }} /></label>
        <fieldset data-existing-insulation><legend className="text-sm font-bold">Existing insulation</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Existing insulation">
            {EXISTING_INSULATION_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={d.insulation === c.value} variant={d.insulation === c.value ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal px-1 text-xs leading-tight" onClick={() => setD({ ...d, insulation: c.value })}>{c.label}</Button>)}
          </div>
          {d.insulation === "unknown" && <p className="mt-1 text-xs text-sub">You can submit. The owner quote waits until the existing insulation is confirmed as none or below R2.0.</p>}
        </fieldset>
        <ProposedRField value={d.proposedR} disabled={busy || fileBusy} onChange={(v) => { typed.current.add("proposedR"); setD({ ...d, proposedR: v }); }} />
        <RemovalQuoteFields value={d.removal ?? blankRemoval()} disabled={busy || fileBusy} onChange={(removal) => setD({ ...d, removal })} />
        <div data-supporting-files>
        {fileNote && <p className="text-xs text-sub" data-file-note>{fileNote}</p>}
        <AttachFiles businessId={businessId} files={files.filter((f) => f.purpose === "supporting")} disabled={busy || fileBusy} label="Supporting photos, videos or measure-up (optional)" onAdd={(picked) => changeFiles(() => addPicked(picked, "supporting"))} onRemove={(path) => changeFiles(() => removeAttached(path))} />
        <p className="mt-1 text-xs text-sub">These are supporting evidence only — they don't count as your quote. Each item is reviewed before it's accepted.</p>
        {files.some((f) => f.purpose == null) && <p className="mt-1 text-xs text-sub" data-unclassified-files>{files.filter((f) => f.purpose == null).length} earlier file(s) have no label yet. They are kept and don't count as your quote — say what each one is from the job page after saving.</p>}
        </div>
        </div>
        {branches.quoteFacts && <div className="space-y-4" data-quote-branch>
        <AttachFiles businessId={businessId} files={files.filter((f) => f.purpose === "quote")} disabled={busy || fileBusy} label="Upload your quote" onAdd={(picked) => changeFiles(() => addPicked(picked, "quote"))} onRemove={(path) => changeFiles(() => removeAttached(path))} />
        <p className="text-xs text-sub">No quote file? Enter the amount and what it includes.</p>
        <label className="block text-sm font-bold">Total installer quote inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={d.amount} onChange={(e) => { typed.current.add("amount"); setD({ ...d, amount: e.target.value }); }} /></label>
        <p className="text-xs text-sub">Your works price before the VEU discount. Removal or extras you priced separately go below — never include them twice.</p>
        <label className="block text-sm font-bold">What the quote includes<Textarea className="mt-1" rows={3} maxLength={1000} value={d.includes} onChange={(e) => { typed.current.add("includes"); setD({ ...d, includes: e.target.value }); }} /></label>
        <QuoteCommercialFields value={d.commercial ?? blankCommercialInput()} removalRequired={d.removal?.answer === "yes"} disabled={busy || fileBusy} onChange={(commercial) => setD({ ...d, commercial })} />
        </div>}
        <p className="pt-1 text-xs font-bold uppercase tracking-wide text-sub" data-section-electrician>Electrician & owner fees</p>
        <fieldset data-electrician-payer><legend className="text-sm font-bold">Electrician (PIESA)</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Electrician">
            {ELECTRICIAN_PAYER_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={payer === c.value} onClick={() => { setPayer(c.value); if (c.value === "hivic") setPlan({ mode: "hivic" }); }} className={`w-full rounded-[14px] border p-3 text-left ${payer === c.value ? "border-primary bg-primary/5" : "border-line bg-paper"}`}>
              <span className="block text-sm font-bold">{c.label}</span><span className="mt-1 block text-xs text-sub">{c.body}</span>
            </button>)}
          </div>
        </fieldset>
        {payer === "own" && plan && <ElectricianPicker ownOnly value={plan} onChange={(n) => { setPlan(n); if (n.mode !== "mine") setPayer("hivic"); }} note={false} approved={el?.approved ?? []} pending={el?.pending ?? []} onAdd={async (x) => { const r = await addEl({ data: { businessId, name: x.name, mobile: x.mobile, email: x.email, business: x.business } }); await refetch(); setPlan({ mode: "mine", ...(r.businessId ? { business_id: r.businessId } : { nomination_id: r.nominationId }) }); return { message: inviteResultMessage(r) }; }} />}
        {d.quoteStatus === "have_quote" && feeText && <label className="flex items-start gap-3 text-sm" data-fee-ack><Checkbox className="mt-0.5" checked={feeAck} onCheckedChange={(c) => setFeeAck(c === true)} aria-label={feeText} /><span>{feeText}<span className="block text-xs text-sub">Not ticked? You can still submit — the owner quote waits until this is recorded.</span></span></label>}
      </section>}

      {step === "review" && <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-step-review>
        <h2 className="font-display text-lg font-bold">Review & submit</h2>
        <Summary title="Customer" disabled={busy || fileBusy} onEdit={() => setStep("customer")} rows={[customer.full_name, [customer.address_line, customer.suburb, customer.postcode].filter(Boolean).join(", "), customer.phone, customer.email, "Permission to contact given"]} />
        <Summary title="Organise" disabled={busy || fileBusy} onEdit={() => setStep("organise")} rows={[coord === "self_managed" ? "I’ll manage the job myself (responsibility acknowledged)" : "Home Insulation Victoria manages the process"]} />
        <Summary title="Job" disabled={busy || fileBusy} onEdit={() => setStep("job")} rows={[
          d.attended === "attended" ? `Attended and assessed${d.attendedOn ? ` on ${d.attendedOn}` : " (date not given)"}` : "Not attended yet — Ready Check required",
          branches.estimateOnly ? (intakeArea(d.area) ? `Preliminary estimate ${d.area} m² (unverified, not measured)` : "Not measured yet") : intakeArea(d.area) ? `Ceiling ${d.area} m²` : "Ceiling area: not measured yet", `Existing insulation: ${EXISTING_INSULATION_CHOICES.find((c) => c.value === (d.insulation ?? "unknown"))?.label ?? "Not yet confirmed"}`,
          ...(d.quoteStatus === "not_quoted" ? ["Quote: not prepared yet", d.proposedR ? `Proposed product ${/^r/i.test(d.proposedR) ? d.proposedR : `R${d.proposedR}`}` : ""] : [branches.preliminary ? "Quote: preliminary estimate (no site visit yet)" : "", d.amount ? `Quote $${d.amount.replace(/^\$/, "")} inc GST` : "Quote amount not confirmed — from your uploaded file", d.includes ? `Includes: ${d.includes}` : "", d.proposedR ? `Proposed product ${/^r/i.test(d.proposedR) ? d.proposedR : `R${d.proposedR}`}` : ""]),
          ...(d.removal ? [removalFactSummary(removalPayload(d.removal, d.quoteStatus === "have_quote", d.attended === "attended"), d.quoteStatus === "have_quote" ? commercialPayload(d.commercial ?? blankCommercialInput(), live.includes || null, d.removal.answer === "yes") : null)] : []),
          `Quote files: ${quoteFileCount(files)} · Supporting files: ${files.length - quoteFileCount(files)}`, `Electrician: ${elName}`, ...(d.quoteStatus === "have_quote" ? [feeAck && feeText ? "Owner fees advised (declared)" : "Owner fees: not declared yet — owner quote waits"] : []),
        ]} />
        <label className="flex items-start gap-3 text-sm" data-evidence-ack><Checkbox className="mt-0.5" checked={ack} onCheckedChange={(c) => setAck(c === true)} aria-label={EVIDENCE_ACK} /><span>{EVIDENCE_ACK}</span></label>
        <div className="rounded-[12px] border border-line p-3" data-next-step><p className="text-xs font-bold uppercase tracking-wide text-sub">What happens next</p><p className="mt-1 text-sm">Nothing is sent or booked when you submit. {intakeNextAction(coord, d.quoteStatus === "have_quote", d.attended ?? null)}</p></div>
      </section>}

      {shown.length > 0 && <ul ref={problemsRef} tabIndex={-1} role="alert" className="space-y-1 rounded-[12px] border border-danger/40 bg-paper p-3 text-sm text-danger outline-none" data-step-problems>{shown.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="status" className="rounded-[12px] border border-line bg-paper p-3 text-sm" data-save-error>{err}</p>}

      <div className="space-y-2">
        {step === "review"
          ? <Button size="field" className="w-full" disabled={busy || fileBusy} aria-busy={busy} onClick={submit}>{busy ? BUSY_LABEL : err ? "Retry submission" : "Submit job"}</Button>
          : <Button size="field" className="w-full" disabled={busy || fileBusy} onClick={forward}>Next</Button>}
        {step !== "customer" && <Button size="field" variant="outline" className="w-full" disabled={busy || fileBusy} onClick={back}>Back</Button>}
      </div>
    </div>
  );
}

function Summary({ title, rows, onEdit, disabled }: { title: string; rows: string[]; onEdit: () => void; disabled: boolean }) {
  return <div className="rounded-[12px] bg-mist p-3" data-summary={title}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-sub">{title}</p><Button variant="ghost" disabled={disabled} type="button" onClick={onEdit} className="h-10 rounded-[9px] px-3 text-sm font-bold text-hiv-blue underline" aria-label={`Edit ${title.toLowerCase()}`}>Edit</Button></div>
    <ul className="mt-1 space-y-0.5 text-sm">{rows.filter(Boolean).map((r, i) => <li key={i} className="break-words">{r}</li>)}</ul>
  </div>;
}

type Saved = { jobId: string; jobNumber: string | null; insulation: ExistingInsulation; quoted?: boolean | null; attended?: AttendanceAnswer | null; next?: string; feeHeld?: boolean };
function Received({ saved, preview = false }: { saved: Saved; preview?: boolean }) {
  const get = useServerFn(getMyIntakeReadyCheck);
  const { data } = useQuery({ queryKey: ["intake-rc", saved.jobId], queryFn: () => get({ data: { jobId: saved.jobId } }), retry: false, enabled: !preview });
  if (preview) return (
    <section className="mt-4 space-y-3 rounded-[18px] border border-line bg-paper p-5" data-saved data-intake-received data-preview-received>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">Preview only</p>
      <h2 className="font-display text-xl font-bold">This is where the installer would see "Job received"</h2>
      <p className="text-sm">Nothing was saved or sent. No job was created and nobody was contacted.</p>
      {!saved.quoted && <p className="text-sm" data-add-when-ready>A real installer would see: "Add your measurements and quote on this job when ready."</p>}
      {saved.next && <p className="text-sm" data-received-next>Next: {saved.next}</p>}
      {saved.feeHeld && <p className="text-sm" data-fee-held>Owner quote would wait until the owner fee confirmation is recorded.</p>}
    </section>
  );
  return (
    <section className="mt-4 space-y-3 rounded-[18px] border border-line bg-paper p-5" data-saved data-intake-received>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">{saved.jobNumber ?? "Job"} received</p>
      <h2 className="font-display text-xl font-bold">Job received</h2>
      <p className="text-sm" data-received-next>{saved.next ?? "Home Insulation Victoria checks the owner's eligibility next."} Nobody has been contacted and nothing is booked yet.</p>
      {saved.feeHeld && <p className="text-sm font-semibold" data-fee-held>The owner quote waits until you confirm the owner has been advised of the fees — you can do this on the job.</p>}
      <p className="text-sm" data-attendance-saved>Site visit: {saved.attended === "attended" ? "attended and assessed" : saved.attended === "not_attended" ? "not attended yet — Ready Check required" : "not answered yet"}</p>
      {saved.quoted === null && <p className="text-sm font-semibold" data-quote-unknown>Quote status: not answered yet — answer it on the job.</p>}
      {saved.quoted === false && <p className="text-sm font-semibold" data-add-when-ready>{saved.attended === "attended" ? "Your measurements are saved. Add your quote on this job when ready." : "Add your measurements and quote on this job when ready."}</p>}
      {saved.quoted && saved.insulation === "unknown" && <p className="text-sm font-semibold">The owner quote waits until the existing insulation is confirmed as none or below R2.0.</p>}
      {data?.coordination && <p className="text-sm" data-coordination-saved>Organised by: {data.coordination === "self_managed" ? "you" : "Home Insulation Victoria"}</p>}
      {data && <p className="text-sm" data-rc-outstanding>Ready Check: {data.readyCheck.outstandingCount} item{data.readyCheck.outstandingCount === 1 ? "" : "s"} outstanding</p>}
      <Link to="/field/$jobId" params={{ jobId: saved.jobId }} className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line font-bold">Complete Ready Check</Link>
      <Link to="/field" className="block text-center text-sm font-bold underline">Back to My work</Link>
    </section>
  );
}
