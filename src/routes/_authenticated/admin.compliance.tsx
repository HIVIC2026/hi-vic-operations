import { EscConfigSection } from "@/components/portal/intelligence";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { useAction } from "@/hooks/use-me";
import { addComplianceTemplate, approveComplianceTemplate, getComplianceSetup, listComplianceTemplates } from "@/lib/portal.functions";
import { parseFormFields, type FormField } from "@/lib/assignment.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock3, FileSignature, ShieldCheck } from "lucide-react";
import { MittiFormsSection } from "@/components/portal/mitti-forms";

export const Route = createFileRoute("/_authenticated/admin/compliance")({
  validateSearch: (s: Record<string, unknown>): { key?: string } => (typeof s["key"] === "string" && KEYS.some(([k]) => k === s["key"]) ? { key: s["key"] } : {}),
  head: () => ({ meta: [{ title: "Compliance Setup (Admin) – Home Insulation Victoria Portal" }, { name: "description", content: "Versioned official wording and field definitions used by the electronic forms." }, { property: "og:title", content: "Compliance Setup (Admin) – Home Insulation Victoria Portal" }, { property: "og:description", content: "Versioned official wording and field definitions used by the electronic forms." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Compliance,
});

import { COMPLIANCE_TEMPLATE_KEYS as KEYS, ACTIVITY_48_FORMS } from "@/lib/template-catalog";

function Compliance() {
  const list = useServerFn(listComplianceTemplates);
  const { data = [], error: templatesError, isPending: templatesPending, refetch: refetchTemplates } = useQuery({ queryKey: ["compliance_templates"], queryFn: () => list() });
  const add = useAction(addComplianceTemplate);
  const approve = useAction(approveComplianceTemplate);
  const { key: initialKey } = Route.useSearch();
  const [key, setKey] = useState<(typeof KEYS)[number][0]>((initialKey as (typeof KEYS)[number][0] | undefined) ?? "consumer_rights");
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const setup = useServerFn(getComplianceSetup);
  const { data: cards = [], error: setupError, isPending: setupPending, refetch: refetchSetup } = useQuery({ queryKey: ["compliance_setup"], queryFn: () => setup() });
  return (
    <AppShell wide>
      <p className="text-xs font-bold uppercase text-primary">Activity 48 control centre</p>
      <h1 className="mt-1 text-4xl font-bold">COMPLIANCE</h1>
      <p className="mb-1 mt-3 rounded-md bg-workspace-sun p-3 text-sm font-medium text-accent-foreground">Every mandatory form, its purpose, signer, timing and blocking point is visible here. Customers and trades complete the approved electronic form—not this office screen.</p>
      <p className="mb-2 text-sm text-muted-foreground">These are four separate events in order: quote acceptance (commercial only) → ESC owner consent once the installation date is booked → installer declaration after installation → final VEEC assignment signed installer → AP → customer during AP review.</p>
      <p className="mb-4 text-sm text-muted-foreground">Each version has two parts: the <b>official wording</b> (shown to the signer, read-only) and optional <b>form fields</b> the electronic form asks for. Approved versions can't be edited – add a new version instead.</p>
      <section className="my-6"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Activity 48 form register</h2></div><div className="grid gap-3 lg:grid-cols-2">{ACTIVITY_48_FORMS.map((form, index) => (
        <article key={form.name} className="rounded-md border bg-card p-4 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-workspace-blush font-bold">{index + 1}</span><div><h3 className="font-bold">{form.name}</h3><p className="mt-1 text-sm text-muted-foreground">{form.purpose}</p><dl className="mt-3 grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-xs"><dt className="font-bold">Signed by</dt><dd>{form.signer}</dd><dt className="font-bold">When</dt><dd>{form.timing}</dd><dt className="font-bold">Blocks</dt><dd>{form.blocks}</dd><dt className="font-bold">Source</dt><dd>{form.source}{"pdf" in form ? <> · <a className="font-semibold text-primary underline" href={form.pdf} target="_blank" rel="noreferrer">Open official form</a></> : null}</dd><dt className="font-bold">Retention</dt><dd>Permanent job record; keep Activity 48 records for six years after registration.</dd></dl></div></div></article>
      ))}</div></section>
      <MittiFormsSection />
      {setupError ? <p role="alert" className="mb-4 rounded border border-danger p-3 text-sm text-danger">Compliance readiness could not be checked. <Button size="sm" variant="outline" onClick={() => void refetchSetup()}>Try again</Button></p> : setupPending ? <p role="status" className="mb-4 text-sm text-muted-foreground">Checking compliance readiness…</p> : <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map((c) => (
        <div key={c.key} className={`rounded-xl border-2 p-3 ${c.ready ? "border-success" : "border-warning"}`}>
          <div className="flex items-center justify-between"><b>{c.label}</b>{c.ready ? <Pill t="good"><CheckCircle2 className="mr-1 h-3 w-3" /> Ready</Pill> : <Pill t="warn"><Clock3 className="mr-1 h-3 w-3" /> Not ready</Pill>}</div>
          <p className="mt-1 text-xs text-muted-foreground">{c.message}</p>
        </div>))}</div>}
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4 break-words">
          {templatesError && <p role="alert" className="rounded border border-danger p-3 text-sm text-danger">Template versions and approvals could not load. <Button size="sm" variant="outline" onClick={() => void refetchTemplates()}>Try again</Button></p>}
          {templatesPending && <p role="status" className="text-sm text-muted-foreground">Loading template versions…</p>}
          {KEYS.map(([k, label]) => (
            <section key={k} id={`tpl-${k}`} className="scroll-mt-24 rounded-xl border bg-card p-4">
              <h2 className="mb-2 font-semibold">{label}</h2>
              {!templatesError && !templatesPending && data.filter((t) => t.template_key === k).length === 0 && <p className="text-sm text-danger">No version recorded</p>}
              {k === "installer_declaration" && <p className="mb-2 text-xs text-muted-foreground">The AP must approve the wording and evidence required to confirm completed work. PIISA Part 8 records the installer's declaration before installation.</p>}
              {k === "consumer_declaration" && <p className="mb-2 text-xs text-muted-foreground">Before approval, the AP checks the current official Activity 48 assignment source, required fields, final facts and signature order against this version.</p>}
              <ul className="space-y-2">{(!templatesError && !templatesPending ? data : []).filter((t) => t.template_key === k).map((t) => (
                <li key={t.id} className="rounded border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><b>{t.version}</b>{t.approved && t.is_active ? <Pill t="good">Approved and active</Pill> : t.approved ? <Pill>Superseded</Pill> : <Pill t="warn">{t.is_active ? "Selected draft · not approved" : "Draft · not approved"}</Pill>}
                    {!t.approved && <Button size="sm" className="ml-auto" onClick={() => approve({ id: t.id }, "Approved and activated")}>Approve & activate</Button>}</div>
                  {t.source_note && <div className="text-xs text-muted-foreground">{t.source_note}</div>}
                  <details className="min-w-0"><summary className="cursor-pointer text-xs">Official wording</summary><pre className="whitespace-pre-wrap break-words text-xs">{t.body}</pre></details>
                  {parseFormFields(t.form_fields).length > 0 && <div className="mt-1 text-xs">Form fields: {parseFormFields(t.form_fields).map((f) => `${f.label}${f.required ? "*" : ""}`).join(", ")}</div>}
                </li>))}</ul>
            </section>
          ))}
        </div>
        <div className="min-w-0 space-y-4"><section className="space-y-3 rounded-xl border bg-card p-4">
           <h2 className="flex items-center gap-2 font-semibold"><FileSignature className="h-4 w-4 text-primary" />Add a version</h2>
          <select className="h-10 w-full rounded border bg-background px-2" value={key} onChange={(e) => setKey(e.target.value as typeof key)}>{KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Input placeholder="Version (e.g. ESC template date)" value={version} onChange={(e) => setVersion(e.target.value)} />
          <Input placeholder="Source (document name / URL)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="text-sm font-medium">1. Official wording (static text shown to the signer)</div>
          <Textarea rows={12} placeholder="Exact official wording" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="text-sm font-medium">2. Form fields the electronic form asks for (optional)</div>
          <p className="text-xs text-muted-foreground">Only for information that is genuinely new at signing, e.g. product batch number. Known details (names, address, product, price, licence) are filled in automatically.</p>
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
              <Input placeholder="Field label" value={f.label} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, label: e.target.value, key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field" } : x))} />
              <select className="h-10 rounded border bg-background px-2 text-sm" value={f.type} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, type: e.target.value as FormField["type"] } : x))}>{["text", "number", "date", "checkbox"].map((t) => <option key={t}>{t}</option>)}</select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.required} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} /> Required</label>
              <Button variant="ghost" size="sm" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</Button>
            </div>))}
          <Button variant="outline" size="sm" onClick={() => setFields([...fields, { key: "", label: "", type: "text", required: true }])}>Add form field</Button>
          <Button disabled={!version.trim() || body.trim().length < 20} onClick={async () => { await add({ template_key: key, version, body, source_note: note || undefined, required: true, form_fields: fields.filter((f) => f.label.trim()) }, "Draft saved"); setBody(""); setVersion(""); setNote(""); setFields([]); }}>Save draft</Button>
        </section>
        <EscConfigSection /></div>
      </div>
    </AppShell>
  );
}
