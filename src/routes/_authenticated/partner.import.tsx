import { OWNER_AGREED_TICK, OWNER_FEE_AWARENESS_TICK } from "@/lib/owner-confirm.core";
import { OnsiteStart } from "@/components/trade/onsite-start";
import { CustomerFields } from "@/components/trade/customer-fields";
import { onsiteProblems, type OnsiteInput } from "@/lib/onsite-ready-check.core";
import { quotedIntakeProblems } from "@/lib/installer-quote-intake.core";
import { LATER_CHOICE, ONSITE_CHOICE } from "@/lib/onsite-ready-check.core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell } from "@/components/trade/TradeShell";
import { Button, Section } from "@/components/trade/trade-ui";
import { useAction } from "@/hooks/use-me";
import { addImportFiles, confirmImport, createImport, discardImport, getPartnerProfile, removeImportFile } from "@/lib/pilot.functions";
import { addBulkElectrician, bulkElectricianChoices, readBulkFile } from "@/lib/bulk-import.functions";
import { AttachFiles, ElectricianPicker, inviteResultMessage, useUploadFiles, type AttachedFile } from "@/components/trade/job-intake";
import { OWNER_CONTACT_PERMISSION, electricianPlanBlocker, usualElectrician, visitedFromEvidence, type ElectricianPlan } from "@/lib/job-electrician.core";
import { useEffect } from "react";
import { parseCsv, reviewItems, type Extracted, type ImportField } from "@/lib/pilot.core";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/partner/import")({
  head: () => ({ meta: [{ title: "Import Existing Job – Home Insulation Victoria Partner Portal" }, { name: "description", content: "Bring an existing customer job into Home Insulation Victoria without retyping it." }, { property: "og:title", content: "Import Existing Job – Home Insulation Victoria Partner Portal" }, { property: "og:description", content: "Bring an existing customer job into Home Insulation Victoria without retyping it." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ImportPage,
});

type Draft = { id: string; extracted: Extracted; files: AttachedFile[]; businessId: string; permission?: boolean; quote?: { amount: string; includes: string } };

function ImportPage() {
  const loadProfile = useServerFn(getPartnerProfile);
  const { data: profile } = useQuery({ queryKey: ["partner-profile", "mine"], queryFn: () => loadProfile({ data: {} }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"choose" | "onsite" | "later">("choose");
  useEffect(() => { const m = new URLSearchParams(window.location.search).get("mode"); if (m === "later" || m === "onsite") setMode(m); }, []);
  const businessId = (profile?.business as { id?: string } | undefined)?.id;
  return (
    <TradeShell installer>
      <h1 className="font-display text-[26px] font-bold leading-tight">{mode === "onsite" ? "Start a Ready Check" : "Add a job"}</h1>
      {mode === "later" && <p className="text-sm text-sub">This is an Installer customer. Add their details, your quote and measure-up, or upload one job sheet and check what was found.</p>}
      {!businessId ? <p className="text-sm text-estimate-navy/70">Loading…</p> : mode === "choose" ? (
        <div className="mt-4 grid gap-3" data-add-choice>
          <Button size="field" className="h-auto w-full whitespace-normal py-4 text-left" onClick={() => setMode("onsite")}>{ONSITE_CHOICE}</Button>
          <Button size="field" variant="outline" className="h-auto w-full whitespace-normal py-4 text-left" onClick={() => setMode("later")}>{LATER_CHOICE}</Button>
        </div>
      ) : mode === "onsite" ? <OnsiteStart businessId={businessId} onBack={() => setMode("choose")} /> : draft ? <Review key={draft.id} draft={draft} onBack={() => setDraft(null)} /> : <Source businessId={businessId} onDraft={setDraft} />}
    </TradeShell>
  );
}

function Source({ businessId, onDraft }: { businessId: string; onDraft: (d: Draft) => void }) {
  const create = useAction(createImport);
  const uploadFiles = useUploadFiles(businessId);
  const readFile = useServerFn(readBulkFile);
  const [text, setText] = useState("");
  const [customer, setCustomer] = useState<OnsiteInput>({ address_line: "", suburb: "", postcode: "", full_name: "", phone: "", email: "", contact_permission: false, consent_by: null });
  const [problems, setProblems] = useState<string[]>([]);
  const [quoted, setQuoted] = useState<"yes" | "no" | null>(null);
  const [area, setArea] = useState("");
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [includes, setIncludes] = useState("");
  const [next, setNext] = useState<"ready_check" | "later" | null>(null);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const go = async () => {
    const issues = [...onsiteProblems(customer), ...quotedIntakeProblems({ quoted, area, method, amount: Number(amount.replace(/[$,\s]/g, "")), includes })];
    if (!quoted) issues.push("Answer Have you quoted?");
    setProblems(issues); if (issues.length || quoted !== "yes") return;
    setBusy(true);
    try {
      const uploaded = files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" }));
      const r = await create({ businessId, sourceSystem: "manual_import", ...(text ? { text } : {}), files: uploaded });
      if (r) {
        const extracted = { ...r.extracted };
        for (const key of ["full_name", "phone", "email", "address_line", "suburb", "postcode"] as const) extracted[key] = { value: customer[key].trim(), confidence: "found", source: "installer entered" };
        extracted.measured_area_m2 = { value: Number(area), confidence: "found", source: "installer entered" };
        extracted.measurement_method = { value: method.trim(), confidence: "found", source: "installer entered" };
        onDraft({ ...r, extracted, files, businessId, permission: customer.contact_permission, quote: { amount, includes } });
      }
    } finally { setBusy(false); }
  };
  if (next === "ready_check") return <OnsiteStart businessId={businessId} initial={customer} onBack={() => setNext(null)} />;
  return (
    <div className="space-y-4">
      <Section title="Customer details"><CustomerFields value={customer} onChange={setCustomer} /></Section>
      <Section title="Have you quoted?">
        <div className="grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} size="field" variant={quoted === v ? "default" : "outline"} onClick={() => { setQuoted(v); setNext(null); }}>{v === "yes" ? "Yes" : "No"}</Button>)}</div>
        {quoted === "yes" && <div className="mt-3 space-y-3">
          <label className="block text-sm font-bold">Ceiling area (m²)<Input className="mt-1 h-12" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
          <label className="block text-sm font-bold">How was it measured?<Input className="mt-1 h-12" placeholder="e.g. laser, tape or floor plan" maxLength={200} value={method} onChange={(e) => setMethod(e.target.value)} /></label>
          <label className="block text-sm font-bold">Quote amount inc GST<Input className="mt-1 h-12" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="block text-sm font-bold">What does the quote include?<Textarea className="mt-1" maxLength={1000} value={includes} onChange={(e) => setIncludes(e.target.value)} /></label>
        </div>}
        {quoted === "no" && <div className="mt-3 space-y-3"><Button size="field" className="w-full" onClick={() => { const issues = onsiteProblems(customer); setProblems(issues); if (!issues.length) setNext("ready_check"); }}>Do our Ready Check</Button><Button size="field" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => setNext("later")}>Fill in the details after I've visited</Button>{next === "later" && <p className="text-sm text-sub">Return to Add a job after your visit with the ceiling area, measurement method and quote. No job has been submitted.</p>}</div>}
      </Section>
      <Section title="Photos, quotes and job sheets">
        <AttachFiles businessId={businessId} files={files} label="Upload one customer file" onAdd={async (picked) => {
          if (files.length || picked.length !== 1) throw new Error("Upload one file for this customer at a time.");
          const f = picked[0]; if (!f) return;
          const up = await uploadFiles([f]); setFiles(up);
          if (["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 10_000_000) {
            const bytes = new Uint8Array(await f.arrayBuffer()); let raw = ""; for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            const r = await readFile({ data: { businessId, onBehalf: false, name: f.name, mime: f.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", base64: btoa(raw) } });
            if (r.text) { setText((old) => [old, r.text].filter(Boolean).join("\n")); setFileNote("Details found. Check every field on the next screen."); }
            else setFileNote(r.description ? `No customer details found: ${r.description}` : "No customer details were found. You can still enter them yourself.");
          } else setFileNote("This file is attached to the job. Enter its customer details yourself.");
        }} onRemove={async (path) => { setFiles((o) => o.filter((x) => x.path !== path)); setFileNote(null); }} />
        {fileNote && <p className="mt-2 text-xs text-sub">{fileNote}</p>}
      </Section>
      {problems.length > 0 && <ul className="text-sm text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {quoted !== "no" && <Button size="field" className="w-full" disabled={busy} onClick={go}>{busy ? "Reading…" : "Continue"}</Button>}
    </div>
  );
}

function Review({ draft, onBack }: { draft: Draft; onBack: () => void }) {
  const confirm = useAction(confirmImport);
  const discard = useAction(discardImport);
  const navigate = useNavigate();
  const items = reviewItems(draft.extracted);
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.key, i.value == null ? "" : typeof i.value === "boolean" ? (i.value ? "yes" : "no") : String(i.value)])));
  const found = items.filter((i) => i.value != null && !i.flagged);
  const check = items.filter((i) => i.flagged || (i.value == null && ["phone", "suburb", "postcode", "measured_area_m2"].includes(i.key)));
  const rest = items.filter((i) => !found.includes(i) && !check.includes(i));
  const numeric: ImportField[] = ["measured_area_m2", "removal_m2", "existing_r_value", "r_value"];
  // Same three facts as bulk upload (Jo, 7 Oct): his quoted price exactly as given, what it includes, site check Y/N.
  const [files, setFiles] = useState<AttachedFile[]>(draft.files);
  const addFiles = useServerFn(addImportFiles), dropFile = useServerFn(removeImportFile), uploadFiles = useUploadFiles(draft.businessId);
  const getElectricians = useServerFn(bulkElectricianChoices), addElectrician = useServerFn(addBulkElectrician);
  const { data: el, refetch: refreshEl } = useQuery({ queryKey: ["bulk-electricians", draft.businessId], queryFn: () => getElectricians({ data: { businessId: draft.businessId } }) });
  const [plan, setPlan] = useState<ElectricianPlan | null>(null);
  useEffect(() => { if (plan || !el) return; const u = usualElectrician(el.approved); setPlan(u?.businessId ? { mode: "mine", business_id: u.businessId } : { mode: "hivic" }); }, [el, plan]);
  // Photos or a measurement mean Visited: the site check answer starts at Yes (the installer can change it).
  const visited = visitedFromEvidence({ files, measuredArea: draft.extracted.measured_area_m2?.value as number | null | undefined });
  const [siteCheck, setSiteCheck] = useState<"yes" | "no" | null>(visited ? "yes" : null);
  const [permission, setPermission] = useState(draft.permission === true);
  const [feeAwareness, setFeeAwareness] = useState(false);
  const [belowR2, setBelowR2] = useState(false);
  const [ownerAgreed, setOwnerAgreed] = useState(false);
  const [siteDate, setSiteDate] = useState("");
  const [price, setPrice] = useState(draft.quote?.amount ?? "");
  const [quoted, setQuoted] = useState<"yes" | "no" | null>(draft.quote ? "yes" : null);
  const [includes, setIncludes] = useState(draft.quote?.includes ?? "");
  const priceNum = price.trim() ? Number(price.replace(/[$,\s]/g, "")) : null;
  const priceBad = priceNum != null && !(Number.isFinite(priceNum) && priceNum > 0);
  const out = () => Object.fromEntries(items.map((i) => {
    const v = vals[i.key]?.trim() ?? "";
    if (!v) return [i.key, null];
    if (numeric.includes(i.key)) return [i.key, Number(v)];
    if (i.key === "removal_required") return [i.key, /^(y|yes|true)$/i.test(v)];
    return [i.key, v];
  }));
  const row = (i: (typeof items)[number]) => (
    <label key={i.key} className="block text-sm">
      <span className="text-estimate-navy/70">{i.label}{i.required ? " *" : ""}{i.confidence === "uncertain" && <span className="ml-1 text-warning">please check</span>}</span>
      <Input className={`h-12 ${i.flagged ? "border-warning" : ""}`} value={vals[i.key] ?? ""} onChange={(e) => setVals({ ...vals, [i.key]: e.target.value })} />
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-line bg-mist p-4"><p className="font-bold">Installer customer</p><p className="mt-1 text-sm text-sub">You supplied this customer. We will check eligibility, prepare the full quote for owner approval and tell you when they accept.</p></div>
      <Section title="We found these details – confirm"><div className="grid gap-2 sm:grid-cols-2">{found.length ? found.map(row) : <p className="text-sm text-estimate-navy/70">Nothing found automatically.</p>}</div></Section>
      <Section title="Check or fill in"><div className="grid gap-2 sm:grid-cols-2">{check.map(row)}</div></Section>
      <details className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card"><summary className="cursor-pointer text-sm font-medium">More details (if you have them)</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{rest.map(row)}</div></details>
      <Section title="Your price and site check">
        <div className="space-y-3" data-installer-facts>
          <div>
            <p className="text-sm font-bold">Have you already done the site check / measure-up?{!siteCheck && <span className="ml-1 text-danger">Please answer</span>}</p>
            <p className="text-xs text-estimate-navy/70">Yes skips our Ready Check. No means we book a Ready Check with the owner.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} type="button" size="field" variant={siteCheck === v ? "default" : "outline"} onClick={() => setSiteCheck(v)}>{v === "yes" ? "Yes" : "No"}</Button>)}</div>
            {siteCheck === "yes" && <label className="mt-2 block text-sm">Site check date (if known)<Input type="date" className="mt-1 h-12" value={siteDate} onChange={(e) => setSiteDate(e.target.value)} /></label>}
          </div>
          <div>
            <p className="text-sm font-bold">Quoted?{!quoted && <span className="ml-1 text-xs font-normal text-estimate-navy/70">You can answer this later on the job page</span>}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} type="button" size="field" variant={quoted === v ? "default" : "outline"} onClick={() => { setQuoted(v); if (v === "no") setPrice(""); }}>{v === "yes" ? "Yes" : "No"}</Button>)}</div>
            {quoted === "no" && <p className="mt-2 text-xs font-semibold">Quote needed from installer</p>}
          </div>
          {quoted === "yes" && <label className="block text-sm"><span className="font-bold">Your quoted price inc GST</span><span className="block text-xs text-estimate-navy/70">Exactly as you quoted the owner.</span>
            <Input className={`mt-1 h-12 ${priceBad ? "border-destructive" : ""}`} inputMode="decimal" placeholder="e.g. 3,450" value={price} onChange={(e) => setPrice(e.target.value)} /></label>}
          {priceNum ? <label className="block text-sm"><span className="font-bold">What the price includes</span><span className="block text-xs text-estimate-navy/70">e.g. R5 batts 120 m², removal of old insulation, tile lift</span>
            <Textarea rows={3} className="mt-1" value={includes} onChange={(e) => setIncludes(e.target.value)} /></label> : null}
          {quoted === "yes" && <label className="flex items-start gap-3 text-sm" data-owner-agreed><Checkbox className="mt-0.5" checked={ownerAgreed} onCheckedChange={(c) => setOwnerAgreed(c === true)} aria-label={OWNER_AGREED_TICK} /><span>{OWNER_AGREED_TICK}</span></label>}
        </div>
      </Section>
      <Section title="Photos, quotes and job sheets">
        <AttachFiles businessId={draft.businessId} files={files} label="Attached to this job" onAdd={async (f) => { const up = await uploadFiles(f); const r = await addFiles({ data: { importId: draft.id, files: up.map((x) => ({ path: x.path, name: x.name, type: x.type ?? "" })) } }); setFiles(r.files); if (!siteCheck && visitedFromEvidence({ files: r.files })) setSiteCheck("yes"); }} onRemove={async (path) => { const r = await dropFile({ data: { importId: draft.id, path } }); setFiles(r.files); }} />
      </Section>
      {plan && <ElectricianPicker value={plan} onChange={setPlan} approved={el?.approved ?? []} pending={el?.pending ?? []} onAdd={async (d) => { const r = await addElectrician({ data: { businessId: draft.businessId, name: d.name, mobile: d.mobile, email: d.email, business: d.business } }); await refreshEl(); setPlan({ mode: "mine", ...(r.businessId ? { business_id: r.businessId } : { nomination_id: r.nominationId }) }); return { message: inviteResultMessage(r) }; }} />}
      {!draft.permission && <label className="flex items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-owner-consent><Checkbox className="mt-0.5" checked={permission} onCheckedChange={(c) => setPermission(c === true)} aria-label={OWNER_CONTACT_PERMISSION} /><span>{OWNER_CONTACT_PERMISSION}</span></label>}
      <label className="flex items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-owner-fee-awareness><Checkbox className="mt-0.5" checked={feeAwareness} onCheckedChange={(c) => setFeeAwareness(c === true)} aria-label={OWNER_FEE_AWARENESS_TICK} /><span>{OWNER_FEE_AWARENESS_TICK}</span></label>
      <label className="flex items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-existing-below-r2><Checkbox className="mt-0.5" checked={belowR2} onCheckedChange={(c) => setBelowR2(c === true)} aria-label="I confirm the existing insulation, if any, is below R2.0" /><span>I confirm the existing insulation, if any, is below R2.0.</span></label>
      {!permission && <p className="-mt-2 text-xs text-sub">Tick this to add the job.</p>}
      <p className="text-xs text-sub">Nothing is sent when you add the job. Next, Home Insulation Victoria checks eligibility, adds the rebate, AP management fee and $349 electrician PIESA fee, then sends the full quote to the owner for approval. We let you know when it is accepted.</p>
      <Button size="field" className="w-full" disabled={!siteCheck || priceBad || !permission || !feeAwareness || !belowR2 || quotedIntakeProblems({ quoted, area: vals.measured_area_m2, method: vals.measurement_method, amount: priceNum, includes }).length > 0 || !!electricianPlanBlocker(plan)} onClick={async () => { if (!siteCheck) return; const r = await confirm({ importId: draft.id, facts: out(), installer: { quoted, site_check: siteCheck, site_check_date: siteCheck === "yes" && siteDate ? siteDate : null, quoted_price_inc_gst: priceNum, price_includes: includes.trim() || null, contact_permission: permission, fee_awareness: feeAwareness, existing_below_r2: belowR2, owner_agreed: quoted === "yes" && ownerAgreed }, electrician: plan && plan.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" } }, "Job added"); if (r) navigate({ to: "/field/$jobId", params: { jobId: r.jobId } }); }}>Add this job</Button>
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={onBack}>Back</Button><Button variant="ghost" onClick={async () => { await discard({ importId: draft.id }, "Draft discarded"); onBack(); }}>Discard draft</Button></div>
    </div>
  );
}
