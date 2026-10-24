// Partner application pieces (moved from the old /admin/partners page, unchanged behaviour) so the O5 application
// review page (decisions 232/249) can compose them: approval checklist + one Approve, office CII verification,
// login link, Jo's one-off email, the signed agreement and the review decision. Guards live in the server functions.
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { useAction } from "@/hooks/use-me";
import { updatePartnerEnquiry } from "@/lib/portal.functions";
import { getRecOnboardingRecord } from "@/lib/rec-onboarding-admin.functions";
import { PARTNER_STATUSES, PARTNER_TYPE_LABEL, partnerIssues, type PartnerType } from "@/lib/partner.core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/integrations/supabase/types";
import { useServerFn } from "@tanstack/react-start";
import { getApprovalChecklist, listPartnerOfficeEmails, sendPartnerOfficeEmail, activatePartnerApplication, createPartnerLogin, sendPartnerLoginLink, decidePartnerApplication, getApplicationReview, listCertificationLevels, listWorkerCertifications, recordCertificationLevel, recordWorkerCertification } from "@/lib/partner-activation.functions";
import type { InstData } from "@/lib/installer-onboarding.core";
import { openFileViewer } from "@/components/portal/file-viewer";
import { PartnerProfileCard } from "@/components/portal/partner-profile-card";
import { RateOfferPanel } from "@/components/portal/rate-offer-panel";

export type PartnerEnquiryRow = Tables<"partner_enquiries">;
type Row = PartnerEnquiryRow;
const money = (n: number | null) => (n == null ? "—" : `$${Number(n).toFixed(2)} inc GST`);
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-AU") : "—");

