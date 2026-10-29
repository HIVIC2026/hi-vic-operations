// Safety plan (SWMS) persistence — decision 261. Facts come from the job (business, crew chosen for the install, address,
// house age, Ready Check / PIESA hazard note); the crew sign on the installer's job page; every signature and the optional
// site note are append-only workflow events; once everyone listed has signed, the plan is filed as a PDF in the WorkSafe
// Victoria sample-template layout (documents kind "swms", one file per signature set; layout swms-pdf.server.ts,
// decision 358). Pure rules in swms.core.ts.
// Never sends anything and never moves a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { createHash } from "node:crypto";
import { buildSwms, checkSwmsSign, currentSignatures, swmsPlanFingerprintText, swmsRecordText, swmsStatus, type SwmsFacts, type SwmsPerson, type SwmsPlan, type SwmsSignature, type SwmsStatus } from "./swms.core";

export const SWMS_SIGNED_EVENT = "swms_signed";
export const SWMS_NOTE_EVENT = "swms_site_note";
export const SWMS_FILED_EVENT = "swms_filed";

/** Install crew chosen in the portal for this job (lead + additional), names from the assigned business's staff. */
async function installCrew(jobId: string): Promise<{ lead: SwmsPerson | null; crew: SwmsPerson[] }> {
  try {
    const { loadCrew } = await import("./piisa-a3.server");
    const { staff, selection } = await loadCrew(jobId);
    if (!selection) return { lead: null, crew: [] };
    const person = (pick: unknown): SwmsPerson | null => {
      if (typeof pick === "string") { const s = staff.find((x) => x.workerId === pick); return s ? { name: s.name, workerId: s.workerId } : null; }
      if (pick && typeof pick === "object" && "workerId" in pick) { const id = String((pick as { workerId: string }).workerId); const s = staff.find((x) => x.workerId === id); return s ? { name: s.name, workerId: s.workerId } : null; }
      if (pick && typeof pick === "object" && "other" in pick) { const n = String((pick as { other: { name: string } }).other.name ?? "").trim(); return n ? { name: n, workerId: null } : null; }
      return null;
    };
    return { lead: person(selection.lead), crew: selection.additional.map(person).filter((x): x is SwmsPerson => !!x) };
  } catch { return { lead: null, crew: [] }; }
}

/** Jo 30 Oct 2026: sha256 of the plan version (signers left out) — stored on each signature as `plan_sha256`. */
export function swmsPlanSha(plan: SwmsPlan): string {
  return createHash("sha256").update(swmsPlanFingerprintText(plan)).digest("hex");
}

