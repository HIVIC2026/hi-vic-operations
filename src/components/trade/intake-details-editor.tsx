// Supplying installer adds/updates what they know on their OWN received job (Jo, 8 Oct): area, quote status/file/amount,
// product, insulation, electrician. Same job, canonical records; never an accepted measurement or Ready Check approval.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AttachFiles, ElectricianPicker, useUploadFiles, type AttachedFile } from "./job-intake";
import { getMyIntakeJob, saveMyIntakeJob } from "@/lib/installer-quote.functions";
import { bulkElectricianChoices } from "@/lib/bulk-import.functions";
import { ELECTRICIAN_PAYER_CHOICES, editorElectricianSend, feeAwarenessText, type ElectricianPayer } from "@/lib/installer-intake.core";
import { melbourneToday, quoteFileCount, visitDateProblem } from "@/lib/installer-intake.core";
import { Checkbox } from "@/components/ui/checkbox";
import { EXISTING_INSULATION_CHOICES, JOB_DETAILS_LEAD, QUOTE_STATUS_CHOICES, intakeArea, intakeProblems, intakeQuotePayload, type ExistingInsulation, type QuoteStatus, type AttendanceAnswer, ATTENDED_CHOICES, ATTENDED_QUESTION, PRELIMINARY_QUOTE_NOTE } from "@/lib/installer-intake.core";
import type { ElectricianPlan } from "@/lib/job-electrician.core";
import { ProposedRField, QuoteCommercialFields, RemovalQuoteFields } from "./intake-quote-fields";
import { commercialInputFrom, commercialInputProblems, commercialPayload, removalFactSummary, type CommercialInput, type QuoteCommercial } from "@/lib/installer-quote-commercial.core";
import { blankRemoval, removalPayload, removalProblems, removalSummary, type RemovalInput, type RemovalQuote } from "@/lib/intake-quote-details.core";
import { refreshInstallerJob } from "./job-cache";

export type IntakeJobFacts = {
  areaM2: number | null; preliminaryAreaM2?: number | null; insulation: ExistingInsulation | null; quoted: "yes" | "no" | null; quoteAnswer?: QuoteStatus | null; attended?: AttendanceAnswer | null; attendedOn?: string | null; quoteIncGst: number | null;
  includes: string | null; proposedR: number | null; files: AttachedFile[]; electricianChosen: boolean; quoteHeld: string[];
  removalQuote?: RemovalQuote | null; commercial?: QuoteCommercial | null; removalText?: string | null;
  electricianPayer?: ElectricianPayer; feeAwarenessCurrent?: boolean; payerEditable?: boolean; payerLockReason?: string | null;
  currentElectrician?: { businessId: string | null; name: string } | null;
};
export type IntakeSave = {
  areaM2: number | null; insulation: ExistingInsulation; quoteStatus: QuoteStatus; quoteIncGst: number | null; includes: string | null;
  proposedR: number | null; files: AttachedFile[]; attended?: AttendanceAnswer; attendedOn?: string | null; electrician?: { mode: "mine"; business_id?: string | null; nomination_id?: string | null };
  electricianPayer?: ElectricianPayer;
  removalQuote?: RemovalQuote; commercial?: QuoteCommercial;
  feeAwareness?: { payer: "hivic" | "own"; text: string };
};
type ElChoices = { approved: { businessId?: string; nominationId?: string; name: string }[]; pending: { businessId?: string; nominationId?: string; name: string }[] };

