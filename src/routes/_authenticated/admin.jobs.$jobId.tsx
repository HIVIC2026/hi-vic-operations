import { AdminEstimateCard } from "@/components/portal/estimate";
import { AdminBookingOverride, AdminPartnerPanel, AppointmentPanel } from "@/components/portal/partner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ArrowLeft, HeartPulse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { PaymentBadge, Pill, SourceBadge, StageBadge, UrgencyBadge } from "@/components/portal/badges";
import { AdminAssignmentPanel, AssignmentStatusInline } from "@/components/portal/assignment";
import { AdminAuthorityPanel, BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, PaymentsPanel, QuotesPanel, Section, TimelinePanel, useJob } from "@/components/portal/panels";
import { MittiCard, PriceItemForm } from "@/components/portal/mitti";
import { RequirementCards } from "@/components/portal/requirements";
import { EscInstallPanel, PropertyIntelligenceCard } from "@/components/portal/intelligence";
import { Gate1EvidencePanel } from "@/components/portal/gate1";
import { IntakeSummary } from "@/components/portal/intake";
import { AllDocuments, Correspondence, ExportJobPack, JobFileHeader, JobTimeline, RetentionCard, SectionDocuments } from "@/components/portal/jobfile";

const TABS: [string, string][] = [
  ["overview", "Overview"], ["eligibility", "Property Intelligence"], ["authority", "Customer & Authorities"], ["piesa", "Electrical / PIESA"], ["assessment", "Measure-up"],
  ["quotes", "Quotes & Payments"], ["installation", "Installation"], ["evidence", "Evidence"], ["veec", "ESC / VEEC"], ["messages", "Correspondence"], ["history", "Timeline / Audit"], ["documents", "All Documents"],
];
import { useAction } from "@/hooks/use-me";
import { useServerFn } from "@tanstack/react-start";
import { RECORD_LABELS, type RecordKey } from "@/lib/compliance-timeline.core";
import {
  adjustQuote, assignContractor, generateInstallerQuotes, markReadyForVeec, regenerateRectificationQuote, runComplianceReview,
  setCommercialModel, setComplianceCheck, setEligibility, setHold, updateVeec, listComplianceRecords, recordComplianceItem,
} from "@/lib/portal.functions";
import { ELIGIBILITY_LABEL, aud, fmtDate, type EligibilityOutcome } from "@/lib/workflow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job – HI VIC Portal" }, { name: "description", content: "Job detail and workflow." }, { property: "og:title", content: "Job – HI VIC Portal" }, { property: "og:description", content: "Job detail and workflow." }] }),
  component: JobDetail,
});

