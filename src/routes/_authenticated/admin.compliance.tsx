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

export const Route = createFileRoute("/_authenticated/admin/compliance")({
  head: () => ({ meta: [{ title: "Compliance Setup (Admin) – HI VIC Portal" }, { name: "description", content: "Versioned official wording and field definitions used by the electronic forms." }, { property: "og:title", content: "Compliance Setup (Admin) – HI VIC Portal" }, { property: "og:description", content: "Versioned official wording and field definitions used by the electronic forms." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Compliance,
});

const KEYS = [
  ["consumer_rights", "VEU consumer information & consumer rights"],
  ["consumer_declaration", "Consumer declarations & VEEC assignment"],
  ["esc_consent", "Owner consent – ESC information sharing (Reg 23A)"],
  ["installer_declaration", "Installer declaration"],
  ["ap_declaration", "Accredited Person / assignee declaration (if required)"],
] as const;

function Compliance() {
  const list = useServerFn(listComplianceTemplates);
  const { data = [] } = useQuery({ queryKey: ["compliance_templates"], queryFn: () => list() });
  const add = useAction(addComplianceTemplate);
  const approve = useAction(approveComplianceTemplate);
  const [key, setKey] = useState<(typeof KEYS)[number][0]>("consumer_rights");
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const setup = useServerFn(getComplianceSetup);
  const { data: cards = [] } = useQuery({ queryKey: ["compliance_setup"], queryFn: () => setup() });
  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold tracking-tight">Compliance Setup (Admin)</h1>
      <p className="mb-1 rounded-lg bg-accent p-3 text-sm font-medium text-accent-foreground">This page stores the official wording and field definitions used by the electronic forms. Customers and trades do not complete anything here.</p>
      <p className="mb-4 text-sm text-muted-foreground">Each version has two parts: the <b>official wording</b> (shown to the signer, read-only) and optional <b>form fields</b> the electronic form asks for. Approved versions can't be edited – add a new version instead.</p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map((c) => (
        <div key={c.key} className={`rounded-xl border-2 p-3 ${c.ready ? "border-success" : "border-warning"}`}>
          <div className="flex items-center justify-between"><b>{c.label}</b>{c.ready ? <Pill t="good">Ready</Pill> : <Pill t="warn">Not ready</Pill>}</div>
          <p className="mt-1 text-xs text-muted-foreground">{c.message}</p>
        </div>))}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {KEYS.map(([k, label]) => (
            <section key={k} className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 font-semibold">{label}</h2>
              {data.filter((t) => t.template_key === k).length === 0 && <p className="text-sm text-danger">Not configured</p>}
              <ul className="space-y-2">{data.filter((t) => t.template_key === k).map((t) => (
                <li key={t.id} className="rounded border p-2 text-sm">
                  <div className="flex items-center gap-2"><b>{t.version}</b>{t.is_active ? <Pill t="good">Active</Pill> : t.approved ? <Pill>Superseded</Pill> : <Pill t="warn">Draft</Pill>}
                    {!t.approved && <Button size="sm" className="ml-auto" onClick={() => approve({ id: t.id }, "Approved and activated")}>Approve & activate</Button>}</div>
                  {t.source_note && <div className="text-xs text-muted-foreground">{t.source_note}</div>}
                  <details><summary className="cursor-pointer text-xs">Official wording</summary><pre className="whitespace-pre-wrap text-xs">{t.body}</pre></details>
                  {parseFormFields(t.form_fields).length > 0 && <div className="mt-1 text-xs">Form fields: {parseFormFields(t.form_fields).map((f) => `${f.label}${f.required ? "*" : ""}`).join(", ")}</div>}
                </li>))}</ul>
            </section>
          ))}
        </div>
        <div className="space-y-4"><section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Add a version</h2>
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
