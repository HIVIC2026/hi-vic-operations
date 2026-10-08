import { RectPlanFields, rectPlanProblems, type RectPlan } from "@/components/portal/rectification-times";
import { VisitContactsCard } from "@/components/portal/allocation";
import { TradeVisitCard } from "@/components/portal/visit-changes";
import { ElectricianChoicePanel, PartnerProposalForm } from "@/components/portal/partner";
import { nextStep } from "@/lib/nextstep.core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, HeartPulse, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell } from "@/components/trade/TradeShell";
import { NowPanel, btnClass } from "@/components/portal/kit";
import { JobElectricianCard } from "@/components/trade/job-intake";
import { MyIntakeDetailsCard } from "@/components/trade/intake-details-editor";

/** Heading: street and suburb only (no state/postcode). */
const streetAndSuburb = (a?: string | null) => (a ?? "").replace(/,?\s*(VIC|Victoria)\b.*$/i, "").replace(/\s+\d{4}\s*$/, "").trim();
import { PartnerInstallerFactsCard } from "@/components/portal/installer-job-facts";
import { tradeTask } from "@/lib/trade-work.core";
import { ClearTimeline, WhoHasTheBall } from "@/components/portal/waiting";
import { WorkerLinksPanel } from "@/components/portal/workers";
import { OwnerEligibilityPanel } from "@/components/portal/owner-eligibility";
import { BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, useJob } from "@/components/portal/panels";
import { Button, Section, YesNo } from "@/components/trade/trade-ui";
import { MittiCard, MittiSyncedFields } from "@/components/portal/mitti";
import { useServerFn } from "@tanstack/react-start";
import { getMyMittiInvited } from "@/lib/trade-view.functions";

/** Partners never see Mitti until the office ticks "Mitti account invited". */
function useMittiInvited() {
  const load = useServerFn(getMyMittiInvited);
  return useQuery({ queryKey: ["mitti-invited"], queryFn: () => load() }).data?.invited === true;
}
import { MeasurementDetails, MeasurementReadOnly, useJobScope, useMeasurements } from "@/components/portal/requirements";
import { useAction } from "@/hooks/use-me";
import { InstallerFinalDeclaration } from "@/components/portal/assignment";
import { JobStatusCard } from "@/components/trade/job-status";
import { SourceBadge } from "@/components/portal/badges";
import { InstallerProgressCard } from "@/components/trade/intake-progress";
import { ReadyCheckDraft } from "@/components/trade/ReadyCheckDraft";
import { addApprovedRectItem, addOtherRectItem, completeAssessment, completeInstallation, getAssignedRecRates, recordPiesa, removeRectItem, saveAssessment, submitForApReview } from "@/lib/portal.functions";
import { aud } from "@/lib/workflow";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/field/$jobId")({
  head: () => ({ meta: [{ title: "Job – Home Insulation Victoria Field" }, { name: "description", content: "Onsite job workflow." }, { property: "og:title", content: "Job – Home Insulation Victoria Field" }, { property: "og:description", content: "Onsite job workflow." }] }),
  component: FieldJob,
});