function JobDetail() {
  const { jobId } = Route.useParams();
  const { data: job } = useJob(jobId);
  if (!job) return <AppShell wide><p className="text-muted-foreground">Loading…</p></AppShell>;
  return (
    <AppShell wide>
      <Link to="/admin" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Pipeline</Link>
      <JobFileHeader jobId={jobId} job={job} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <StageBadge stage={job.stage} /><PaymentBadge status={job.payment_status} /><UrgencyBadge urgency={job.urgency} days={job.days_remaining} /><SourceBadge channel={job.channel} business={job.originating_business_name} />
        {job.life_support && <Pill t="bad"><HeartPulse className="mr-1 h-3 w-3" /> Life support</Pill>}
        {job.eligibility_review_required ? <Pill t="warn">Gate 1 REVIEW REQUIRED</Pill> : job.eligibility_outcome && <Pill t="info">{ELIGIBILITY_LABEL[job.eligibility_outcome]}</Pill>}
      </div>
      <div className="mb-4"><BlockersPanel jobId={jobId} /></div>
      <Tabs defaultValue="overview">
        <TabsList className="mb-3 flex h-auto flex-wrap justify-start">
          {TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2"><RequirementCards jobId={jobId} isAdmin job={job} /></div>
                    <Section title="Status summary">
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted-foreground">Agreement / consent / VEEC assignment</dt><dd><AssignmentStatusInline jobId={jobId} /></dd>
              <dt className="text-muted-foreground">Payment</dt><dd><PaymentBadge status={job.payment_status} /> {job.deposit_cleared ? <span className="text-xs text-success">deposit cleared</span> : <span className="text-xs text-danger">deposit not cleared</span>}</dd>
              <dt className="text-muted-foreground">PIESA</dt><dd>{job.piesa_date ? `${fmtDate(job.piesa_date)} → install by ${fmtDate(job.install_deadline)}` : "Not recorded"}</dd>
              <dt className="text-muted-foreground">Electrician</dt><dd>{job.electrician_name ?? "Unassigned"}</dd>
              <dt className="text-muted-foreground">Installer</dt><dd>{job.installer_name ?? "Unassigned"}</dd>
              <dt className="text-muted-foreground">Last activity</dt><dd>{fmtDate(job.last_activity_at)}</dd>
            </dl>
          </Section>
          <JobSource jobId={jobId} channel={job.channel} model={job.commercial_model} business={job.originating_business_name} />
          <Assignments jobId={jobId} />
          <AdminPartnerPanel jobId={jobId} />
          <HoldControls jobId={jobId} stage={job.stage!} />
          <RetentionCard jobId={jobId} />
          <details className="rounded-xl border p-3 lg:col-span-2"><summary className="cursor-pointer text-sm font-medium">All bookings</summary><div className="mt-3 grid gap-4 lg:grid-cols-3"><BookingPanel jobId={jobId} kind="assessment" canBook={false} isAdmin /><BookingPanel jobId={jobId} kind="rectification" canBook isAdmin /><BookingPanel jobId={jobId} kind="installation" canBook isAdmin /></div></details>
        </TabsContent>
        <TabsContent value="eligibility" className="space-y-4"><IntakeSummary jobId={jobId} /><Gate1EvidencePanel jobId={jobId} /><AdminEstimateCard jobId={jobId} /><PropertyIntelligenceCard jobId={jobId} /><EligibilityForm jobId={jobId} /><SectionDocuments jobId={jobId} categories={["Property"]} /></TabsContent>
        <TabsContent value="authority" className="space-y-4"><AdminAssignmentPanel jobId={jobId} /><SectionDocuments jobId={jobId} categories={["Customer / Consent"]} /><details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">Legacy Owner Authority history (no longer a gate)</summary><div className="mt-3"><AdminAuthorityPanel jobId={jobId} /></div></details></TabsContent>
        <TabsContent value="piesa" className="space-y-4">
          <Section title="PIESA 30-day installation window">
            {job.piesa_date ? <p className="text-sm">Current PIESA {fmtDate(job.piesa_date)} → install by <strong>{fmtDate(job.install_deadline)}</strong> ({job.days_remaining} days) <UrgencyBadge urgency={job.urgency} days={job.days_remaining} /></p> : <p className="text-sm text-muted-foreground">No PIESA recorded yet.</p>}
          </Section>
          <AssessmentView jobId={jobId} part="piesa" />
          <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">Rectification</summary><div className="mt-3 space-y-4"><AssessmentView jobId={jobId} part="rectification" /><BookingPanel jobId={jobId} kind="rectification" canBook isAdmin /></div></details>
          <SectionDocuments jobId={jobId} categories={["Electrical / PIESA"]} />
        </TabsContent>
        <TabsContent value="assessment" className="space-y-4"><RequirementCards jobId={jobId} isAdmin job={job} /><AppointmentPanel jobId={jobId} /><BookingPanel jobId={jobId} kind="assessment" canBook={false} isAdmin /><AdminBookingOverride jobId={jobId} /><MittiCard jobId={jobId} isAdmin /><AssessmentView jobId={jobId} part="assessment" /><SectionDocuments jobId={jobId} categories={["Measure-up"]} /></TabsContent>
        <TabsContent value="quotes" className="space-y-4"><AdminQuotes jobId={jobId} /><PaymentsPanel jobId={jobId} isAdmin /><SectionDocuments jobId={jobId} categories={["Quotes", "Payments"]} /></TabsContent>
        <TabsContent value="installation" className="space-y-4"><EscInstallPanel jobId={jobId} /><BookingPanel jobId={jobId} kind="installation" canBook isAdmin /><EvidencePanel jobId={jobId} role="admin" gates={["installation"]} /><SectionDocuments jobId={jobId} categories={["Installation"]} /></TabsContent>
        <TabsContent value="evidence" className="space-y-4"><EvidencePanel jobId={jobId} role="admin" /><SectionDocuments jobId={jobId} categories={["Evidence"]} /></TabsContent>
        <TabsContent value="veec" className="space-y-4"><ComplianceRecords jobId={jobId} /><Compliance jobId={jobId} /><Veec jobId={jobId} /><SectionDocuments jobId={jobId} categories={["ESC / VEEC"]} /></TabsContent>
        <TabsContent value="messages" className="space-y-4"><MessagesPanel jobId={jobId} isAdmin /><Correspondence jobId={jobId} /></TabsContent>
        <TabsContent value="history" className="space-y-4"><JobTimeline jobId={jobId} /><details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">Raw workflow history</summary><div className="mt-3"><TimelinePanel jobId={jobId} /></div></details></TabsContent>
        <TabsContent value="documents" className="space-y-4"><AllDocuments jobId={jobId} /><ExportJobPack jobId={jobId} /></TabsContent>
      </Tabs>
    </AppShell>
  );
}

function EligibilityForm({ jobId }: { jobId: string }) {
  const save = useAction(setEligibility);
  const { data } = useQuery({ queryKey: ["jobraw", jobId], queryFn: async () => (await supabase.from("jobs").select("*, properties(*)").eq("id", jobId).single()).data });
  const [outcome, setOutcome] = useState<EligibilityOutcome | "">("");
  const [reason, setReason] = useState("");
  const [next, setNext] = useState("");
  if (!data) return null;
  const p = data.properties as { occupancy: string | null; year_built: number | null; is_residential: boolean | null } | null;
  return (
    <Section title="Gate 1 · Eligibility">
      <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Occupancy</dt><dd>{p?.occupancy?.replace("_", "-") ?? "—"}</dd>
        <dt className="text-muted-foreground">Residential</dt><dd>{p?.is_residential == null ? "To verify" : p.is_residential ? "Yes" : "No (commercial)"}</dd>
        <dt className="text-muted-foreground">Year built (relevant ceiling may differ)</dt><dd>{p?.year_built ?? "To verify"}{p?.year_built && new Date().getFullYear() - p.year_built < 5 && <Pill t="bad" className="ml-1">&lt; 5 yrs</Pill>}</dd>
        <dt className="text-muted-foreground">Est. area</dt><dd>{data.estimated_area_unknown ? "Unknown" : `${data.estimated_area_m2} m²`}</dd>
        <dt className="text-muted-foreground">Current</dt><dd>{data.eligibility_review_required ? "Review required (no customer category yet)" : data.eligibility_outcome ? ELIGIBILITY_LABEL[data.eligibility_outcome] : "Not set"}</dd>
      </dl>
      {data.eligibility_reason && <p className="mb-3 rounded bg-muted p-2 text-sm">{data.eligibility_reason}</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (outcome) save({ jobId, outcome, reason, nextAction: next }, "Eligibility saved"); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ELIGIBILITY_LABEL) as EligibilityOutcome[]).map((o) => (
            <button type="button" key={o} onClick={() => setOutcome(o)} className={`rounded-lg border p-2 text-sm font-medium ${outcome === o ? "border-primary bg-secondary" : ""}`}>{ELIGIBILITY_LABEL[o]}</button>
          ))}
        </div>
        <Textarea placeholder="Reason (e.g. residential, built 1985, existing R-value to verify onsite)" value={reason} onChange={(e) => setReason(e.target.value)} required />
        <Input placeholder="NEXT ACTION" value={next} onChange={(e) => setNext(e.target.value)} required />
        <Button type="submit" disabled={!outcome}>Save outcome</Button>
      </form>
    </Section>
  );
}

