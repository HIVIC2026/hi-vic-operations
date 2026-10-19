import { useMe } from "@/hooks/use-me";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ExternalLink, MailCheck } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { approveCustomerCommunicationDraft, listCustomerCommunicationTemplates, saveCustomerCommunicationDraft } from "@/lib/customer-communications.functions";
import { PARTNER_TEMPLATES, previewPartnerTemplate, renderPartnerTemplate, type PartnerTemplate } from "@/lib/partner-templates";

import { CUSTOMER_COMMUNICATION_CATALOG, isRetiredCommunicationKey } from "@/lib/template-catalog";

// P1-S77: superseded enquiry emails are not listed; Jo's approved homeowner emails are managed in Templates › Email.
const CATALOG = CUSTOMER_COMMUNICATION_CATALOG.filter(([k]) => !isRetiredCommunicationKey(k));
type Key = (typeof CATALOG)[number][0];

export const Route = createFileRoute("/_authenticated/admin/communications")({
  validateSearch: (s: Record<string, unknown>): { key?: string } => (typeof s["key"] === "string" && CATALOG.some(([k]) => k === s["key"]) ? { key: s["key"] } : {}),
  head: () => ({ meta: [{ title: "Customer Communications – Home Insulation Victoria Portal" }, { name: "description", content: "Review every customer email and controlled communication draft." }, { property: "og:title", content: "Customer Communications – Home Insulation Victoria Portal" }, { property: "og:description", content: "Review every customer email and controlled communication draft." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: CustomerCommunications,
});

function CustomerCommunications() {
  const list = useServerFn(listCustomerCommunicationTemplates);
  const { data = [], refetch } = useQuery({ queryKey: ["customer-communication-templates"], queryFn: () => list() });
  const save = useAction(saveCustomerCommunicationDraft);
  const approve = useAction(approveCustomerCommunicationDraft);
  const { key: initialKey } = Route.useSearch();
  const [selected, setSelected] = useState<Key>((initialKey as Key | undefined) ?? "estimate_unopened_3d");
  const [version, setVersion] = useState("draft-1");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const drafts = data.filter((row) => row.template_key === selected);
  const chosen = CATALOG.find(([key]) => key === selected);
  return <AppShell wide>
    <p className="text-xs font-bold uppercase text-primary">Controlled customer content</p>
    <h1 className="mt-1 text-4xl font-bold">CUSTOMER COMMUNICATIONS</h1>
    <a href="#partner-invitation-templates" className="mt-2 inline-block text-sm font-semibold text-primary underline">Partner invitation templates ↓</a>
    <p className="mt-2 max-w-3xl rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"><b>Jo’s approved homeowner enquiry emails (templates 1–8) are managed only in <a href="/admin/templates?cat=email" className="font-semibold text-primary underline">Templates › Email</a>.</b> The older enquiry emails they replaced are no longer listed here.</p>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Personally inspect every customer email here. Delivery remains locked; approving a review draft does not send it or replace regulated wording automatically.</p>
    <div className="mt-6 grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-2">{CATALOG.map(([key, label, purpose, stage, forms], index) => {
        const versions = data.filter((row) => row.template_key === key);
        const approved = versions.find((row) => row.status === "approved");
        return <button type="button" key={key} onClick={() => setSelected(key)} className={`w-full rounded-md border p-4 text-left transition ${selected === key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card hover:border-primary"}`}><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-workspace-sun text-sm font-bold">{index + 1}</span><div><div className="text-[11px] font-bold uppercase text-primary">{stage}</div><div className="font-bold">{label}</div><p className="mt-1 text-xs text-muted-foreground">{purpose}</p><p className="mt-1 text-xs"><b>Forms attached:</b> {forms}</p><div className="mt-2"><Pill t={approved ? "good" : "warn"}>{approved ? `Reviewed · ${approved.version}` : "Review required"}</Pill></div></div></div></button>;
      })}</aside>
      <section className="space-y-5">
        <div className="rounded-md border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{chosen?.[1]}</h2><p className="mt-1 text-sm text-muted-foreground">{chosen?.[2]}</p></div>{chosen?.[5] ? <Button asChild variant="outline"><a href="/admin/templates?cat=email" target="_blank" rel="noopener">Open in Templates <ExternalLink /></a></Button> : <Pill t="warn">No preview yet – wording needs drafting & your approval</Pill>}</div><div className="mt-4 rounded-md border border-workspace-blush-strong bg-workspace-blush p-3 text-sm"><b>Mandatory forms attached at this point ({chosen?.[3]}):</b> {chosen?.[4]}</div></div>
        <section className="rounded-md border bg-card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><MailCheck className="h-5 w-5 text-primary" />Create review draft</h2><p className="mt-1 text-xs text-muted-foreground">Copy the approved proposal here for review. Regulated forms stay versioned separately under Compliance.</p><div className="mt-4 grid gap-3"><div><Label>Version</Label><Input value={version} onChange={(event) => setVersion(event.target.value)} /></div><div><Label>Subject</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div><Label>Customer wording</Label><Textarea rows={14} value={body} onChange={(event) => setBody(event.target.value)} /></div><div><Label>Review note or source</Label><Input value={note} onChange={(event) => setNote(event.target.value)} /></div><Button disabled={subject.trim().length < 3 || body.trim().length < 10 || !version.trim()} onClick={async () => { await save({ templateKey: selected, version, subject, bodyMarkdown: body, sourceNote: note || undefined }, "Review draft saved"); setSubject(""); setBody(""); setNote(""); setVersion("draft-1"); await refetch(); }}>Save review draft</Button></div></section>
        <section className="rounded-md border bg-card p-5"><h2 className="text-lg font-bold">Version history</h2>{drafts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No personal review version saved yet.</p> : <div className="mt-3 space-y-3">{drafts.map((row) => <article key={row.id} className="rounded-md border p-4"><div className="flex flex-wrap items-center gap-2"><b>{row.version}</b><Pill t={row.status === "approved" ? "good" : row.status === "draft" ? "warn" : "neutral"}>{row.status}</Pill>{row.status === "draft" && <Button className="ml-auto" size="sm" onClick={async () => { await approve({ id: row.id }, "Review version approved"); await refetch(); }}>Approve review version</Button>}</div><p className="mt-2 text-sm font-semibold">{row.subject}</p><pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">{row.body_markdown}</pre>{row.source_note && <p className="mt-2 text-xs text-muted-foreground">Note: {row.source_note}</p>}</article>)}</div>}</section>
      </section>
    </div>
    <OfficeOnlyPartnerTemplates />
  </AppShell>;
}

function OfficeOnlyPartnerTemplates() {
  const { data: me } = useMe();
  return (me?.roles ?? []).includes("admin") ? <PartnerTemplates /> : null;
}

function PartnerTemplates() {
  const [open, setOpen] = useState<PartnerTemplate | null>(null);
  const [copied, setCopied] = useState("");
  return <section id="partner-invitation-templates" className="mt-10 scroll-mt-20 rounded-md border bg-card p-5">
    <h2 className="text-lg font-bold">Partner invitation templates</h2>
    <p className="mt-1 text-sm text-muted-foreground">Reusable, office-approved invitations. Preview, copy the subject or download the HTML template (logo embedded for standalone viewing; email-client delivery not yet tested). Nothing here sends email.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {PARTNER_TEMPLATES.map((t) => <article key={t.key} className="min-w-0 rounded-md border p-4">
        <div className="font-bold">{t.label}</div>
        <p className="mt-1 text-xs text-muted-foreground">Subject: {t.subject}</p>
        <p className="mt-1 text-xs text-muted-foreground">Registration link: <a className="break-all text-primary underline" href={t.registrationUrl} target="_blank" rel="noopener">{t.registrationUrl}</a></p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(open?.key === t.key ? null : t)}>{open?.key === t.key ? "Close preview" : "Preview"}</Button>
          <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(t.subject); setCopied(t.key); }}>{copied === t.key ? "Copied" : "Copy subject"}</Button>
          <DownloadTemplate t={t} />
        </div>
      </article>)}
    </div>
    {open && <TemplatePreview t={open} />}
  </section>;
}

function TemplatePreview({ t }: { t: PartnerTemplate }) {
  return <div className="mt-4 overflow-hidden rounded-md border"><iframe title={t.label} srcDoc={previewPartnerTemplate(t)} className="h-[560px] w-full bg-white" sandbox="allow-popups allow-popups-to-escape-sandbox" /></div>;
}

function DownloadTemplate({ t }: { t: PartnerTemplate }) {
  return <Button size="sm" variant="outline" onClick={() => {
    const blob = new Blob([renderPartnerTemplate(t)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = t.fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }}>Download HTML template</Button>;
}
