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
import { ELECTRICIAN_PAYER_CHOICES, feeAwarenessText, type ElectricianPayer } from "@/lib/installer-intake.core";
import { Checkbox } from "@/components/ui/checkbox";
import { EXISTING_INSULATION_CHOICES, JOB_DETAILS_LEAD, QUOTE_STATUS_CHOICES, intakeArea, intakeProblems, intakeQuotePayload, type ExistingInsulation, type QuoteStatus } from "@/lib/installer-intake.core";
import type { ElectricianPlan } from "@/lib/job-electrician.core";

export type IntakeJobFacts = {
  areaM2: number | null; insulation: ExistingInsulation | null; quoted: "yes" | "no" | null; quoteAnswer?: QuoteStatus | null; quoteIncGst: number | null;
  includes: string | null; proposedR: number | null; files: AttachedFile[]; electricianChosen: boolean; quoteHeld: string[];
  electricianPayer?: ElectricianPayer; feeAwarenessCurrent?: boolean; payerEditable?: boolean; payerLockReason?: string | null;
};
export type IntakeSave = {
  areaM2: number | null; insulation: ExistingInsulation; quoteStatus: QuoteStatus; quoteIncGst: number | null; includes: string | null;
  proposedR: number | null; files: AttachedFile[]; electrician?: { mode: "mine"; business_id?: string | null; nomination_id?: string | null };
  electricianPayer?: ElectricianPayer;
  feeAwareness?: { payer: "hivic" | "own"; text: string };
};
type ElChoices = { approved: { businessId?: string; nominationId?: string; name: string }[]; pending: { businessId?: string; nominationId?: string; name: string }[] };

