// Decision 157 (Jo, 24 Oct 2026): our-lead PIESA goes to the quoted installer's usual electrician at the onboarding
// rate. Reads only; the one write is the internal `piesa_usual_electrician_applied` note when an offer uses that rate.
// Never creates offers, assignments or quotes — the existing office pick / offer path does that.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { ourLeadPiesaElectrician, type OurLeadPiesaSelection, type UsualMatchCandidate } from "./our-lead-piesa-electrician.core";

type Cand = { business_id: string; blocker?: string | null };

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
    const [{ data: bizs }, { data: workers }] = ids.length ? await Promise.all([
      admin.from("businesses").select("id, name, trading_name, rec_number").in("id", ids),
      admin.from("partner_workers").select("business_id, licence_number").eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).in("business_id", ids),
    ]) : [{ data: [] }, { data: [] }];
    const full: UsualMatchCandidate[] = candidates.map((c) => {
      const b = (bizs ?? []).find((x) => x.id === c.business_id);
      return { business_id: c.business_id, name: b?.name ?? null, trading_name: b?.trading_name ?? null, rec_number: b?.rec_number ?? null,
        worker_licences: (workers ?? []).filter((w) => w.business_id === c.business_id).map((w) => w.licence_number), blocker: c.blocker ?? null };
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
  await logEvent(jobId, actorId, USUAL_ELECTRICIAN_APPLIED_EVENT, `${sel.note} (decision 157 — owner price unchanged)`, { business_id: sel.businessId, rate_inc_gst: sel.rateIncGst, rate_id: sel.rateId }, { internal: true });
}
