// Install-day evidence and sign-off (decisions 205/210/211/213/262): reads the Install day audit against the job's
// upgrade areas and keeps the result as the append-only `install_evidence_synced` workflow event (latest per job wins;
// a new event only when the result changed). Rules are pure in install-evidence.core.ts. The safety plan (SWMS) lives
// in swms.server.ts (decision 261). Never sends; the only stage move is through recordInstallationComplete.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { melbourneToday, addYmd } from "./melbourne-time.core";
import { declaredProductProblems, evaluateInstallEvidence, withJobProduct, installEvidenceGateLines, jobProductOptions, readInstallEvidence, type InstallEvidenceCtx, type InstallEvidenceSummary, type InstallPrefillCtx, type JobZone } from "./install-evidence.core";
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
  const zones = await readyCheckZones(jobId);
  if (!zones.some((z) => !z.product)) return zones;
  // Jo 30 Oct 2026: the Ready Check asks the product once per job; areas without their own use it (latest ready answer).
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = ev?.details as { ready?: boolean; product?: unknown } | null;
  const { insulationProduct } = await import("./insulation-product.core");
  return withJobProduct(zones, d?.ready ? insulationProduct(d.product)?.option ?? null : null);
}

async function readyCheckZones(jobId: string): Promise<JobZone[]> {
  // Canonical Ready Check areas (latest Ready Check, `measure.areas_v1` observation) read directly: this module sits on the
  // autoAdvanceJob import graph, so it must not pull the Ready Check draft module and its intake/Mitti imports.
  const { data: rcRow } = await admin.from("ready_checks").select("id").eq("job_id", jobId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: obs } = rcRow ? await admin.from("ready_check_observations").select("value").eq("ready_check_id", rcRow.id).eq("field_key", AREAS_FIELD_KEY).maybeSingle() : { data: null };
  let rc: ReturnType<typeof readAreas> = [];
  try { rc = obs ? readAreas(obs.value) : []; } catch { rc = []; }
  const { data: m } = await admin.from("ceiling_measurements").select("insulation_present, existing_r_value, removal_required, zones").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  // Decision 264: whether each area's before video is on the Ready Check (the Mitti sync stores it on the measurement zones).
  const rawZones: unknown[] = Array.isArray(m?.zones) ? (m?.zones as unknown[]) : [];
  const mz = rawZones.filter((z): z is Record<string, unknown> => !!z && typeof z === "object" && !Array.isArray(z));
  const videoAt = (i: number, label: string | null): boolean | null => {
    const z = mz.find((x) => label && typeof x["label"] === "string" && String(x["label"]).trim().toLowerCase() === label.trim().toLowerCase()) ?? mz[i];
    return z && typeof z["beforeVideo"] === "boolean" ? (z["beforeVideo"] as boolean) : null;
  };
  if (rc.length) return rc.map((a, i) => ({ name: a.label?.trim() || null, underInsulated: a.existing === "present" ? true : a.existing === "none" ? false : null, areaM2: a.areaM2, product: a.product, beforeVideo: videoAt(i, a.label) }));
  const { rcAreasFromRecord } = await import("./piisa-a3.core");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return rcAreasFromRecord(m ?? null, null).map((a, i) => {
    const z = mz[i];
    return { name: a.name ?? null, underInsulated: a.present ?? null, areaM2: num(z?.["areaM2"]), product: typeof z?.["product"] === "string" ? (z["product"] as string) : null, beforeVideo: videoAt(i, a.name ?? null) };
  });
}

async function installBooking(jobId: string) {
  const { data } = await admin.from("bookings").select("scheduled_start, scheduled_end, status").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: true }).limit(1).maybeSingle();
  return data ?? null;
}
/** Installation start date: the confirmed installation booking, else the A5 form's start date, else the completion record. */
export async function installStartDate(jobId: string, a3StartDate?: string | null): Promise<string | null> {
  const b = await installBooking(jobId);
  if (b?.scheduled_start) return melbourneDateOf(b.scheduled_start);
  const fromForm = melbourneDateOf(a3StartDate);
  if (fromForm) return fromForm;
  const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
  return melbourneDateOf(job?.installation_completed_at);
}

