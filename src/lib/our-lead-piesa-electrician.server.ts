// Decision 157 (Jo, 24 Oct 2026): our-lead PIESA goes to the quoted installer's usual electrician at the onboarding
// rate. Reads only; the one write is the internal `piesa_usual_electrician_applied` note when an offer uses that rate.
// Never creates offers, assignments or quotes — the existing office pick / offer path does that.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { ourLeadPiesaElectrician, type OurLeadPiesaSelection, type UsualMatchCandidate } from "./our-lead-piesa-electrician.core";

type Cand = { business_id: string; blocker?: string | null };

const melbourneToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Decision 353: each business's ACTIVE onboarded PIESA rate (electrician_rates, `selectAgreedRate`). A read error
 *  throws — the caller's catch falls back to "not our lead" / office pick, never a guessed rate. */
async function onboardedPiesaRates(businessIds: string[]): Promise<Map<string, { id: string; rate_inc_gst: number }>> {
  const out = new Map<string, { id: string; rate_inc_gst: number }>();
  if (!businessIds.length) return out;
  const { selectAgreedRate } = await import("./allocation.core");
  const { data, error } = await (admin as unknown as { from: (t: string) => any }).from("electrician_rates") // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, business_id, service_type, rate_inc_gst, status, effective_from, effective_to").eq("status", "active").eq("service_type", "piesa").in("business_id", businessIds);
  if (error) throw new Error(`Could not read the electricians' onboarding rates: ${error.message}`);
  const today = melbourneToday();
  for (const b of businessIds) {
    const r = selectAgreedRate(data ?? [], b, "piesa", today);
    if (r) out.set(b, { id: r.id, rate_inc_gst: Number(r.rate_inc_gst) });
  }
  return out;
}

/** The selection for this job against the REC candidates the allocation already computed. Fails to "office pick" on any read error. */
export async function ourLeadPiesaSelection(jobId: string, candidates: Cand[]): Promise<OurLeadPiesaSelection> {
  const none: OurLeadPiesaSelection = { mode: "not_our_lead", businessId: null, rateIncGst: null, note: null };
  try {
    const [{ data: job }, { data: inst }] = await Promise.all([
      admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
      admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    ]);
    if (!job || job.channel === "installer_sourced") return none;
    if (!inst?.business_id) return ourLeadPiesaElectrician({ channel: job.channel, usual: null, candidates: [] });
    const { readUsualElectrician } = await import("./usual-electrician.server");
    const usual = await readUsualElectrician(inst.business_id);
    if (!usual.electrician) return ourLeadPiesaElectrician({ channel: job.channel, usual: null, candidates: [] });
    const ids = candidates.map((c) => c.business_id);
    const [{ data: bizs }, { data: workers }, rates] = ids.length ? await Promise.all([
      admin.from("businesses").select("id, name, trading_name, rec_number").in("id", ids),
      admin.from("partner_workers").select("business_id, licence_number").eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).in("business_id", ids),
      onboardedPiesaRates(ids),
    ]) : [{ data: [] }, { data: [] }, new Map<string, { id: string; rate_inc_gst: number }>()];
    const full: UsualMatchCandidate[] = candidates.map((c) => {
      const b = (bizs ?? []).find((x) => x.id === c.business_id);
      return { business_id: c.business_id, name: b?.name ?? null, trading_name: b?.trading_name ?? null, rec_number: b?.rec_number ?? null,
        worker_licences: (workers ?? []).filter((w) => w.business_id === c.business_id).map((w) => w.licence_number), blocker: c.blocker ?? null,
        piesa_rate: rates.get(c.business_id) ?? null };
    });
    return ourLeadPiesaElectrician({ channel: job.channel, usual: usual.electrician, revision: usual.revision, candidates: full });
  } catch (e) {
    console.error("our-lead PIESA electrician selection skipped", (e as Error).message);
    return none;
  }
}

/** Records (once per selection) that an offer used the usual electrician's onboarding rate. Internal, office-visible. */
export async function noteUsualElectricianApplied(jobId: string, actorId: string | null, sel: OurLeadPiesaSelection) {
  if (sel.mode !== "usual") return;
  const { USUAL_ELECTRICIAN_APPLIED_EVENT } = await import("./our-lead-piesa-electrician.core");
  const { data: dup } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", USUAL_ELECTRICIAN_APPLIED_EVENT).contains("details", { rate_id: sel.rateId, business_id: sel.businessId }).limit(1);
  if ((dup ?? []).length) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, actorId, USUAL_ELECTRICIAN_APPLIED_EVENT, `${sel.note} (decision 157; decision 349 — pass-through, no margin)`, { business_id: sel.businessId, rate_inc_gst: sel.rateIncGst, rate_id: sel.rateId }, { internal: true });
}

/** Decisions 349/351: whose electrician is on this job — the installer's own (usual / nominated) electrician, or ours.
 *  Our leads (A2): is the assigned electrician business the quoted installer's usual electrician (decision 157 identity).
 *  Installer-supplied jobs (A1, decision 351): the job's electrician choice (decision 289) — HIV's → ours; the installer's
 *  usual / nominated electrician → installer_usual when that electrician is the one assigned (`electricianSourceForA1`).
 *  No assignment / no installer / no usual saved → "ours". Read errors throw (no guessed margin). */
export async function electricianSourceForJob(jobId: string, electricianBusinessId: string | null): Promise<import("./our-lead-piesa-electrician.core").ElectricianSource> {
  const { electricianSourceFor, electricianSourceForA1 } = await import("./our-lead-piesa-electrician.core");
  if (!electricianBusinessId) return "ours";
  const READ_FAIL = "Could not check whose electrician is on this job.";
  const [{ data: job, error: je }, { data: inst, error: ie }] = await Promise.all([
    admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  if (je || ie) throw new Error(READ_FAIL);
  if (!job) return "ours";
  const a1 = job.channel === "installer_sourced";
  const installerBiz = a1 ? job.originating_installer_business_id ?? inst?.business_id ?? null : inst?.business_id ?? null;
  const usual = installerBiz ? (await (await import("./usual-electrician.server")).readUsualElectrician(installerBiz)).electrician : null;
  const [{ data: b, error: be }, { data: workers, error: we }] = await Promise.all([
    admin.from("businesses").select("id, name, trading_name, rec_number").eq("id", electricianBusinessId).maybeSingle(),
    admin.from("partner_workers").select("licence_number").eq("business_id", electricianBusinessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null),
  ]);
  if (be || we) throw new Error(READ_FAIL);
  const assigned = b ? { business_id: b.id, name: b.name ?? null, trading_name: b.trading_name ?? null, rec_number: b.rec_number ?? null, worker_licences: (workers ?? []).map((w) => w.licence_number) } : null;
  if (!a1) return installerBiz && usual ? electricianSourceFor({ usual, assigned }) : "ours";
  // A1: the recorded choice, then the last resolved Mitti electrician (old forms), then usual, then HIV (decision 289).
  const [recorded, { data: last, error: le }] = await Promise.all([
    (await import("./electrician-choice.server")).readElectricianChoice(jobId),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (le) throw new Error(READ_FAIL);
  const lastDetails = (last?.details ?? null) as { choice?: string | null; recBusinessId?: string | null } | null;
  const { resolveElectricianChoice } = await import("./electrician-choice.core");
  const choice = resolveElectricianChoice({ recorded, legacy: lastDetails?.choice ?? null, usual });
  return electricianSourceForA1({ choice, usual, nominatedBusinessIds: [lastDetails?.recBusinessId ?? null], assigned });
}