const MODEL_LABEL: Record<string, string> = {
  hivic_invoices_owner: "HI VIC invoices the owner (Xero)",
  installer_invoices_owner: "Installer invoices the owner; HI VIC charges installer an AP fee",
  not_configured: "Commercial setup required",
};

function JobSource({ jobId, channel, model, business }: { jobId: string; channel: string | null; model: string | null; business: string | null }) {
  const set = useAction(setCommercialModel);
  const [m, setM] = useState(model ?? "not_configured");
  const [reason, setReason] = useState("");
  return (
    <Section title="Job source">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Channel</dt><dd><SourceBadge channel={channel} /></dd>
        {channel === "installer_sourced" && <><dt className="text-muted-foreground">Originating installer</dt><dd>{business ?? "—"} <span className="text-xs text-muted-foreground">(permanent)</span></dd></>}
        <dt className="text-muted-foreground">Invoice route</dt><dd>{MODEL_LABEL[model ?? ""] ?? "—"}</dd>
      </dl>
      {channel === "installer_sourced" && (
        <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); await set({ jobId, model: m as "not_configured", reason }, "Invoice route updated"); setReason(""); }}>
          {model !== "hivic_invoices_owner" && <p className="rounded bg-warning-soft p-2 text-xs">Payment, deposit and rectification/installation scheduling stay locked until an invoice route is set. Installer-invoices route is recorded but not yet supported – it stays locked.</p>}
          <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={m} onChange={(e) => setM(e.target.value)}>
            {Object.entries(MODEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" required minLength={5} />
          <Button type="submit" size="sm" variant="outline">Save invoice route</Button>
        </form>
      )}
    </Section>
  );
}

