// Persistence for verified eligibility. Reads use the service client only after the caller is
// verified as office; writes go through the office-only database function as the signed-in user.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  assessEligibility,
  recordErrors,
  verificationStale,
  PRIOR_ACTIVITY_CHECKS,
  PRIOR_ACTIVITY_LABEL,
  VERIFIED_RULESET,
  type PriorActivityCheck,
  type ReadyCheckEvidence,
  type StoredVerification,
  type VerifiedOutcome,
} from "./verified-eligibility.core";

type Row = StoredVerification & {
  id: string;
  reason: string | null;
  note: string | null;
  recorded_at: string;
  recorded_by: string;
  is_current: boolean;
  flags: unknown;
  review_reasons: unknown;
};
// Table is added by pending migration 0081; until it exists, typed queries go through this loose handle.
const loose = admin as unknown as SupabaseClient;

/** Current Ready Check reference: the newest final ready_checks row, else the current installer measure-up. */
async function currentReadyCheck(jobId: string) {
  const { data: rc } = await admin
    .from("ready_checks")
    .select("id, version, status, submitted_at, external_mitti_id, installer_user_id, attended_at")
    .eq("job_id", jobId)
    .neq("status", "superseded") // a superseded version is never the current Ready Check
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: m } = await admin
    .from("ceiling_measurements")
    .select("*")
    .eq("job_id", jobId)
    .eq("is_current", true)
    .eq("source_role", "installer")
    .maybeSingle();
  return { rc, m };
}

/** Submitted portal Ready Check answers (ready_check_observations), keyed by the canonical field keys. */
async function portalAnswers(readyCheckId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("ready_check_observations").select("field_key, value").eq("ready_check_id", readyCheckId);
  if (error) throw new Error(`Ready Check answers could not be read: ${error.message}`);
  const out: Record<string, unknown> = {};
  for (const r of data ?? []) out[r.field_key] = r.value;
  return out;
}

