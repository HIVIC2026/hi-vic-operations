import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, HeartPulse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { PaymentBadge, Pill, StageBadge, UrgencyBadge } from "@/components/portal/badges";
import { BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, PaymentsPanel, QuotesPanel, Section, TimelinePanel, useJob } from "@/components/portal/panels";
import { useAction } from "@/hooks/use-me";
import {
  adjustQuote, assignContractor, generateInstallerQuotes, markReadyForVeec, regenerateRectificationQuote, runComplianceReview,
  setComplianceCheck, setEligibility, setHold, updateVeec,
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-primary">{job.job_number}</div>
          <h1 className="text-2xl font-bold tracking-tight">{job.property_address}</h1>
          <p className="text-sm text-muted-foreground">{job.owner_name} · {job.owner_phone} · {job.owner_email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StageBadge stage={job.stage} /><PaymentBadge status={job.payment_status} /><UrgencyBadge urgency={job.urgency} days={job.days_remaining} />
            {job.life_support && <Pill t="bad"><HeartPulse className="mr-1 h-3 w-3" /> Life support</Pill>}
            {job.eligibility_outcome && <Pill t="info">{ELIGIBILITY_LABEL[job.eligibility_outcome]}</Pill>}
          </div>
        </div>
        <div className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground"><div className="text-xs font-semibold uppercase">Next action</div>{job.next_action}</div>
      </div>
      <div className="mb-4"><BlockersPanel jobId={jobId} /></div>
      <Tabs defaultValue="overview">
        <TabsList className="mb-3 flex h-auto flex-wrap justify-start">
          {["overview", "assessment", "quotes", "payments", "bookings", "evidence", "compliance", "messages", "history"].map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <EligibilityForm jobId={jobId} />
          <Assignments jobId={jobId} />
          <HoldControls jobId={jobId} stage={job.stage!} />
          <Section title="PIESA deadline">
            {job.piesa_date ? <p className="text-sm">PIESA {fmtDate(job.piesa_date)} → install by <strong>{fmtDate(job.install_deadline)}</strong> ({job.days_remaining} days)</p> : <p className="text-sm text-muted-foreground">No PIESA recorded yet.</p>}
          </Section>
        </TabsContent>
        <TabsContent value="assessment"><AssessmentView jobId={jobId} /></TabsContent>
        <TabsContent value="quotes" className="space-y-4"><AdminQuotes jobId={jobId} /></TabsContent>
        <TabsContent value="payments"><PaymentsPanel jobId={jobId} isAdmin /></TabsContent>
        <TabsContent value="bookings" className="grid gap-4 lg:grid-cols-3">
          <BookingPanel jobId={jobId} kind="assessment" canBook /><BookingPanel jobId={jobId} kind="rectification" canBook /><BookingPanel jobId={jobId} kind="installation" canBook />
        </TabsContent>
        <TabsContent value="evidence"><EvidencePanel jobId={jobId} role="admin" /></TabsContent>
        <TabsContent value="compliance" className="grid gap-4 lg:grid-cols-2"><Compliance jobId={jobId} /><Veec jobId={jobId} /></TabsContent>
        <TabsContent value="messages"><MessagesPanel jobId={jobId} isAdmin /></TabsContent>
        <TabsContent value="history"><TimelinePanel jobId={jobId} /></TabsContent>
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
        <dt className="text-muted-foreground">Year built</dt><dd>{p?.year_built ?? "To verify"}{p?.year_built && new Date().getFullYear() - p.year_built < 5 && <Pill t="bad" className="ml-1">&lt; 5 yrs</Pill>}</dd>
        <dt className="text-muted-foreground">Est. area</dt><dd>{data.estimated_area_unknown ? "Unknown" : `${data.estimated_area_m2} m²`}</dd>
        <dt className="text-muted-foreground">Current</dt><dd>{data.eligibility_outcome ? ELIGIBILITY_LABEL[data.eligibility_outcome] : "Not set"}</dd>
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

function AssessmentView({ jobId }: { jobId: string }) {
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
  if (!data?.a) return <Section title="Assessment"><p className="text-sm text-muted-foreground">Not started by the electrician yet.</p></Section>;
  const a = data.a;
  const rows: [string, unknown][] = [
    ["Status", a.status], ["Measured area", a.measured_area_m2 && `${a.measured_area_m2} m²`], ["Insulation present", a.insulation_present], ["Existing R-value", a.existing_r_value],
    ["Removal", a.removal_required ? `${a.removal_m2} m²` : a.removal_required], ["Access", a.access_difficulty], ["Downlights", a.downlights_qty != null && `${a.downlights_qty} × ${a.downlights_type ?? ""} (${a.downlights_upgrade_qty ?? 0} to upgrade)`],
    ["Exhaust fans", a.exhaust_fans_qty != null && `${a.exhaust_fans_qty} (${a.exhaust_fans_clearance_qty ?? 0} need clearance)`], ["Hazards", a.hazards], ["Switchboard", a.switchboard_condition], ["RCDs present", a.rcds_present],
    ["RCDs required", a.rcds_required_qty], ["Life support", a.life_support_confirmed], ["PIESA outcome", a.piesa_outcome], ["Assessed on", a.assessed_on], ["Mitti ID", a.external_mitti_id ? `${a.external_mitti_id} (${a.mitti_sync_status})` : a.mitti_sync_status], ["Notes", a.notes],
  ];
  const fmt = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Gate 2 · Measure-up & electrical safety">
        <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <><dt key={k} className="text-muted-foreground">{k}</dt><dd key={k + "v"}>{fmt(v)}</dd></>)}</dl>
      </Section>
      <div className="space-y-4">
        <Section title="Rectification items">
          {data.items.length ? <ul className="space-y-1 text-sm">{data.items.map((i) => <li key={i.id} className="flex justify-between"><span>{i.description} × {Number(i.quantity)}{i.is_other && <span className="text-xs text-muted-foreground"> — {i.explanation}</span>}</span><Pill t={i.status === "completed" ? "good" : "warn"}>{i.status}</Pill></li>)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}
        </Section>
        <Section title="PIESA records">
          {data.piesa.map((p) => <p key={p.id} className="text-sm">{fmtDate(p.completed_date)} · {p.kind.replace("_", " ")} · <strong>{p.outcome}</strong> {p.is_current && <Pill t="good">current</Pill>}</p>)}
        </Section>
      </div>
    </div>
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
                  <>
                    <tr key={q.id} className="border-t">
                      <td className="p-2">{q.option_label} {q.manually_adjusted && <Pill t="warn">adjusted</Pill>}</td><td className="p-2">{q.status}</td>
                      <td className="p-2">{aud(int?.cost_ex_gst)}</td><td className="p-2">{aud(int?.ap_margin_ex_gst)}</td><td className="p-2">{aud(int?.ap_fee_ex_gst)}</td>
                      <td className="p-2 font-semibold">{aud(q.customer_total_inc_gst)}</td>
                      <td className="p-2">{q.status === "issued" && <Button size="sm" variant="outline" onClick={() => { setEditing(editing === q.id ? null : q.id); setEdits({}); setReason(""); }}>Adjust</Button>}</td>
                    </tr>
                    {editing === q.id && (
                      <tr key={q.id + "e"}><td colSpan={7} className="bg-muted p-3">
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
                  </>
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
        save({ jobId, quantity: f.get("quantity") ? Number(f.get("quantity")) : null, status: f.get("status") as "not_submitted", submission_reference: (f.get("ref") as string) || null, submitted_date: (f.get("date") as string) || null, notes: (f.get("notes") as string) || null }, "VEEC saved");
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Quantity</Label><Input name="quantity" type="number" step="0.01" defaultValue={data.quantity ?? ""} /></div>
          <div><Label>Status</Label><select name="status" defaultValue={data.status} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{["not_submitted", "submitted", "approved", "rejected"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div><Label>Submission ref</Label><Input name="ref" defaultValue={data.submission_reference ?? ""} /></div>
          <div><Label>Submitted date</Label><Input name="date" type="date" defaultValue={data.submitted_date ?? ""} /></div>
        </div>
        <Textarea name="notes" placeholder="Notes" defaultValue={data.notes ?? ""} />
        <Button type="submit">Save lodgement</Button>
      </form>
    </Section>
  );
}