function Assignments({ jobId }: { jobId: string }) {
  const assign = useAction(assignContractor);
  const { data } = useQuery({
    queryKey: ["assign", jobId],
    queryFn: async () => {
      const [{ data: a }, { data: roles }, { data: rr }] = await Promise.all([
        supabase.from("job_assignments").select("*, profiles!job_assignments_user_id_fkey(full_name)").eq("job_id", jobId).order("assigned_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role, profiles(full_name)").in("role", ["electrician", "installer"]),
        supabase.from("reassignment_requests").select("*").eq("job_id", jobId).eq("status", "open"),
      ]);
      return { a: a ?? [], roles: roles ?? [], rr: rr ?? [] };
    },
  });
  return (
    <Section title="Assigned trades">
      {data?.rr.map((r) => <p key={r.id} className="mb-2 rounded bg-warning-soft p-2 text-sm">Owner requested a different {r.role}: {r.reason}</p>)}
      {(["electrician", "installer"] as const).map((role) => {
        const cur = data?.a.find((x) => x.role === role && x.active);
        return (
          <div key={role} className="mb-3">
            <Label className="capitalize">{role}</Label>
            <select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={cur?.user_id ?? ""} onChange={(e) => e.target.value && assign({ jobId, userId: e.target.value, role }, "Assigned")}>
              <option value="">— Unassigned —</option>
              {data?.roles.filter((r) => r.role === role).map((r) => <option key={r.user_id} value={r.user_id}>{(r.profiles as { full_name: string | null } | null)?.full_name}</option>)}
            </select>
          </div>
        );
      })}
      {!data?.roles.length && <p className="text-xs text-muted-foreground">No electricians/installers yet — grant roles on the Users page.</p>}
    </Section>
  );
}

function HoldControls({ jobId, stage }: { jobId: string; stage: string }) {
  const act = useAction(setHold);
  return (
    <Section title="Exceptions">
      <div className="flex flex-wrap gap-2">
        {stage === "on_hold" ? <Button onClick={() => act({ jobId, action: "resume" }, "Resumed")}>Resume job</Button> : stage !== "cancelled" && (
          <>
            <Button variant="outline" onClick={() => { const r = prompt("Reason for hold"); if (r) act({ jobId, action: "hold", reason: r }, "On hold"); }}>Put on hold</Button>
            <Button variant="destructive" onClick={() => { const r = prompt("Reason for cancelling"); if (r) act({ jobId, action: "cancel", reason: r }, "Cancelled"); }}>Cancel job</Button>
          </>
        )}
      </div>
    </Section>
  );
}