export async function gatherEvidence(jobId: string): Promise<ReadyCheckEvidence> {
  const [{ rc, m }, { data: job }, { data: files }] = await Promise.all([
    currentReadyCheck(jobId),
    admin.from("jobs").select("property_id").eq("id", jobId).maybeSingle(),
    admin.from("evidence_files").select("lat, evidence_requirements(category)").eq("job_id", jobId),
  ]);
  const { data: prop } = job?.property_id
    ? await admin.from("properties").select("enrichment").eq("id", job.property_id).maybeSingle()
    : { data: null };
  const cats = (files ?? []).map((f) => ({
    cat: (f.evidence_requirements as { category?: string } | null)?.category ?? null,
    geo: f.lat !== null,
  }));
  const hasCat = (c: string) => cats.some((f) => f.cat === c);
  const snap = (m?.raw_snapshot ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof snap[k] === "string" ? (snap[k] as string) : null);
  const num = (k: string) => (typeof snap[k] === "number" ? (snap[k] as number) : null);
  const ref = rc?.id ?? m?.id ?? null;
  const version = rc ? rc.version : m ? 1 : null;
  // Portal Ready Check (installer-submitted in the portal, no Mitti form): its submitted answers are the record the
  // office reviews. The office still decides; this only lets the existing review card see what was submitted.
  const portal = rc && rc.status === "submitted" && !!rc.submitted_at && !rc.external_mitti_id ? await portalAnswers(rc.id) : null;
  const pStr = (k: string) => (portal && typeof portal[k] === "string" ? (portal[k] as string) : null);
  const pNum = (k: string) => (portal && typeof portal[k] === "number" ? (portal[k] as number) : null);
  const pInsulation = pStr("insulation.existing");
  const pRemoval = pStr("removal.required");
  return {
    readyCheck: {
      ref,
      version,
      final: rc ? rc.status === "submitted" && !!rc.submitted_at : m?.status === "complete",
      submissionRef: rc?.external_mitti_id ?? (portal && rc ? `portal:${rc.id}` : null) ?? m?.external_id ?? null,
    },
    currentVersion: version,
    attendance: {
      installer: !!(rc?.installer_user_id ?? m?.completed_by ?? m?.measured_by_name),
      attendedAt: !!(rc?.attended_at ?? pStr("attendance.attended_at") ?? m?.completed_at ?? m?.measured_on),
      geotagPhoto: cats.some((f) => f.geo),
      ceilingMedia: hasCat("before_ceiling_space"),
    },
    // Area/method: the office-reviewed measurement wins; the portal answer is shown when no measurement row exists.
    measure: { areaM2: m?.measured_area_m2 ?? pNum("measure.eligible_area_m2"), method: m?.measurement_method ?? pStr("measure.method") },
    insulation: {
      existing: m?.insulation_present == null ? (pInsulation === "none" || pInsulation === "present" || pInsulation === "unknown" ? pInsulation : null) : m.insulation_present ? "present" : "none",
      type: str("insulation.type") ?? str("insulation_type") ?? pStr("insulation.type"),
      depthMm: num("insulation.depth_mm") ?? num("insulation_depth_mm") ?? pNum("insulation.depth_mm"),
      rValue: m?.existing_r_value ?? pNum("insulation.r_value"),
      photos: hasCat("existing_insulation_r_value"),
    },
    removal: m?.removal_required == null ? (pRemoval === "yes" || pRemoval === "no" ? pRemoval : pRemoval ? "uncertain" : null) : m.removal_required ? "yes" : "no",
    access: { level: m?.access_difficulty ?? pStr("access.level"), evidence: hasCat("access_manhole") },
    electrical: {
      downlightCount: num("elec.downlight_count") ?? num("downlight_count") ?? pNum("elec.downlight_count"),
      downlightType: str("elec.downlight_type") ?? str("downlight_type") ?? pStr("elec.downlight_type"),
    },
    conflicts: Array.isArray(m?.review_flags)
      ? (m!.review_flags as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    priorActivity: await priorActivityCheck(jobId),
  };
}

export const PRIOR_ACTIVITY_EVENT = "prior_activity_check_recorded";

/** Latest office check for previous Activity 48 evidence (null = not checked; fails closed). */
export async function priorActivityCheck(jobId: string): Promise<PriorActivityCheck | null> {
  const { data } = await admin
    .from("workflow_events")
    .select("details")
    .eq("job_id", jobId)
    .eq("event_type", PRIOR_ACTIVITY_EVENT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = (data?.details as { answer?: string } | null)?.answer;
  return (PRIOR_ACTIVITY_CHECKS as readonly string[]).includes(v ?? "")
    ? (v as PriorActivityCheck)
    : null;
}

/** Office-only. Audited; never changes stage, eligibility result, quotes, payments or messages. */
export async function recordPriorActivityCheck(
  jobId: string,
  actorId: string,
  answer: PriorActivityCheck,
  note: string | null,
) {
  const n = note?.trim() || null;
  if (answer !== "none_known" && !n)
    throw new Error("Add a note describing the previous Activity 48 evidence and where it applies.");
  const { logEvent } = await import("./workflow.server");
  await logEvent(
    jobId,
    actorId,
    PRIOR_ACTIVITY_EVENT,
    `Previous Activity 48 check: ${PRIOR_ACTIVITY_LABEL[answer]}`,
    { answer, note: n },
    { internal: true },
  );
  return { ok: true };
}

/** Current verification row, or null when none (or the table is not yet created — fails closed). */
export async function currentVerification(jobId: string): Promise<Row | null> {
  const { data, error } = await loose
    .from("eligibility_verifications")
    .select("*")
    .eq("job_id", jobId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) return null;
  return (data as Row | null) ?? null;
}

/** True only for a current, not-stale "eligible" result. */
export async function verifiedEligible(jobId: string): Promise<boolean> {
  const [v, e] = await Promise.all([currentVerification(jobId), gatherEvidence(jobId)]);
  // A current office decision always wins, eligible or not (admin decisions are never overridden).
  if (v && !verificationStale(v, { ref: e.readyCheck.ref, version: e.readyCheck.version })) return v.outcome === "eligible";
  return formEligibleForCurrentReadyCheck(jobId);
}

/** Jo 24 Oct: eligibility decided from the answers on the job's CURRENT Mitti Ready Check form, recorded by the
 *  completion step as an append-only `ready_check_form_eligible` event for that exact form. */
export const FORM_ELIGIBLE_EVENT = "ready_check_form_eligible";
export async function formEligibleForCurrentReadyCheck(jobId: string): Promise<boolean> {
  const { data: m, error } = await admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (error || !m || m.external_source !== "mitti" || !m.external_id || m.status !== "complete") return false;
  const { count, error: ee } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FORM_ELIGIBLE_EVENT).contains("details", { audit_id: m.external_id });
  return !ee && (count ?? 0) > 0;
}

export async function eligibilityView(jobId: string) {
  const evidence = await gatherEvidence(jobId);
  const assessment = assessEligibility(evidence);
  const current = await currentVerification(jobId);
  const { data: history } = await loose
    .from("eligibility_verifications")
    .select("id, outcome, reason, note, recorded_at, recorded_by, is_current, ready_check_version")
    .eq("job_id", jobId)
    .order("recorded_at", { ascending: false });
  const stale = verificationStale(current, {
    ref: evidence.readyCheck.ref,
    version: evidence.readyCheck.version,
  });
  return { evidence, assessment, current, stale, history: (history ?? []) as Row[] };
}

/** Office-only. Records the result/audit; final not-eligible decisions prepare the guarded T7 once per job. */
export async function recordVerification(
  sb: SupabaseClient,
  jobId: string,
  outcome: VerifiedOutcome,
  reason: string | null,
  note: string | null,
) {
  const evidence = await gatherEvidence(jobId);
  const a = assessEligibility(evidence);
  const errors = recordErrors(outcome, a, reason, note);
  if (errors.length) throw new Error(errors.join(" "));
  if (!evidence.readyCheck.ref || evidence.readyCheck.version === null)
    throw new Error("No Ready Check is recorded for this job yet.");
  const { data, error } = await sb.rpc(
    "record_eligibility_verification" as never,
    {
      _job: jobId,
      _ref: evidence.readyCheck.ref,
      _version: evidence.readyCheck.version,
      _outcome: outcome,
      _evidence_complete: a.evidenceComplete,
      _reviews: a.reviewReasons,
      _flags: a.flags,
      _snapshot: evidence,
      _ruleset: VERIFIED_RULESET,
      _reason: reason,
      _note: note,
    } as never,
  );
  if (error) throw new Error(`Verified eligibility could not be recorded: ${error.message}`);
  if (outcome === "not_eligible") {
    await (await import("./verified-ineligible-email.server")).sendVerifiedIneligibleEmail(jobId)
      .catch((e) => console.error("Verified not-eligible email not sent", jobId, String(e)));
  }
  return { id: data as unknown as string };
}
