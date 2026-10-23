// Jo 23 Oct 2026: basic-info check run on every Mitti Ready Check sync. Writes one "ready_check_basics"
// event only when the result changes, and keeps "Needs finishing…" on installer/Mitti jobs. Never sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { readyCheckBasics, needsFinishingFromMissing } from "./ready-check-basics.core";

type E = { label: string; value: string | null };
export const BASICS_EVENT = "ready_check_basics";
/** Jobs whose next step is protected as "Needs finishing…" while basics are missing. */
export const PROTECT_EVENTS = ["mitti_pickup_needs_finishing", "mitti_pickup_manual_adopt"];

export async function checkReadyCheckBasics(jobId: string, actorId: string | null, entries: E[], formCompleted: boolean, auditId: string) {
  const [{ data: job }, { data: m }, { data: perm }, { data: protect }, { data: last }] = await Promise.all([
    admin.from("jobs").select("channel, stage, owner_id, life_support_status, owners(phone,email), properties(enrichment)").eq("id", jobId).maybeSingle(),
    admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "mitti_contact_permission").limit(1).maybeSingle(),
    admin.from("workflow_events").select("id").eq("job_id", jobId).in("event_type", PROTECT_EVENTS).limit(1).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", BASICS_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!job) return null;
  const installerSourced = job.channel === "installer_sourced";
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const a = contactAnswersFromEntries(entries);
  const { resolveMittiProduct } = await import("./insulation-product.core");
  const ra = await import("./ready-check-answers.core");
  const totalRaw = entries.find((e) => /^total quoted price/i.test((e.label ?? "").trim()))?.value ?? null;
  const total = totalRaw == null ? null : Number(String(totalRaw).replace(/[$,\s]/g, ""));
  let permission: boolean | null = a.contactPermission ?? (perm ? true : null);
  if (!installerSourced && permission == null) {
    const { data: c } = await admin.from("owner_contact_consents").select("consent_status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    permission = c?.consent_status === "granted" ? true : null;
  }
  const owner = job.owners as { phone: string | null; email: string | null } | null;
  const overFive = ((job.properties as { enrichment?: { base44?: { declared?: { over_five_years?: string } } } } | null)?.enrichment?.base44?.declared?.over_five_years) ?? null;
  const stops = installerSourced ? ra.readyCheckStopReasons(entries)
    : [...ra.readyCheckStopReasons(entries, { ownerAnsweredOnWebsite: true }), ...ra.websiteStopReasons({ lifeSupportStatus: (job.life_support_status as string | null) ?? null, overFiveYears: overFive })];
  const r = readyCheckBasics({
    installerSourced, areaM2: m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null,
    productReady: resolveMittiProduct(a.productOption).ready, installerPriceIncGst: Number.isFinite(total) ? total : null,
    ownerMobile: owner?.phone ?? a.phone ?? null, ownerEmail: owner?.email ?? a.email ?? null, contactPermission: permission, stops, formCompleted,
  });
  const prev = last?.details as { missing?: string[]; stops?: string[]; completed?: boolean } | null;
  if (!prev || JSON.stringify(prev.missing ?? []) !== JSON.stringify(r.missing) || JSON.stringify(prev.stops ?? []) !== JSON.stringify(r.stops) || prev.completed !== formCompleted)
    await logEvent(jobId, actorId, BASICS_EVENT, r.ready ? "Ready Check basics in — quote drafted for office check" : `Ready Check basics missing: ${[...r.missing, ...r.stops].join(", ")}`, { audit_id: auditId, missing: r.missing, stops: r.stops, notes: r.notes, completed: formCompleted, ready: r.ready }, { internal: true });
  if ((installerSourced || protect)) await keepNeedsFinishingFor(jobId, job.stage as string, r.missing);
  return r;
}

/** Writes next_action only; never moves stages. Ready Check stages only. */
export const READY_CHECK_BASICS_DONE = "Ready Check basics in — quote being prepared";
export async function keepNeedsFinishingFor(jobId: string, stage: string, missing: string[]) {
  const { READY_CHECK_STAGES } = await import("./mitti-pickup.server");
  if (!READY_CHECK_STAGES.includes(stage as never)) return false;
  const { data: cur } = await admin.from("jobs").select("next_action").eq("id", jobId).maybeSingle();
  // Jo 23 Oct: once every basic is in, a stale "Needs finishing…" is replaced (it otherwise stayed on the installer's card).
  const next = needsFinishingFromMissing(missing) ?? (cur?.next_action?.startsWith("Needs finishing") ? READY_CHECK_BASICS_DONE : null);
  if (!next || cur?.next_action === next) return false;
  await admin.from("jobs").update({ next_action: next }).eq("id", jobId);
  return true;
}
