import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { renderJoOutcomeEmail, renderJoReadyCheckInvitationEmail } from "@/lib/jo-outcome-email.core";
import { withUnsubscribe } from "@/lib/emailsafety.core";

/** P1-S77: Jo samples get the same footer/opt-out wrapping as a real send (sample opt-out link only). */
const SAMPLE_UNSUBSCRIBE = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"S".repeat(43)}`;
import type { JoTemplateId } from "@/lib/jo-email-templates.core";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Download } from "lucide-react";
import { Btn, Pill, btnClass, fieldInput } from "./kit";
import { MittiFormCard } from "./mitti-forms";
import { useAction } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import { TEMPLATE_CATEGORIES, TEMPLATE_STANDING, entriesFor, entriesForStanding, registerFor, templateStanding, type TemplateCategory, type TemplateEntry, type TemplateStanding } from "@/lib/template-hub.core";
import { ACTIVITY_48_FORMS, MITTI_FORM_ORDER } from "@/lib/template-catalog";
import { samples } from "@/lib/step3-email-samples";
import { PARTNER_TEMPLATES, renderPartnerTemplate } from "@/lib/partner-templates";
import { partnerWelcomeEmail } from "@/lib/partner-email.core";
import { changesEmail, declineEmail } from "@/lib/application-review.core";
import { partnerLoginEmail } from "@/lib/partner-login-email.core";
import { FORMS } from "@/lib/mitti-forms.core";
import { listCustomerCommunicationTemplates } from "@/lib/customer-communications.functions";
import { approveComplianceTemplate, listComplianceTemplates } from "@/lib/portal.functions";
import { getMittiForms } from "@/lib/mitti-forms.functions";
import { paperworkCatalogueFn } from "@/lib/owner-gates.functions";
import { parseFormFields } from "@/lib/assignment.core";

const SAMPLE_LINK = "https://estimate.homeinsulationvictoria.com.au/portal";

export function TemplatesHub({ cat, t, standing }: { cat: TemplateCategory; t?: string; standing?: TemplateStanding }) {
  const navigate = useNavigate();
  const list = entriesForStanding(cat, standing);
  const selected = (list.find((e) => e.id === t) ?? list[0] ?? entriesFor(cat)[0])!;
  const choose = (id: string) => navigate({ to: "/admin/templates", search: { cat, t: id, ...(standing ? { standing } : {}) }, replace: true });
  const groups = [...new Set(list.map((e) => e.group))];
  return (
    <div>
      <header className="mb-4"><h1 className="font-display text-[26px] font-bold leading-tight">Templates</h1><p className="mt-1 text-sm text-sub">The ONE register of every approved email, Mitti form and compliance wording. Viewing here never sends, saves or connects anything.</p></header>
      <nav aria-label="Template categories" className="mb-3 flex gap-1 border-b border-line">
        {TEMPLATE_CATEGORIES.map((c) => <Link key={c.key} to="/admin/templates" search={{ cat: c.key }} aria-current={c.key === cat ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", c.key === cat ? "border-hiv-blue text-ink" : "border-transparent text-sub hover:text-ink")}>{c.label} <span className="text-xs font-normal text-sub">{entriesFor(c.key).length}</span></Link>)}
      </nav>
      <div role="tablist" aria-label="Template standing" className="mb-4 flex flex-wrap gap-1.5">
        <Link to="/admin/templates" search={{ cat }} role="tab" aria-selected={!standing} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", !standing ? "border-hiv-blue bg-mist text-ink" : "border-line text-sub hover:text-ink")}>All <span className="font-normal">{entriesFor(cat).length}</span></Link>
        {TEMPLATE_STANDING.map((s) => (
          <Link key={s.key} to="/admin/templates" search={{ cat, standing: s.key }} role="tab" aria-selected={standing === s.key} title={s.hint} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", standing === s.key ? "border-hiv-blue bg-mist text-ink" : "border-line text-sub hover:text-ink")}>
            {s.label} <span className="font-normal">{entriesFor(cat).filter((e) => templateStanding(e) === s.key).length}</span>
          </Link>
        ))}
      </div>
      {standing === "historical" && <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">These templates are superseded. They are kept for history and are never used for a new send.</p>}
      {standing === "draft" && <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">No recorded approval. Do not treat these as current office wording.</p>}
      {list.length === 0 ? <p className="rounded-md border bg-card p-6 text-sm text-sub">No templates in this standing.</p> : null}
      {list.length > 0 && <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <label className="block lg:hidden"><span className="sr-only">Choose a template</span>
            <select aria-label="Choose a template" className={fieldInput} value={selected.id} onChange={(e) => choose(e.target.value)}>
              {groups.map((g) => <optgroup key={g} label={g}>{list.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="hidden space-y-3 lg:block" role="listbox" aria-label="Templates">
            {groups.map((g) => <div key={g}><p className="px-2 pb-1 text-[11px] font-bold uppercase text-sub">{g}</p>
              {list.filter((e) => e.group === g).map((e) => <button key={e.id} type="button" role="option" aria-selected={e.id === selected.id} onClick={() => choose(e.id)} className={cn("block w-full rounded-[8px] px-2 py-1.5 text-left text-sm", e.id === selected.id ? "bg-mist font-semibold text-ink" : "text-sub hover:bg-mist/60 hover:text-ink")}>{e.title}</button>)}
            </div>)}
          </div>
        </div>
        <section aria-label="Selected template" className="min-w-0"><TemplateDetail key={selected.id} entry={selected} /></section>
      </div>}
    </div>
  );
}

function Facts({ entry }: { entry: TemplateEntry }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <p className="text-[11px] font-bold uppercase text-hiv-blue">{entry.group}</p>
      <h2 className="font-display text-xl font-bold">{entry.title}</h2>
      <p className="mt-1 text-sm text-sub">{entry.purpose}</p>
      <dl className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-sub">Audience / signer</dt><dd>{entry.audience}</dd>
        <dt className="text-sub">When used</dt><dd>{entry.trigger}</dd>
        <dt className="text-sub">Approval</dt><dd>{entry.approval}</dd>
      </dl>
    </div>
  );
}

function JoSample({ templateId }: { templateId: JoTemplateId }) {
  const mail = useMemo(() => {
    const raw = (() => { try {
      const recipient = { firstName: "Alex", propertyAddress: "12 Sample St, Melbourne VIC 3000", enquiryReference: "HV-0000" };
      // Sample data only: size-known templates preview as homeowner-provided (210 m²); size-unknown
      // templates preview the approved 150 m² assumption. Neither value is used for a real send.
      const ceilingSizeKnown = templateId.endsWith("size_known");
      const figures = { veuRebate: 2600, customerTotal: 1900, totalBeforeRebate: 4500, installation: 3800, piesaFee: 350, apFee: 350, ceilingAreaM2: ceilingSizeKnown ? 210 : 150, areaEstimated: !ceilingSizeKnown };
      const links = { saveMySpotUrl: SAMPLE_LINK, uploadMediaUrl: SAMPLE_LINK, reviewResultUrl: SAMPLE_LINK, calculatorUrl: SAMPLE_LINK };
      // Preview-only artwork: draws the SAME campaign art as a real send, with no customer token.
      const previewArtSrc = templateId === "ineligible" ? null : `/api/public/email-art-preview/${templateId === "ready_check_invitation" ? "spot" : "headline"}.png`;
      if (templateId === "ready_check_invitation") return renderJoReadyCheckInvitationEmail(recipient, { ...figures, savedAt: "2026-10-19T00:00:00Z", personalEstimateUrl: SAMPLE_LINK, readyCheckBookingUrl: SAMPLE_LINK }, previewArtSrc);
      if (templateId === "ineligible") return renderJoOutcomeEmail({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient, reason: "[The official ineligibility reason appears here]", links });
      const outcome = templateId.startsWith("eligible") ? "likely_eligible" : templateId.startsWith("potentially") ? "needs_onsite_confirmation" : "likely_eligible";
      const insulation = templateId.startsWith("eligible_no_insulation") ? "none" : templateId.startsWith("eligible_below_r2") ? "present" : "unknown";
      const deskCheckStatus = templateId.startsWith("eligible_below_r2") ? "looks_eligible" : null;
      return renderJoOutcomeEmail({ outcome, insulation, ceilingSizeKnown, deskCheckStatus, recipient, figures, links, previewArtSrc });
    } catch { return null; } })();
    return raw ? withUnsubscribe(raw, SAMPLE_UNSUBSCRIBE) : null;
  }, [templateId]);
  if (!mail) return <p className="text-sm text-rose">This template could not be previewed with sample data.</p>;
  const areaNote = templateId.endsWith("size_known")
    ? " Sample ceiling area: 210 m² provided by the homeowner."
    : templateId === "ineligible"
      ? ""
      : " Sample ceiling area: 150 m² assumed (homeowner did not provide one).";
  return <HtmlEmail subject={mail.subject} html={mail.html} note={`Sample values only.${areaNote} Rendered by the same function every real send uses.`} />;
}

function TemplateDetail({ entry }: { entry: TemplateEntry }) {
  const v = entry.view;
  return (
    <div className="space-y-4">
      <Facts entry={entry} />
      {v.kind === "sample_email" && <HtmlEmail subject={samples[v.sample].subject} preview={samples[v.sample].previewText} html={samples[v.sample].html} note="Sample values only. Same renderer as every real send." />}
      {v.kind === "partner_invitation" && <PartnerInvitation templateKey={v.templateKey} />}
      {v.kind === "partner_email" && <PartnerEmail email={v.email} />}
      {v.kind === "plain_email" && <PlainEmail />}
      {entry.reviewKey && <ReviewVersions reviewKey={entry.reviewKey} storedOnly={v.kind === "review_only"} />}
      {v.kind === "mitti" && <MittiDetail formKey={v.formKey} />}
      {v.kind === "compliance_template" && <ComplianceVersions templateKey={v.templateKey} />}
      {v.kind === "register" && <RegisterDetail index={v.index} mitti={v.mitti} />}
      {v.kind === "owner_paperwork" && <OwnerPaperwork gate={v.gate} />}
      {v.kind === "jo_sample" && <JoSample templateId={v.templateId} />}
    </div>
  );
}

function HtmlEmail({ subject, preview, html, note, original }: { subject: string; preview?: string; html: string; note: string; original?: { href: string; label: string } }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <p className="text-sm"><b>Subject:</b> {subject}</p>
      {preview && <p className="mt-1 text-sm"><b>Preheader:</b> {preview}</p>}
      <p className="mt-1 text-xs text-sub">{note} Links are disabled in this preview.</p>
      {original && <a href={original.href} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-hiv-blue hover:underline">{original.label}<ArrowUpRight className="h-4 w-4" /></a>}
      <iframe title={`${subject} preview`} srcDoc={html} sandbox="" className="mt-3 h-[70vh] min-h-[480px] w-full rounded-[10px] border border-line bg-paper" />
    </div>
  );
}

function PartnerInvitation({ templateKey }: { templateKey: string }) {
  const t = PARTNER_TEMPLATES.find((p) => p.key === templateKey)!;
  return (
    <div className="space-y-2">
      <Btn tone="secondary" onClick={() => {
        const url = URL.createObjectURL(new Blob([renderPartnerTemplate(t)], { type: "text/html;charset=utf-8" }));
        const a = document.createElement("a"); a.href = url; a.download = t.fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}><Download className="h-4 w-4" />Download HTML template</Btn>
      <HtmlEmail subject={t.subject} html={renderPartnerTemplate(t)} note={`Exact stored HTML. Registration link: ${t.registrationUrl}.`} />
    </div>
  );
}

function PartnerEmail({ email }: { email: "welcome" | "changes" | "decline" }) {
  const m = email === "welcome" ? partnerWelcomeEmail({ firstName: "Alex", businessName: "Sample Insulation Co", trade: "installer", email: "alex@example.com", link: SAMPLE_LINK, test: false })
    : email === "changes" ? changesEmail({ contactName: "Alex Sample", message: "[The office's typed message appears here]", link: SAMPLE_LINK, test: false })
    : declineEmail({ contactName: "Alex Sample", reason: null, test: false });
  return <HtmlEmail subject={m.subject} html={m.html} note="Sample names only. Same builder as the real send." />;
}

function PlainEmail() {
  const m = partnerLoginEmail(null, SAMPLE_LINK);
  return <div className="rounded-[14px] border border-line bg-paper p-4"><p className="text-sm"><b>Subject:</b> {m.subject}</p><p className="mt-1 text-xs text-sub">Plain-text email. Sample link only.</p><pre className="mt-3 whitespace-pre-wrap rounded-[10px] bg-mist p-3 font-sans text-sm">{m.message}</pre></div>;
}

function ReviewVersions({ reviewKey, storedOnly }: { reviewKey: string; storedOnly: boolean }) {
  const list = useServerFn(listCustomerCommunicationTemplates);
  const q = useQuery({ queryKey: ["customer-communication-templates"], queryFn: () => list() });
  const rows = (q.data ?? []).filter((r) => r.template_key === reviewKey);
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Stored review versions</h3><Link to="/admin/communications" search={{ key: reviewKey }} className={btnClass("secondary")}>Create or approve in Customer communications<ArrowUpRight className="h-4 w-4" /></Link></div>
      {storedOnly && <p className="mt-2 text-xs text-sub">No live-send renderer preview available for this entry. Stored review wording below is not a live-send layout; its approval does not replace the sending template.</p>}
      {q.isError ? <p role="alert" className="mt-2 text-sm text-rose">Versions could not load: {q.error instanceof Error ? q.error.message : "read failed"}</p>
        : q.isLoading ? <p className="mt-2 text-sm text-sub">Loading versions…</p>
        : rows.length === 0 ? <p className="mt-2 text-sm text-sub">{storedOnly ? "No preview available. No review version saved." : "No review version saved."}</p>
        : <ul className="mt-2 space-y-3 text-sm">{rows.map((r) => <li key={r.id} className="min-w-0 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2"><b>{r.version}</b><Pill tone={r.status === "approved" ? "green" : r.status === "draft" ? "amber" : "plain"}>{r.status || "Not recorded"}</Pill></div>
          <p className="mt-1 break-words font-semibold">{r.subject}</p>
          {r.body_markdown?.trim() ? <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-mist p-3 font-sans text-sm">{r.body_markdown}</pre> : <p className="mt-2 text-sub">No preview available. No body saved for this version.</p>}
          {r.source_note && <p className="mt-2 break-words text-xs text-sub">Source note: {r.source_note}</p>}
        </li>)}</ul>}
    </div>
  );
}

function useMittiIds() {
  const get = useServerFn(getMittiForms);
  return useQuery({ queryKey: ["mitti_forms"], queryFn: () => get() });
}

function MittiDetail({ formKey }: { formKey: keyof typeof FORMS }) {
  const q = useMittiIds();
  const id = q.data?.[formKey] ?? null;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[14px] border border-line bg-paper p-4 text-sm">
        <dt className="text-sub">Template version</dt><dd>Portal build sheet · {FORMS[formKey].fields.length} required questions (no version number stored)</dd>
        <dt className="text-sub">Saved connection</dt><dd className="break-all">{q.isError ? <span className="text-rose">Settings could not load</span> : q.isLoading ? "Loading…" : id ? `Form ID saved in settings: ${id}` : "No form ID saved"}</dd>
        <dt className="text-sub">Live health</dt><dd>Use the form checks below to verify access, identity and required questions. A replacement connection is saved only through "Check &amp; connect".</dd>
      </dl>
      {q.data && <MittiFormCard formKey={formKey} connected={id} />}
    </div>
  );
}

function ComplianceVersions({ templateKey }: { templateKey: string }) {
  const list = useServerFn(listComplianceTemplates);
  const approve = useAction(approveComplianceTemplate);
  const q = useQuery({ queryKey: ["compliance_templates"], queryFn: () => list() });
  const rows = (q.data ?? []).filter((r) => r.template_key === templateKey);
  const reg = registerFor(templateKey);
  return (
    <div className="space-y-3">
      {reg && <p className="rounded-[14px] border border-line bg-paper p-4 text-sm"><b>Blocks:</b> {reg.blocks} · <b>Source:</b> {reg.source}</p>}
      <div className="rounded-[14px] border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Versions</h3><Link to="/admin/compliance" search={{ key: templateKey }} className={btnClass("secondary")}>Add a new version<ArrowUpRight className="h-4 w-4" /></Link></div>
        <p className="mt-1 text-xs text-sub">Approved versions can't be edited — add a new version instead.</p>
        {q.isError ? <p role="alert" className="mt-2 text-sm text-rose">Versions could not load.</p>
          : q.isLoading ? <p className="mt-2 text-sm text-sub">Loading versions…</p>
          : rows.length === 0 ? <p className="mt-2 text-sm text-rose">Not configured</p>
          : <ul className="mt-2 space-y-2">{rows.map((r) => <li key={r.id} className="rounded-[10px] border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><b>{r.version}</b>{r.approved && r.is_active ? <Pill tone="green">Approved and active</Pill> : r.approved ? <Pill>Superseded</Pill> : <Pill tone="amber">{r.is_active ? "Selected draft · not approved" : "Draft · not approved"}</Pill>}
              {!r.approved && <Btn className="ml-auto min-h-9 px-3 py-1 text-xs" onClick={() => void approve({ id: r.id }, "Approved and activated")}>Approve &amp; activate</Btn>}</div>
            {r.source_note && <p className="mt-1 text-xs text-sub">{r.source_note}</p>}
            <details className="mt-1"><summary className="cursor-pointer text-xs text-hiv-blue">Official wording</summary><pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{r.body}</pre></details>
            {parseFormFields(r.form_fields).length > 0 && <p className="mt-1 text-xs">Form fields: {parseFormFields(r.form_fields).map((f) => `${f.label}${f.required ? "*" : ""}`).join(", ")}</p>}
          </li>)}</ul>}
      </div>
    </div>
  );
}

function RegisterDetail({ index, mitti }: { index: number; mitti: (keyof typeof FORMS)[] }) {
  const f = ACTIVITY_48_FORMS[index]!;
  const q = useMittiIds();
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4 text-sm">
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-sub">Blocks</dt><dd>{f.blocks}</dd><dt className="text-sub">Source</dt><dd>{f.source}</dd>
        <dt className="text-sub">Retention</dt><dd>Permanent job record; keep Activity 48 records for six years after registration.</dd>
      </dl>
      {"pdf" in f && <a className="mt-3 inline-flex items-center gap-1 font-semibold text-hiv-blue hover:underline" href={f.pdf} target="_blank" rel="noreferrer">Open official form (read-only)<ArrowUpRight className="h-4 w-4" /></a>}
      {mitti.length > 0 && <div className="mt-3 border-t border-line pt-3"><p className="text-xs text-sub">The Mitti entry shows the saved form and its separate access, question and approval checks.</p>
        {q.isError && <p role="alert" className="mt-1 text-xs text-rose">Form settings could not load.</p>}
        <ul className="mt-1 space-y-1">{mitti.map((k) => { const o = MITTI_FORM_ORDER.find((m) => m.key === k)!; return <li key={k} className="flex flex-wrap items-center gap-2"><Link to="/admin/templates" search={{ cat: "mitti", t: `mitti:${k}` }} className="font-semibold text-hiv-blue hover:underline">Mitti {o.letter} · {o.forWho}</Link>{q.data ? (q.data[k] ? <Pill>ID saved · check required</Pill> : <Pill tone="amber">No ID saved</Pill>) : null}</li>; })}</ul></div>}
    </div>
  );
}

type Doc = { key: string; gate: string; title: string; version: string; status: string; approvedBy: string | null; approvedAt: string | null; managedIn: string; templateId: string | null };
function OwnerPaperwork({ gate }: { gate: string }) {
  const load = useServerFn(paperworkCatalogueFn);
  const q = useQuery({ queryKey: ["paperwork-catalogue"], queryFn: () => load() });
  const docs = ((q.data?.docs ?? []) as Doc[]).filter((d) => d.gate === gate);
  const bodies = (q.data?.bodies ?? {}) as Record<string, string>;
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Documents</h3><Link to="/admin/owner-paperwork" className={btnClass("secondary")}>Approve in Owner paperwork<ArrowUpRight className="h-4 w-4" /></Link></div>
      {q.isError ? <p role="alert" className="mt-2 text-sm text-rose">Owner paperwork could not load.</p> : q.isLoading ? <p className="mt-2 text-sm text-sub">Loading…</p> : docs.length === 0 ? <p className="mt-2 text-sm text-sub">No documents recorded for this gate.</p> :
        <ul className="mt-2 divide-y divide-line">{docs.map((d) => <li key={d.key} className="py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>{d.title}</b><span className="text-sub">{d.version}</span><Pill tone={d.status === "Approved" ? "green" : "rose"}>{d.status}</Pill>{d.approvedBy && <span className="text-xs text-sub">{d.approvedBy}{d.approvedAt ? `, ${d.approvedAt.slice(0, 10)}` : ""}</span>}</div>
          {d.managedIn === "Templates" ? <Link to="/admin/templates" search={{ cat: "compliance", t: `compliance:${d.key}` }} className="mt-1 inline-block text-xs font-semibold text-hiv-blue hover:underline">Wording is managed in the versioned template →</Link>
            : bodies[d.key] ? <details className="mt-1"><summary className="cursor-pointer text-xs text-hiv-blue">Wording</summary><pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{bodies[d.key]}</pre></details> : null}
        </li>)}</ul>}
    </div>
  );
}