function FieldJob() {
  const { jobId } = Route.useParams();
  const { data: job, isError, error } = useJob(jobId);
  const { data: role } = useQuery({ queryKey: ["myrole", jobId], queryFn: async () => (await supabase.rpc("my_job_role", { _job: jobId })).data });
  if (!job && isError) return <TradeShell installer={role !== "electrician"}><p className="rounded-[18px] border bg-paper p-6 text-sm text-sub">{/TEST accounts/.test(String((error as Error)?.message)) ? "This TEST sign-in can only open active TEST jobs." : "This job isn't available to you. If it's a new offer, accept it from My work first."}</p><Link to="/field" className="mt-3 inline-block font-bold text-hiv-blue underline">Back to My work</Link></TradeShell>;
  if (!job) return <TradeShell installer={role !== "electrician"}><p className="text-sub">Loading…</p></TradeShell>;
  const step = nextStep(job);
  const task = tradeTask({ stage: job.stage ?? "", bookings: [], blockers: [] });
  const maps = job.property_address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.property_address)}` : null;
  const yourTurn = step.waitingOn === "Installer" || step.waitingOn === "Electrician" || task.bucket !== "waiting";
  return (
    <TradeShell installer={role !== "electrician"}>
      <div className="space-y-4">
      <Link to="/field" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ArrowLeft className="h-4 w-4" />My work</Link>
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-bold leading-tight">{streetAndSuburb(job.property_address) || "Your job"}</h1>
        {job.owner_name && <p className="text-sm text-sub">{job.owner_name}</p>}
        <div className="mt-1"><SourceBadge channel={job.channel} business={job.originating_business_name} /></div>
      </div>
      <NowPanel attention={yourTurn} eyebrow={yourTurn ? "Your turn" : `Waiting on ${step.waitingOn ?? "Home Insulation Victoria"}`} status={task.label}
        due={job.install_deadline && job.days_remaining != null ? `${job.days_remaining} days left` : undefined}
        next={job.install_deadline ? `Install must start by ${new Date(job.install_deadline).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}` : undefined}
        pairs={job.life_support ? [{ label: "Note", value: <span className="inline-flex items-center gap-1 text-rose"><HeartPulse className="h-3 w-3" /> Life support at this property</span> }] : []}
        action={<div className="flex flex-wrap gap-2">
          {job.owner_phone && <a href={`tel:${job.owner_phone}`} className={btnClass("primary")}><Phone className="h-4 w-4" /> Call</a>}
          {job.owner_phone && <a href={`sms:${job.owner_phone}`} className={btnClass("secondary")}>Text</a>}
          {maps && job.owner_name && <a href={maps} target="_blank" rel="noreferrer" className={btnClass("secondary")}>Directions</a>}
        </div>} />
      <JobStatusCard jobId={jobId} />
      {role === "installer" && <PartnerInstallerFactsCard jobId={jobId} />}
      {role === "installer" && <JobElectricianCard jobId={jobId} />}
      <div><BlockersPanel jobId={jobId} quietWhenClear partner /></div>
      <div className="space-y-4">
        {role === "electrician" && <ElectricianFlow jobId={jobId} stage={job.stage!} expired={!!job.piesa_expired} />}
        {role === "installer" && <InstallerProgressCard jobId={jobId} />}
        {role === "installer" && job.channel === "installer_sourced" && <MyIntakeDetailsCard jobId={jobId} />}
        {role === "installer" && job.channel === "installer_sourced" && <ReadyCheckDraft jobId={jobId} />}
        {role === "installer" && ["piesa_and_install_window_pending"].includes(job.stage!) && !job.electrician_name && <ElectricianChoicePanel jobId={jobId} />}
        {role === "installer" && <InstallerFlow jobId={jobId} stage={job.stage!} />}
        {role === "installer" && ["assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(job.stage!) && <PartnerProposalForm jobId={jobId} />}
        {(role === "electrician" || role === "installer") && ["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(job.stage!) && <TradeVisitCard jobId={jobId} />}
        <VisitContactsCard jobId={jobId} />
        <details className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card"><summary className="cursor-pointer text-sm font-semibold text-hiv-blue">History, documents and messages</summary><div className="mt-3 space-y-4"><WhoHasTheBall jobId={jobId} /><ClearTimeline jobId={jobId} initial={5} /><OwnerEligibilityPanel jobId={jobId} /><WorkerLinksPanel jobId={jobId} /><MessagesPanel jobId={jobId} isAdmin={false} {...(role === "electrician" || role === "installer" ? { role } : {})} /></div></details>
      </div>
      </div>
    </TradeShell>
  );
}

/** Onsite forms are filled in Mitti only. Until the form is connected, trades see a plain setup notice. */
function MittiOnly({ jobId, which }: { jobId: string; which: "ready_check" | "piesa" }) {
  const { data } = useQuery({ queryKey: ["mitti-only", jobId, which], queryFn: async () => {
    const [{ data: a }, { data: m }] = await Promise.all([
      supabase.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(),
      supabase.from("ceiling_measurements").select("external_id, external_source").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    ]);
    return which === "piesa" ? a?.external_mitti_id ?? null : (m?.external_source === "mitti" ? m.external_id : null) ?? a?.external_mitti_id ?? null;
  } });
  const invited = useMittiInvited();
  return (
    <Section title={which === "piesa" ? "Safety check form" : "Ready Check form"}>
      {data && invited ? <><p className="mb-3 text-sm text-sub">Fill it in on site, in order. Your answers come back here automatically.</p><Button asChild size="field" className="w-full"><a href={`https://app.au.mitti.com/inspections/${data}`} target="_blank" rel="noreferrer">Open form in Mitti</a></Button><div className="mt-3"><MittiCard jobId={jobId} isAdmin={false} /></div></>
        : <p className="text-sm font-medium" data-mitti-unavailable>{!invited ? "Your Mitti account isn't invited yet, so the Mitti form can't open. Home Insulation Victoria has to invite you." : "The Mitti form isn't linked to this job yet — Home Insulation Victoria links it."}{which === "ready_check" ? " You can still enter and save the Ready Check on this page." : ""}</p>}
    </Section>
  );
}

