import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, MailCheck } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Pill } from "@/components/portal/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-me";
import { approveCustomerCommunicationDraft, listCustomerCommunicationTemplates, saveCustomerCommunicationDraft } from "@/lib/customer-communications.functions";

const CATALOG = [
  ["likely_estimate", "Likely eligible estimate", "After the official Gate 1 result; includes estimate and free Ready Check action."],
  ["onsite_estimate", "Needs onsite confirmation estimate", "Explains what the installer must confirm during the free Ready Check."],
  ["ineligible_result", "Ineligible result", "No quote or Ready Check action; offers result review only."],
  ["estimate_unopened_3d", "Estimate not opened reminder", "Manual-first follow-up after three days."],
  ["estimate_engaged_no_booking_3d", "Ready Check reminder", "Manual-first follow-up when the estimate was viewed but no Ready Check was requested."],
  ["estimate_second_reminder_7d", "Final estimate reminder", "Manual-first final reminder after seven days."],
  ["area_unavailable", "No partner in service area", "Used only after both REC and installer coverage are conclusively checked."],
] as const;
type Key = (typeof CATALOG)[number][0];

export const Route = createFileRoute("/_authenticated/admin/communications")({
  head: () => ({ meta: [{ title: "Customer Communications – HI VIC Portal" }, { name: "description", content: "Review every customer email and controlled communication draft." }, { property: "og:title", content: "Customer Communications – HI VIC Portal" }, { property: "og:description", content: "Review every customer email and controlled communication draft." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: CustomerCommunications,
});

function CustomerCommunications() {
  const list = useServerFn(listCustomerCommunicationTemplates);
  const { data = [], refetch } = useQuery({ queryKey: ["customer-communication-templates"], queryFn: () => list() });
  const save = useAction(saveCustomerCommunicationDraft);
  const approve = useAction(approveCustomerCommunicationDraft);
  const [selected, setSelected] = useState<Key>("likely_estimate");
  const [version, setVersion] = useState("draft-1");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const drafts = data.filter((row) => row.template_key === selected);
  const chosen = CATALOG.find(([key]) => key === selected);
  return <AppShell wide>
    <p className="text-xs font-bold uppercase text-primary">Controlled customer content</p>
    <h1 className="mt-1 text-4xl font-bold">CUSTOMER COMMUNICATIONS</h1>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Personally inspect every customer email here. Delivery remains locked; approving a review draft does not send it or replace regulated wording automatically.</p>
    <div className="mt-6 grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-2">{CATALOG.map(([key, label, purpose], index) => {
        const versions = data.filter((row) => row.template_key === key);
        const approved = versions.find((row) => row.status === "approved");
        return <button type="button" key={key} onClick={() => setSelected(key)} className={`w-full rounded-md border p-4 text-left transition ${selected === key ? "border-workspace-blush-strong bg-workspace-blush shadow-sm" : "bg-card hover:border-primary"}`}><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-workspace-sun text-sm font-bold">{index + 1}</span><div><div className="font-bold">{label}</div><p className="mt-1 text-xs text-muted-foreground">{purpose}</p><div className="mt-2"><Pill t={approved ? "good" : "warn"}>{approved ? `Reviewed · ${approved.version}` : "Review required"}</Pill></div></div></div></button>;
      })}</aside>
      <section className="space-y-5">
        <div className="rounded-md border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{chosen?.[1]}</h2><p className="mt-1 text-sm text-muted-foreground">{chosen?.[2]}</p></div><Button asChild variant="outline"><a href="/step3-email-preview" target="_blank" rel="noopener">Open canonical previews <ExternalLink /></a></Button></div></div>
        <section className="rounded-md border bg-card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><MailCheck className="h-5 w-5 text-primary" />Create review draft</h2><p className="mt-1 text-xs text-muted-foreground">Copy the approved proposal here for review. Regulated forms stay versioned separately under Compliance.</p><div className="mt-4 grid gap-3"><div><Label>Version</Label><Input value={version} onChange={(event) => setVersion(event.target.value)} /></div><div><Label>Subject</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div><Label>Customer wording</Label><Textarea rows={14} value={body} onChange={(event) => setBody(event.target.value)} /></div><div><Label>Review note or source</Label><Input value={note} onChange={(event) => setNote(event.target.value)} /></div><Button disabled={subject.trim().length < 3 || body.trim().length < 10 || !version.trim()} onClick={async () => { await save({ templateKey: selected, version, subject, bodyMarkdown: body, sourceNote: note || undefined }, "Review draft saved"); setSubject(""); setBody(""); setNote(""); setVersion("draft-1"); await refetch(); }}>Save review draft</Button></div></section>
        <section className="rounded-md border bg-card p-5"><h2 className="text-lg font-bold">Version history</h2>{drafts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No personal review version saved yet.</p> : <div className="mt-3 space-y-3">{drafts.map((row) => <article key={row.id} className="rounded-md border p-4"><div className="flex flex-wrap items-center gap-2"><b>{row.version}</b><Pill t={row.status === "approved" ? "good" : row.status === "draft" ? "warn" : "neutral"}>{row.status}</Pill>{row.status === "draft" && <Button className="ml-auto" size="sm" onClick={async () => { await approve({ id: row.id }, "Review version approved"); await refetch(); }}>Approve review version</Button>}</div><p className="mt-2 text-sm font-semibold">{row.subject}</p><pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">{row.body_markdown}</pre>{row.source_note && <p className="mt-2 text-xs text-muted-foreground">Note: {row.source_note}</p>}</article>)}</div>}</section>
      </section>
    </div>
  </AppShell>;
}