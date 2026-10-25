// Decision 211: generate the Table 4 area diagram from the job's own Ready Check facts and file it in the private job
// file (kind `area_diagram` on Ready Check completion; `final_area_diagram` from the install-day per-zone
// confirmations). Idempotent: the same facts (content hash) never file a second copy. Never sends anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  AREA_DIAGRAM_EVENT, AREA_DIAGRAM_KIND, FINAL_AREA_DIAGRAM_EVENT, FINAL_AREA_DIAGRAM_KIND,
  applyInstallZones, areaDiagramHash, areaDiagramSummary, areaDiagramSvg, areasFromReadyCheckEntries, areasFromRecordAreas, singleAreaFallback,
  type DiagramArea, type DiagramInput, type DiagramKind, type InstallZoneConfirmation,
} from "./area-diagram.core";
import { logEvent } from "./workflow.server";

const BUCKET = "job-files";
type Entry = { label: string; value: unknown };

async function jobHeader(jobId: string): Promise<{ jobNumber: string | null; address: string | null }> {
  const { data } = await admin.from("job_overview").select("job_number, property_address").eq("id", jobId).maybeSingle();
  return { jobNumber: data?.job_number ?? null, address: data?.property_address ?? null };
}

type MeasurementRow = { id: string; status: string | null; raw_snapshot: Json | null; measured_area_m2: number | null; insulation_present: boolean | null; removal_required: boolean | null; removal_m2: number | null; zones: Json | null; completed_at: string | null };
async function currentMeasurement(jobId: string): Promise<MeasurementRow | null> {
  const { data } = await admin.from("ceiling_measurements").select("id, status, raw_snapshot, measured_area_m2, insulation_present, removal_required, removal_m2, zones, completed_at").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  return (data as MeasurementRow | null) ?? null;
}

async function declaredProduct(jobId: string, entries: Entry[] | null): Promise<string | null> {
  const fromForm = (entries ?? []).find((e) => ["insulation product", "what insulation product will you be using on this job?"].includes(String(e.label ?? "").split("\n")[0]!.trim().toLowerCase()))?.value;
  if (typeof fromForm === "string" && fromForm.trim()) return fromForm.trim();
  const { productForHivQuote } = await import("./insulation-product.server");
  return (await productForHivQuote(jobId).catch(() => ({ product: null }))).product?.option ?? null;
}