/** Pure view: callers supply load/save/upload (real RPCs on /field, local stand-ins on /installer-preview). */
export function IntakeDetailsEditor({ facts, businessId, onSave, upload, electricians, preview = false }: {
  facts: IntakeJobFacts; businessId: string; onSave: (s: IntakeSave) => Promise<{ quoteHeld: string[] }>; upload: (f: File[]) => Promise<AttachedFile[]>; electricians?: ElChoices | undefined; preview?: boolean;
}) {
  const initStatus: QuoteStatus | null = facts.quoteAnswer !== undefined ? facts.quoteAnswer : facts.quoted === "yes" || facts.quoteIncGst != null ? "have_quote" : facts.quoted === "no" ? "not_quoted" : null;
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState(facts.areaM2 == null ? "" : String(facts.areaM2));
  const [ins, setIns] = useState<ExistingInsulation>(facts.insulation ?? "unknown");
  const [qs, setQs] = useState<QuoteStatus | null>(initStatus);
  const [amount, setAmount] = useState(facts.quoteIncGst == null ? "" : String(facts.quoteIncGst));
  const [includes, setIncludes] = useState(facts.includes ?? "");
  const [proposedR, setProposedR] = useState(facts.proposedR == null ? "" : String(facts.proposedR));
  const [newFiles, setNewFiles] = useState<AttachedFile[]>([]);
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  const [feeTick, setFeeTick] = useState(false);
  const currentPayer: ElectricianPayer = facts.electricianPayer ?? "undecided";
  const [payer, setPayer] = useState<ElectricianPayer>(currentPayer);
  const payerChanged = payer !== currentPayer;
  // The declaration always follows the PROPOSED payer; any change clears the tick.
  const feeText = !payerChanged && facts.feeAwarenessCurrent ? null : feeAwarenessText(payer);
  useEffect(() => { setFeeTick(false); }, [payer]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const allFiles = [...facts.files, ...newFiles];

  const save = async () => {
    const p = intakeProblems({ area, amount, includes, proposedR, insulation: ins, quoteStatus: qs, quoteFileCount: allFiles.length, evidenceAck: true });
    if (facts.areaM2 != null && !area.trim()) p.push("The ceiling area is already saved — enter the corrected area instead of clearing it");
    if (payerChanged && payer === "own" && !(plan?.mode === "mine" && (plan.business_id || plan.nomination_id))) p.push("Choose your electrician");
    setProblems(p); setMsg(null);
    if (p.length || busy) return;
    const q = intakeQuotePayload({ quoteStatus: qs, amount, includes, proposedR });
    setBusy(true);
    try {
      const r = await onSave({ areaM2: intakeArea(area), insulation: ins, quoteStatus: qs!, quoteIncGst: q.quoted_price_inc_gst, includes: q.price_includes, proposedR: q.proposed_r_value, files: newFiles,
        ...(feeTick && feeText && (payer === "hivic" || payer === "own") ? { feeAwareness: { payer, text: feeText } } : {}),
        ...(payerChanged ? { electricianPayer: payer } : {}),
        ...(payerChanged && payer === "own" && plan?.mode === "mine" && (plan.business_id || plan.nomination_id) ? { electrician: { mode: "mine" as const, business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } } : {}) });
      setNewFiles([]); if (feeTick) setFeeTick(false);
      setMsg(preview ? "Preview only — nothing was saved." : r.quoteHeld.length ? "Saved. The owner quote is still on hold until the remaining items are ready." : "Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save. Try again."); }
    finally { setBusy(false); }
  };

  const known = [
    facts.areaM2 != null ? `Ceiling ${facts.areaM2} m² (your figure, not yet accepted)` : "Ceiling area: not measured yet",
    `Existing insulation: ${EXISTING_INSULATION_CHOICES.find((c) => c.value === (facts.insulation ?? "unknown"))?.label}`,
    facts.quoteIncGst != null ? `Your quote $${facts.quoteIncGst.toLocaleString("en-AU")} inc GST` : initStatus === "not_quoted" ? "Quote: not quoted yet" : initStatus === "have_quote" ? (facts.files.length ? "Quote: your uploaded quote — office confirms the amount" : "Quote: amount still needed") : "Quote: not answered yet",
  ];
  return (
    <section className="space-y-3 rounded-[18px] border border-line bg-paper p-4" data-intake-editor>
      <h2 className="font-display text-lg font-bold">Measurements and quote</h2>
      <ul className="space-y-0.5 text-sm" data-intake-known>{known.map((k) => <li key={k}>{k}</li>)}</ul>
      {facts.quoteHeld.length > 0 && <p className="text-xs text-sub" data-quote-held>Owner quote on hold: {facts.quoteHeld.join("; ")}</p>}
      {!open ? <Button size="field" variant="outline" className="w-full" onClick={() => setOpen(true)}>Add or update details</Button> : <>
        <p className="text-sm text-sub">{JOB_DETAILS_LEAD}</p>
        <label className="block text-sm font-bold">Ceiling area (m²)<span className="block text-xs font-normal text-sub">Optional — leave blank if not measured yet</span><Input className="mt-1 h-12" inputMode="decimal" placeholder="Not measured yet" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <fieldset><legend className="text-sm font-bold">Existing insulation</legend>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Existing insulation">
            {EXISTING_INSULATION_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={ins === c.value} variant={ins === c.value ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal px-1 text-xs leading-tight" onClick={() => setIns(c.value)}>{c.label}</Button>)}
          </div>
        </fieldset>
        <fieldset><legend className="text-sm font-bold">Quote status</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quote status">
            {QUOTE_STATUS_CHOICES.map((c) => <Button key={c.value} size="field" role="radio" aria-checked={qs === c.value} variant={qs === c.value ? "default" : "outline"} className="h-auto min-h-12 whitespace-normal px-1 text-sm" onClick={() => setQs(c.value)}>{c.label}</Button>)}
          </div>
          {qs === "not_quoted" && (facts.quoteIncGst != null || facts.includes) && <p className="mt-1 text-xs text-sub" data-quote-clear-note>Saving "Not quoted yet" removes the quote amount and inclusions saved earlier. Uploaded files are kept as originals.</p>}
        </fieldset>
        {qs === "have_quote" && <>
          <AttachFiles businessId={businessId} files={allFiles} label="Upload your quote" onAdd={async (picked) => { const up = await upload(picked); setNewFiles((o) => [...o, ...up]); }} onRemove={async (path) => setNewFiles((o) => o.filter((f) => f.path !== path))} />
          <p className="text-xs text-sub">No quote file? Enter the amount and what it includes.</p>
          <label className="block text-sm font-bold">Your quote inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="block text-sm font-bold">What the quote includes<Textarea className="mt-1" rows={3} maxLength={1000} value={includes} onChange={(e) => setIncludes(e.target.value)} /></label>
          <label className="block text-sm font-bold">Proposed product R-rating<span className="block text-xs font-normal text-sub">Optional, e.g. R5.0</span><Input className="mt-1 h-12" inputMode="decimal" value={proposedR} onChange={(e) => setProposedR(e.target.value)} /></label>
        </>}
        {facts.payerEditable && <fieldset data-editor-payer><legend className="text-sm font-bold">Electrician (PIESA)</legend>
          <p className="text-xs text-sub">Choosing doesn't book anyone. Changing this updates the owner quote.</p>
          <div className="mt-2 space-y-2" role="radiogroup" aria-label="Who arranges the electrician">
            {ELECTRICIAN_PAYER_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={payer === c.value} onClick={() => { setPayer(c.value); if (c.value === "own" && plan?.mode !== "mine") setPlan({ mode: "mine" }); }} className={`w-full rounded-[14px] border p-3 text-left ${payer === c.value ? "border-primary bg-primary/5" : "border-line bg-paper"}`}><span className="block text-sm font-bold text-ink">{c.label}</span><span className="block text-xs text-sub">{c.body}</span></button>)}
          </div>
          {payer === "own" && electricians && <div className="mt-2"><ElectricianPicker ownOnly value={plan?.mode === "mine" ? plan : { mode: "mine" }} onChange={(n) => setPlan(n)} note={false} approved={electricians.approved as never} pending={electricians.pending as never} /></div>}
        </fieldset>}
        {!facts.payerEditable && <p className="text-sm" data-editor-payer-fixed>Electrician: {currentPayer === "own" ? "your own electrician (invoices the owner directly)" : currentPayer === "hivic" ? "Home Insulation Victoria arranges" : "to be arranged"}. {facts.payerLockReason ?? "Ask Home Insulation Victoria to change it."}</p>}
        {feeText && <label className="flex items-start gap-3 text-sm" data-editor-fee-ack><Checkbox className="mt-0.5" checked={feeTick} onCheckedChange={(c) => setFeeTick(c === true)} aria-label={feeText} /><span>{feeText}<span className="block text-xs text-sub">Optional now — the owner quote waits until this is recorded.</span></span></label>}
        {problems.length > 0 && <ul role="alert" className="space-y-1 rounded-[12px] border border-danger/40 p-3 text-sm text-danger" data-editor-problems>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {msg && <p role="status" className="text-sm" data-editor-msg>{msg}</p>}
        <Button size="field" className="w-full" disabled={busy} aria-busy={busy} onClick={save}>{busy ? "Saving…" : "Save details"}</Button>
      </>}
    </section>
  );
}

/** Real job page: supplying installer only (server re-checks job access, installer role and business membership). */
export function MyIntakeDetailsCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getMyIntakeJob), put = useServerFn(saveMyIntakeJob), getEl = useServerFn(bulkElectricianChoices);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["my-intake-job", jobId], queryFn: () => get({ data: { jobId } }), retry: false });
  const biz = data?.applies ? data.businessId : null;
  const { data: el } = useQuery({ queryKey: ["bulk-electricians", biz], queryFn: () => getEl({ data: { businessId: biz! } }), enabled: !!biz });
  const upload = useUploadFiles(biz ?? "");
  const [k, setK] = useState(0);
  useEffect(() => { setK((x) => x + 1); }, [data]);
  if (!data?.applies) return null;
  return <IntakeDetailsEditor key={k} facts={data as IntakeJobFacts} businessId={data.businessId} upload={upload} electricians={el as ElChoices | undefined}
    onSave={async (s) => { const r = await put({ data: { jobId, ...s, files: s.files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" })) } }); await qc.invalidateQueries({ queryKey: ["my-intake-job", jobId] }); return r; }} />;
}
