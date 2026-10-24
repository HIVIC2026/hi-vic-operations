// Install-day evidence and sign-off (decisions 205/210/211/213/262): reads the Install day audit against the job's
// upgrade areas and keeps the result as the append-only `install_evidence_synced` workflow event (latest per job wins;
// a new event only when the result changed). Rules are pure in install-evidence.core.ts. The safety plan (SWMS) lives
// in swms.server.ts (decision 261). Never sends; the only stage move is through recordInstallationComplete.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { melbourneToday, addYmd } from "./melbourne-time.core";
import { declaredProductProblems, evaluateInstallEvidence, installEvidenceGateLines, jobProductOptions, readInstallEvidence, type InstallEvidenceCtx, type InstallEvidenceSummary, type InstallPrefillCtx, type JobZone } from "./install-evidence.core";
import { AREAS_FIELD_KEY, readAreas } from "./ready-check-areas.core";
import type { MittiMediaFetch } from "./mitti.server";

export const INSTALL_EVIDENCE_EVENT = "install_evidence_synced";

/** Melbourne calendar date of an ISO timestamp or a date-only string; null when unreadable. */
export function melbourneDateOf(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : melbourneToday(new Date(t));
}
const daysBetween = (a: string | null, b: string | null) => { if (!a || !b) return null; let n = 1, d = a; while (d < b && n < 60) { d = addYmd(d, 1); n++; } return n; };

/** Upgrade zones the job records: the canonical Ready Check areas, else structured measurement zones, else the one measurement. */
export async function jobUpgradeZones(jobId: string): Promise<JobZone[]> {
  // Canonical Ready Check areas (latest Ready Check, `measure.areas_v1` observation) read directly: this module sits on the
  // autoAdvanceJob import graph, so it must not pull the Ready Check draft module and its intake/Mitti imports.
  const { data: rcRow } = await admin.from("ready_checks").select("id").eq("job_id", jobId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: obs } = rcRow ? await admin.from("ready_check_observations").select("value").eq("ready_check_id", rcRow.id).eq("field_key", AREAS_FIELD_KEY).maybeSingle() : { data: null };
  let rc: ReturnType<typeof readAreas> = [];
  try { rc = obs ? readAreas(obs.value) : []; } catch { rc = []; }
  if (rc.length) return rc.map((a) => ({ name: a.label?.trim() || null, underInsulated: a.existing === "present" ? true : a.existing === "none" ? false : null }));
  const { data: m } = await admin.from("ceiling_measurements").select("insulation_present, existing_r_value, removal_required, zones").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  const { rcAreasFromRecord } = await import("./piisa-a3.core");
  return rcAreasFromRecord(m ?? null, null).map((a) => ({ name: a.name ?? null, underInsulated: a.present ?? null }));
}

async function installBooking(jobId: string) {
  const { data } = await admin.from("bookings").select("scheduled_start, scheduled_end, status").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: true }).limit(1).maybeSingle();
  return data ?? null;
}
/** Installation start date: the confirmed installation booking, else the A3 form's start date, else the completion record. */
export async function installStartDate(jobId: string, a3StartDate?: string | null): Promise<string | null> {
  const b = await installBooking(jobId);
  if (b?.scheduled_start) return melbourneDateOf(b.scheduled_start);
  const fromForm = melbourneDateOf(a3StartDate);
  if (fromForm) return fromForm;
  const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
  return melbourneDateOf(job?.installation_completed_at);
}

export async function latestInstallEvidence(jobId: string): Promise<InstallEvidenceSummary | null> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_EVIDENCE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = data?.details as { summary?: InstallEvidenceSummary } | null;
  return d?.summary ?? null;
}

