// Installer Job page = approved mock-up M2 (Jo 24 Oct 2026, decisions 196/198): one Next panel, Quote, Ready Check,
// Who's doing this, More. Decision 277 (Jo 25 Oct 2026): no in-portal Messages section — the installer uses Call/Text
// and the portal sends its own automatic texts. The electrician's visit flow shares this route unchanged.
import { RectPlanFields, rectPlanProblems, type RectPlan } from "@/components/portal/rectification-times";
import { VisitContactsCard } from "@/components/portal/allocation";
import { TradeVisitCard } from "@/components/portal/visit-changes";
import { nextStep } from "@/lib/nextstep.core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, HeartPulse, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TradeShell } from "@/components/trade/TradeShell";
import { NowPanel, btnClass } from "@/components/portal/kit";

/** Heading: street and suburb only (no state/postcode). */
const streetAndSuburb = (a?: string | null) => (a ?? "").replace(/,?\s*(VIC|Victoria)\b.*$/i, "").replace(/\s+\d{4}\s*$/, "").trim();
import { tradeTurn } from "@/lib/trade-work.core";
import { ClearTimeline, WhoHasTheBall } from "@/components/portal/waiting";
import { WorkerLinksPanel } from "@/components/portal/workers";
import { OwnerEligibilityPanel } from "@/components/portal/owner-eligibility";
import { BlockersPanel, BookingPanel, EvidencePanel, MessagesPanel, useJob } from "@/components/portal/panels";
import { Button, Section } from "@/components/trade/trade-ui";
import { MittiCard, MittiSyncedFields } from "@/components/portal/mitti";
import { mittiFormId } from "@/lib/mitti-form-link.core";
import { ElectricianManualResult, manualResultEntry } from "@/components/portal/electrician-manual-result";
import { useServerFn } from "@tanstack/react-start";
import { getMyMittiInvited, getTradeJobBundle, getTradeJobPage, setA1ReadyCheckTimeFn } from "@/lib/trade-view.functions";
import { seedPlan } from "@/lib/trade-job-bundle.core";
import { a1ReadyCheckEntryAllowed, a1ReadyCheckTimeBlockers, allowedReadyCheckDays, allowedReadyCheckTimes } from "@/lib/ready-check-times.core";
import { installTimeLabel } from "@/lib/install-days.core";

/** Partners never see Mitti until the office ticks "Mitti account invited". */
function useMittiInvited() {
  const load = useServerFn(getMyMittiInvited);
  return useQuery({ queryKey: ["mitti-invited"], queryFn: () => load(), staleTime: 300_000 }).data?.invited === true;
}
import { MeasurementReadOnly, useJobScope } from "@/components/portal/requirements";
import { useAction } from "@/hooks/use-me";
import { InstallerFinalDeclaration } from "@/components/portal/assignment";
import { JobStatusCard } from "@/components/trade/job-status";
import { OwnerQuoteCard } from "@/components/trade/OwnerQuoteCard";
import { SafetyPlanCard } from "@/components/trade/SafetyPlanCard";
import { InstallerReadyCheckTimesCard, useInstallerReadyCheckTimes } from "@/components/portal/ready-check-times-installer";
import { OneTapAction } from "@/components/trade/one-tap-action";
import { addApprovedRectItem, addOtherRectItem, completeAssessment, completeInstallation, getAssignedRecRates, recordPiesa, removeRectItem, saveAssessment } from "@/lib/portal.functions";
import { aud } from "@/lib/workflow";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { MittiFormLink } from "@/components/portal/MittiFormLink";
import { InstallerInstallDays, useInstallerInstallDays } from "@/components/portal/install-days";
import { WhosDoingThis } from "@/components/trade/visit-allocation";
import { ContactButtons, Group, LinkRow, NextPanel, NoFormNoPay, Note, PrimaryButton, Row, Screen, ScreenHead, primaryLinkClass } from "@/components/trade/installer-kit";
import { completeView, electricianRow, firstName, installRow, installerStatusLine, jobNext, payNote, quoteStatusRow, readyCheckRows, sourceLabel, type ReadyCheckTurn } from "@/lib/installer-screens.core";
import { InstallerPriceCard } from "@/components/trade/InstallerPriceCard";
import { FixesFormCard } from "@/components/trade/FixesFormCard";
import { FixesTimesCard, useTradeFixesTimes } from "@/components/trade/FixesTimesCard";
import { SafetyCheckDocRow } from "@/components/trade/SafetyCheckDocRow";

