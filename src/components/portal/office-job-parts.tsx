// O2 Job page working parts kept from the old job page (decisions 218/223): trade coverage (229), the one eligibility
// change-result form, the PIESA / electrical fixes records, compliance checks, VEEC lodgement and the
// Activity 48 records. Moved here unchanged; Approve now lives on the one-screen Final check (decision 372, final-check.tsx).
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Pill } from "@/components/portal/badges";
import { Section } from "@/components/portal/panels";
import { PriceItemForm } from "@/components/portal/mitti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getAdminJobEligibility } from "@/lib/admin-records.functions";
import { getJobCoverage, sendNoCoverageEmail } from "@/lib/coverage.functions";
import { RECORD_LABELS, type RecordKey } from "@/lib/compliance-timeline.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { ELIGIBILITY_LABEL, aud, fmtDate, type EligibilityOutcome } from "@/lib/workflow";
import { draftVeecReply, listComplianceRecords, markVeecReplySent, recordComplianceItem, runComplianceReview, setComplianceCheck, setEligibility, updateVeec } from "@/lib/portal.functions";
import { panelLoad, readOrThrow } from "@/lib/panel-load.core";
import { LoadFailed } from "@/components/portal/load-failed";

export function JobCoverage({ jobId }: { jobId: string }) {
  const load = useServerFn(getJobCoverage);
  const send = useAction(sendNoCoverageEmail);
  const { data, error, isPending } = useQuery({ queryKey: ["job-coverage", jobId], queryFn: () => load({ data: { jobId } }), retry: 2 });
  if (isPending) return <Section title="Trade coverage"><p className="text-sm text-muted-foreground">Checking REC and installer coverage…</p></Section>;
  if (error || !data) return <Section title="Trade coverage"><p role="alert" className="text-sm text-danger">Coverage could not be checked. Do not offer this job until coverage is confirmed.</p></Section>;
  const label = (state: string) => ({ serviceable: "Serviceable", partial: "Needs verification", unserviceable: "Not covered", not_configured: "Not configured" }[state] ?? state);
  const provenUnavailable = [data.rec.state, data.installer.state].includes("unserviceable") && ![data.rec.state, data.installer.state].some((state) => state === "partial" || state === "not_configured");
  return <Section title="Trade coverage"><div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs font-bold uppercase text-muted-foreground">REC / electrician</div><div className="font-semibold">{label(data.rec.state)}</div><div className="text-xs text-muted-foreground">{data.rec.matches.map((item) => item.name).join(", ") || "No eligible verified REC"}</div></div><div><div className="text-xs font-bold uppercase text-muted-foreground">Installer</div><div className="font-semibold">{label(data.installer.state)}</div><div className="text-xs text-muted-foreground">{data.installer.matches.map((item) => item.name).join(", ") || "No eligible verified installer"}</div></div></div><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link to="/admin/partners" search={{ tab: "coverage" }}>Partners › Coverage</Link></Button>{provenUnavailable && <Button size="sm" variant="outline" onClick={() => send({ jobId }, "Service-area update sent")}>Email service-area update</Button>}</div>{provenUnavailable && <p className="mt-2 text-xs text-muted-foreground">This action still checks the communications lock, owner consent, suppression status and delivery setup before sending.</p>}</Section>;
}