function AssessmentView({ jobId, part }: { jobId: string; part: "assessment" | "piesa" | "rectification" }) {
  const { data } = useQuery({
    queryKey: ["assessment", jobId],
    queryFn: async () => {
      const [{ data: a }, { data: items }, { data: piesa }] = await Promise.all([
        supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("rectification_items").select("*").eq("job_id", jobId).neq("status", "removed"),
        supabase.from("piesa_records").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
      ]);
      return { a, items: items ?? [], piesa: piesa ?? [] };
    },
  });
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
      <Section title="Rectification items">
        {data.items.length ? <ul className="space-y-1 text-sm">{data.items.map((i) => <li key={i.id}><div className="flex justify-between gap-2"><span>{i.description} × {Number(i.quantity)}{i.is_other && <span className="text-xs text-muted-foreground"> — {i.other_unit_price_inc_gst != null ? `${aud(i.other_unit_price_inc_gst)} ea · ` : ""}{i.explanation}</span>}{i.source === "mitti" && <span className="text-xs text-muted-foreground"> · from Mitti</span>}</span><span className="flex gap-1">{i.needs_office_pricing && <Pill t="bad">needs office pricing</Pill>}<Pill t={i.status === "completed" ? "good" : "warn"}>{i.status}</Pill></span></div>{i.needs_office_pricing && i.status === "required" && <PriceItemForm itemId={i.id} />}</li>)}</ul> : <p className="text-sm text-muted-foreground">No rectification required.</p>}
      </Section>
    );
  return (
    <Section title="Electrical assessment record">
      <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{fmt(v)}</dd></Fragment>)}</dl>
    </Section>
  );
}

