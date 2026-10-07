import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell } from "@/components/trade/TradeShell";
import { Section } from "@/components/portal/panels";
import { useAction } from "@/hooks/use-me";
import { confirmImport, createImport, discardImport, getPartnerProfile, partnerUploadUrl } from "@/lib/pilot.functions";
import { parseCsv, reviewItems, type Extracted, type ImportField } from "@/lib/pilot.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/partner/import")({
  head: () => ({ meta: [{ title: "Import Existing Job – Home Insulation Victoria Partner Portal" }, { name: "description", content: "Bring an existing customer job into Home Insulation Victoria without retyping it." }, { property: "og:title", content: "Import Existing Job – Home Insulation Victoria Partner Portal" }, { property: "og:description", content: "Bring an existing customer job into Home Insulation Victoria without retyping it." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ImportPage,
});

type Draft = { id: string; extracted: Extracted };

function ImportPage() {
  const loadProfile = useServerFn(getPartnerProfile);
  const { data: profile } = useQuery({ queryKey: ["partner-profile", "mine"], queryFn: () => loadProfile({ data: {} }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const businessId = (profile?.business as { id?: string } | undefined)?.id;
  return (
    <TradeShell installer>
      <h1 className="font-display text-3xl font-extrabold">Add one job</h1>
      <p className="text-sm text-estimate-navy/70">Paste, upload or export what you already have. We'll pull out the details and you just confirm them.</p>
      {!businessId ? <p className="text-sm text-muted-foreground">Loading…</p> : draft ? <Review draft={draft} onBack={() => setDraft(null)} /> : <Source businessId={businessId} onDraft={setDraft} />}
    </TradeShell>
  );
}

function Source({ businessId, onDraft }: { businessId: string; onDraft: (d: Draft) => void }) {
  const create = useAction(createImport);
  const upload = useServerFn(partnerUploadUrl);
  const [text, setText] = useState("");
  const [csv, setCsv] = useState("");
  const [row, setRow] = useState(0);
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [system, setSystem] = useState<"easymate" | "manual_import" | "email">("easymate");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const rows = csv ? parseCsv(csv) : [];
  const go = async () => {
    setBusy(true);
    try {
      const uploaded: { path: string; name: string; type: string }[] = [];
      for (const f of files) {
        const { path, token } = await upload({ data: { businessId, folder: "imports", fileName: f.name } });
        const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, f, { contentType: f.type });
        if (!error) uploaded.push({ path, name: f.name, type: f.type });
      }
      const r = await create({ businessId, sourceSystem: system, ...(text ? { text } : {}), ...(csv ? { csv, csvRow: row } : {}), ...(url ? { sourceUrl: url } : {}), ...(ref ? { externalRefs: { [system === "easymate" ? "easymate_ref" : "reference"]: ref } } : {}), files: uploaded });
      if (r) onDraft(r);
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Section title="Where is it from?">
        <div className="grid grid-cols-3 gap-2">{([["easymate", "EasyMate"], ["email", "Forwarded email"], ["manual_import", "Other"]] as const).map(([k, l]) => <Button key={k} size="field" variant={system === k ? "default" : "outline"} onClick={() => setSystem(k)}>{l}</Button>)}</div>
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
        {rows.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{rows.length} row(s) found – one job per import.</p>}
      </Section>
      <Section title="Attach quote, job sheet, measure-up or photos">
        <Input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <p className="mt-1 text-xs text-muted-foreground">Files are kept with the job as source documents. Details inside PDFs and photos aren't read automatically yet – confirm them on the next screen.</p>
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
  const out = () => Object.fromEntries(items.map((i) => {
    const v = vals[i.key]?.trim() ?? "";
    if (!v) return [i.key, null];
    if (numeric.includes(i.key)) return [i.key, Number(v)];
    if (i.key === "removal_required") return [i.key, /^(y|yes|true)$/i.test(v)];
    return [i.key, v];
  }));
  const row = (i: (typeof items)[number]) => (
    <label key={i.key} className="block text-sm">
      <span className="text-muted-foreground">{i.label}{i.required ? " *" : ""}{i.confidence === "uncertain" && <span className="ml-1 text-warning">please check</span>}</span>
      <Input className={`h-12 ${i.flagged ? "border-warning" : ""}`} value={vals[i.key] ?? ""} onChange={(e) => setVals({ ...vals, [i.key]: e.target.value })} />
    </label>
  );
  return (
    <div className="space-y-4">
      <Section title="We found these details – confirm"><div className="grid gap-2 sm:grid-cols-2">{found.length ? found.map(row) : <p className="text-sm text-muted-foreground">Nothing found automatically.</p>}</div></Section>
      <Section title="Check or fill in"><div className="grid gap-2 sm:grid-cols-2">{check.map(row)}</div></Section>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Other optional details</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{rest.map(row)}</div></details>
      {draft.extracted.quote_lines?.length ? <Section title="Existing quote lines (kept as source context)">{draft.extracted.quote_lines.map((l, i) => <div key={i} className="text-sm">{l.description} – ${l.amount}</div>)}</Section> : null}
      <p className="text-xs text-muted-foreground">A measured area you enter becomes your measure-up for Home Insulation Victoria to review. If it's accepted, the electrician only does the electrical check.</p>
      <Button size="field" className="w-full" onClick={async () => { const r = await confirm({ importId: draft.id, facts: out() }, "Home Insulation Victoria job created"); if (r) navigate({ to: "/field/$jobId", params: { jobId: r.jobId } }); }}>Confirm & create Home Insulation Victoria job</Button>
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={onBack}>Back</Button><Button variant="ghost" onClick={async () => { await discard({ importId: draft.id }, "Draft discarded"); onBack(); }}>Discard draft</Button></div>
    </div>
  );
}
