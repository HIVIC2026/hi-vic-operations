import { useMemo, useState } from "react";
import { nextStep } from "@/lib/nextstep.core";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Lock, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { Pill } from "@/components/portal/badges";
import { Section } from "@/components/portal/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-me";
import { exportJobPackFn, getJobFile, getJobFileHeader, logCommunication, openJobDocument } from "@/lib/jobfile.functions";
import { DOC_CATEGORIES, inCategory, searchItems, type DocCategory, type DocItem, type TimelineFilter } from "@/lib/jobfile.core";
import { fmtDate } from "@/lib/workflow";
import { openFileViewer } from "@/components/portal/file-viewer";

type JobFile = Awaited<ReturnType<typeof import("@/lib/jobfile.server").buildJobFile>>;
type JobRow = import("@/integrations/supabase/types").Database["public"]["Views"]["job_overview"]["Row"];
const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" }) : "—");

export function useJobFile(jobId: string) {
  const fn = useServerFn(getJobFile);
  return useQuery({ queryKey: ["jobfile", jobId], queryFn: () => fn({ data: { jobId } }) as Promise<JobFile>, staleTime: 30_000 });
}

const STATUS_TONE: Record<string, "good" | "info" | "warn" | "bad" | "neutral" | "brand"> = {
  signed: "good", final: "good", verified: "good", current: "info", draft: "warn", outstanding: "warn", rejected: "bad", superseded: "neutral", historical: "neutral",
};

export function JobFileHeader({ jobId, job }: { jobId: string; job: JobRow }) {
  const fn = useServerFn(getJobFileHeader);
  const { data: h } = useQuery({ queryKey: ["jobfile-header", jobId], queryFn: () => fn({ data: { jobId } }) });
  const warnings: { t: "bad" | "warn" | "info"; text: string }[] = [];
  if (job.piesa_expired) warnings.push({ t: "bad", text: "PIESA expired – reassess before install" });
  else if (job.install_deadline) warnings.push({ t: job.urgency === "urgent" ? "bad" : "info", text: `Install by ${fmtDate(job.install_deadline)} (PIESA +30 days)` });
  if (h?.escDueBy && h.escStatus !== "sent") warnings.push({ t: "warn", text: `ESC notice due by ${fmtDT(h.escDueBy)}` });
  if (job.payment_status && !job.deposit_cleared && ["deposit_due", "invoice_created", "overdue"].includes(job.payment_status)) warnings.push({ t: "bad", text: "Approved payment option not yet verified" });
  const showReady = ["installation_scheduling", "installation_booked", "evidence_outstanding"].includes(job.stage ?? "");
  return (
    <div className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-primary"><FileText className="h-4 w-4" /> Job File {job.job_number}</div>
          <h1 className="text-2xl font-bold tracking-tight">{job.property_address}</h1>
          <p className="text-sm text-muted-foreground">{job.owner_name} · {job.owner_phone} · {job.owner_email}</p>
        </div>
        <div className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground"><div className="text-xs font-semibold uppercase">Next action</div>{nextStep(job).next}</div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Channel</dt><dd>{job.channel === "installer_sourced" ? `Installer-sourced · ${job.originating_business_name ?? "partner"}` : "Home Insulation Victoria-sourced"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Electrician</dt><dd>{job.electrician_name ?? "Unassigned"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Installer</dt><dd>{job.installer_name ?? "Unassigned"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Readiness</dt><dd>
          {job.stage === "ready_for_veec" ? <Pill t="good">VEEC-ready</Pill>
            : showReady && h?.ready ? (h.ready.ready ? <Pill t="good">READY TO INSTALL</Pill> : <Pill t="bad" className="whitespace-normal">Not ready to install: {h.ready.blockers[0]}</Pill>)
            : <span className="text-muted-foreground">—</span>}
        </dd></div>
      </dl>
      {warnings.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{warnings.map((w) => <Pill key={w.text} t={w.t}>{w.text}</Pill>)}</div>}
    </div>
  );
}

