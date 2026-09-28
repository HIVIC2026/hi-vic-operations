import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { useAction } from "@/hooks/use-me";
import { addComplianceTemplate, approveComplianceTemplate, listComplianceTemplates } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin/compliance")({
  head: () => ({ meta: [{ title: "Compliance wording – HI VIC Portal" }, { name: "description", content: "Versioned official wording for customer acceptance and VEEC assignment." }, { property: "og:title", content: "Compliance wording – HI VIC Portal" }, { property: "og:description", content: "Versioned official wording for customer acceptance and VEEC assignment." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Compliance,
});

const KEYS = [
  ["consumer_rights", "VEU consumer information & consumer rights"],
  ["consumer_declaration", "Consumer declarations & VEEC assignment"],
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
  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold tracking-tight">Compliance wording</h1>
      <p className="mb-4 text-sm text-muted-foreground">Paste the exact current official Activity 48 wording. Signing stays blocked until each required item is approved. Approved versions can't be edited – add a new version instead.</p>
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
                  <details><summary className="cursor-pointer text-xs">Wording</summary><pre className="whitespace-pre-wrap text-xs">{t.body}</pre></details>
                </li>))}</ul>
            </section>
          ))}
        </div>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Add a version</h2>
          <select className="h-10 w-full rounded border bg-background px-2" value={key} onChange={(e) => setKey(e.target.value as typeof key)}>{KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Input placeholder="Version (e.g. ESC template date)" value={version} onChange={(e) => setVersion(e.target.value)} />
          <Input placeholder="Source (document name / URL)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Textarea rows={16} placeholder="Exact official wording" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button disabled={!version.trim() || body.trim().length < 20} onClick={async () => { await add({ template_key: key, version, body, source_note: note || undefined, required: true }, "Draft saved"); setBody(""); setVersion(""); setNote(""); }}>Save draft</Button>
        </section>
      </div>
    </AppShell>
  );
}