export function EligibilityForm({ jobId }: { jobId: string }) {
  const save = useAction(setEligibility);
  const load = useServerFn(getAdminJobEligibility);
  const { data, error, refetch } = useQuery({ queryKey: ["jobraw", jobId], queryFn: () => load({ data: { jobId } }), retry: 3, staleTime: 30_000 });
  const [outcome, setOutcome] = useState<EligibilityOutcome | "">("");
  const [reason, setReason] = useState("");
  const [next, setNext] = useState("");
  if (error) return <Section title="Eligibility · change the result"><p className="text-sm text-danger">Eligibility details could not be loaded.</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>Try again</Button></Section>;
  if (!data) return <Section title="Eligibility · change the result"><p className="text-sm text-muted-foreground">Loading eligibility details…</p></Section>;
  const p = data.properties as { occupancy: string | null; year_built: number | null; is_residential: boolean | null } | null;
  return (
    <Section title="Eligibility · change the result">
      <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Residential</dt><dd>{p?.is_residential == null ? "To verify" : p.is_residential ? "Yes" : "No (commercial)"}</dd>
        <dt className="text-muted-foreground">Year built (relevant ceiling may differ)</dt><dd>{p?.year_built ?? "To verify"}{p?.year_built && new Date().getFullYear() - p.year_built < 5 && <Pill t="bad" className="ml-1">&lt; 5 yrs</Pill>}</dd>
        <dt className="text-muted-foreground">Est. area</dt><dd>{data.estimated_area_unknown ? "Unknown" : `${data.estimated_area_m2} m²`}</dd>
        <dt className="text-muted-foreground">Current</dt><dd>{data.eligibility_review_required ? "Review required (no customer category yet)" : data.eligibility_outcome ? ELIGIBILITY_LABEL[data.eligibility_outcome] : "Not set"}</dd>
      </dl>
      {data.eligibility_reason && <p className="mb-3 rounded bg-muted p-2 text-sm">{data.eligibility_reason}</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (outcome) save({ jobId, outcome, reason, nextAction: next.trim() || undefined }, "Eligibility saved"); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ELIGIBILITY_LABEL) as EligibilityOutcome[]).map((o) => (
            <button type="button" key={o} onClick={() => setOutcome(o)} className={`rounded-lg border p-2 text-sm font-medium ${outcome === o ? "border-primary bg-secondary" : ""}`}>{ELIGIBILITY_LABEL[o]}</button>
          ))}
        </div>
        <Textarea placeholder="Reason (e.g. residential, built 1985, existing R-value to verify onsite)" value={reason} onChange={(e) => setReason(e.target.value)} required />
        <Input placeholder="Note (optional)" value={next} onChange={(e) => setNext(e.target.value)} />
        <Button type="submit" disabled={!outcome}>Save outcome</Button>
      </form>
    </Section>
  );
}

export function AssessmentView({ jobId, part }: { jobId: string; part: "assessment" | "piesa" | "rectification" }) {
  const { data, error, refetch } = useQuery({
    queryKey: ["assessment", jobId],
    queryFn: async () => {
      const [ra, ri, rp] = await Promise.all([
        supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("rectification_items").select("*").eq("job_id", jobId).neq("status", "removed"),
        supabase.from("piesa_records").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
      ]);
      return { a: readOrThrow(ra), items: readOrThrow(ri) ?? [], piesa: readOrThrow(rp) ?? [] };
    },
  });
  const title = part === "piesa" ? "PIESA records (entered once by the electrician)" : part === "rectification" ? "Electrical fixes items" : "Electrical assessment record";
  if (panelLoad({ error, data }) === "failed") return <Section title={title}><LoadFailed what={title} onRetry={() => void refetch()} /></Section>;
  if (!data) return null;
  if (!data.a && part === "assessment") return <Section title="Assessment"><p className="text-sm text-muted-foreground">Not started by the electrician yet.</p></Section>;
  const a = data.a ?? ({} as NonNullable<typeof data.a>);
  const rows: [string, unknown][] = [
    ["Status", a.status], ["Downlights", a.downlights_qty != null && `${a.downlights_qty} × ${a.downlights_type ?? ""} (${a.downlights_upgrade_qty ?? 0} to upgrade)`],
    ["Exhaust fans", a.exhaust_fans_qty != null && `${a.exhaust_fans_qty} (${a.exhaust_fans_clearance_qty ?? 0} need clearance)`], ["Hazards", a.hazards], ["Switchboard", a.switchboard_condition], ["RCDs present", a.rcds_present],
    ["RCDs required", a.rcds_required_qty], ["Life support", a.life_support_confirmed], ["PIESA outcome", a.piesa_outcome], ["Assessed on", a.assessed_on], ["Mitti ID", a.external_mitti_id ? `${a.external_mitti_id} (${a.mitti_sync_status})` : a.mitti_sync_status], ["Notes", a.notes],
  ];
  const fmt = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
  if (part === "piesa")
    return (
      <Section title="PIESA records (entered once by the electrician)">
        {data.piesa.length ? data.piesa.map((p) => <p key={p.id} className="text-sm">{fmtDate(p.completed_date)} · {p.kind.replace("_", " ")} · <strong>{p.outcome}</strong> {p.external_mitti_id && `· Mitti ${p.external_mitti_id}`} {p.is_current && <Pill t="good">current</Pill>}</p>) : <p className="text-sm text-muted-foreground">None.</p>}
      </Section>
    );
  if (part === "rectification")
    return (
      <Section title="Electrical fixes items">
        {data.items.length ? <ul className="space-y-1 text-sm">{data.items.map((i) => <li key={i.id}><div className="flex justify-between gap-2"><span>{i.description} × {Number(i.quantity)}{i.is_other && <span className="text-xs text-muted-foreground"> — {i.other_unit_price_inc_gst != null ? `${aud(i.other_unit_price_inc_gst)} ea · ` : ""}{i.explanation}</span>}{i.source === "mitti" && <span className="text-xs text-muted-foreground"> · from Mitti</span>}</span><span className="flex gap-1">{i.needs_office_pricing && <Pill t="bad">needs office pricing</Pill>}<Pill t={i.status === "completed" ? "good" : "warn"}>{i.status}</Pill></span></div>{i.needs_office_pricing && i.status === "required" && <PriceItemForm itemId={i.id} />}</li>)}</ul> : <p className="text-sm text-muted-foreground">No electrical fixes required.</p>}
      </Section>
    );
  return (
    <Section title="Electrical assessment record">
      <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{fmt(v)}</dd></Fragment>)}</dl>
    </Section>
  );
}