function DocRow({ jobId, d }: { jobId: string; d: DocItem }) {
  const open = useAction(openJobDocument, { refresh: false });
  const [more, setMore] = useState(false);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className="min-w-0 flex-1 text-left text-sm font-medium" onClick={() => setMore(!more)}>{d.title}</button>
        {d.deprecated && <Pill t="neutral">Legacy</Pill>}
        {d.immutable && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Immutable" />}
        <Pill t={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Pill>
        <span className="text-xs text-muted-foreground">{fmtDT(d.at)}</span>
        {d.storagePath && <Button size="sm" variant="outline" onClick={async () => { const r = await open({ jobId, docId: d.id }); if (r?.url) openFileViewer(r.url); }}>Open</Button>}
        {!d.storagePath && d.sourceUrl && <a className="text-xs text-primary underline" href={d.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
      </div>
      {more && (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground md:grid-cols-4">
          <div>Category: {d.category}{d.alsoIn.length ? ` (+ ${d.alsoIn.join(", ")})` : ""}</div><div>Type: {d.docType}</div><div>Source: {d.sourceSystem}</div><div>Version: {d.version ?? "—"}</div>
          <div>By: {d.actor ?? "—"}</div><div>Verified: {d.verifiedAt ? `${d.verifiedBy} ${fmtDT(d.verifiedAt)}` : "—"}</div><div>File: {d.fileName ?? "record only"}</div>
          <div className="break-all">SHA-256: {d.sha256 ?? "—"}</div>
        </dl>
      )}
    </li>
  );
}

/** Documents for one Job File section, filed automatically. */
export function SectionDocuments({ jobId, categories, title = "Documents in this section" }: { jobId: string; categories: DocCategory[]; title?: string }) {
  const { data } = useJobFile(jobId);
  const [hasOpened, setHasOpened] = useState(false);
  const docs = useMemo(() => { const all = (data?.documents ?? []) as DocItem[]; const set = new Map<string, DocItem>(); categories.forEach((c) => inCategory(all, c).forEach((d) => set.set(d.id, d))); return [...set.values()]; }, [data, categories]);
  if (!docs.length) return null;
  return <details className="rounded-xl border p-3" onToggle={(e) => { if (e.currentTarget.open) setHasOpened(true); }}><summary className="cursor-pointer text-sm font-medium">{title} ({docs.length})</summary>{hasOpened && <ul className="mt-2 divide-y">{docs.map((d) => <DocRow key={d.id} jobId={jobId} d={d} />)}</ul>}</details>;
}

export function AllDocuments({ jobId }: { jobId: string }) {
  const { data } = useJobFile(jobId);
  const [q, setQ] = useState(""); const [cat, setCat] = useState<DocCategory | "all">("all"); const [showOld, setShowOld] = useState(false);
  const docs = (data?.documents ?? []) as DocItem[];
  const filtered = searchItems(cat === "all" ? docs : inCategory(docs, cat), q, (d) => [d.title, d.category, d.docType, d.fileName, d.at, d.sourceSystem])
    .filter((d) => showOld || !["superseded", "historical"].includes(d.status));
  const counts = Object.fromEntries(DOC_CATEGORIES.map((c) => [c, inCategory(docs, c).length]));
  return (
    <Section title="All documents">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="w-64 pl-8" placeholder="Search title, type, date…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={showOld} onCheckedChange={setShowOld} /> Show superseded / historical</label>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        <Button size="sm" variant={cat === "all" ? "default" : "outline"} onClick={() => setCat("all")}>All ({docs.length})</Button>
        {DOC_CATEGORIES.filter((c) => counts[c]).map((c) => <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)}>{c} ({counts[c]})</Button>)}
      </div>
      {filtered.length ? <ul className="divide-y">{filtered.map((d) => <DocRow key={d.id} jobId={jobId} d={d} />)}</ul> : <p className="text-sm text-muted-foreground">No documents match.</p>}
      <p className="mt-3 text-xs text-muted-foreground">Everything here is filed automatically from the job's records. Files stay in private storage and open with a short-lived link.</p>
    </Section>
  );
}

export function RetentionCard({ jobId }: { jobId: string }) {
  const { data } = useJobFile(jobId);
  if (!data?.retention) return null;
  return <Section title="Record retention"><p className="text-sm">Retain until <strong>{fmtDate(data.retention.retainUntil)}</strong></p><p className="mt-1 text-xs text-muted-foreground">{data.retention.rule}</p></Section>;
}

export function Correspondence({ jobId }: { jobId: string }) {
  const { data } = useJobFile(jobId);
  const [q, setQ] = useState("");
  const items = searchItems(data?.correspondence ?? [], q, (c) => [c.body, c.subject, c.channel, c.from, c.at]);
  return (
    <div className="space-y-4">
      <LogCommunication jobId={jobId} />
      <Section title="All correspondence">
        <p className="mb-2 text-xs text-muted-foreground">Oldest first. Emails from the Outlook mailbox, emails the portal sent, portal messages and logged calls together. Nothing here sends anything.</p>
        <Input className="mb-3 w-64" placeholder="Search correspondence…" value={q} onChange={(e) => setQ(e.target.value)} />
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <ul className="space-y-2">{items.map((c) => (
            <li key={c.id} className={`rounded-lg border p-2 text-sm ${c.direction === "inbound" ? "mr-8 border-l-4 border-l-primary" : c.direction === "outbound" ? "ml-8 border-r-4 border-r-success" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Pill t={c.direction === "inbound" ? "info" : c.direction === "outbound" ? "good" : "warn"}>{c.direction === "inbound" ? "Owner sent" : c.direction === "outbound" ? "We sent" : "Internal note"}</Pill>
                {c.provider === "outlook" && <span className="font-semibold">Outlook</span>}
                <Pill t={c.internal ? "warn" : "info"}>{c.internal ? "Internal" : c.audience.length === 1 && c.audience[0] === "owner" ? "Customer" : c.audience.includes("owner") ? "Shared" : "Trades"}</Pill>
                <span>{c.channel} · {c.direction}</span><span>{c.from ?? ""}</span><span>{fmtDT(c.at)}</span>
              </div>
              {c.subject && <div className="mt-1 font-medium">{c.subject}</div>}
              {c.direction === "outbound" && c.to && c.to.length > 0 && <div className="text-xs text-muted-foreground">To {c.to.join(", ")}</div>}
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              {c.attachments && c.attachments.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Attachments: {c.attachments.join(", ")}</div>}
            </li>))}
          </ul>)}
      </Section>
    </div>
  );
}

function LogCommunication({ jobId }: { jobId: string }) {
  const save = useAction(logCommunication);
  const [f, setF] = useState({ channel: "phone" as "phone" | "email" | "sms" | "note" | "whatsapp" | "other", direction: "outbound" as "inbound" | "outbound" | "internal", party: "", subject: "", body: "", visibility: "internal" as "customer" | "trade" | "internal" });
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Phone className="mr-1 h-4 w-4" /> Log phone call / external email</Button>;
  const sel = "h-10 rounded-md border bg-background px-2 text-sm";
  return (
    <Section title="Log a call, email or note">
      <div className="grid gap-2 md:grid-cols-4">
        <select className={sel} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as never })}>{["phone", "email", "sms", "whatsapp", "note", "other"].map((c) => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as never })}><option value="outbound">We contacted them</option><option value="inbound">They contacted us</option><option value="internal">Internal note</option></select>
        <select className={sel} value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as never })}><option value="internal">Internal only</option><option value="customer">Customer can see</option><option value="trade">Trades can see</option></select>
        <Input placeholder="Who (name / number / email)" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} />
      </div>
      <Input className="mt-2" placeholder="Subject (optional)" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
      <Label className="mt-2 block text-xs">Summary</Label>
      <Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <div className="mt-2 flex gap-2">
        <Button disabled={f.body.trim().length < 2} onClick={async () => { const r = await save({ jobId, ...f, party: f.party || undefined, subject: f.subject || undefined }, "Logged – nothing was sent"); if (r) { setF({ ...f, body: "", subject: "" }); setOpen(false); } }}>Save record</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Section>
  );
}

const FILTERS: [TimelineFilter, string][] = [["all", "All"], ["customer", "Customer"], ["trades", "Trades"], ["money", "Money"], ["compliance", "Compliance"], ["documents", "Documents"], ["internal", "Internal"]];
function TimelineDetail({ item: t }: { item: JobFile["timeline"][number] }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="rounded-md border px-2 py-1.5 text-sm" onToggle={(e) => setExpanded(e.currentTarget.open)}>
    <summary className="flex cursor-pointer flex-wrap items-center gap-2"><span className="w-36 shrink-0 text-xs text-muted-foreground">{fmtDT(t.at)}</span><span className="flex-1">{t.summary}</span>{t.internal && <Pill t="warn">Internal</Pill>}<span className="text-xs text-muted-foreground">{t.source} · {t.actor}</span></summary>
    {expanded && t.detail != null && <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(t.detail, null, 2)}</pre>}
  </details>;
}
export function JobTimeline({ jobId }: { jobId: string }) {
  const { data } = useJobFile(jobId);
  const [f, setF] = useState<TimelineFilter>("all"); const [q, setQ] = useState("");
  const items = searchItems((data?.timeline ?? []).filter((t) => f === "all" || t.tags.includes(f as never)), q, (t) => [t.summary, t.source, t.actor, t.at]);
  return (
    <Section title="Timeline / audit">
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={f === k ? "default" : "outline"} onClick={() => setF(k)}>{l}</Button>)}
        <Input className="ml-auto w-56" placeholder="Search timeline…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ol className="space-y-1">{[...items].reverse().map((t) => (
        <li key={t.id}><TimelineDetail item={t} /></li>))}
      </ol>
      {!items.length && <p className="text-sm text-muted-foreground">No events for this filter.</p>}
    </Section>
  );
}

export function ExportJobPack({ jobId }: { jobId: string }) {
  const run = useAction(exportJobPackFn);
  const [sup, setSup] = useState(false); const [int, setInt] = useState(false); const [busy, setBusy] = useState(false);
  return (
    <Section title="Export complete job pack">
      <p className="mb-2 text-sm text-muted-foreground">Builds an audit-ready ZIP on the server (folders by category, manifest with hashes, timeline). Records are not changed. Very large packs come as a manifest with private 7-day download links.</p>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><Switch checked={sup} onCheckedChange={setSup} /> Include superseded / historical</label>
        <label className="flex items-center gap-2"><Switch checked={int} onCheckedChange={setInt} /> Include internal items</label>
      </div>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); const r = await run({ jobId, includeSuperseded: sup, includeInternal: int }); setBusy(false);
        if (r?.url) { toast.success(`Job pack ready (${r.count} items${r.missing ? `, ${r.missing} files missing – see manifest` : ""})`); window.location.assign(r.url); }
      }}><Download className="mr-1 h-4 w-4" /> {busy ? "Building…" : "Export job pack"}</Button>
    </Section>
  );
}