export async function latestInstallEvidenceRecord(jobId: string) {
  const { data, error } = await admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", INSTALL_EVIDENCE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Install-day evidence could not be read.");
  const d = data?.details as { audit_id?: string; summary?: InstallEvidenceSummary } | null;
  return d ? { ...d, createdAt: data?.created_at } : null;
}
export async function latestInstallEvidence(jobId: string): Promise<InstallEvidenceSummary | null> {
  return (await latestInstallEvidenceRecord(jobId))?.summary ?? null;
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

/** Job-file document kind for the A5 ruler photos (decision 396). */
export const RULER_PHOTO_DOC_KIND = "install_ruler_photo";
/**
 * Decision 396: keep each A5 ruler photo with the job file for the AP record, the same way the PIESA evidence files are
 * kept (mitti.server savePiesaEvidenceFiles): one private copy per Mitti media id (`documents` external_id
 * `<audit>:<media>`), so a retry never duplicates; location and capture time go on the saved event. Never throws.
 */
export async function saveRulerPhotoFiles(jobId: string, actorId: string | null, auditId: string, summary: InstallEvidenceSummary, fetchMedia: MittiMediaFetch): Promise<string[]> {
  const saved: string[] = [];
  summary.copyFailures = [];
  const captured: { area: string; which: "existing" | "new"; media_id: string; captured_at: string | null; geotagged: boolean }[] = [];
  for (const a of summary.rulerPhotos ?? []) {
    for (const [which, files] of [["existing", a.existing], ["new", a.after]] as const) {
      for (const file of files) {
        const key = `${auditId}:${file.mediaId}`;
        try {
          if (!file.mediaId) throw new Error("media id missing");
          const { data: ex, error: lookupError } = await admin.from("documents").select("id, storage_path").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
          if (lookupError) throw new Error(lookupError.message);
          if (ex) {
            const check = ex.storage_path ? await admin.storage.from("job-files").download(ex.storage_path) : null;
            if (!check?.error && check?.data?.size) continue;
          }
          const { bytes, contentType } = await fetchMedia(auditId, file.mediaId);
          if (!bytes.length) throw new Error("empty media");
          const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("heic") ? "heic" : "bin";
          const path = ex?.storage_path || `${jobId}/mitti/ruler-photos/${auditId}-${file.mediaId}.${ext}`;
          const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
          if (up.error) {
            if (!/exists|duplicate/i.test(up.error.message)) throw new Error("storage upload failed");
            const check = await admin.storage.from("job-files").download(path);
            if (check.error || !check.data?.size) throw new Error("stored photo could not be verified");
          }
          const label = which === "existing" ? "existing insulation depth" : "new insulation depth after install";
          const { error } = ex ? { error: null } : await admin.from("documents").insert({ job_id: jobId, kind: RULER_PHOTO_DOC_KIND, title: `Ruler photo – ${a.name} – ${label}`, storage_path: path, mime_type: contentType, uploaded_by: actorId, source_system: "mitti", external_id: key, original_name: `area${a.zone}-${which}-${file.mediaId}.${ext}`, size_bytes: bytes.length });
          if (error) {
            if (error.code !== "23505") throw new Error(error.message);
            const check = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
            if (check.error || !check.data) throw new Error(error.message);
          }
          saved.push(path);
          captured.push({ area: a.name, which, media_id: file.mediaId, captured_at: file.capturedAt ?? null, geotagged: file.lat != null && file.lng != null });
        } catch (e) {
          summary.copyFailures.push({ mediaId: file.mediaId ?? "", area: a.name, which, reason: e instanceof Error ? e.message : "error" });
          await logEvent(jobId, actorId, "install_ruler_photo_failed", `Ruler photo (${a.name}, ${which}) could not be saved – sync again to retry`, { audit_id: auditId, media_id: file.mediaId, reason: e instanceof Error ? e.message : "error" }, { internal: true }).catch(() => undefined);
        }
      }
    }
  }
  if (saved.length) await logEvent(jobId, actorId, "install_ruler_photos_saved", `${saved.length} ruler photo(s) from the install day form saved to job files (decision 396)`, { audit_id: auditId, paths: saved, captured }, { internal: true }).catch(() => undefined);
  return saved;
}

/** Read the audit, evaluate, and record the result when it changed. Returns the summary. `fetchMedia` = also keep the
 *  ruler photos on the job file (decision 396). */
export async function syncInstallEvidence(jobId: string, actorId: string | null, auditId: string, audit: unknown, fetchMedia?: MittiMediaFetch): Promise<InstallEvidenceSummary> {
  const { parseAudit } = await import("./mitti.core");
  const parsed = parseAudit(audit);
  const { data: job, error: je } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  if (je || !job || parsed.auditId !== auditId || parsed.jobNumber?.trim().toUpperCase() !== job.job_number.trim().toUpperCase()) throw new Error("The A5 form does not match this job.");
  const ctx = await installEvidenceContext(jobId, audit);
  const { data: pre } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_prestart_captured").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const workStartAt = (pre?.details as { snapshot?: { signature?: { signed_at?: string } } } | null)?.snapshot?.signature?.signed_at ?? null;
  const summary = evaluateInstallEvidence(readInstallEvidence(audit), ctx, workStartAt);
  summary.jobId = jobId;
  summary.auditId = auditId;
  summary.auditFingerprint = await (await import("./mitti-create-claim.core")).stableUuid(JSON.stringify(audit));
  if (summary.rulerPhotos?.length) {
    if (fetchMedia) await saveRulerPhotoFiles(jobId, actorId, auditId, summary, fetchMedia);
    else summary.copyFailures = summary.rulerPhotos.flatMap(a => [...a.existing, ...a.after].map(f => ({ mediaId: f.mediaId ?? "", area: a.name, which: "photo", reason: "Photo copy has not been checked" })));
    const copyLines = (summary.copyFailures ?? []).map(f => `${f.area}: ${f.which} ruler photo ${f.mediaId || "(missing id)"} could not be saved — sync again to retry`);
    summary.blockers = [...new Set([...summary.blockers, ...copyLines])];
    summary.rulerBlockers = [...new Set([...(summary.rulerBlockers ?? []), ...copyLines])];
    for (const item of summary.items) if (item.id.startsWith("ruler_") && copyLines.length) { item.state = "review"; item.problems.push(...copyLines); }
  }
  const prev = await latestInstallEvidenceRecord(jobId);
  const { data: lastFailure, error: failureError } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "install_evidence_sync_failed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (failureError) throw new Error("Evidence retry history could not be checked.");
  if (prev?.audit_id !== auditId || JSON.stringify(prev?.summary ?? null) !== JSON.stringify(summary) || (lastFailure && (!prev?.createdAt || lastFailure.created_at >= prev.createdAt))) {
    const n = summary.blockers.length;
    await logEvent(jobId, actorId, INSTALL_EVIDENCE_EVENT, !summary.applies ? (n ? `Install-day evidence: ${n} ruler photo item(s) outstanding (decision 396; the rest of the new rule does not apply before the effective date)` : "Install-day evidence: new rule does not apply (install before the effective date)") : n ? `Install-day evidence: ${n} item(s) outstanding` : "Install-day evidence: every item present, SWMS complete, sign-off done", { audit_id: auditId, summary } as unknown as Record<string, unknown>, { internal: true });
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