export async function swmsFacts(jobId: string): Promise<SwmsFacts> {
  const [{ data: job }, { data: asg }, { data: book }, { data: asm }, { data: note }, crew, { data: meas }, { data: piesa }] = await Promise.all([
    admin.from("jobs").select("job_number, life_support_status, properties(address_line, suburb, postcode, year_built)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").neq("status", "cancelled").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("hazards, piesa_outcome").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", SWMS_NOTE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    installCrew(jobId),
    // Jo 30 Oct 2026: house facts — the current Ready Check answers and the current PIESA record.
    admin.from("ceiling_measurements").select("raw_snapshot").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("piesa_records").select("outcome, rectification_completed_at").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (!job) throw new WorkflowError("Job not found.");
  const { data: biz } = asg?.business_id ? await admin.from("businesses").select("name").eq("id", asg.business_id).maybeSingle() : { data: null };
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null; year_built: number | null } | null;
  const { melbourneDateOf } = await import("./install-evidence.server");
  const { swmsHouseFacts, swmsHouseLines, swmsHouseSteps } = await import("./swms-house.core");
  const entries = Array.isArray(meas?.raw_snapshot) ? (meas!.raw_snapshot as unknown as { label: string; value: unknown }[]) : [];
  const upgradesDone = !!piesa?.rectification_completed_at;
  const house = swmsHouseFacts(entries, {
    lifeSupportStatus: (job as { life_support_status?: string | null }).life_support_status ?? null,
    piesaOutcome: upgradesDone ? "fail" : (piesa?.outcome ?? asm?.piesa_outcome ?? null),
    upgradesDone,
    piesaHazards: typeof asm?.hazards === "string" ? asm.hazards : null,
  });
  return {
    jobNumber: job.job_number, address: [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(", ") || null,
    businessName: biz?.name ?? null, installDate: melbourneDateOf(book?.scheduled_start ?? null),
    lead: crew.lead, crew: crew.crew, yearBuilt: prop?.year_built ?? null,
    hazardNote: typeof asm?.hazards === "string" ? asm.hazards : null,
    siteNote: ((note?.details as { note?: unknown } | null)?.note as string | undefined) ?? null,
    houseLines: swmsHouseLines(house), houseSteps: swmsHouseSteps(house),
  };
}

export async function swmsSignatures(jobId: string): Promise<SwmsSignature[]> {
  const { data, error } = await admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", SWMS_SIGNED_EVENT).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => { const d = r.details as { key?: string; name?: string; typed_name?: string; plan_sha256?: string } | null; return { key: String(d?.key ?? ""), name: String(d?.name ?? ""), typedName: String(d?.typed_name ?? ""), signedAt: r.created_at, planSha: d?.plan_sha256 ?? null }; }).filter((s) => s.key);
}

export async function loadSwms(jobId: string): Promise<{ plan: SwmsPlan; signatures: SwmsSignature[]; status: SwmsStatus }> {
  const [facts, all] = await Promise.all([swmsFacts(jobId), swmsSignatures(jobId)]);
  const plan = buildSwms(facts);
  // Jo 30 Oct 2026: signatures given on an older version of the plan no longer count — those people sign again.
  const signatures = currentSignatures(all, swmsPlanSha(plan));
  return { plan, signatures, status: swmsStatus(plan, signatures) };
}

/** Pre-start: the safety plan's status for this job (null = could not be read → the blocker says so). */
export async function swmsStatusFor(jobId: string): Promise<SwmsStatus | null> {
  try { return (await loadSwms(jobId)).status; } catch { return null; }
}

export async function saveSwmsSiteNote(jobId: string, actorId: string, note: string) {
  const text = note.trim().slice(0, 2000);
  await logEvent(jobId, actorId, SWMS_NOTE_EVENT, text ? "Safety plan: site note saved" : "Safety plan: site note cleared", { note: text || null }, { internal: true });
  return { ok: true };
}

/** One person signs for themselves (typed full name = their name). Filing happens once everyone listed has signed.
 *  Decision 364: `method` records how — logged in as that worker (`login`, own line checked by the caller) or through
 *  that person's own secure text link (`link`, swms-link.server). */
export async function signSwms(jobId: string, actorId: string | null, key: string, typedName: string, method: import("./swms.core").SwmsSignMethod) {
  const { plan, signatures } = await loadSwms(jobId);
  const check = checkSwmsSign(plan, signatures, key, typedName);
  if (!check.ok) throw new WorkflowError(check.reason);
  const planSha = swmsPlanSha(plan);
  await logEvent(jobId, actorId, SWMS_SIGNED_EVENT, `Safety plan signed by ${check.signer.name} (${method === "link" ? "own text link" : method === "lead_phone" ? "signed on the Lead's phone" : "logged in"})`, { key, name: check.signer.name, role: check.signer.role, typed_name: typedName.trim(), plan_sha256: planSha, method }, { internal: true });
  const after = await loadSwms(jobId);
  if (after.status.complete) await fileSwms(jobId, actorId).catch(async (e) => { await logEvent(jobId, actorId, "swms_file_failed", "Safety plan signed but the PDF could not be filed — it will be filed on the next signature or office retry", { reason: e instanceof Error ? e.message : "error" }, { internal: true }).catch(() => undefined); });
  return { complete: after.status.complete, missing: after.status.missing };
}

/** File the signed plan (immutable PDF, 6-year record). Keyed by content hash: an unchanged plan is never filed twice. */
export async function fileSwms(jobId: string, actorId: string | null): Promise<{ filed: boolean; path: string | null }> {
  const { plan, signatures, status } = await loadSwms(jobId);
  if (!status.complete) return { filed: false, path: null };
  const text = swmsRecordText(plan, signatures);
  const sha = createHash("sha256").update(text).digest("hex");
  const key = `swms:${sha.slice(0, 32)}`;
  const { data: ex } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("source_system", "portal").eq("external_id", key).maybeSingle();
  if (ex) return { filed: false, path: ex.storage_path };
  // Decision 358: the PDF is drawn in the WorkSafe sample-template layout; the key stays the hash of the same canonical
  // text (swmsRecordText), so plans already filed as plain text are not filed again.
  const { buildSwmsPdf } = await import("./swms-pdf.server");
  const { bytes: pdf } = await buildSwmsPdf(plan, signatures, { recordRef: key });
  const path = `${jobId}/official/swms-${sha.slice(0, 16)}.pdf`;
  const up = await admin.storage.from("job-files").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error(`Safety plan could not be stored: ${up.error.message}`);
  const { error } = await admin.from("documents").insert({ job_id: jobId, kind: "swms", title: `Safety plan (SWMS) — Job ${plan.jobNumber}`, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId, source_system: "portal", external_id: key, original_name: `swms-${plan.jobNumber}.pdf`, size_bytes: pdf.byteLength });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, SWMS_FILED_EVENT, "Signed safety plan (SWMS) filed on the job (6-year record)", { path, sha256: sha, signers: signatures.map((s) => ({ key: s.key, name: s.name, signed_at: s.signedAt })) }, { internal: true });
  return { filed: true, path };
}
