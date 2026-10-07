import { OWNER_AGREED_TICK } from "@/lib/owner-confirm.core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TradeShell } from "@/components/trade/TradeShell";
import { Button, Section } from "@/components/trade/trade-ui";
import { useAction } from "@/hooks/use-me";
import { addImportFiles, confirmImport, createImport, discardImport, getPartnerProfile, removeImportFile } from "@/lib/pilot.functions";
import { addBulkElectrician, bulkElectricianChoices } from "@/lib/bulk-import.functions";
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

type Draft = { id: string; extracted: Extracted; files: AttachedFile[]; businessId: string };

function ImportPage() {
  const loadProfile = useServerFn(getPartnerProfile);
  const { data: profile } = useQuery({ queryKey: ["partner-profile", "mine"], queryFn: () => loadProfile({ data: {} }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const businessId = (profile?.business as { id?: string } | undefined)?.id;
  return (
    <TradeShell installer>
      <h1 className="font-display text-[26px] font-bold leading-tight">Add one job</h1>
      <p className="text-sm text-sub">Paste or attach what you have. You just check the details.</p>
      {!businessId ? <p className="text-sm text-estimate-navy/70">Loading…</p> : draft ? <Review key={draft.id} draft={draft} onBack={() => setDraft(null)} /> : <Source businessId={businessId} onDraft={setDraft} />}
    </TradeShell>
  );
}

function Source({ businessId, onDraft }: { businessId: string; onDraft: (d: Draft) => void }) {
  const create = useAction(createImport);
  const uploadFiles = useUploadFiles(businessId);
  const [text, setText] = useState("");
  const [csv, setCsv] = useState("");
  const [row, setRow] = useState(0);
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [system, setSystem] = useState<"easymate" | "manual_import" | "email">("easymate");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const rows = csv ? parseCsv(csv) : [];
  const go = async () => {
    setBusy(true);
    try {
      const uploaded = files.map((f) => ({ path: f.path, name: f.name, type: f.type ?? "" }));
      const r = await create({ businessId, sourceSystem: system, ...(text ? { text } : {}), ...(csv ? { csv, csvRow: row } : {}), ...(url ? { sourceUrl: url } : {}), ...(ref ? { externalRefs: { [system === "easymate" ? "easymate_ref" : "reference"]: ref } } : {}), files: uploaded });
      if (r) onDraft({ ...r, files, businessId });
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Section title="Where is it from?">
        <div className="grid grid-cols-3 gap-2 [&_button]:px-2">{([["easymate", "EasyMate"], ["email", "Email"], ["manual_import", "Other"]] as const).map(([k, l]) => <Button key={k} size="field" variant={system === k ? "default" : "outline"} onClick={() => setSystem(k)}>{l}</Button>)}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Input className="h-12" placeholder="Your job / lead reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Input className="h-12" placeholder="Link (ERA / job link – saved as a reference only)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      </Section>
      <Section title="Paste job details or an email">
        <Textarea rows={8} placeholder={"Customer: Jane Smith\nEmail: jane@example.com\nPhone: 0400 000 000\nAddress: 12 Example St, Brunswick VIC 3056\nCeiling area: 120 m2\nRemoval: yes\nProduct: R5.0 batts"} value={text} onChange={(e) => setText(e.target.value)} />
      </Section>
      <Section title="Or upload a CSV export">
        <Input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; setCsv(f ? await f.text() : ""); setRow(0); }} />
        {rows.length > 1 && <select className="mt-2 h-12 w-full rounded border bg-background px-2" value={row} onChange={(e) => setRow(Number(e.target.value))}>{rows.map((r, i) => <option key={i} value={i}>{Object.values(r).slice(0, 3).join(" · ")}</option>)}</select>}
        {rows.length > 0 && <p className="mt-1 text-xs text-estimate-navy/70">{rows.length} row(s) found – one job per import.</p>}
      </Section>
      <Section title="Photos, quotes and job sheets">
        <AttachFiles businessId={businessId} files={files} label="Attach to this job" onAdd={async (f) => { const up = await uploadFiles(f); setFiles((o) => [...o, ...up]); }} onRemove={async (path) => setFiles((o) => o.filter((x) => x.path !== path))} />
      </Section>
      <Button size="field" className="w-full" disabled={busy || (!text && !csv && !files.length && !ref)} onClick={go}>{busy ? "Reading…" : "Continue"}</Button>
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
  const [permission, setPermission] = useState(false);
  const [ownerAgreed, setOwnerAgreed] = useState(false);
  const [siteDate, setSiteDate] = useState("");
  const [price, setPrice] = useState("");
  const [quoted, setQuoted] = useState<"yes" | "no" | null>(null); // never preset (Jo, 7 Oct)
  const [includes, setIncludes] = useState("");
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
      <Section title="We found these details – confirm"><div className="grid gap-2 sm:grid-cols-2">{found.length ? found.map(row) : <p className="text-sm text-estimate-navy/70">Nothing found automatically.</p>}</div></Section>
      <Section title="Check or fill in"><div className="grid gap-2 sm:grid-cols-2">{check.map(row)}</div></Section>
      <details className="rounded-[22px] bg-card p-5 shadow-sm"><summary className="cursor-pointer text-sm font-medium">More details (if you have them)</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{rest.map(row)}</div></details>
      <Section title="Your price and site check">
        <div className="space-y-3" data-installer-facts>
          <div>
            <p className="text-sm font-bold">Have you already done the site check / measure-up?{!siteCheck && <span className="ml-1 text-destructive">Please answer</span>}</p>
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
      <label className="flex items-start gap-3 rounded-[18px] border border-line bg-paper p-4 text-sm" data-owner-consent><Checkbox className="mt-0.5" checked={permission} onCheckedChange={(c) => setPermission(c === true)} aria-label={OWNER_CONTACT_PERMISSION} /><span>{OWNER_CONTACT_PERMISSION}</span></label>
      {!permission && <p className="-mt-2 text-xs text-sub">Tick this to add the job.</p>}
      <p className="text-xs text-sub">Nothing is sent to the owner when you add the job.</p>
      <Button size="field" className="w-full" disabled={!siteCheck || priceBad || !permission || (quoted === "yes" && !priceNum) || !!electricianPlanBlocker(plan)} onClick={async () => { const r = await confirm({ importId: draft.id, facts: out(), installer: { quoted, site_check: siteCheck!, site_check_date: siteCheck === "yes" && siteDate ? siteDate : null, quoted_price_inc_gst: priceNum, price_includes: includes.trim() || null, contact_permission: permission, owner_agreed: quoted === "yes" && ownerAgreed }, electrician: plan && plan.mode === "mine" ? { mode: "mine", business_id: plan.business_id ?? null, nomination_id: plan.nomination_id ?? null } : { mode: "hivic" } }, "Job added"); if (r) navigate({ to: "/field/$jobId", params: { jobId: r.jobId } }); }}>Add this job</Button>
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={onBack}>Back</Button><Button variant="ghost" onClick={async () => { await discard({ importId: draft.id }, "Draft discarded"); onBack(); }}>Discard draft</Button></div>
    </div>
  );
}