/** Pure view: callers supply load/save/upload (real RPCs on /field, local stand-ins on /installer-preview). */
export function IntakeDetailsEditor({ facts, businessId, onSave, upload, electricians, preview = false }: {
  facts: IntakeJobFacts; businessId: string; onSave: (s: IntakeSave) => Promise<{ quoteHeld: string[] }>; upload: (f: File[]) => Promise<AttachedFile[]>; electricians?: ElChoices | undefined; preview?: boolean;
}) {
  const initStatus: QuoteStatus | null = facts.quoteAnswer !== undefined ? facts.quoteAnswer : facts.quoted === "yes" || facts.quoteIncGst != null ? "have_quote" : facts.quoted === "no" ? "not_quoted" : null;
  const [open, setOpen] = useState(false);
  const savedArea = facts.areaM2 ?? facts.preliminaryAreaM2 ?? null;
  const [area, setArea] = useState(savedArea == null ? "" : String(savedArea));
  const [ins, setIns] = useState<ExistingInsulation>(facts.insulation ?? "unknown");
  const [qs, setQs] = useState<QuoteStatus | null>(initStatus);
  const [att, setAtt] = useState<AttendanceAnswer | null>(facts.attended ?? null);
  const [attOn, setAttOn] = useState(facts.attendedOn ?? "");
  const [amount, setAmount] = useState(facts.quoteIncGst == null ? "" : String(facts.quoteIncGst));
  const [includes, setIncludes] = useState(facts.includes ?? "");
  const [proposedR, setProposedR] = useState(facts.proposedR == null ? "" : String(facts.proposedR));
  const removalFromFacts = (): RemovalInput => facts.removalQuote ? { answer: facts.removalQuote.answer, area: facts.removalQuote.areaM2 == null ? "" : String(facts.removalQuote.areaM2), charge: facts.removalQuote.chargeIncGst == null ? "" : String(facts.removalQuote.chargeIncGst) } : blankRemoval();
  const [removal, setRemoval] = useState<RemovalInput>(removalFromFacts);
  const [com, setCom] = useState<CommercialInput>(() => commercialInputFrom(facts.commercial));
  const [newFiles, setNewFiles] = useState<AttachedFile[]>([]);
  const savedPlan = (): ElectricianPlan | null => facts.currentElectrician?.businessId ? { mode: "mine", business_id: facts.currentElectrician.businessId } : null;
  const [plan, setPlan] = useState<ElectricianPlan | null>(savedPlan);
  const [feeTick, setFeeTick] = useState(false);
  const currentPayer: ElectricianPayer = facts.electricianPayer ?? "undecided";
  const [payer, setPayer] = useState<ElectricianPayer>(currentPayer);
  const payerChanged = payer !== currentPayer;
  // Own -> a different own electrician is a real change and is sent (server re-checks every lock).
  const sendElectrician = editorElectricianSend({ payerChanged, payer, plan, currentBusinessId: facts.currentElectrician?.businessId });
  // The declaration always follows the PROPOSED payer; any change clears the tick.
  const feeText = !payerChanged && facts.feeAwarenessCurrent ? null : feeAwarenessText(payer);
  useEffect(() => { setFeeTick(false); }, [payer]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Refresh idle forms only. An open edit must survive focus/refetch without losing input or feedback.
  useEffect(() => {
    if (open || busy || fileBusy) return;
    setArea(savedArea == null ? "" : String(savedArea)); setIns(facts.insulation ?? "unknown");
    setQs(initStatus); setAtt(facts.attended ?? null); setAttOn(facts.attendedOn ?? ""); setAmount(facts.quoteIncGst == null ? "" : String(facts.quoteIncGst));
    setIncludes(facts.includes ?? ""); setProposedR(facts.proposedR == null ? "" : String(facts.proposedR));
    setPayer(currentPayer); setRemoval(removalFromFacts()); setCom(commercialInputFrom(facts.commercial)); setPlan(savedPlan());
  }, [facts, open, busy, fileBusy, initStatus, currentPayer]);
  // Earlier files without a purpose stay UNCLASSIFIED until the installer explicitly says what each one is.
  const [classified, setClassified] = useState<Record<string, "quote" | "supporting">>({});
  const allFiles = [...facts.files.map((f) => (f.purpose == null && classified[f.path] ? { ...f, purpose: classified[f.path] } : f)), ...newFiles];
  const unclassified = facts.files.filter((f) => f.purpose == null);

  const save = async () => {
    const p = intakeProblems({ area, amount, includes, proposedR, insulation: ins, quoteStatus: qs, quoteFileCount: quoteFileCount(allFiles), evidenceAck: true });
    { const dp = att === "attended" ? visitDateProblem(attOn || null, melbourneToday()) : null; if (dp) p.push(dp); }
    p.push(...removalProblems(removalPayload(removal, qs === "have_quote", att === "attended"), ins, intakeArea(area), intakeQuotePayload({ quoteStatus: qs, amount, includes, proposedR }).quoted_price_inc_gst, false, false)); // draft may omit removal m²
    if (qs === "have_quote") p.push(...commercialInputProblems(commercialPayload(com, includes || null, removal.answer === "yes"), removalPayload(removal, true)));
    if (savedArea != null && !area.trim()) p.push("The ceiling area is already saved — enter the corrected area instead of clearing it");
    if (payerChanged && payer === "own" && !(plan?.mode === "mine" && (plan.business_id || plan.nomination_id))) p.push("Choose your electrician");
    setProblems(p); setMsg(null);
    if (p.length || busy || fileBusy || !qs) return;
    const q = intakeQuotePayload({ quoteStatus: qs, amount, includes, proposedR });
    setBusy(true);
    try {
      const r = await onSave({ areaM2: intakeArea(area), insulation: ins, quoteStatus: qs, quoteIncGst: q.quoted_price_inc_gst, includes: q.price_includes, proposedR: q.proposed_r_value, files: [...newFiles, ...facts.files.filter((f) => f.purpose == null && classified[f.path]).map((f) => ({ path: f.path, name: f.name, type: f.type, purpose: classified[f.path]! }))], ...(att && (att !== (facts.attended ?? null) || (att === "attended" && attOn !== (facts.attendedOn ?? ""))) ? { attended: att, attendedOn: att === "attended" ? attOn || null : null } : {}), removalQuote: removalPayload(removal, qs === "have_quote", att === "attended"), ...(qs === "have_quote" ? { commercial: commercialPayload(com, q.price_includes, removal.answer === "yes") } : {}),
        ...(feeTick && feeText && (payer === "hivic" || payer === "own") ? { feeAwareness: { payer, text: feeText } } : {}),
        ...(payerChanged ? { electricianPayer: payer } : {}),
        ...(sendElectrician ? { electrician: sendElectrician } : {}) });
      setNewFiles([]); if (feeTick) setFeeTick(false);
      setMsg(preview ? "Preview only — nothing was saved." : r.quoteHeld.length ? "Saved. The owner quote is still on hold until the remaining items are ready." : "Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save. Try again."); }
    finally { setBusy(false); }
  };

  const known = [
    facts.attended === "attended" ? `Site visit: attended and assessed${facts.attendedOn ? ` on ${facts.attendedOn}` : ""}` : facts.attended === "not_attended" ? "Site visit: not attended yet — Ready Check required" : "Site visit: not answered yet",
    facts.areaM2 != null ? `Ceiling ${facts.areaM2} m² (your figure, not yet accepted)` : facts.preliminaryAreaM2 != null ? `Preliminary estimate ${facts.preliminaryAreaM2} m² (unverified — not measured)` : "Ceiling area: not measured yet",
    `Existing insulation: ${EXISTING_INSULATION_CHOICES.find((c) => c.value === (facts.insulation ?? "unknown"))?.label}`,
    facts.quoteIncGst != null ? `Your quote $${facts.quoteIncGst.toLocaleString("en-AU")} inc GST` : initStatus === "not_quoted" ? "Quote: not quoted yet" : initStatus === "have_quote" ? (facts.files.length ? "Quote: your uploaded quote — office confirms the amount" : "Quote: amount still needed") : "Quote: not answered yet",
    ...(facts.removalText ? [facts.removalText] : facts.removalQuote ? [removalFactSummary(facts.removalQuote, facts.commercial ?? null)] : []),
  ];
  return (
    <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-intake-editor>
      <h2 className="font-display text-lg font-bold">Measurements and quote</h2>
      <ul className="space-y-0.5 text-sm" data-intake-known>{known.map((k) => <li key={k}>{k}</li>)}</ul>
      {facts.quoteHeld.length > 0 && <p className="text-xs text-sub" data-quote-held>Owner quote on hold: {facts.quoteHeld.join("; ")}</p>}
      {!open ? <Button size="field" variant="outline" className="w-full" onClick={() => setOpen(true)}>Add or update details</Button> : <>
        <p className="text-sm text-sub">{JOB_DETAILS_LEAD}</p>
        <fieldset disabled={busy || fileBusy} className="space-y-3" aria-busy={busy || fileBusy}>
        <fieldset data-editor-attended><legend className="text-sm font-bold">{ATTENDED_QUESTION}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={ATTENDED_QUESTION}>
            {ATTENDED_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={att === c.value} variant={att === c.value ? "default" : "outline"} onClick={() => setAtt(c.value)}>{c.label}</Button>)}
          </div>
          {att === "attended" && <label className="mt-2 block text-sm font-bold">Date of the visit<span className="block text-xs font-normal text-sub">Optional</span><Input type="date" className="mt-1 h-12" max={melbourneToday()} value={attOn} onChange={(e) => setAttOn(e.target.value)} /></label>}
          {att === "not_attended" && qs === "have_quote" && <p className="mt-1 text-xs text-sub" data-preliminary-note>{PRELIMINARY_QUOTE_NOTE}</p>}
        </fieldset>
        <label className="block text-sm font-bold">{att === "attended" ? "Ceiling area (m²)" : "Estimated ceiling area (m²)"}<span className="block text-xs font-normal text-sub">{att === "attended" ? "Optional — leave blank if not measured yet" : "Optional — saved as a preliminary, unverified estimate"}</span><Input className="mt-1 h-12" inputMode="decimal" placeholder="Not measured yet" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <fieldset><legend className="text-sm font-bold">Existing insulation</legend>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Existing insulation">
            {EXISTING_INSULATION_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={ins === c.value} variant={ins === c.value ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal px-1 text-xs leading-tight" onClick={() => setIns(c.value)}>{c.label}</Button>)}
          </div>
        </fieldset>
        <fieldset><legend className="text-sm font-bold">Quote status</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quote status">
            {QUOTE_STATUS_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={qs === c.value} variant={qs === c.value ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal px-1 text-sm" onClick={() => setQs(c.value)}>{c.label}</Button>)}
          </div>
          {qs === "not_quoted" && (facts.quoteIncGst != null || facts.includes) && <p className="mt-1 text-xs text-sub" data-quote-clear-note>Saving "Not quoted yet" removes only the quote amount and inclusions saved earlier. Measurements, product, removal facts and uploaded files are kept.</p>}
        </fieldset>
        {unclassified.length > 0 && <div className="rounded-[13px] border border-line p-3" data-editor-unclassified-files>
          <p className="text-sm font-bold">Earlier files — tell us what each one is</p>
          <p className="text-xs text-sub">These were saved before files were labelled. They don't count as your quote until you say so.</p>
          <ul className="mt-2 space-y-2">{unclassified.map((f) => <li key={f.path} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {(["quote", "supporting"] as const).map((p) => <button key={p} type="button" disabled={busy} aria-pressed={classified[f.path] === p} className={`h-12 rounded-[12px] border px-3 text-sm font-semibold ${classified[f.path] === p ? "border-action bg-mint" : "border-line"}`} onClick={() => setClassified((o) => ({ ...o, [f.path]: p }))}>{p === "quote" ? "My quote" : "Supporting evidence"}</button>)}
          </li>)}</ul>
        </div>}
        <div data-editor-supporting-files>
          <AttachFiles businessId={businessId} files={allFiles.filter((f) => f.purpose === "supporting")} label="Supporting photos, videos or measure-up (optional)" disabled={busy} onBusyChange={setFileBusy} canRemove={(path) => newFiles.some((f) => f.path === path)} onAdd={async (picked) => {
            const failed: string[] = [];
            for (const file of picked) {
              try { const up = await upload([file]); setNewFiles((o) => [...o, ...up.map((u) => ({ ...u, purpose: "supporting" as const }))]); }
              catch { failed.push(file.name); }
            }
            if (failed.length) throw new Error(`${failed.join(", ")} didn't upload. Other uploaded files have been kept. Retry only the missing files.`);
          }} onRemove={async (path) => setNewFiles((o) => o.filter((f) => f.path !== path))} />
          <p className="mt-1 text-xs text-sub">Supporting evidence only — not your quote. Reviewed before it's accepted.</p>
        </div>
        {qs === "have_quote" && <>
          <AttachFiles businessId={businessId} files={allFiles.filter((f) => f.purpose === "quote")} label="Upload your quote" disabled={busy} onBusyChange={setFileBusy} canRemove={(path) => newFiles.some((f) => f.path === path)} onAdd={async (picked) => {
            const failed: string[] = [];
            for (const file of picked) {
              try { const up = await upload([file]); setNewFiles((o) => [...o, ...up.map((u) => ({ ...u, purpose: "quote" as const }))]); }
              catch { failed.push(file.name); }
            }
            if (failed.length) throw new Error(`${failed.join(", ")} didn't upload. Other uploaded files have been kept. Retry only the missing files.`);
          }} onRemove={async (path) => setNewFiles((o) => o.filter((f) => f.path !== path))} />
          <p className="text-xs text-sub">No quote file? Enter the amount and what it includes.</p>
          <label className="block text-sm font-bold">Total installer quote inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <p className="text-xs text-sub">Your works price before the VEU discount. Removal or extras you priced separately go below — never include them twice.</p>
          <label className="block text-sm font-bold">What the quote includes<Textarea className="mt-1" rows={3} maxLength={1000} value={includes} onChange={(e) => setIncludes(e.target.value)} /></label>
        </>}
        <ProposedRField value={proposedR} disabled={busy || fileBusy} onChange={setProposedR} />
        <RemovalQuoteFields value={removal} disabled={busy || fileBusy} onChange={setRemoval} />
        {qs === "have_quote" && <QuoteCommercialFields value={com} removalRequired={removal.answer === "yes"} disabled={busy || fileBusy} onChange={setCom} />}
        {facts.payerEditable && <fieldset data-editor-payer><legend className="text-sm font-bold">Electrician (PIESA)</legend>
          <p className="text-xs text-sub">Choosing doesn't book anyone. Changing this updates the owner quote.</p>
          <div className="mt-2 space-y-2" role="radiogroup" aria-label="Who arranges the electrician">
            {ELECTRICIAN_PAYER_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={payer === c.value} onClick={() => { setPayer(c.value); if (c.value === "own" && plan?.mode !== "mine") setPlan({ mode: "mine" }); }} className={`w-full rounded-[14px] border p-3 text-left ${payer === c.value ? "border-primary bg-primary/5" : "border-line bg-paper"}`}><span className="block text-sm font-bold text-ink">{c.label}</span><span className="block text-xs text-sub">{c.body}</span></button>)}
          </div>
          {payer === "own" && !payerChanged && <p className="mt-2 text-sm" data-editor-current-electrician>Current electrician: {facts.currentElectrician?.name ?? "your own electrician"}. To change to another of your electricians, email Home Insulation Victoria at <a className="underline" href="mailto:info@homeinsulationvictoria.com.au">info@homeinsulationvictoria.com.au</a> — the office makes the change.</p>}
          {payer === "own" && payerChanged && electricians && <div className="mt-2"><ElectricianPicker ownOnly value={plan?.mode === "mine" ? plan : { mode: "mine" }} onChange={(n) => setPlan(n)} note={false} approved={electricians.approved as never} pending={electricians.pending as never} /></div>}
        </fieldset>}
        {!facts.payerEditable && <p className="text-sm" data-editor-payer-fixed>Electrician: {currentPayer === "own" ? "your own electrician (invoices the owner directly)" : currentPayer === "hivic" ? "Home Insulation Victoria arranges" : "to be arranged"}. {facts.payerLockReason ?? "Ask Home Insulation Victoria to change it."}</p>}
        {feeText && <label className="flex items-start gap-3 text-sm" data-editor-fee-ack><Checkbox className="mt-0.5" checked={feeTick} onCheckedChange={(c) => setFeeTick(c === true)} aria-label={feeText} /><span>{feeText}<span className="block text-xs text-sub">Optional now — the owner quote waits until this is recorded.</span></span></label>}
        </fieldset>
        {problems.length > 0 && <ul role="alert" className="space-y-1 rounded-[12px] border border-danger/40 p-3 text-sm text-danger" data-editor-problems>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {msg && <p role="status" className="text-sm" data-editor-msg>{msg}</p>}
        <Button size="field" className="w-full" disabled={busy || fileBusy} aria-busy={busy || fileBusy} onClick={save}>{busy ? "Saving…" : fileBusy ? "Saving files…" : "Save details"}</Button>
      </>}
    </section>
  );
}

/** Real job page: supplying installer only (server re-checks job access, installer role and business membership). */
export function MyIntakeDetailsCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getMyIntakeJob), put = useServerFn(saveMyIntakeJob), getEl = useServerFn(bulkElectricianChoices);
  const qc = useQueryClient();
  const { data, isError, refetch } = useQuery({ queryKey: ["my-intake-job", jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const biz = data?.applies ? data.businessId : null;
  const { data: el } = useQuery({ queryKey: ["bulk-electricians", biz], queryFn: () => { if (!biz) throw new Error("Business not loaded"); return getEl({ data: { businessId: biz } }); }, enabled: !!biz });
  const upload = useUploadFiles(biz ?? "");
  if (isError && !data) return <section><p role="alert">Couldn't load the job details.</p><Button variant="outline" onClick={() => void refetch()}>Retry</Button></section>;
  if (!data?.applies) return null;
  return <IntakeDetailsEditor key={jobId} facts={data as IntakeJobFacts} businessId={data.businessId} upload={upload} electricians={el as ElChoices | undefined}
    onSave={async (s) => { const r = await put({ data: { jobId, ...s, files: s.files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" })) } }); await refreshInstallerJob(qc, jobId); return r; }} />;
}
