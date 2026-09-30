import { AppointmentPanel, ElectricianChoicePanel, PartnerProposalForm } from "@/components/portal/partner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, HeartPulse, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { Pill, StageBadge, UrgencyBadge } from "@/components/portal/badges";
import { BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, Section, useJob } from "@/components/portal/panels";
import { MittiCard, MittiSyncedFields } from "@/components/portal/mitti";
import { MeasurementDetails, MeasurementForm, MeasurementReadOnly, useJobScope, useMeasurements } from "@/components/portal/requirements";
import { useAction } from "@/hooks/use-me";
import { InstallerFinalDeclaration } from "@/components/portal/assignment";
import { InstallerJourney } from "@/components/portal/installer-journey";
import { addOtherRectItem, completeAssessment, completeInstallation, recordPiesa, removeRectItem, saveAssessment, submitForApReview } from "@/lib/portal.functions";
import { aud } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/field/$jobId")({
  head: () => ({ meta: [{ title: "Job – HI VIC Field" }, { name: "description", content: "Onsite job workflow." }, { property: "og:title", content: "Job – HI VIC Field" }, { property: "og:description", content: "Onsite job workflow." }] }),
  component: FieldJob,
});

function FieldJob() {
  const { jobId } = Route.useParams();
  const { data: job } = useJob(jobId);
  const { data: role } = useQuery({ queryKey: ["myrole", jobId], queryFn: async () => (await supabase.rpc("my_job_role", { _job: jobId })).data });
  if (!job) return <AppShell><p className="text-muted-foreground">Loading…</p></AppShell>;
  return (
    <AppShell>
      <Link to="/field" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> My jobs</Link>
      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="text-xs font-bold text-primary">{job.job_number}</div>
        <h1 className="text-xl font-bold">{job.property_address}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm">{job.owner_name}{job.owner_phone && <a href={`tel:${job.owner_phone}`} className="inline-flex items-center gap-1 font-semibold text-primary"><Phone className="h-4 w-4" /> Call</a>}</div>
        <div className="mt-2 flex flex-wrap gap-1.5"><StageBadge stage={job.stage} />{job.deposit_cleared ? <Pill t="good">Deposit cleared</Pill> : null}<UrgencyBadge urgency={job.urgency} days={job.days_remaining} />{job.life_support && <Pill t="bad"><HeartPulse className="mr-1 h-3 w-3" /> Life support</Pill>}</div>
        <p className="mt-2 rounded bg-accent px-2 py-1 text-sm font-medium text-accent-foreground">Next: {job.next_action}</p>
      </div>
      <div className="mb-4"><BlockersPanel jobId={jobId} /></div>
      <div className="space-y-4">
        {role === "electrician" && <ElectricianFlow jobId={jobId} stage={job.stage!} expired={!!job.piesa_expired} />}
        {role === "installer" && <InstallerJourney jobId={jobId} />}
        {role === "installer" && ["new_enquiry", "eligibility_review", "awaiting_electrician"].includes(job.stage!) && !job.electrician_name && <ElectricianChoicePanel jobId={jobId} />}
        {(role === "installer" || role === "electrician") && ["assessment_booking", "assessment_booked"].includes(job.stage!) && <AppointmentPanel jobId={jobId} />}
        {role === "installer" && <InstallerFlow jobId={jobId} stage={job.stage!} />}
        {role === "installer" && ["assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(job.stage!) && <PartnerProposalForm jobId={jobId} />}
        <MessagesPanel jobId={jobId} isAdmin={false} {...(role === "electrician" || role === "installer" ? { role } : {})} />
      </div>
    </AppShell>
  );
}

// ---------- Electrician: one visit, in onsite order ----------
type A = Record<string, string | number | boolean | null>;

function ElectricianFlow({ jobId, stage, expired }: { jobId: string; stage: string; expired: boolean }) {
  const save = useAction(saveAssessment);
  const complete = useAction(completeAssessment);
  const { data: a } = useQuery({ queryKey: ["assessment", jobId], queryFn: async () => (await supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle()).data });
  const [f, setF] = useState<A>({});
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (a) setF(a as unknown as A); }, [a]);
  const locked = a?.status === "complete";
  const put = async (k: string, v: string | number | boolean | null) => {
    setF((p) => ({ ...p, [k]: v }));
    if (locked) return;
    const r = await save({ jobId, patch: { [k]: v } as never });
    if (!r) return;
    setSaved(new Date(r.savedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }));
  };
  const num = (k: string) => (e: React.FocusEvent<HTMLInputElement>) => put(k, e.target.value === "" ? null : Number(e.target.value));
  const Yn = ({ k, label }: { k: string; label: string }) => (
    <div><Label>{label}</Label><div className="mt-1 grid grid-cols-2 gap-2">{[true, false].map((v) => <Button key={String(v)} type="button" size="field" variant={f[k] === v ? "default" : "outline"} disabled={locked} onClick={() => put(k, v)}>{v ? "Yes" : "No"}</Button>)}</div></div>
  );
  const Num = ({ k, label, step = "1" }: { k: string; label: string; step?: string }) => (
    <div><Label>{label}</Label><Input className="h-12 text-base" type="number" inputMode="decimal" step={step} defaultValue={(f[k] as number | null) ?? ""} key={String(f[k])} disabled={locked} onBlur={num(k)} /></div>
  );
  const Choice = ({ k, label, opts }: { k: string; label: string; opts: [string, string][] }) => (
    <div><Label>{label}</Label><div className={`mt-1 grid gap-2`} style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0,1fr))` }}>{opts.map(([v, l]) => <Button key={v} type="button" size="field" variant={f[k] === v ? "default" : "outline"} disabled={locked} onClick={() => put(k, v)}>{l}</Button>)}</div></div>
  );
  const assessing = ["assessment_booking", "assessment_booked"].includes(stage) && !locked;
  const { data: scope } = useJobScope(jobId);
  const measureBlock = !scope || !assessing ? null : scope.measurement.state === "accepted" ? <MeasurementReadOnly jobId={jobId} canFlag /> : <Section title="Installer eligibility measure-up"><p className="text-sm text-muted-foreground">This is not part of your PIESA visit. The assigned insulation installer completes the measure-up and eligibility evidence.</p></Section>;

  return (
    <>
      {["rectification_scheduling", "rectification_booked", "awaiting_deposit_payment"].includes(stage) && (
        stage === "awaiting_deposit_payment" ? <Section title="Rectification booking"><p className="text-sm font-medium text-danger">Locked – awaiting owner's 50% deposit. Booking details will appear here once paid.</p></Section> : <BookingPanel jobId={jobId} kind="rectification" canBook />
      )}
      {stage === "rectification_booked" && <PiesaForm jobId={jobId} kind="post_rectification" title="Rectification complete – record PIESA sign-off" />}
      {expired && <PiesaForm jobId={jobId} kind="reassessment" title="PIESA window expired – record reassessment" />}
      {scope && assessing && <div className="rounded-lg border border-primary/30 bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">Your visit: {scope.label}</div>}
      {a?.external_mitti_id && (assessing || locked) && (
        <>
          {measureBlock}
          <MittiCard jobId={jobId} isAdmin={false} />
          {<MittiSyncedFields a={a as unknown as Record<string, unknown>} />}
          {!locked && <EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} />}
          {!locked && <OtherItems jobId={jobId} editable />}
          {!locked && <Button size="field" className="w-full" onClick={() => complete({ jobId }, "PIESA complete")}><Check /> Complete PIESA</Button>}
        </>
      )}
      {!a?.external_mitti_id && (assessing || locked) && (
        <details open={!locked} className="group">
          <summary className={locked ? "mb-2 cursor-pointer list-none rounded-md border bg-card px-4 py-3 text-sm font-medium" : "hidden"}>Assessment (complete – locked) · tap to view</summary>
          <div className="space-y-4">
          <div className="text-right text-xs text-muted-foreground">{locked ? "Assessment complete – locked" : saved ? `Autosaved ${saved}` : "Changes save automatically"}</div>
          {measureBlock}
          <Section title="2 · Electrical safety">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3"><Num k="downlights_qty" label="Downlights (qty)" /><Num k="downlights_upgrade_qty" label="Need upgrade" /></div>
              <div><Label>Downlight type</Label><Input className="h-12" defaultValue={(f["downlights_type"] as string) ?? ""} key={"dt" + String(f["downlights_type"])} disabled={locked} onBlur={(e) => put("downlights_type", e.target.value || null)} /></div>
              <div className="grid grid-cols-2 gap-3"><Num k="exhaust_fans_qty" label="Exhaust fans" /><Num k="exhaust_fans_clearance_qty" label="Need clearance" /></div>
              <Choice k="switchboard_condition" label="Switchboard" opts={[["ok", "OK"], ["upgrade_required", "Upgrade"]]} />
              <Yn k="rcds_present" label="RCDs present?" />
              <Num k="rcds_required_qty" label="RCDs to install" />
              <Yn k="life_support_confirmed" label="Life support equipment onsite?" />
              <div><Label>Hazards</Label><Textarea defaultValue={(f["hazards"] as string) ?? ""} key={"hz" + String(f["hazards"])} disabled={locked} onBlur={(e) => put("hazards", e.target.value || null)} /></div>
            </div>
          </Section>
          <Section title="3 · PIESA outcome">
            <p className="mb-2 text-xs text-muted-foreground">Recorded once here — sign-off syncs to Mitti via the ID below.</p>
            <div className="grid gap-3">
              <Choice k="piesa_outcome" label="PIESA result" opts={[["pass", "Pass"], ["fail", "Fail"]]} />
              <div><Label>Assessment date</Label><Input className="h-12" type="date" defaultValue={(f["assessed_on"] as string) ?? ""} key={"ad" + String(f["assessed_on"])} disabled={locked} onBlur={(e) => put("assessed_on", e.target.value || null)} /></div>
              <div><Label>Mitti record ID (optional)</Label><Input className="h-12" defaultValue={(f["external_mitti_id"] as string) ?? ""} key={"mi" + String(f["external_mitti_id"])} disabled={locked} onBlur={(e) => put("external_mitti_id", e.target.value || null)} /></div>
              <div><Label>Notes</Label><Textarea defaultValue={(f["notes"] as string) ?? ""} key={"nt" + String(f["notes"])} disabled={locked} onBlur={(e) => put("notes", e.target.value || null)} /></div>
            </div>
          </Section>
          <EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} />
          <OtherItems jobId={jobId} editable={!locked || stage === "awaiting_owner_rectification_approval"} />
           {!locked && <Button size="field" className="w-full" onClick={() => complete({ jobId }, "PIESA complete")}><Check /> Complete PIESA</Button>}
          </div>
        </details>
      )}
    </>
  );
}

function OtherItems({ jobId, editable }: { jobId: string; editable: boolean }) {
  const add = useAction(addOtherRectItem);
  const remove = useAction(removeRectItem);
  const { data } = useQuery({ queryKey: ["rect", jobId], queryFn: async () => (await supabase.from("rectification_items").select("*").eq("job_id", jobId).neq("status", "removed")).data ?? [] });
  const [o, setO] = useState({ description: "", quantity: "1", price: "", explanation: "" });
  return (
    <Section title="4 · Rectification items">
      <p className="mb-2 text-xs text-muted-foreground">Standard items (downlights, RCDs, switchboard, fan clearances) are priced automatically from your answers above.</p>
      <ul className="mb-3 space-y-1 text-sm">
        {data?.map((i) => <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.description} × {Number(i.quantity)}{i.is_other && ` @ ${aud(i.other_unit_price_inc_gst)}`}</span>{i.is_other && editable && <Button size="sm" variant="ghost" onClick={() => remove({ itemId: i.id })}>Remove</Button>}</li>)}
      </ul>
      {editable && (
        <form className="grid gap-2" onSubmit={async (e) => { e.preventDefault(); await add({ jobId, description: o.description, quantity: Number(o.quantity), unitPriceIncGst: Number(o.price), explanation: o.explanation }, "Item added"); setO({ description: "", quantity: "1", price: "", explanation: "" }); }}>
          <div className="text-sm font-medium">Add an "Other" item</div>
          <Input className="h-12" placeholder="Description" value={o.description} onChange={(e) => setO({ ...o, description: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2"><Input className="h-12" type="number" placeholder="Qty" value={o.quantity} onChange={(e) => setO({ ...o, quantity: e.target.value })} required /><Input className="h-12" type="number" step="0.01" placeholder="Price inc GST" value={o.price} onChange={(e) => setO({ ...o, price: e.target.value })} required /></div>
          <Textarea placeholder="Why is this needed?" value={o.explanation} onChange={(e) => setO({ ...o, explanation: e.target.value })} required />
          <Button type="submit" size="field" variant="outline">Add item</Button>
        </form>
      )}
    </Section>
  );
}

function PiesaForm({ jobId, kind, title }: { jobId: string; kind: "post_rectification" | "reassessment"; title: string }) {
  const rec = useAction(recordPiesa);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Section title={title}>
      {kind === "post_rectification" && <div className="mb-3"><EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} /></div>}
      <Label>PIESA completion date</Label>
      <Input className="mb-3 h-12" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Button size="field" onClick={() => rec({ jobId, kind, outcome: "pass", completedDate: date }, "PIESA recorded")}>Pass</Button>
        <Button size="field" variant="outline" onClick={() => rec({ jobId, kind, outcome: "fail", completedDate: date }, "PIESA recorded")}>Fail</Button>
      </div>
    </Section>
  );
}

// ---------- Installer ----------
function InstallerFlow({ jobId, stage }: { jobId: string; stage: string }) {
  const done = useAction(completeInstallation);
  const submit = useAction(submitForApReview);
  const { data: ms } = useMeasurements(jobId);
  const { data: scope } = useJobScope(jobId);
  const { data: el } = useQuery({ queryKey: ["assessment-trade", jobId], queryFn: async () => (await supabase.from("assessments").select("hazards, downlights_qty").eq("job_id", jobId).maybeSingle()).data });
  const m = ms?.current;
  const a = m?.status === "complete" ? { ...m, hazards: el?.hazards ?? null, downlights_qty: el?.downlights_qty ?? null } : null;
  const measuring = ["ready_check_scheduled", "assessment_booking", "assessment_booked"].includes(stage) && !!scope?.installerTasks.includes("measure_up");
  return (
    <>
      {measuring && <MeasurementForm jobId={jobId} editable={["measured_area_m2", "insulation_present", "existing_r_value", "removal_required", "removal_m2", "access_difficulty"]} showComplete title="Your task: free Ready Check — eligibility measure-up" />}
      {!measuring && m && m.status !== "complete" && ["assessment_booking", "assessment_booked"].includes(stage) && <Section title="Your measure-up"><MeasurementDetails m={m} /><p className="mt-2 text-sm text-muted-foreground">Status: {m.status.replace("_", " ")} – HI VIC will follow up.</p></Section>}
      {a && (
        <Section title="Site summary">
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Area</dt><dd>{Number(a.measured_area_m2)} m²</dd>
            <dt className="text-muted-foreground">Removal</dt><dd>{a.removal_required ? `${a.removal_m2} m²` : "No"}</dd>
            <dt className="text-muted-foreground">Access</dt><dd className="capitalize">{a.access_difficulty}</dd>
            <dt className="text-muted-foreground">Downlights</dt><dd>{a.downlights_qty ?? "—"}</dd>
            <dt className="text-muted-foreground">Hazards</dt><dd>{a.hazards ?? "None noted"}</dd>
          </dl>
        </Section>
      )}
      {stage === "awaiting_deposit_payment" && <Section title="Installation booking"><p className="text-sm font-medium text-danger">Locked – awaiting owner's 50% deposit.</p></Section>}
      {["installation_scheduling", "installation_booked"].includes(stage) && <BookingPanel jobId={jobId} kind="installation" canBook />}
      {a && ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"].includes(stage) && <Section title="Scope">
        <p className="text-sm">Install ceiling insulation to {Number(a.measured_area_m2)} m²{a.removal_required ? `, remove ${a.removal_m2} m² existing` : ""}. Access: {a.access_difficulty}.</p></Section>}
      {["installation_booked", "evidence_outstanding", "ap_review"].includes(stage) && <EvidencePanel jobId={jobId} role="installer" gates={["installation"]} />}
      {stage === "installation_booked" && <Button size="field" className="w-full" onClick={() => done({ jobId }, "Installation complete")}><Check /> Installation complete</Button>}
      {stage === "evidence_outstanding" && (
        <Section title="Declaration & submit">
          <div className="mb-3"><InstallerFinalDeclaration jobId={jobId} /></div>
          <Button size="field" className="w-full" onClick={() => submit({ jobId }, "Submitted for review")}>Submit for HI VIC review</Button>
        </Section>
      )}
    </>
  );
}