function AdminQuotes({ jobId }: { jobId: string }) {
  const gen = useAction(generateInstallerQuotes);
  const regen = useAction(regenerateRectificationQuote);
  const adjust = useAction(adjustQuote);
  const { data } = useQuery({
    queryKey: ["adminquotes", jobId],
    queryFn: async () => (await supabase.from("quotes").select("*, quote_items(*), quote_internals(*), quote_adjustments(*)").eq("job_id", jobId).order("created_at", { ascending: false })).data ?? [],
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { quantity: number; unit_price_inc_gst: number }>>({});
  const [reason, setReason] = useState("");
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => gen({ jobId }, "Installer quotes generated")}>Generate installer quotes</Button>
        <Button variant="outline" onClick={() => regen({ jobId }, "Rectification quote regenerated")}>Regenerate rectification quote</Button>
      </div>
      <QuotesPanel jobId={jobId} canRespond={false} />
      <Section title="Internal pricing (admin only)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="p-2">Quote</th><th className="p-2">Status</th><th className="p-2">Cost ex GST</th><th className="p-2">AP margin</th><th className="p-2">AP fee</th><th className="p-2">Customer inc GST</th><th className="p-2" /></tr></thead>
            <tbody>
              {data?.map((q) => {
                const int = q.quote_internals as unknown as { cost_ex_gst: number; ap_margin_ex_gst: number; ap_fee_ex_gst: number } | null;
                return (
                  <Fragment key={q.id}>
                    <tr className="border-t">
                      <td className="p-2">{q.option_label} {q.manually_adjusted && <Pill t="warn">adjusted</Pill>}</td><td className="p-2">{q.status}</td>
                      <td className="p-2">{aud(int?.cost_ex_gst)}</td><td className="p-2">{aud(int?.ap_margin_ex_gst)}</td><td className="p-2">{aud(int?.ap_fee_ex_gst)}</td>
                      <td className="p-2 font-semibold">{aud(q.customer_total_inc_gst)}</td>
                      <td className="p-2">{q.status === "issued" && <Button size="sm" variant="outline" onClick={() => { setEditing(editing === q.id ? null : q.id); setEdits({}); setReason(""); }}>Adjust</Button>}</td>
                    </tr>
                    {editing === q.id && (
                      <tr><td colSpan={7} className="bg-muted p-3">
                        {q.quote_items.map((i) => (
                          <div key={i.id} className="mb-2 grid grid-cols-[1fr_90px_120px] items-center gap-2">
                            <span>{i.description}</span>
                            <Input type="number" step="0.01" defaultValue={Number(i.quantity)} onChange={(e) => setEdits({ ...edits, [i.id]: { quantity: Number(e.target.value), unit_price_inc_gst: edits[i.id]?.unit_price_inc_gst ?? Number(i.unit_price_inc_gst) } })} />
                            <Input type="number" step="0.01" defaultValue={Number(i.unit_price_inc_gst)} onChange={(e) => setEdits({ ...edits, [i.id]: { quantity: edits[i.id]?.quantity ?? Number(i.quantity), unit_price_inc_gst: Number(e.target.value) } })} />
                          </div>
                        ))}
                        <Textarea placeholder="Reason for adjustment (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button className="mt-2" disabled={reason.trim().length < 5} onClick={async () => { await adjust({ quoteId: q.id, reason, items: Object.entries(edits).map(([id, v]) => ({ id, ...v })) }, "Quote adjusted"); setEditing(null); }}>Save adjustment</Button>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function Compliance({ jobId }: { jobId: string }) {
  const run = useAction(runComplianceReview);
  const set = useAction(setComplianceCheck);
  const ready = useAction(markReadyForVeec);
  const { data } = useQuery({ queryKey: ["compliance", jobId], queryFn: async () => (await supabase.from("compliance_checks").select("*").eq("job_id", jobId).order("sort")).data ?? [] });
  return (
    <Section title="Gate 6 · AP compliance review" action={<Button size="sm" variant="outline" onClick={() => run({ jobId }, "Automated checks updated")}>Run automated checks</Button>}>
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
      <Button className="mt-3 w-full" onClick={() => ready({ jobId }, "Ready for VEEC")}>Mark Ready for VEEC</Button>
    </Section>
  );
}

function Veec({ jobId }: { jobId: string }) {
  const save = useAction(updateVeec);
  const { data } = useQuery({ queryKey: ["veec", jobId], queryFn: async () => (await supabase.from("veec_lodgements").select("*").eq("job_id", jobId).maybeSingle()).data });
  if (!data) return null;
  return (
    <Section title="VEEC lodgement">
      <form key={data.updated_at} className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({ jobId, quantity: f.get("quantity") ? Number(f.get("quantity")) : null, status: f.get("status") as "not_submitted", submission_reference: (f.get("ref") as string) || null, submitted_date: (f.get("date") as string) || null, notes: (f.get("notes") as string) || null, reason: (f.get("reason") as string) || null }, "VEEC saved");
      }}>
        <p className="text-xs text-muted-foreground">Submitted or approved needs quantity, ESC reference and submitted date. Approved is final. Changing lodged details needs a reason.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Quantity</Label><Input name="quantity" type="number" step="0.01" min="0" defaultValue={data.quantity ?? ""} /></div>
          <div><Label>Status</Label><select name="status" defaultValue={data.status} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{["not_submitted", "submitted", "approved", "rejected"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div><Label>ESC submission ref</Label><Input name="ref" defaultValue={data.submission_reference ?? ""} /></div>
          <div><Label>Submitted date</Label><Input name="date" type="date" max={new Date().toISOString().slice(0, 10)} defaultValue={data.submitted_date ?? ""} /></div>
        </div>
        <Textarea name="notes" placeholder="Notes (required if rejected)" defaultValue={data.notes ?? ""} />
        {["submitted", "approved"].includes(data.status) && <Input name="reason" placeholder="Reason for changing lodged details" />}
        <Button type="submit">Save lodgement</Button>
      </form>
    </Section>
  );
}

function ComplianceRecords({ jobId }: { jobId: string }) {
  const list = useServerFn(listComplianceRecords);
  const record = useAction(recordComplianceItem);
  const { data = [] } = useQuery({ queryKey: ["compliance-records", jobId], queryFn: () => list({ data: { jobId } }) });
  const [open, setOpen] = useState<RecordKey | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Section title="Activity 48 records">
      <p className="mb-2 text-xs text-muted-foreground">Permanent once saved. Missing items block the stage shown: life support plan (PIESA booking), pre-install documents (install start), safety assessment, completion documents and $200 co-payment (AP review — co-payment also clears when Xero shows ≥ $200 paid), assignment copy (Ready for VEEC).</p>
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