// ---------- Electrician: one visit, in onsite order ----------
type A = Record<string, string | number | boolean | null>;

function ElectricianFlow({ jobId, stage, expired }: { jobId: string; stage: string; expired: boolean }) {
  const mittiInvited = useMittiInvited();
  const save = useAction(saveAssessment);
  const complete = useAction(completeAssessment);
  const { data: a } = useQuery({ queryKey: ["assessment", jobId], queryFn: async () => (await supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle()).data });
  const [f, setF] = useState<A>({});
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (a) setF(a as unknown as A); }, [a]);
  const locked = a?.status === "complete";
  const [plan, setPlan] = useState<RectPlan>({ hours: "", picks: [] });
  const { data: rectCount } = useQuery({ queryKey: ["rect-items-count", jobId], queryFn: async () => (await supabase.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required")).count ?? 0, refetchInterval: 30_000 });
  const needsPlan = !!rectCount && f["no_rectification_confirmed"] !== true;
  const finish = () => complete(needsPlan ? { jobId, rectHours: Number(plan.hours), rectWindows: plan.picks } : { jobId }, "PIESA complete");
  const planBlock = !locked && needsPlan ? <Section title="Rectification time and hours"><RectPlanFields value={plan} onChange={setPlan} /></Section> : null;
  const put = async (k: string, v: string | number | boolean | null) => {
    setF((p) => ({ ...p, [k]: v }));
    if (locked) return;
    const r = await save({ jobId, patch: { [k]: v } as never });
    if (!r) return;
    setSaved(new Date(r.savedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }));
  };
  const num = (k: string) => (e: React.FocusEvent<HTMLInputElement>) => put(k, e.target.value === "" ? null : Number(e.target.value));
  const Yn = ({ k, label }: { k: string; label: string }) => (
    <div className="flex items-center justify-between gap-3"><Label>{label}</Label><YesNo label={label} value={f[k] as boolean | null} disabled={locked} onChange={(v) => put(k, v)} /></div>
  );
  const Num = ({ k, label, step = "1" }: { k: string; label: string; step?: string }) => (
    <div><Label>{label}</Label><Input className="h-12 text-base" type="number" inputMode="decimal" step={step} defaultValue={(f[k] as number | null) ?? ""} key={String(f[k])} disabled={locked} onBlur={num(k)} /></div>
  );
  const Choice = ({ k, label, opts }: { k: string; label: string; opts: [string, string][] }) => (
    <div><Label>{label}</Label><div className={`mt-1 grid gap-2`} style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0,1fr))` }}>{opts.map(([v, l]) => <Button key={v} type="button" size="field" variant={f[k] === v ? "default" : "outline"} disabled={locked} onClick={() => put(k, v)}>{l}</Button>)}</div></div>
  );
  const assessing = ["assessment_booking", "assessment_booked", "piesa_scheduled"].includes(stage) && !locked;
  const { data: scope } = useJobScope(jobId);
  const measureBlock = !scope || !assessing ? null : scope.measurement.state === "accepted" ? <MeasurementReadOnly jobId={jobId} canFlag /> : <Section title="Installer eligibility measure-up"><p className="text-sm text-sub">The installer does the measure-up, not you.</p></Section>;

  return (
    <>
      {["rectification_scheduling", "rectification_booked", "awaiting_deposit_payment"].includes(stage) && (
        stage === "awaiting_deposit_payment" ? <Section title="Rectification booking"><p className="text-sm font-medium text-rose">Waiting for the owner's payment. Booking opens once paid.</p></Section> : <BookingPanel jobId={jobId} kind="rectification" canBook />
      )}
      {stage === "rectification_booked" && <PiesaForm jobId={jobId} kind="post_rectification" title="Rectification complete – record PIESA sign-off" />}
      {expired && <PiesaForm jobId={jobId} kind="reassessment" title="PIESA window expired – record reassessment" />}
      {scope && assessing && <div className="rounded-[13px] bg-mist px-4 py-2 text-sm font-semibold text-ink">Your visit: {scope.label}</div>}
      {a?.external_mitti_id && (assessing || locked) && (
        <>
          {measureBlock}
          {mittiInvited && <MittiCard jobId={jobId} isAdmin={false} />}
          {<MittiSyncedFields a={a as unknown as Record<string, unknown>} />}
          {!locked && <EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} />}
          {!locked && <OtherItems jobId={jobId} editable />}
          {planBlock}
          {!locked && <Button size="field" className="w-full" disabled={needsPlan && rectPlanProblems(plan).length > 0} onClick={finish}><Check /> Complete PIESA</Button>}
        </>
      )}
      {!a?.external_mitti_id && assessing && <MittiOnly jobId={jobId} which="piesa" />}
      {!a?.external_mitti_id && locked && <Section title="Safety check"><p className="text-sm text-sub">Safety check complete.</p></Section>}
    </>
  );
}

function OtherItems({ jobId, editable }: { jobId: string; editable: boolean }) {
  const add = useAction(addOtherRectItem);
  const addApproved = useAction(addApprovedRectItem);
  const remove = useAction(removeRectItem);
  const { data } = useQuery({ queryKey: ["rect", jobId], queryFn: async () => (await supabase.from("rectification_items").select("*").eq("job_id", jobId).neq("status", "removed")).data ?? [] });
  const { data: approvedRates = [] } = useQuery({ queryKey: ["assigned-rec-rates", jobId], queryFn: () => getAssignedRecRates({ data: { jobId } }) });
  const [o, setO] = useState({ description: "", quantity: "1", price: "", explanation: "" });
  const [approved, setApproved] = useState({ code: "", quantity: "1" });
  return (
    <Section title="4 · Rectification items">
      {editable && approvedRates.length > 0 && <div className="mb-4 rounded-lg border p-3"><p className="mb-2 text-sm font-semibold">Add from your approved rate schedule</p><div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]"><select className="h-12 rounded-lg border bg-background px-3 text-sm" value={approved.code} onChange={(e) => setApproved((x) => ({ ...x, code: e.target.value }))}><option value="">Choose an item</option>{approvedRates.map((rate) => <option key={rate.code} value={rate.code}>{rate.description} · {rate.display_unit || rate.unit}</option>)}</select><Input className="h-12" type="number" min="0.01" step="0.01" aria-label="Quantity" value={approved.quantity} onChange={(e) => setApproved((x) => ({ ...x, quantity: e.target.value }))} /><Button disabled={!approved.code || !(Number(approved.quantity) > 0)} onClick={() => addApproved({ jobId, rateCode: approved.code, quantity: Number(approved.quantity) }, "Approved rectification item added")}>Add</Button></div></div>}
      <p className="mb-2 text-xs text-sub">Standard items are priced from your answers.</p>
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
  const [date, setDate] = useState(melbourneToday());
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
      {measuring && <MittiOnly jobId={jobId} which="ready_check" />}
      {!measuring && m && m.status !== "complete" && ["assessment_booking", "assessment_booked"].includes(stage) && <Section title="Your measure-up"><MeasurementDetails m={m} /><p className="mt-2 text-sm text-sub">Status: {m.status.replace("_", " ")} – Home Insulation Victoria will follow up.</p></Section>}
      {a && (
        <Section title="Site summary">
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-sub">Area</dt><dd>{Number(a.measured_area_m2)} m²</dd>
            <dt className="text-sub">Removal</dt><dd>{a.removal_required ? `${a.removal_m2} m²` : "No"}</dd>
            <dt className="text-sub">Access</dt><dd className="capitalize">{a.access_difficulty}</dd>
            <dt className="text-sub">Downlights</dt><dd>{a.downlights_qty ?? "—"}</dd>
            <dt className="text-sub">Hazards</dt><dd>{a.hazards ?? "None noted"}</dd>
          </dl>
        </Section>
      )}
      {stage === "awaiting_deposit_payment" && <Section title="Installation booking"><p className="text-sm font-medium text-rose">Waiting for the owner's payment. Booking opens once paid.</p></Section>}
      {["installation_scheduling", "installation_booked"].includes(stage) && <BookingPanel jobId={jobId} kind="installation" canBook />}
      {a && ["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"].includes(stage) && <Section title="Scope">
        <p className="text-sm">Install ceiling insulation to {Number(a.measured_area_m2)} m²{a.removal_required ? `, remove ${a.removal_m2} m² existing` : ""}. Access: {a.access_difficulty}.</p></Section>}
      {["installation_booked", "evidence_outstanding", "ap_review"].includes(stage) && <EvidencePanel jobId={jobId} role="installer" gates={["installation"]} />}
      {stage === "installation_booked" && <Button size="field" className="w-full" onClick={() => done({ jobId }, "Installation complete")}><Check /> Installation complete</Button>}
      {stage === "evidence_outstanding" && (
        <Section title="Declaration & submit">
          <div className="mb-3"><InstallerFinalDeclaration jobId={jobId} /></div>
          <Button size="field" className="w-full" onClick={() => submit({ jobId }, "Submitted for review")}>Submit for Home Insulation Victoria review</Button>
        </Section>
      )}
    </>
  );
}
