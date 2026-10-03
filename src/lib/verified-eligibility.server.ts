// Persistence for verified eligibility. Reads use the service client only after the caller is
// verified as office; writes go through the office-only database function as the signed-in user.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  assessEligibility,
  recordErrors,
  verificationStale,
  VERIFIED_RULESET,
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

export async function gatherEvidence(jobId: string): Promise<ReadyCheckEvidence> {
  const [{ rc, m }, { data: job }, { data: files }] = await Promise.all([
    currentReadyCheck(jobId),
    admin.from("jobs").select("property_id").eq("id", jobId).maybeSingle(),
    admin.from("evidence_files").select("lat, evidence_requirements(category)").eq("job_id", jobId),
  ]);
  const { data: prop } = job?.property_id
    ? await admin.from("properties").select("enrichment").eq("id", job.property_id).maybeSingle()
    : { data: null };
  const enr = (prop?.enrichment ?? {}) as Record<string, unknown>;
  const declared = ((enr["base44"] as { declared?: Record<string, unknown> } | undefined)
    ?.declared ?? {}) as Record<string, unknown>;
  const prev =
    typeof enr["previous_ceiling_insulation_upgrade"] === "boolean"
      ? enr["previous_ceiling_insulation_upgrade"]
        ? "yes"
        : "no"
      : declared["previous_upgrade"] === "yes" || declared["previous_upgrade"] === "no"
        ? (declared["previous_upgrade"] as "yes" | "no")
        : null;
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
  return {
    readyCheck: {
      ref,
      version,
      final: rc ? rc.status === "submitted" && !!rc.submitted_at : m?.status === "complete",
      submissionRef: rc?.external_mitti_id ?? m?.external_id ?? null,
    },
    currentVersion: version,
    attendance: {
      installer: !!(rc?.installer_user_id ?? m?.completed_by ?? m?.measured_by_name),
      attendedAt: !!(rc?.attended_at ?? m?.completed_at ?? m?.measured_on),
      geotagPhoto: cats.some((f) => f.geo),
      ceilingMedia: hasCat("before_ceiling_space"),
    },
    measure: { areaM2: m?.measured_area_m2 ?? null, method: m?.measurement_method ?? null },
    insulation: {
      existing: m?.insulation_present == null ? null : m.insulation_present ? "present" : "none",
      type: str("insulation.type") ?? str("insulation_type"),
      depthMm: num("insulation.depth_mm") ?? num("insulation_depth_mm"),
      rValue: m?.existing_r_value ?? null,
      photos: hasCat("existing_insulation_r_value"),
    },
    removal: m?.removal_required == null ? null : m.removal_required ? "yes" : "no",
    access: { level: m?.access_difficulty ?? null, evidence: hasCat("access_manhole") },
    previousUpgrade: prev,
    electrical: {
      downlightCount: num("elec.downlight_count") ?? num("downlight_count"),
      downlightType: str("elec.downlight_type") ?? str("downlight_type"),
    },
    conflicts: Array.isArray(m?.review_flags)
      ? (m!.review_flags as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  };
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
  return (
    !!v &&
    v.outcome === "eligible" &&
    !verificationStale(v, { ref: e.readyCheck.ref, version: e.readyCheck.version })
  );
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

/** Office-only. Records the result and an audit event. Never changes stage, quotes, payments, bookings or messages. */
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
  return { id: data as unknown as string };
}