/** The Ready Check areas for this job: form snapshot (names, L × W) → office areas record → whole-job measurement. */
export async function readyCheckDiagramAreas(jobId: string, opts: { entries?: Entry[] | null } = {}): Promise<{ areas: DiagramArea[]; measurementId: string | null; measurementComplete: boolean; basis: string }> {
  const m = await currentMeasurement(jobId);
  const entries = opts.entries ?? (Array.isArray(m?.raw_snapshot) ? (m!.raw_snapshot as unknown as Entry[]) : null);
  const product = await declaredProduct(jobId, entries);
  const complete = m?.status === "complete";
  if (entries?.length) {
    const areas = areasFromReadyCheckEntries(entries, { productOption: product });
    if (areas.length) return { areas, measurementId: m?.id ?? null, measurementComplete: complete, basis: "Dimensions as measured by the installer at the Ready Check (Mitti form)" };
  }
  try {
    const { data: rc } = await admin.from("ready_checks").select("id").eq("job_id", jobId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle();
    if (rc) {
      const { data: obs } = await admin.from("ready_check_observations").select("value").eq("ready_check_id", rc.id).eq("field_key", "measure.areas_v1").maybeSingle();
      if (obs) {
        const { readAreas } = await import("./ready-check-areas.core");
        const areas = areasFromRecordAreas(readAreas(obs.value), product);
        if (areas.length) return { areas, measurementId: m?.id ?? null, measurementComplete: complete, basis: "Areas as recorded on the Ready Check (office record)" };
      }
    }
  } catch { /* malformed record: fall through to the whole-job measurement */ }
  return { areas: singleAreaFallback(m?.measured_area_m2 == null ? null : Number(m.measured_area_m2), product, m?.insulation_present ?? null, m?.removal_required ?? null, m?.removal_m2 == null ? null : Number(m.removal_m2)), measurementId: m?.id ?? null, measurementComplete: complete, basis: "Whole-job measured area (no per-area record)" };
}

/**
 * Final-plan input. TODO(install-evidence.core): once the install-day form is read (decision 210 d/e: zone names carried
 * from the Ready Check, installed m² and product per zone), `installZones` comes from that module's per-zone
 * confirmations; until then the final plan is regenerated from the Ready Check areas (source "ready_check").
 */
export async function finalDiagramInput(jobId: string, installZones: InstallZoneConfirmation[] | null = null): Promise<{ areas: DiagramArea[]; source: "install_day" | "ready_check"; basis: string }> {
  const rc = await readyCheckDiagramAreas(jobId);
  if (installZones?.length) return { areas: applyInstallZones(rc.areas, installZones), source: "install_day", basis: "Installed m² and products as confirmed by the installer on install day; dimensions from the Ready Check" };
  return { areas: rc.areas, source: "ready_check", basis: `${rc.basis} — install-day confirmation not yet recorded` };
}

export type FileDiagramResult = { filed: boolean; existing: boolean; documentId: string | null; hash: string; reason: string | null; summary: string };

async function fileDiagram(jobId: string, actorId: string | null, kind: DiagramKind, areas: DiagramArea[], basis: string, keyPrefix: string, extra: Record<string, unknown>): Promise<FileDiagramResult> {
  const header = await jobHeader(jobId);
  const input: DiagramInput = { kind, jobNumber: header.jobNumber, address: header.address, generatedAt: new Date().toISOString(), areas, basis };
  const hash = areaDiagramHash(input);
  const docKind = kind === "final" ? FINAL_AREA_DIAGRAM_KIND : AREA_DIAGRAM_KIND;
  const externalId = `${keyPrefix}:${hash}`;
  const summary = areaDiagramSummary(areas);
  const { data: ex } = await admin.from("documents").select("id").eq("job_id", jobId).eq("kind", docKind).eq("external_id", externalId).maybeSingle();
  if (ex) return { filed: false, existing: true, documentId: ex.id, hash, reason: null, summary };
  if (!areas.length) return { filed: false, existing: false, documentId: null, hash, reason: "No ceiling areas recorded yet — the diagram is drawn once the Ready Check areas are in.", summary };
  const { areaDiagramPdf } = await import("./area-diagram-pdf.server");
  const pdf = await areaDiagramPdf(input);
  const path = `${jobId}/diagrams/${docKind}-${hash}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) return { filed: false, existing: false, documentId: null, hash, reason: `Diagram could not be stored: ${up.error.message}`, summary };
  const title = kind === "final" ? `Final installation plan (generated) — ${summary}` : `Upgrade area diagram (generated) — ${summary}`;
  const { data: doc, error } = await admin.from("documents").insert({ job_id: jobId, kind: docKind, title, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId, source_system: "portal", external_id: externalId, original_name: `${docKind}-${hash}.pdf`, size_bytes: pdf.byteLength }).select("id").single();
  if (error) return { filed: false, existing: false, documentId: null, hash, reason: `Diagram could not be filed: ${error.message}`, summary };
  await logEvent(jobId, actorId, kind === "final" ? FINAL_AREA_DIAGRAM_EVENT : AREA_DIAGRAM_EVENT,
    kind === "final" ? `Final installation plan generated from the recorded areas (${summary}) — decision 211` : `Upgrade area diagram generated from the Ready Check areas (${summary}) — decision 211`,
    { document_id: doc.id, path, hash, areas, basis, svg: areaDiagramSvg(input), ...extra }, { internal: true });
  return { filed: true, existing: false, documentId: doc.id, hash, reason: null, summary };
}

/** Ready Check complete → file the Table 4 diagram once per set of measured facts. Never throws. */
export async function fileReadyCheckAreaDiagram(jobId: string, actorId: string | null, opts: { entries?: Entry[] | null; auditId?: string | null } = {}): Promise<FileDiagramResult> {
  try {
    const rc = await readyCheckDiagramAreas(jobId, { entries: opts.entries ?? null });
    if (!rc.measurementComplete) return { filed: false, existing: false, documentId: null, hash: "", reason: "Ready Check measurements not complete yet", summary: areaDiagramSummary(rc.areas) };
    return await fileDiagram(jobId, actorId, "ready_check", rc.areas, rc.basis, `${AREA_DIAGRAM_KIND}:${rc.measurementId ?? "none"}`, { measurement_id: rc.measurementId, audit_id: opts.auditId ?? null });
  } catch (e) {
    return { filed: false, existing: false, documentId: null, hash: "", reason: e instanceof Error ? e.message : "error", summary: "" };
  }
}

/** Install complete → file the final plan and let it stand as the A5 "final plan" evidence (decision 211). Never throws. */
export async function fileFinalAreaDiagram(jobId: string, actorId: string | null, installZones: InstallZoneConfirmation[] | null = null): Promise<FileDiagramResult> {
  try {
    const f = await finalDiagramInput(jobId, installZones);
    const r = await fileDiagram(jobId, actorId, "final", f.areas, f.basis, `${FINAL_AREA_DIAGRAM_KIND}:${f.source}`, { source: f.source, install_zones: installZones ?? null });
    if (r.documentId) await satisfyFinalZonePlanRequirement(jobId, r.documentId).catch(() => undefined);
    return r;
  } catch (e) {
    return { filed: false, existing: false, documentId: null, hash: "", reason: e instanceof Error ? e.message : "error", summary: "" };
  }
}

/** The job's evidence checklist row for the final plan is met by the generated document (old uploads still count). */
async function satisfyFinalZonePlanRequirement(jobId: string, documentId: string) {
  const { data: doc } = await admin.from("documents").select("storage_path, size_bytes").eq("id", documentId).maybeSingle();
  if (!doc) return;
  const { data: req } = await admin.from("evidence_requirements").select("id, status").eq("job_id", jobId).eq("category", "final_zone_plan").order("sort").limit(1).maybeSingle();
  if (!req) return;
  const { data: have } = await admin.from("evidence_files").select("id").eq("requirement_id", req.id).eq("storage_path", doc.storage_path).maybeSingle();
  if (!have) {
    const { error } = await admin.from("evidence_files").insert({ requirement_id: req.id, job_id: jobId, storage_path: doc.storage_path, file_name: "Final installation plan (generated by the portal)", mime_type: "application/pdf", size_bytes: doc.size_bytes, uploaded_by: null, location_source: "portal_generated", uploaded_at: new Date().toISOString() });
    if (error) return;
  }
  if (req.status === "outstanding") await admin.from("evidence_requirements").update({ status: "uploaded" }).eq("id", req.id).eq("status", "outstanding");
}

/** True when a generated final plan is on the job file (A5 `final_plan` satisfied, decision 211). */
export async function hasGeneratedFinalPlan(jobId: string): Promise<boolean> {
  const { data } = await admin.from("documents").select("id").eq("job_id", jobId).eq("kind", FINAL_AREA_DIAGRAM_KIND).limit(1);
  return (data ?? []).length > 0;
}

export type StoredDiagram = { kind: DiagramKind; svg: string; generatedAt: string; documentId: string | null; summary: string; basis: string | null };
/** Latest generated diagram of each kind (from the generation event, which carries the SVG). */
export async function latestAreaDiagrams(jobId: string): Promise<{ readyCheck: StoredDiagram | null; final: StoredDiagram | null }> {
  const { data } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", [AREA_DIAGRAM_EVENT, FINAL_AREA_DIAGRAM_EVENT]).order("created_at", { ascending: false }).limit(10);
  const pick = (type: string, kind: DiagramKind): StoredDiagram | null => {
    const row = (data ?? []).find((r) => r.event_type === type);
    const d = (row?.details ?? null) as { svg?: string; document_id?: string; areas?: DiagramArea[]; basis?: string } | null;
    if (!row || !d?.svg) return null;
    return { kind, svg: d.svg, generatedAt: row.created_at, documentId: d.document_id ?? null, summary: areaDiagramSummary(d.areas ?? []), basis: d.basis ?? null };
  };
  return { readyCheck: pick(AREA_DIAGRAM_EVENT, "ready_check"), final: pick(FINAL_AREA_DIAGRAM_EVENT, "final") };
}