export const Route = createFileRoute("/_authenticated/field/$jobId")({
  head: () => ({ meta: [{ title: "Job – Home Insulation Victoria Field" }, { name: "description", content: "Onsite job workflow." }, { property: "og:title", content: "Job – Home Insulation Victoria Field" }, { property: "og:description", content: "Onsite job workflow." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: FieldJob,
});

/** Speed (decision 280): ONE server call on first paint. The bundle answers every section the cards below read and is
 *  written into their own Query cache entries before the page draws, so each card finds its answer already there and
 *  fetches on its own only when one of its actions invalidates it (or the bundle left that section out). A section the
 *  server could not answer is simply not seeded: that card fetches and handles its error exactly as before. */
function useTradeJobBundle(jobId: string) {
  const qc = useQueryClient();
  const load = useServerFn(getTradeJobBundle);
  return useQuery({
    queryKey: ["trade-job-bundle", jobId],
    queryFn: async ({ queryKey }) => {
      // `useAction` invalidates every query after an action; the cards refetch themselves then, so the bundle is not
      // asked again (its first answer is kept) — one call on first paint, none after.
      const prev = qc.getQueryData<Awaited<ReturnType<typeof load>>>(queryKey);
      if (prev) return prev;
      const bundle = await load({ data: { jobId } });
      for (const s of seedPlan(bundle, jobId)) qc.setQueryData([...s.key], s.data);
      return bundle;
    },
    // First paint only: afterwards the cards' own queries, polls and invalidations carry on exactly as before.
    staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}

function FieldJob() {
  const { jobId } = Route.useParams();
  const bundle = useTradeJobBundle(jobId);
  // While the one call is in flight nothing below mounts, so no card starts its own fetch. A failed bundle still renders
  // the page: every card then loads itself (the pre-bundle behaviour) and the existing refusal wording applies.
  if (!bundle.isFetched) return <TradeShell installer><p className="text-sub">Loading…</p></TradeShell>;
  return <FieldJobBody jobId={jobId} />;
}

function FieldJobBody({ jobId }: { jobId: string }) {
  const { data: job, isError, error } = useJob(jobId);
  const { data: role } = useQuery({ queryKey: ["myrole", jobId], queryFn: async () => (await supabase.rpc("my_job_role", { _job: jobId })).data, staleTime: 300_000 });
  if (!job && isError) return <TradeShell installer={role !== "electrician"}><p className="rounded-[18px] border bg-paper p-6 text-sm text-sub">{/TEST accounts/.test(String((error as Error)?.message)) ? "This TEST sign-in can only open active TEST jobs." : "This job isn't available to you. If it's a new offer, accept it from My work first."}</p><Link to="/field" className="mt-3 inline-block font-bold text-hiv-blue underline">Back to My work</Link></TradeShell>;
  if (!job) return <TradeShell installer={role !== "electrician"}><p className="text-sub">Loading…</p></TradeShell>;
  if (role === "installer") return <TradeShell installer><InstallerFlow jobId={jobId} job={job} /></TradeShell>;
  const step = nextStep(job);
  const turn = tradeTurn({ trade: role === "electrician" ? role : null, stage: job.stage ?? "", waitingOn: step.waitingOn });
  const task = turn.task;
  const maps = job.property_address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.property_address)}` : null;
  return (
    <TradeShell installer={false}>
      <div className="space-y-4">
      <Link to="/field" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ArrowLeft className="h-4 w-4" />My work</Link>
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-bold leading-tight">{streetAndSuburb(job.property_address) || "Your job"}</h1>
        {job.owner_name && <p className="text-sm text-sub">{job.owner_name}</p>}
      </div>
      <NowPanel attention={turn.yourTurn} eyebrow={turn.eyebrow} status={task.label}
        due={job.install_deadline && job.days_remaining != null ? `${job.days_remaining} days left` : undefined}
        next={job.install_deadline ? `Install must start by ${new Date(job.install_deadline).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}` : undefined}
        pairs={job.life_support ? [{ label: "Note", value: <span className="inline-flex items-center gap-1 text-rose"><HeartPulse className="h-3 w-3" /> Life support at this property</span> }] : []}
        action={<div className="flex flex-wrap gap-2">
          {job.owner_phone && <a href={`tel:${job.owner_phone}`} className={btnClass("primary")}><Phone className="h-4 w-4" /> Call</a>}
          {job.owner_phone && <a href={`sms:${job.owner_phone}`} className={btnClass("secondary")}>Text</a>}
          {maps && job.owner_name && <a href={maps} target="_blank" rel="noreferrer" className={btnClass("secondary")}>Directions</a>}
        </div>} />
      {role === "electrician" && <JobStatusCard jobId={jobId} />}
      <div><BlockersPanel jobId={jobId} quietWhenClear partner /></div>
      <div className="space-y-4">
        {role === "electrician" && <FixesTimesCard jobId={jobId} />}
        {role === "electrician" && <ElectricianFlow jobId={jobId} stage={job.stage!} expired={!!job.piesa_expired} />}
        {role === "electrician" && <SafetyCheckDocRow jobId={jobId} />}
        {role === "electrician" && ["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(job.stage!) && <TradeVisitCard jobId={jobId} />}
        <VisitContactsCard jobId={jobId} />
        <details className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card"><summary className="cursor-pointer text-sm font-semibold text-hiv-blue">History and documents</summary><div className="mt-3 space-y-4"><WhoHasTheBall jobId={jobId} /><ClearTimeline jobId={jobId} initial={5} /><OwnerEligibilityPanel jobId={jobId} /><WorkerLinksPanel jobId={jobId} />{role === "electrician" && <MessagesPanel jobId={jobId} isAdmin={false} role="electrician" />}</div></details>
      </div>
      </div>
    </TradeShell>
  );
}

/** Jo 24 Oct 2026 (decision 110): on the installer's own job the installer enters the Ready Check day and time. It is
 *  saved as the job's Ready Check booking, so the 6:30am text lists it with the Mitti form link. Nothing goes to the owner. */
function A1ReadyCheckTimeCard({ jobId }: { jobId: string }) {
  const save = useAction(setA1ReadyCheckTimeFn);
  const days = allowedReadyCheckDays();
  const [day, setDay] = useState(days[0] ?? melbourneToday());
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const blockers = a1ReadyCheckTimeBlockers({ day, time });
  const times = allowedReadyCheckTimes(day);
  return (
    <div className="mt-3" data-a1-ready-check-time>
      <p className="text-[13px] text-sub">Ready Check day and time (optional). It goes on your day list with the Mitti form link in the 6:30am text. The owner isn't messaged.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div><Label htmlFor="a1-rc-day">Day</Label><Input id="a1-rc-day" type="date" value={day} min={days[0]} max={days[days.length - 1]} onChange={(e) => { setDay(e.target.value); setTime(""); }} /></div>
        <div><Label htmlFor="a1-rc-time">Arrival time</Label>
          <select id="a1-rc-time" aria-label="Arrival time" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="">Time…</option>
            {times.map((t) => <option key={t} value={t}>{installTimeLabel(t)}</option>)}
          </select></div>
      </div>
      {time && blockers.length > 0 && <p className="mt-2 text-sm text-rose" data-a1-rc-blocker>{blockers.join(" ")}</p>}
      <PrimaryButton className="mt-3" disabled={busy || !time || blockers.length > 0} onClick={async () => { setBusy(true); try { await save({ jobId, day, time }, "Ready Check time saved"); } finally { setBusy(false); } }}>
        {busy ? "Saving…" : "Save Ready Check time"}
      </PrimaryButton>
    </div>
  );
}

/** Onsite forms are filled in Mitti only. Until the form is connected, trades see a plain setup notice. */
function MittiOnly({ jobId, which }: { jobId: string; which: "ready_check" | "piesa" }) {
  const { data } = useQuery({ queryKey: ["mitti-only", jobId, which], queryFn: async () => {
    const [{ data: a }, { data: m }] = await Promise.all([
      supabase.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(),
      supabase.from("ceiling_measurements").select("external_id, external_source").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    ]);
    return mittiFormId(which, a?.external_mitti_id, m);
  } });
  const invited = useMittiInvited();
  return (
    <>
      {data && invited ? <><Row label="Mitti form" value="Linked" /><MittiFormLink auditId={data} className="flex min-h-12 w-full items-center justify-between gap-3 text-[15px] font-semibold text-hiv-blue"><span>Open Mitti form</span><span className="text-xl text-sub">›</span></MittiFormLink></>
        : <Row label="Mitti form" value={!invited ? "Your Mitti account isn't invited yet" : "Not linked yet — Home Insulation Victoria links it"} tone="sub" last />}
    </>
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
  // Decision 315: times already given on the "Fixes times" card are never asked again at Complete PIESA.
  const { data: fixesTimes } = useTradeFixesTimes(jobId);
  const needsPlan = !!rectCount && f["no_rectification_confirmed"] !== true && !(fixesTimes?.show && fixesTimes.given);
  const finish = () => complete(needsPlan ? { jobId, rectHours: Number(plan.hours), rectWindows: plan.picks } : { jobId }, "PIESA complete");
  const planBlock = !locked && needsPlan ? <Section title="Electrical fixes time and hours"><RectPlanFields value={plan} onChange={setPlan} /></Section> : null;
  const put = async (k: string, v: string | number | boolean | null) => {
    setF((p) => ({ ...p, [k]: v }));
    if (locked) return;
    const r = await save({ jobId, patch: { [k]: v } as never });
    if (!r) return;
    setSaved(new Date(r.savedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }));
  };
  const assessing = ["assessment_booking", "assessment_booked", "piesa_scheduled"].includes(stage) && !locked;
  // Manual PIESA pathway (S64, owner ruling G-E1): no Mitti form linked to this job. Editable while the
  // assessment is open; a completed one shows as a locked record. The Mitti branch above stays authoritative
  // whenever assessments.external_mitti_id is set.
  const manualPath = !a?.external_mitti_id;
  const canEnter = manualPath && manualResultEntry(a);
  const showManual = manualPath && (assessing || locked);
  const { data: scope } = useJobScope(jobId);
  const measureBlock = !scope || !assessing ? null : scope.measurement.state === "accepted" ? <MeasurementReadOnly jobId={jobId} canFlag /> : <Section title="Installer Ready Check"><p className="text-sm text-sub">The installer does the Ready Check, not you.</p></Section>;

  return (
    <>
      {["rectification_scheduling", "rectification_booked", "awaiting_deposit_payment"].includes(stage) && (
        stage === "awaiting_deposit_payment" ? <Section title="Electrical fixes booking"><p className="text-sm font-medium text-rose">Waiting for the owner's payment. Booking opens once paid.</p></Section> : <BookingPanel jobId={jobId} kind="rectification" canBook />
      )}
      {/* Decision 318: the pay rule sits beside the PIESA / fixes Mitti forms. */}
      {(stage === "rectification_booked" || (a?.external_mitti_id && assessing)) && <NoFormNoPay />}
      {stage === "rectification_booked" && <FixesFormCard jobId={jobId} mittiInvited={mittiInvited} />}
      {stage === "rectification_booked" && <PiesaForm jobId={jobId} kind="post_rectification" title="Electrical fixes complete – record PIESA sign-off" />}
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
      {showManual && (
        <>
          {measureBlock}
          {/* S64 (owner ruling G-E1): no Mitti form linked — the same saveAssessment/completeAssessment chain, entered here. */}
          {canEnter && <ElectricianManualResult value={f} locked={locked} savedAt={saved} onPut={put} />}
          {assessing && <EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} />}
          {assessing && <OtherItems jobId={jobId} editable />}
          {planBlock}
          {assessing && <Button size="field" className="w-full" disabled={needsPlan && rectPlanProblems(plan).length > 0} onClick={finish}><Check /> Complete PIESA</Button>}
          {locked && <Section title="Pre Insulation Electrical Safety Assessment (PIESA)"><p className="text-sm text-sub">Pre Insulation Electrical Safety Assessment (PIESA) complete.</p></Section>}
        </>
      )}
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
    <Section title="4 · Electrical fixes items">
      {editable && approvedRates.length > 0 && <div className="mb-4 rounded-lg border p-3"><p className="mb-2 text-sm font-semibold">Add from your approved rate schedule</p><div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]"><select className="h-12 rounded-lg border bg-background px-3 text-sm" value={approved.code} onChange={(e) => setApproved((x) => ({ ...x, code: e.target.value }))}><option value="">Choose an item</option>{approvedRates.map((rate) => <option key={rate.code} value={rate.code}>{rate.description} · {rate.display_unit || rate.unit}</option>)}</select><Input className="h-12" type="number" min="0.01" step="0.01" aria-label="Quantity" value={approved.quantity} onChange={(e) => setApproved((x) => ({ ...x, quantity: e.target.value }))} /><Button disabled={!approved.code || !(Number(approved.quantity) > 0)} onClick={() => addApproved({ jobId, rateCode: approved.code, quantity: Number(approved.quantity) }, "Approved electrical fixes item added")}>Add</Button></div></div>}
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
  const [sectionC, setSectionC] = useState(false);
  const [sectionCDate, setSectionCDate] = useState(melbourneToday());
  const post = kind === "post_rectification";
  return (
    <Section title={title}>
      {post && <div className="mb-3"><EvidencePanel jobId={jobId} role="electrician" gates={["electrical"]} /></div>}
      <Label>PIESA completion date</Label>
      <Input className="mb-3 h-12" type="date" value={date} max={melbourneToday()} onChange={(e) => setDate(e.target.value)} />
      {post && (
        <div className="mb-3 rounded-lg border p-3">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" className="mt-1" checked={sectionC} onChange={(e) => setSectionC(e.target.checked)} />
            <span>I confirm Section C of the completed PIESA has been completed and signed for this electrical fixes work.</span>
          </label>
          <Label>Section C signed date</Label>
          <Input className="h-12" type="date" value={sectionCDate} max={melbourneToday()} onChange={(e) => setSectionCDate(e.target.value)} />
          <p className="mt-1 text-xs text-sub">Upload the signed PIESA / CoES evidence above before recording a pass.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="field" disabled={post && !sectionC} onClick={() => rec({ jobId, kind, outcome: "pass", completedDate: date, ...(post ? { sectionCCompleted: sectionC, sectionCSignedDate: sectionCDate } : {}) }, "PIESA recorded")}>Pass</Button>
        <Button size="field" variant="outline" onClick={() => rec({ jobId, kind, outcome: "fail", completedDate: date }, "PIESA recorded")}>Fail</Button>
      </div>
    </Section>
  );
}


// ---------- Installer (mock-up M2) ----------
type Overview = NonNullable<ReturnType<typeof useJob>["data"]>;

function InstallerFlow({ jobId, job }: { jobId: string; job: Overview }) {
  const load = useServerFn(getTradeJobPage);
  const { data: page } = useQuery({ queryKey: ["trade-job-page", jobId], queryFn: () => load({ data: { jobId } }), retry: false, refetchInterval: 60_000, staleTime: 20_000 });
  const { data: days } = useInstallerInstallDays(jobId);
  const { data: rc } = useInstallerReadyCheckTimes(jobId);
  const done = useAction(completeInstallation);
  const owner = firstName(job.owner_name);
  const rcTurn: ReadyCheckTurn = rc && rc.applies ? (rc.turn as ReadyCheckTurn) : null;
  const next = page ? jobNext({
    channel: page.channel, stage: page.stage, ownerFirstName: owner, formLinked: page.form.linked, formCompleted: page.form.completed, quoteLine: page.quote?.line ?? null,
    needsFinishing: page.form.needsFinishing, needsFinishingItems: page.form.needsFinishingItems, readyCheckTurn: rcTurn, readyCheckBookedAt: page.readyCheck.bookedAt,
    installTurn: (days?.turn as never) ?? null, installBookedAt: page.install.bookedAt, installDeadline: days?.deadline ?? null, installDaysLeft: days?.daysLeft ?? null, clearedOn: page.clearance.clearedOn,
    installFormComplete: page.install.form.complete, installationRecorded: !!page.install.recordedAt, rebateSigned: page.install.rebateSigned,
    quoteSentAt: page.quote?.sentAt ?? null, quoteDeclinedAt: page.quote?.declinedAt ?? null, formCompletedAt: page.form.completedAt,
    piesaBooking: page.piesa.bookedAt ? { electrician: page.piesa.electrician, start: page.piesa.bookedAt } : null,
    installFormCompletedAt: page.install.formCompletedAt, evidenceChecked: page.install.evidenceChecked, crew: page.install.crew, ownerReady: page.install.ownerReady,
    formHasAnswers: page.form.hasAnswers, priceEntered: page.price.entered, boss: page.boss, ownerPiesaConfirmed: page.ownerPiesaConfirmed,
  }) : null;
  const readyCheck = page ? readyCheckRows({ bookedAt: page.readyCheck.bookedAt, done: page.readyCheck.done, formLinked: page.form.linked, formCompleted: page.form.completed, missing: page.form.missing.length + page.form.stops.length, hasAnswers: page.form.hasAnswers }) : null;
  // Decision 279: ONE status line per job. The Quote row shows quote wording only once the form has answers and (A1) the price is in.
  const status = page ? installerStatusLine({ channel: page.channel, formLinked: page.form.linked, formCompleted: page.form.completed, formHasAnswers: page.form.hasAnswers, priceEntered: page.price.entered, boss: page.boss, quoteLine: page.quote?.line ?? null }) : null;
  const quoteRow = quoteStatusRow(page?.quote ? { ...page.quote } : null, { needsFinishing: !!page?.form.needsFinishing, formLinked: !!page?.form.linked });
  const showQuoteStatus = !!status && (status.kind === "quote" || status.kind === "none");
  const atReadyCheck = ["ready_check_ready_to_schedule", "ready_check_scheduled", "preliminary_estimate_ready", "new_enquiry", "eligibility_review"].includes(job.stage ?? "");
  const elecRow = page ? electricianRow({ name: page.piesa.electrician ?? (page.form.electrician?.startsWith("Home Insulation Victoria") ? "Home Insulation Victoria electrician" : page.form.electrician), piesaBookedAt: page.piesa.bookedAt, piesaPassedOn: page.piesa.passedOn, fixesNote: page.piesa.fixesNote }) : null;
  const installLine = page ? installRow({ doneAt: page.install.recordedAt, areaM2: page.pay.areaM2, removalM2: page.pay.removalM2 }) : null;

  // Approved state M2-complete: read-only summary; owner contact is no longer shown (contactVisible rule).
  if (page && job.stage === "complete") {
    const v = completeView({ jobNumber: job.job_number ?? null, suburb: (job.property_address ?? "").split(",").slice(-1)[0]?.replace(/\b(VIC|Victoria)\b.*$/i, "").trim() || null, channel: page.channel, completedAt: page.install.recordedAt,
      product: page.complete.product, areaM2: page.pay.areaM2, removalM2: page.pay.removalM2, crew: page.install.crew, pay: page.complete.pay,
      piisaSignedAt: page.complete.piisaSignedAt, installerSignedAt: page.complete.installerSignedAt, ownerSignedAt: page.complete.ownerSignedAt, apSignedAt: page.complete.apSignedAt });
    return (
      <Screen>
        <ScreenHead title={v.heading} line2={v.sub} />
        <NextPanel eyebrow="Done" title={v.done.title} sub={v.done.body} />
        <Group title="Summary">{v.summary.map(([k, val], i) => <Row key={k} label={k} value={val} last={i === v.summary.length - 1} />)}</Group>
        <Group title="Paperwork">{v.paperwork.map(([k, val], i) => <Row key={k} label={k} value={val} tone={/^Signed/.test(val) ? "green" : "sub"} last={i === v.paperwork.length - 1} />)}</Group>
        {page.complete.pay && <LinkRow to="/field/money/$jobId" params={{ jobId }}>See it in Money</LinkRow>}
      </Screen>
    );
  }
  return (
    <Screen>
      <ScreenHead title={streetAndSuburb(job.property_address) || "Your job"} line1={job.owner_name ?? undefined} line2={[job.job_number, sourceLabel(job.channel)].filter(Boolean).join(" · ")}>
        {job.life_support && <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-rose"><HeartPulse className="h-3.5 w-3.5" /> Life support at this property</p>}
        <ContactButtons phone={job.owner_phone} address={job.owner_name ? job.property_address : null} />
      </ScreenHead>

      {page && next && (
        <NextPanel title={next.title} sub={next.sub}>
          {next.items && next.items.length > 0 && <ul className="mt-2.5" data-next-items>{next.items.map((it) => <li key={it} className="flex min-h-10 items-center gap-2.5 border-b border-line text-[15px] last:border-b-0"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-hiv-blue" />{it}</li>)}</ul>}
          {next.checks && next.checks.length > 0 && <ul className="mt-2.5" data-next-checks>{next.checks.map((c) => <li key={c} className="flex min-h-9 items-center gap-2.5 text-sm"><span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-hiv-green text-[13px] font-bold text-white">✓</span>{c}</li>)}</ul>}
          {next.ownerReady && <p className={`mt-2.5 text-sm font-medium ${next.ownerReady.done ? "text-hiv-green" : "text-ink"}`} data-owner-ready>{next.ownerReady.text}</p>}
          {["offer_install_days", "install_answer_owner", "install_waiting_owner", "install_booked"].includes(next.panel) && <InstallerInstallDays jobId={jobId} ownerFirstName={owner} />}
          {next.panel === "install_booked" && <Link to="/field/day/$jobId" params={{ jobId }} className={`${primaryLinkClass} mt-2`} data-todays-job>Today's job</Link>}
          {["ready_check_offer_times", "ready_check_answer_owner", "ready_check_waiting_owner"].includes(next.panel) && <InstallerReadyCheckTimesCard jobId={jobId} ownerFirstName={owner} />}
          {next.panel === "ready_check_set_time" && a1ReadyCheckEntryAllowed({ channel: job.channel ?? null, stage: job.stage ?? null }) && <A1ReadyCheckTimeCard jobId={jobId} />}
          {(next.panel === "mitti_form" || (next.panel === "quote_status" && next.yours)) && page.form.auditId && page.mittiInvited && <MittiFormLink auditId={page.form.auditId} className={`${primaryLinkClass} mt-3.5`}>Open Mitti form</MittiFormLink>}
          {/* Decision 318: the pay rule sits beside the Mitti form for the paid visits (install day onwards). */}
          {["offer_install_days", "install_answer_owner", "install_waiting_owner", "install_booked", "sign_rebate", "install_done"].includes(next.panel) && <NoFormNoPay className="mt-3" />}
          {next.panel === "sign_rebate" && (
            <div className="mt-3 space-y-3" data-sign-rebate>
              {!page.install.recordedAt
                ? <OneTapAction label={<><Check /> The install is finished</>} busyLabel="Recording…" confirm="Confirm the install is finished on site? Only do this once the Mitti install form is Complete." confirmLabel="Yes, it's finished" run={() => done({ jobId }, "Install recorded")} />
                : <InstallerFinalDeclaration jobId={jobId} />}
            </div>
          )}
          {next.note && <Note className="mt-3">{next.note}</Note>}
        </NextPanel>
      )}

      {page && (showQuoteStatus || (page.boss && page.channel === "installer_sourced") || page.pay.amount != null) && (
        <Group title="Quote">
          {showQuoteStatus && <Row label="Status" value={quoteRow.label} tone={quoteRow.tone === "green" ? "green" : quoteRow.tone === "sub" ? "sub" : "bold"} />}
          {/* Approved M2-quote-declined: the pay line is hidden when there is no install. */}
          {page.pay.amount != null && !page.quote?.declined && <Row label="Your pay for this job" value={`$${Math.round(page.pay.amount).toLocaleString("en-AU")}`} tone="bold" />}
          {page.pay.amount != null && !page.quote?.declined && <Note>{payNote({ channel: page.channel, areaM2: page.pay.areaM2, removalM2: page.pay.removalM2 })}</Note>}
          {/* Decision 278: the business owner's price card — the server returns nothing for team members. */}
          {page.boss && page.channel === "installer_sourced" && <InstallerPriceCard jobId={jobId} />}
          {showQuoteStatus && <OwnerQuoteCard jobId={jobId} hideStatus />}
          {elecRow && <div className="mt-1.5 border-t border-line"><Row label={elecRow.label} value={<span className="font-medium">{elecRow.value}</span>} last={!installLine} /></div>}
          {installLine && <Row label="Install" value={installLine} last />}
        </Group>
      )}

      {/* Decision 261: the safety plan (SWMS) the crew signs before install day. */}
      <SafetyPlanCard jobId={jobId} />

      {page && readyCheck && (atReadyCheck || page.form.linked) && (
        <Group title="Ready Check">
          {(readyCheck.visit !== "Not booked yet" || page.channel === "hivic_sourced") && <Row label="Visit" value={readyCheck.visit} />}
          {readyCheck.form && <Row label="Mitti form" value={readyCheck.form.label} tone={readyCheck.form.tone === "green" ? "green" : readyCheck.form.tone === "sub" ? "sub" : "bold"} />}
          {page.form.linked && page.form.auditId && page.mittiInvited && <MittiFormLink auditId={page.form.auditId} className="flex min-h-12 w-full items-center justify-between gap-3 text-[15px] font-semibold text-hiv-blue"><span>Open Mitti form</span><span className="text-xl text-sub">›</span></MittiFormLink>}
          {!page.form.linked && page.channel === "hivic_sourced" && <MittiOnly jobId={jobId} which="ready_check" />}
        </Group>
      )}

      <WhosDoingThis jobId={jobId} readyCheckDone={!!page?.readyCheck.done} visitAt={page?.install.bookedAt ?? page?.readyCheck.bookedAt ?? null} suburb={(job.property_address ?? "").split(",").slice(-1)[0]?.replace(/\b(VIC|Victoria)\b.*$/i, "").trim() || null} />

      <details>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between border-y border-line text-[15px] text-sub"><span>More · staff job links</span><span className="text-xl">›</span></summary>
        <div className="py-3"><WorkerLinksPanel jobId={jobId} /></div>
      </details>
    </Screen>
  );
}