/** The application/enquiry record: review flags, every field, Jo's email box, approval, status and notes. */
export function ApplicationDetail({ row, recordOnly = false }: { row: Row; recordOnly?: boolean }) {
  const update = useAction(updatePartnerEnquiry);
  const qc = useQueryClient();
  const [notes, setNotes] = useState(row.internal_notes ?? "");
  const save = async (p: { status?: (typeof PARTNER_STATUSES)[number]; internal_notes?: string | null }, msg: string) => {
    await update({ id: row.id, ...p }, msg);
    await qc.invalidateQueries({ queryKey: ["partner_enquiries"] });
  };
  const f: [string, React.ReactNode][] = [
    ["Type", PARTNER_TYPE_LABEL[row.enquiry_type as PartnerType]], ["Company", row.company], ["Name", row.name], ["Email", row.email], ["Phone", row.phone],
    ["Submitted", date(row.source_created_at ?? row.created_at)], ["Website status", row.source_status], ["Source", row.source], ["Reference", row.external_id ?? row.submission_id],
    ["Service areas", row.service_areas?.join(", ")],
    ...(row.enquiry_type === "installer" ? [["CII certification", row.cii_certification_status], ["CII details", row.cii_certification_details], ["Indicative R5 rate", row.estimated_r5_install_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_r5_install_rate_per_sqm_inc_gst}/m² inc GST`], ["R6.0 rate", (() => { const v = (row.raw_payload as { r6_rate?: number | null } | null)?.r6_rate; return v == null ? "Not offered" : `$${v}/m² inc GST`; })()], ["R7.0 rate", (() => { const v = (row.raw_payload as { r7_rate?: number | null } | null)?.r7_rate; return v == null ? "Not offered" : `$${v}/m² inc GST`; })()], ["Top up to R5.0 rate", (() => { const v = (row.raw_payload as { topup_r5_rate?: number | null } | null)?.topup_r5_rate; return v == null ? "Not offered" : `$${v}/m² inc GST`; })()], ["Dust / vermin vacuum only rate", (() => { const v = (row.raw_payload as { vacuum_only_rate?: number | null } | null)?.vacuum_only_rate; return v == null ? "Not offered" : `$${v}/m² inc GST`; })()], ["Batts removal rate", row.estimated_batts_removal_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_batts_removal_rate_per_sqm_inc_gst}/m² inc GST`], ["Loose fill removal rate", row.estimated_loose_fill_removal_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_loose_fill_removal_rate_per_sqm_inc_gst}/m² inc GST`], ["Free quotes for Home Insulation Victoria leads", row.free_quotes_for_hivic_leads == null ? null : row.free_quotes_for_hivic_leads ? "Yes" : "No"], ["Free Ready Checks for qualified quote leads", row.free_measureups_for_hivic_quote_leads == null ? null : row.free_measureups_for_hivic_quote_leads ? "Yes" : "No"]] as [string, React.ReactNode][] : []),
    ...(row.enquiry_type === "electrician_rec" ? [["REC number", row.rec_registration_number], ["ESV-licensed electricians confirmed", row.esv_licensed_electricians_confirmed == null ? null : row.esv_licensed_electricians_confirmed ? "Yes" : "No"], ["Services", row.services?.join(", ")], ["Indicative PIESA fee", money(row.estimated_piesa_fee_inc_gst)], ["Indicative return visit fee", money(row.estimated_return_visit_fee_inc_gst)], ["Booking lead time", row.booking_lead_time], ["Weekly capacity", row.weekly_capacity]] as [string, React.ReactNode][] : []),
    ["Their message", row.notes],
  ];
  return (
    <div className="space-y-4">
        {(() => { const issues = partnerIssues(row); return issues.length > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="mb-1 text-sm font-semibold text-amber-700 dark:text-amber-400">Review flags</div>
            <ul className="list-inside list-disc text-sm text-amber-700 dark:text-amber-400">
              {issues.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        ); })()}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {f.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap">{v ?? "—"}</dd></Fragment>)}
        </dl>
        {!recordOnly && <OfficeEmailBox enquiryId={row.id} to={row.email} />}
        {!recordOnly && (() => { const id = (row.raw_payload as { rec_onboarding_id?: string } | null)?.rec_onboarding_id; return id ? <><ApprovePartner applicationId={id} /><PartnerProfileCard applicationId={id} /><SignedRecAgreement id={id} /></> : null; })()}
        <div>
          <div className="mb-1 text-sm font-semibold">Status</div>
          <div className="flex flex-wrap gap-2">
            {row.status === "approved" && <Badge>Approved partner</Badge>}{PARTNER_STATUSES.filter((s) => s !== "approved").map((s) => <Button key={s} size="sm" variant={row.status === s ? "default" : "outline"} className="capitalize" onClick={() => save({ status: s }, `Marked ${s}`)}>{s}</Button>)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold">Internal notes</div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          <Button className="mt-2" size="sm" onClick={() => save({ internal_notes: notes || null }, "Notes saved")}>Save notes</Button>
        </div>
    </div>
  );
}

export function SignedRecAgreement({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const activate = useAction(activatePartnerApplication);
  const q = useQuery({ queryKey: ["rec-onboarding", id], enabled: open, queryFn: () => getRecOnboardingRecord({ data: { id } }) });
  const r = q.data;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Signed partner agreement</div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "View signed agreement"}</Button>
      </div>
      {open && (q.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : q.error ? <p className="mt-2 text-sm text-destructive">{(q.error as Error).message}</p> : r && (
        <div className="mt-3 space-y-2 text-sm">
          <div>Version <b>{r.agreement_version}</b> · signed {r.signed_at ? new Date(r.signed_at).toLocaleString("en-AU") : "—"} by <b>{r.signer_name}</b> ({r.signer_position}, {r.signer_email})</div>
          <div className="break-all text-xs text-muted-foreground">SHA-256 {r.agreement_sha256} · IP {r.signed_ip ?? "—"}</div>
          {r.certificateUrl && <button type="button" className="text-primary underline" onClick={() => openFileViewer(r.certificateUrl, "Certificate of Currency")}>Open Certificate of Currency</button>}
          {r.activation && <p className="rounded bg-success-soft p-2 font-semibold text-success">Activated as an approved partner business on {new Date(r.activation.activated_at).toLocaleDateString("en-AU")}.</p>}
          <div className="rounded-md border bg-muted/40 p-3" data-signature-block>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Electronic signature</div>
            <div className="mt-1">Signed by <b>{r.signer_name}</b>{r.signer_position ? `, ${r.signer_position}` : ""} ({r.signer_email})</div>
            <div>Signed {r.signed_at ? new Date(r.signed_at).toLocaleString("en-AU") : "—"} · from IP {r.signed_ip ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Typed-name electronic signature · document fingerprint SHA-256 {r.agreement_sha256}</div>
          </div>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{r.agreement_text}</pre>
        </div>
      ))}
    </div>
  );
}


/** Office: "Send back for changes" or "Decline" a signed installer application (Jo, 7 Oct). Emails are DRAFT wording. */
export function ReviewDecision({ applicationId }: { applicationId: string }) {
  const decide = useAction(decidePartnerApplication);
  const q = useQuery({ queryKey: ["application-review", applicationId], queryFn: () => getApplicationReview({ data: { applicationId } }) });
  const [mode, setMode] = useState<null | "changes_requested" | "declined">(null);
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const r = q.data;
  if (q.isLoading) return null;
  if (r) return <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-review-decision><b>{r.decision === "declined" ? "Declined" : "Sent back for changes"}</b> on {new Date(r.created_at).toLocaleString("en-AU")}{r.message ? <> — “{r.message}”</> : null}<div className="text-xs text-muted-foreground">{r.email_status === "sent" ? (r.email_detail?.startsWith("Sent to") ? r.email_detail : "Email sent") : `Email not sent${r.email_detail ? `: ${r.email_detail}` : ""}`}</div>{r.decision === "changes_requested" && <div className="text-xs text-muted-foreground">The re-signed application will come back here for approval.</div>}{link && <div className="mt-1 break-all text-xs">TEST link: {link}</div>}</div>;
  return <div className="space-y-2 rounded-lg border p-3">
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={mode === "changes_requested" ? "default" : "outline"} onClick={() => setMode("changes_requested")}>Send back for changes</Button><Button size="sm" variant={mode === "declined" ? "destructive" : "outline"} onClick={() => setMode("declined")}>Decline</Button></div>
    {mode && <>
      <label className="block text-sm font-medium">{mode === "changes_requested" ? "What should they check?" : "Reason (shown in the email; leave blank for none)"}<Textarea className="mt-1" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={mode === "changes_requested" ? "e.g. Please check your batts removal rate." : ""} /></label>
      <p className="text-xs text-muted-foreground">This emails the applicant at the address on their application. Replies go to info@homeinsulationvictoria.com.au. Automatic test-run applications email Jo's test inbox only.</p>
      <Button size="sm" disabled={mode === "changes_requested" && msg.trim().length < 3} onClick={async () => { const res = await decide({ applicationId, decision: mode, message: msg.trim() || null }, mode === "declined" ? "Application declined" : "Sent back for changes"); if (res) { setLink(res.testLink); window.alert(res.email.status === "sent" ? `${res.email.detail.startsWith("Sent to") ? res.email.detail : "Email sent"}.` : `Saved, but the email was not sent: ${res.email.detail}`); await q.refetch(); } }}>{mode === "declined" ? "Decline application" : "Send back"}</Button>
    </>}
  </div>;
}

/** Office CII verification per nominated installer. Self-declared answers are shown but never count. */
export function WorkerCertifications({ applicationId, installers }: { applicationId: string; installers: NonNullable<InstData["installers"]> }) {
  const record = useAction(recordWorkerCertification);
  const list = useServerFn(listWorkerCertifications);
  const q = useQuery({ queryKey: ["worker-certs", applicationId], queryFn: () => list({ data: { applicationId } }) });
  const listLv = useServerFn(listCertificationLevels);
  const recordLv = useAction(recordCertificationLevel);
  const lv = useQuery({ queryKey: ["worker-cert-levels", applicationId], queryFn: () => listLv({ data: { applicationId } }) });
  const [lvForm, setLvForm] = useState<Record<string, { level: "full" | "provisional"; expires: string }>>({});
  const [form, setForm] = useState<Record<string, { source: "certificate_sighted" | "issuer_register_checked"; note: string; number: string }>>({});
  return (
    <div className="rounded border p-2">
      <div className="mb-1 font-semibold">EEC CII certification checks</div>
      <p className="mb-2 text-xs text-muted-foreground">Activation needs at least one office-verified installer. Installers who are not verified can never be assigned. There is no override for this check.</p>
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
      {installers.map((w) => {
        const email = (w.email ?? "").trim().toLowerCase();
        const latest = (q.data ?? []).find((c) => c.worker_email === email);
        const f = form[email] ?? { source: "certificate_sighted" as const, note: "", number: w.cii_certificate_number ?? "" };
        const set = (p: Partial<typeof f>) => setForm((x) => ({ ...x, [email]: { ...f, ...p } }));
        const submit = async (status: "verified" | "rejected") => { await record({ applicationId, workerEmail: email, status, evidenceSource: f.source, evidenceNote: f.note, certificateNumber: f.number || undefined, issuer: w.cii_issuer || undefined }, status === "verified" ? "Certification verified" : "Certification rejected"); await q.refetch(); };
        return (
          <div key={email} className="mt-2 border-t pt-2">
            <div><b>{w.full_legal_name}</b> · {email}</div>
            <div className="text-xs text-muted-foreground">Applicant declared: {w.cii_holds === "held" ? `holds CII ${w.cii_certificate_number ?? ""}, ${w.cii_issuer ?? ""}, ${w.cii_issue_date ?? ""}${w.cii_level ? `, ${w.cii_level === "full" ? "Full" : "Provisional (no work until Full)"}` : ""}${w.cii_expiry ? `, expires ${w.cii_expiry}` : ""}` : w.cii_holds === "in_training" ? "training in progress" : w.cii_holds === "not_held" ? "not certified" : "not provided (older application)"}</div>
            <div className="mt-1">{latest ? <Badge variant={latest.status === "verified" ? "default" : "destructive"}>{latest.status === "verified" ? "Office verified" : "Rejected"} {new Date(latest.recorded_at).toLocaleDateString("en-AU")}</Badge> : <Badge variant="outline">Not verified</Badge>}</div>
            {latest?.status === "verified" && (() => {
              const cur = (lv.data ?? []).find((x) => x.certification_id === latest.id);
              const lf = lvForm[email] ?? { level: (w.cii_level === "provisional" ? "provisional" : "full") as "full" | "provisional", expires: w.cii_expiry ?? "" };
              return (
                <div className="mt-2 rounded border p-2">
                  {cur ? <div className="text-xs">Level: <b>{cur.level === "full" ? "Full" : "Provisional"}</b> · expires {cur.expires_on}</div>
                    : <p className="text-xs font-medium text-danger">Re-record certification as Full with expiry date.</p>}
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    <select aria-label="Certification level" className="h-9 rounded border px-2" value={lf.level} onChange={(e) => setLvForm((x) => ({ ...x, [email]: { ...lf, level: e.target.value as "full" | "provisional" } }))}><option value="full">Full</option><option value="provisional">Provisional</option></select>
                    <input aria-label="Certification expiry date" type="date" className="h-9 rounded border px-2" value={lf.expires} onChange={(e) => setLvForm((x) => ({ ...x, [email]: { ...lf, expires: e.target.value } }))} />
                    <Button size="sm" disabled={!lf.expires} onClick={async () => { await recordLv({ applicationId, workerEmail: email, level: lf.level, expiresOn: lf.expires }, "Certification level recorded"); await lv.refetch(); }}>Record level and expiry</Button>
                  </div>
                </div>
              );
            })()}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select aria-label="How it was checked" className="h-9 rounded border px-2" value={f.source} onChange={(e) => set({ source: e.target.value as typeof f.source })}>
                <option value="certificate_sighted">Certificate sighted</option>
                <option value="issuer_register_checked">Issuer register checked</option>
              </select>
              <input aria-label="Certificate number checked" className="h-9 rounded border px-2" placeholder="Certificate number checked" value={f.number} onChange={(e) => set({ number: e.target.value })} />
            </div>
            <Textarea className="mt-2" rows={2} aria-label="Evidence checked" placeholder="What you checked (at least 10 characters)" value={f.note} onChange={(e) => set({ note: e.target.value })} />
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => submit("verified")}>Record verified</Button><Button size="sm" variant="outline" onClick={() => submit("rejected")}>Record not verified</Button></div>
          </div>
        );
      })}
    </div>
  );
}


/** Partner login: email the one-time set-password link for real (recorded on the record), or copy it. */
export function PartnerLogin({ applicationId, defaultEmail, autoResult }: { applicationId: string; defaultEmail: string; autoResult?: { ok: boolean; text: string; link?: string } | null }) {
  const make = useAction(createPartnerLogin);
  const send = useAction(sendPartnerLoginLink);
  const [email, setEmail] = useState(defaultEmail);
  const [link, setLink] = useState<string | null>(autoResult?.link ?? null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(autoResult ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (autoResult) { setResult(autoResult); if (autoResult.link) setLink(autoResult.link); } }, [autoResult]);
  return (
    <div className="rounded border p-2" data-testid="partner-login">
      <div className="font-semibold">Login link</div>
      <p className="text-xs text-muted-foreground">Emails a one-time link to set their password (works once, expires after 24 hours). Recorded on this record.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input aria-label="Login email" className="h-9 min-w-0 flex-1 rounded border px-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); const r = await send({ applicationId, email }); setBusy(false); if (r) { setLink(r.link); setResult(r.status === "sent" ? { ok: true, text: `Login link sent to ${r.to}` } : { ok: false, text: `Not sent: ${r.detail}` }); } }}>{busy ? "Sending…" : autoResult || result ? "Send a new login link" : "Send login link"}</Button>
        <Button size="sm" variant="outline" onClick={async () => { const r = await make({ applicationId, email }, "Login link ready"); if (r) { setLink(r.link); await navigator.clipboard.writeText(r.link).catch(() => {}); toast.success("New link copied"); } }}>Copy link</Button>
      </div>
      {result && <p role="status" className={`mt-2 rounded p-2 text-sm font-semibold ${result.ok ? "bg-success-soft text-success" : "bg-destructive/10 text-destructive"}`}>{result.text}</p>}
      {link && <textarea readOnly aria-label="Set-password link" className="mt-2 w-full break-all rounded border p-2 text-xs" rows={2} value={link} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

/** Jo's own one-off email to this applicant or partner. Sends to the real address; recorded here with who and when. */
export function OfficeEmailBox({ enquiryId, to }: { enquiryId: string; to: string | null }) {
  const send = useAction(sendPartnerOfficeEmail);
  const list = useServerFn(listPartnerOfficeEmails);
  const q = useQuery({ queryKey: ["office-emails", enquiryId], queryFn: () => list({ data: { enquiryId } }) });
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-lg border p-3" data-office-email>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Email {to ?? "this applicant"}</div>
        {!open && <Button size="sm" variant="outline" onClick={() => { setOpen(true); setResult(null); }}>Write an email</Button>}
      </div>
      {open && <div className="mt-2 space-y-2">
        <input aria-label="Subject" className="h-9 w-full rounded border px-2 text-sm" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Textarea aria-label="Message" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Your message" />
        <p className="text-xs text-muted-foreground">Sent from Home Insulation Victoria. Replies go to info@homeinsulationvictoria.com.au.</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !msg.trim()} onClick={async () => { setBusy(true); const r = await send({ enquiryId, subject, message: msg }); setBusy(false); if (r) { setResult(r.status === "sent" ? { ok: true, text: `Sent to ${r.to}` } : { ok: false, text: `Not sent: ${r.detail}` }); if (r.status === "sent") { setOpen(false); setMsg(""); setSubject(""); } await q.refetch(); } }}>{busy ? "Sending…" : "Send email"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>}
      {result && <p role="status" className={`mt-2 rounded p-2 text-sm font-semibold ${result.ok ? "bg-success-soft text-success" : "bg-destructive/10 text-destructive"}`}>{result.text}</p>}
      {(q.data ?? []).length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{q.data!.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString("en-AU")} · {e.by} · “{e.subject}” to {e.to} — {e.status === "sent" ? "sent" : `not sent (${e.detail})`}</li>)}</ul>}
    </div>
  );
}

/** ONE clear Approve for a signed application: checklist of blockers (each fixable here), then activate, then the login link. */
export function ApprovePartner({ applicationId, showReviewDecision = true }: { applicationId: string; showReviewDecision?: boolean }) {
  const check = useServerFn(getApprovalChecklist);
  const rec = useServerFn(getRecOnboardingRecord);
  const activate = useAction(activatePartnerApplication);
  const sendLogin = useAction(sendPartnerLoginLink);
  const [autoLogin, setAutoLogin] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const q = useQuery({ queryKey: ["approval-checklist", applicationId], queryFn: () => check({ data: { applicationId } }) });
  const r2 = useQuery({ queryKey: ["rec-onboarding", applicationId], queryFn: () => rec({ data: { id: applicationId } }) });
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const c = q.data;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading approval…</p>;
  if (q.error || !c) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Could not load the approval checklist."}</p>;
  const installers = ((r2.data?.data as InstData | null)?.installers ?? []);
  if (c.activated) return (
    <div className="space-y-2 rounded-lg border-2 border-success p-3" data-approve>
      <p className="font-semibold text-success">Approved on {new Date(c.activatedAt!).toLocaleDateString("en-AU")}.</p>
      {msg && <p className="text-sm">{msg}</p>}
      <PartnerLogin applicationId={applicationId} defaultEmail={c.loginEmail} autoResult={autoLogin} />
      {installers.length > 0 && <WorkerCertifications applicationId={applicationId} installers={installers} />}
    </div>
  );
  const ready = !c.hardBlocked && (!c.needsOverride || override.trim().length >= 10);
  return (
    <div className="space-y-3 rounded-lg border-2 border-primary p-3" data-approve>
      <div className="text-base font-semibold">Approve this partner</div>
      {c.items.length === 0 ? <p className="text-sm text-success">Everything is ready.</p> : <div className="space-y-1 text-sm"><p className="font-medium">Still to do before approving:</p><ul className="list-disc space-y-1 pl-5">{c.items.map((i) => <li key={i.key}>{i.label}</li>)}</ul></div>}
      {installers.length > 0 && <WorkerCertifications applicationId={applicationId} installers={installers} />}
      {c.needsOverride && <label className="block text-sm font-medium">Office override reason (needed for the items above)<Textarea className="mt-1" rows={2} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Why it's OK to approve anyway (at least 10 characters)" /></label>}
      <RateOfferPanel applicationId={applicationId} showActivate={false} onActivate={async () => {}} />
      {showReviewDecision && <ReviewDecision applicationId={applicationId} />}
      <Button className="h-12 w-full text-base" disabled={!ready || busy} onClick={async () => { setBusy(true); const res = await activate({ applicationId, overrideReason: c.needsOverride ? override.trim() : undefined }, "Partner approved"); setBusy(false); if (res) { setMsg("welcome" in res && res.welcome ? res.welcome : null); if (!("welcome" in res && res.welcome) && c.loginEmail) { const l = await sendLogin({ applicationId, email: c.loginEmail }); setAutoLogin(l ? (l.status === "sent" ? { ok: true, text: `Approved. Login link sent to ${l.to}.`, link: l.link } : { ok: false, text: `Approved, but the login email didn't send: ${l.detail}`, link: l.link }) : { ok: false, text: "Approved, but the login link couldn't be made. Use \"Send login link\" below." }); } } await q.refetch(); }}>{busy ? "Approving…" : "Approve"}</Button>
      {!ready && <p className="text-xs text-muted-foreground">Approve unlocks when the list above is done.</p>}
    </div>
  );
}