/** Compliance checks (workflow steps 28–29). Decision 372: Approve moved to the one-screen Final check
 *  (final-check.tsx, the one human Approve), which lists these blocking checks among its items. */
export function Compliance({ jobId }: { jobId: string }) {
  const run = useAction(runComplianceReview);
  const set = useAction(setComplianceCheck);
  const { data, error, refetch } = useQuery({ queryKey: ["compliance", jobId], queryFn: async () => readOrThrow(await supabase.from("compliance_checks").select("*").eq("job_id", jobId).order("sort")) ?? [] });
  return (
    <Section title="Compliance checks" action={<Button size="sm" variant="outline" onClick={() => run({ jobId }, "Automated checks updated")}>Run automated checks</Button>}>
      {panelLoad({ error, data }) === "failed" && <LoadFailed what="Compliance checks" onRetry={() => void refetch()} />}
      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <div><div className="font-medium">{c.label}{c.blocking && <span className="ml-1 text-xs text-danger">blocking</span>}</div>{c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}</div>
            <div className="flex gap-1">
              {(["pass", "fail", "pending"] as const).map((s) => (
                <button key={s} onClick={() => set({ checkId: c.id, status: s }, "Updated")} className={`rounded px-2 py-1 text-xs font-semibold ${c.status === s ? (s === "pass" ? "bg-success text-primary-foreground" : s === "fail" ? "bg-danger text-primary-foreground" : "bg-muted-foreground text-primary-foreground") : "bg-muted"}`}>{s}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Veec({ jobId }: { jobId: string }) {
  const save = useAction(updateVeec);
  const { data, error, refetch } = useQuery({ queryKey: ["veec", jobId], queryFn: async () => readOrThrow(await supabase.from("veec_lodgements").select("*").eq("job_id", jobId).maybeSingle()) });
  const [pickedStatus, setPickedStatus] = useState<string | null>(null);
  if (panelLoad({ error, data }) === "failed") return <Section title="VEEC lodgement"><LoadFailed what="VEEC lodgement" onRetry={() => void refetch()} /></Section>;
  if (!data) return null;
  const shownStatus = pickedStatus ?? data.status;
  return (
    <Section title="VEEC lodgement">
      <form key={data.updated_at} className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({ jobId, quantity: f.get("quantity") ? Number(f.get("quantity")) : null, status: f.get("status") as "not_submitted", submission_reference: (f.get("ref") as string) || null, submitted_date: (f.get("date") as string) || null, notes: (f.get("notes") as string) || null, query_text: (f.get("query_text") as string) || null, query_received_at: (f.get("query_received_at") as string) || null, reason: (f.get("reason") as string) || null }, "VEEC saved");
      }}>
        <p className="text-xs text-muted-foreground">Submitted or approved needs quantity, ESC reference and submitted date. Approved is final. Changing lodged details needs a reason.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Quantity</Label><Input name="quantity" type="number" step="0.01" min="0" defaultValue={data.quantity ?? ""} /></div>
          <div><Label>Status</Label><select name="status" value={shownStatus} onChange={(e) => setPickedStatus(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{["not_submitted", "submitted", "query", "approved", "rejected"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div><Label>ESC submission ref</Label><Input name="ref" defaultValue={data.submission_reference ?? ""} /></div>
          <div><Label>Submitted date</Label><Input name="date" type="date" max={melbourneToday()} defaultValue={data.submitted_date ?? ""} /></div>
        </div>
        <Textarea name="notes" placeholder="Notes (required if rejected)" defaultValue={data.notes ?? ""} />
        {shownStatus === "query" && (
          <div className="space-y-2 rounded-md border p-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><Label>What the Registry asked</Label><Textarea name="query_text" defaultValue={data.query_text ?? ""} /></div>
              <div><Label>Query received</Label><Input name="query_received_at" type="date" max={melbourneToday()} defaultValue={data.query_received_at ?? ""} /></div>
            </div>
          </div>
        )}
        {["submitted", "approved"].includes(data.status) && <Input name="reason" placeholder="Reason for changing lodged details" />}
        <Button type="submit">Save lodgement</Button>
      </form>
      {data.status === "query" && <VeecQueryReply jobId={jobId} draft={data.reply_draft ?? ""} sentAt={data.reply_sent_at ?? null} />}
    </Section>
  );
}

function VeecQueryReply({ jobId, draft, sentAt }: { jobId: string; draft: string; sentAt: string | null }) {
  const qc = useQueryClient();
  const gen = useAction(draftVeecReply);
  const mark = useAction(markVeecReplySent);
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <p className="text-xs text-muted-foreground">The reply is sent in the Registry's own system. Draft it here, edit it, send it there, then record the date you sent it. Nothing is sent from the portal.</p>
      {sentAt ? <p className="text-sm">Reply sent {sentAt}.</p> : (
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await gen({ jobId }, "Draft ready"); if (r?.draft) setText(r.draft); } finally { setBusy(false); } }}>{busy ? "Drafting…" : "Draft reply (AI)"}</Button>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Draft reply" rows={6} />
          <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try { await mark({ jobId, replyDraft: text, sentDate: f.get("sent") as string }, "Reply recorded"); void qc.invalidateQueries({ queryKey: ["veec", jobId] }); } finally { setBusy(false); } }}>
            <div><Label>Date sent</Label><Input name="sent" type="date" required max={melbourneToday()} /></div>
            <Button type="submit" disabled={busy || text.trim().length < 5}>Mark reply sent</Button>
          </form>
        </>
      )}
    </div>
  );
}

export function ComplianceRecords({ jobId }: { jobId: string }) {
  const list = useServerFn(listComplianceRecords);
  const record = useAction(recordComplianceItem);
  const { data, error, refetch } = useQuery({ queryKey: ["compliance-records", jobId], queryFn: () => list({ data: { jobId } }) });
  const [open, setOpen] = useState<RecordKey | null>(null);
  const today = melbourneToday();
  // A failed or unfinished read must never list every record as missing with a Record button.
  const load = panelLoad({ error, data });
  if (load === "failed") return <Section title="Activity 48 records"><LoadFailed what="Activity 48 records" onRetry={() => void refetch()} /></Section>;
  if (load === "loading" || !data) return <Section title="Activity 48 records"><p className="text-sm text-muted-foreground">Loading Activity 48 records…</p></Section>;
  return (
    <Section title="Activity 48 records">
      <p className="mb-2 text-xs text-muted-foreground">Permanent once saved. Missing items block the stage shown: life support plan (PIESA booking), pre-install documents (install start), safety assessment, completion documents and $200 co-payment (Final check — co-payment also clears when Xero shows ≥ $200 paid), assignment copy (Ready for VEEC).</p>
      <ul className="divide-y text-sm">
        {(Object.keys(RECORD_LABELS) as RecordKey[]).map((k) => {
          const r = data.find((x) => x.record_key === k);
          return (
            <li key={k} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <span>{RECORD_LABELS[k]}</span>
                {r ? <Pill t="good">Recorded {fmtDate(r.occurred_at)}</Pill> : <Button size="sm" variant="outline" onClick={() => setOpen(open === k ? null : k)}>Record</Button>}
              </div>
              {r?.reference && <div className="text-xs text-muted-foreground">Ref: {r.reference}</div>}
              {!r && open === k && (
                <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => {
                  e.preventDefault(); const f = new FormData(e.currentTarget);
                  record({ jobId, key: k, occurredAt: f.get("date") as string, reference: (f.get("ref") as string) || null, notes: (f.get("notes") as string) || null }, "Recorded");
                  setOpen(null);
                }}>
                  <Input name="date" type="date" required max={today} defaultValue={today} />
                  <Input name="ref" placeholder="Reference / document" />
                  <Input name="notes" placeholder="Notes" />
                  <Button type="submit" className="sm:col-span-3">Save permanently</Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