/** Facts from the job + the audit itself (crew names and Part answers come from the same form, never guessed). */
export async function installEvidenceContext(jobId: string, audit: unknown): Promise<InstallEvidenceCtx> {
  const a3 = await import("./piisa-a3.core");
  const { answers } = a3.parseA3Answers(audit);
  const str = (k: string) => { const v = answers[k]; return typeof v === "string" ? v : null; };
  const start = str("startDate"), end = str("completionDate");
  const installDate = await installStartDate(jobId, start);
  const b = await installBooking(jobId);
  const bookedStart = melbourneDateOf(b?.scheduled_start), bookedEnd = melbourneDateOf(b?.scheduled_end);
  const formStart = melbourneDateOf(start), formEnd = melbourneDateOf(end);
  const days = Math.max(daysBetween(bookedStart, bookedEnd) ?? 1, daysBetween(formStart, formEnd) ?? 1);
  const crew = a3.a3CrewChoices(audit);
  const nameOf = (c: (typeof crew)[number]) => (c.kind === "other" ? c.name : c.kind === "option" ? c.optionLabel : null);
  const leadName = nameOf(crew[0]!) ?? null;
  const yn = (k: string): boolean | null => (str(k) === "Yes" ? true : str(k) === "No" ? false : null);
  return { installDate, zones: await jobUpgradeZones(jobId), multiDay: days > 1, leadName, solarPresent: yn("p4.present"), existingInsulation: yn("p6.present") };
}

/** Read the audit, evaluate, and record the result when it changed. Returns the summary. */
export async function syncInstallEvidence(jobId: string, actorId: string | null, auditId: string, audit: unknown): Promise<InstallEvidenceSummary> {
  const ctx = await installEvidenceContext(jobId, audit);
  const { data: pre } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_prestart_captured").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const workStartAt = (pre?.details as { snapshot?: { signature?: { signed_at?: string } } } | null)?.snapshot?.signature?.signed_at ?? null;
  const summary = evaluateInstallEvidence(readInstallEvidence(audit), ctx, workStartAt);
  const prev = await latestInstallEvidence(jobId);
  if (JSON.stringify(prev) !== JSON.stringify(summary)) {
    const n = summary.blockers.length;
    await logEvent(jobId, actorId, INSTALL_EVIDENCE_EVENT, !summary.applies ? "Install-day evidence: new rule does not apply (install before the effective date)" : n ? `Install-day evidence: ${n} item(s) outstanding` : "Install-day evidence: every item present, SWMS complete, sign-off done", { audit_id: auditId, summary } as unknown as Record<string, unknown>, { internal: true });
  }
  return summary;
}

/** Prefill facts for a new OLD-A3 Install day audit: zone names from the Ready Check. */
export async function installPrefillContext(jobId: string): Promise<InstallPrefillCtx> {
  const zones = await jobUpgradeZones(jobId);
  return { zoneNames: zones.map((z) => z.name) };
}

/** Gate lines for AP review / Ready for VEEC: install evidence + Activity 48 product check. */
export async function installEvidenceStageExtras(jobId: string): Promise<{ installEvidence: string[]; productProblems: string[] }> {
  const [summary, installDate] = await Promise.all([latestInstallEvidence(jobId), installStartDate(jobId)]);
  return { installEvidence: installEvidenceGateLines(summary, installDate), productProblems: await jobProductProblems(jobId, installDate, summary) };
}

/** Activity 48 product problems: per-zone installed products first, else the declared Ready Check product; install date and today (planned VEEC creation). */
export async function jobProductProblems(jobId: string, installDate?: string | null, summary?: InstallEvidenceSummary | null): Promise<string[]> {
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = ev?.details as { ready?: boolean; product?: { option?: string } | null } | null;
  const option = d?.ready ? d.product?.option ?? null : null;
  const date = installDate === undefined ? await installStartDate(jobId) : installDate;
  const s = summary === undefined ? await latestInstallEvidence(jobId) : summary;
  const options = jobProductOptions(s?.zoneProducts, option);
  const out = options.flatMap((o) => declaredProductProblems(o, { installDate: date, veecCreationDate: melbourneToday() }));
  return [...new Set(out)];
}
