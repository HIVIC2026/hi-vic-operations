// The ONLY Mitti network boundary. Callers must already be authorised (see portal.functions.ts).
// Token is read per call, never logged or returned. Sync populates assessment / measure-up data only —
// never completes a requirement, approves compliance, moves stages or issues quotes.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { MITTI_TEMPLATE_ID, MittiError, builtLast5YearsOption, createOrReuseAudit, mittiApi, parseAudit, pickUser, planSync, propertyTypeOption, readyCheckFormStageAllowed, splitPatch, validateStoredMittiAudit, type MittiCall } from "./mitti.core";
import { canonicalMittiTemplateId, mittiTemplateIdentity, sameMittiTemplateId } from "./mitti-identity.core";
const MITTI_BASE_URL = "https://api.mitti.com"; // network boundary lives only here
import { planMeasurementUpdate, type MeasurementLike } from "./scope.core";
import { jobScope } from "./requirements.server";
import { provisionalGivesWayToMitti } from "./measurement.core";
import { readyCheckVariant } from "./mitti-forms.core";
import { officialFormUseBlocker, evaluatePiesa } from "./official-forms.core";
import { noPriceTalkIssue, ONSITE_START_CLEARED_EVENT, ONSITE_START_EVENT, ONSITE_START_HISTORY_TEXT, RECTIFICATION_OUTCOMES, shortAnswersFromEntries } from "./official-short.core";
import { expandPiesa } from "./official-expand.core";
import { formatPropertyAddress } from "./address";
import { todayMelbourne } from "./eligibility.server";
import { refuseFuturePiesaDate } from "./piesa-date.core";
import { PIESA_EVIDENCE_ISSUE_PREFIX, attachPiesaMedia, piesaEvidenceBlockers, piesaEvidenceFilesToStore, piesaMediaFromSnapshot, type PiesaSnapshotEntry } from "./piesa-evidence.core";
import { officialPrefillContext } from "./official-forms.server";
import { draftInstallerQuoteFromReadyCheck } from "./installer-quote.server";
import { applyCobrand } from "./pilot.server";
import { MITTI_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** QA journey guard (Jo 27 Oct): while a TEST journey has armed it, every Mitti call that product code makes through this
 *  boundary goes to that run's simulated Mitti instead; armed without a simulator, the call is refused loudly. Never armed
 *  by the running portal. */
type JourneyMittiGuard = { sim: MittiCall | null; routed: string[] };
const JOURNEY_GUARD = "__hivJourneyMittiGuard";
const journeyGuard = () => (globalThis as Record<string, unknown>)[JOURNEY_GUARD] as JourneyMittiGuard | undefined;
export function armJourneyMittiGuard(sim: MittiCall | null): JourneyMittiGuard {
  const g: JourneyMittiGuard = { sim, routed: [] }; (globalThis as Record<string, unknown>)[JOURNEY_GUARD] = g; return g;
}
export function disarmJourneyMittiGuard() { delete (globalThis as Record<string, unknown>)[JOURNEY_GUARD]; }

export const realMittiCall: MittiCall = async (method, path, body) => {
  const g = journeyGuard();
  if (g) {
    if (!g.sim) throw new MittiError(`SAFETY STOP: real Mitti call refused during a TEST journey (${method} ${path.split("?")[0]})`, { code: "unavailable" });
    g.routed.push(`${method} ${path.split("?")[0]}`);
    return g.sim(method, path, body);
  }
  // Running-portal TEST routing (Jo 27 Oct): TEST people, sim_ ids and stored simulated forms go to the persistent simulator.
  {
    const { testMittiRoute, auditIdOfPath, isSimId } = await import("./mitti-test-route.core");
    const audit = auditIdOfPath(path);
    const stored = audit && !isSimId(audit) ? await (await import("./mitti-sim-store.server")).isStoredSimAudit(audit) : false;
    if (testMittiRoute(method, path, body, () => stored)) return (await import("./mitti-sim-store.server")).persistentSimMittiCall(method, path, body);
  }
  const token = process.env["MITTI_API_TOKEN"];
  if (!token) throw new MittiError("Mitti is not configured. Add the MITTI_API_TOKEN secret.", { code: "not_configured" });
  let res: Response;
  try {
    res = await fetch(`${MITTI_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: timeoutSignal(MITTI_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new MittiError("Mitti could not be reached. Try again shortly.", { code: "unavailable" });
  }
  if (!res.ok) {
    console.error(`[mitti] ${method} ${path.split("/")[1]} -> ${res.status}`); // no provider body, token or personal fields
    throw new MittiError(
      res.status === 401 || res.status === 403 ? "Mitti rejected the API token."
      : res.status === 404 ? "Mitti record not found."
      : res.status === 400 ? "Mitti rejected the request (400) – check the assigned user's email is a real address registered in your Mitti account."
      : `Mitti request failed (${res.status}).`, { status: res.status, code: "api_error" });
  }
  const t = await res.text();
  try { return t ? JSON.parse(t) : {}; }
  catch { throw new MittiError("Mitti returned an unreadable response.", { code: "api_error" }); }
};

/** Binary media download (supported audit media route). Used only to store the PIISA signature image itself. */
export type MittiMediaFetch = (auditId: string, mediaId: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
export const realMittiMedia: MittiMediaFetch = async (auditId, mediaId) => {
  if (journeyGuard()) throw new MittiError("SAFETY STOP: real Mitti media download refused during a TEST journey");
  const token = process.env["MITTI_API_TOKEN"];
  if (!token) throw new MittiError("Mitti is not configured. Add the MITTI_API_TOKEN secret.");
  const res = await fetch(`${MITTI_BASE_URL}/audits/${encodeURIComponent(auditId)}/media/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: timeoutSignal(MITTI_FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!res || !res.ok) throw new MittiError(`Mitti signature image could not be downloaded (${res?.status ?? "network"}).`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!/^image\//.test(contentType)) throw new MittiError("Mitti returned something that is not an image for the signature.");
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
};

/** A whole Mitti flow for a TEST person (including its template read) uses the persistent simulator; otherwise unchanged. */
export async function mittiCallFor(call: MittiCall, email: string | null | undefined): Promise<MittiCall> {
  if (call !== realMittiCall) return call;
  const { isTestMittiEmail } = await import("./mitti-test-route.core");
  return isTestMittiEmail(email) ? (await import("./mitti-sim-store.server")).persistentSimMittiCall : call;
}

const wrap = (e: unknown) => (e instanceof MittiError ? new WorkflowError(e.message) : e);

export const MEASUREUP_TEMPLATE_MISSING = "Ready Check-only Mitti template is not configured. An admin must add the Ready Check template ID in workflow settings before a Ready Check-only Mitti audit can be sent.";

export const PIESA_TEMPLATE_MISSING = "PIESA Mitti form is not configured. An admin must add the validated PIESA form ID in workflow settings before a PIESA audit can be sent.";

async function templateIds() {
  const { data } = await admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piesa_template_id").eq("id", 1).maybeSingle();
  return { readyCheck: data?.mitti_ready_check_template_id?.trim() || null, readyCheckPriced: data?.mitti_ready_check_priced_template_id?.trim() || null, piesa: data?.mitti_piesa_template_id?.trim() || null };
}

export const PIESA_BOOKING_MISSING = "The PIESA form can only be created once a PIESA visit is confirmed in the portal.";

/** opts.assignee: hand the Ready Check to this specific approved worker (auto-assign); opts.readyCheck forces the installer Ready Check form. */
export async function createAssignMittiAudit(jobId: string, actorId: string | null, call: MittiCall = realMittiCall, opts: { assignee?: { userId: string; fullName: string | null; email: string }; readyCheck?: boolean; officeOverride?: boolean } = {}) {
  const { data: job } = await admin.from("jobs").select("id,job_number,business_unit,stage,estimated_area_m2,life_support,life_support_status,property_id,owner_id,channel").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  const scope = await jobScope(jobId);
  if (scope.scope === "COMPLETE") throw new WorkflowError("Both site requirements are already complete – no Mitti audit needed.");
  // The Ready Check comes before any PIESA, so in Ready Check stages the installer form is sent even though no PIESA exists yet.
  // Jo 24 Oct (HV-3151): an installer's own customer gets the Ready Check form in every pre-Ready-Check stage, so the
  // office button and the automatic sweep agree with each other whatever stage the website checks left the job in.
  const readyCheckStage = readyCheckFormStageAllowed(job.stage, job.channel);
  const measureOnly = !!opts.readyCheck || readyCheckStage || scope.scope === "MEASURE_UP_ONLY";
  const role = measureOnly ? "installer" : "electrician";
  // Role-specific forms only; the old combined template is never used for new audits.
  // Ready Check variant: installer-sourced jobs get the priced form (A1), our leads the evidence-only form (A2).
  const ids = await templateIds();
  const templateId = measureOnly ? (readyCheckVariant(job.channel) === "ready_check_priced" ? ids.readyCheckPriced : ids.readyCheck) : ids.piesa;
  if (!templateId) throw new WorkflowError(measureOnly ? MEASUREUP_TEMPLATE_MISSING : PIESA_TEMPLATE_MISSING);
  // Official PIESA stays blocked from live use until its mapping is approved and its source confirmed.
  if (!measureOnly) { const b = officialFormUseBlocker("piesa"); if (b) throw new WorkflowError(b); }

  const [{ data: prop }, { data: owner }, { data: asgRow }, { data: booking }, { data: rcBooking }, { data: a }] = await Promise.all([
    admin.from("properties").select("address_line,suburb,state,postcode,occupancy,enrichment").eq("id", job.property_id).single(),
    admin.from("owners").select("full_name,email,phone").eq("id", job.owner_id).single(),
    admin.from("job_assignments").select("user_id, profiles:user_id(full_name,email)").eq("job_id", jobId).eq("role", role).eq("active", true).maybeSingle(),
    admin.from("bookings").select("scheduled_start,status").eq("job_id", jobId).eq("kind", "assessment").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    // Stage 5 (Jo 23 Oct): a Ready Check form carries the OWNER'S BOOKED Ready Check date — the PIESA
    // booking is irrelevant here and must never leak onto a Ready Check form.
    admin.from("bookings").select("scheduled_start,status").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assessments").select("id,status,external_mitti_id").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!measureOnly && a?.status === "complete") {
    // Batch 1 task 6: same path as an expired window — the new check is recorded as a reassessment, not a second A3.
    if (await (await import("./repeat-piesa.server")).currentPiesaSupersededByReopen(jobId)) throw new WorkflowError((await import("./repeat-piesa.core")).SUPERSEDED_USE_REASSESSMENT);
    throw new WorkflowError("Electrical assessment is already complete and locked.");
  }
  // Gap 1: no PIESA form until the PIESA visit is confirmed in the portal.
  if (!measureOnly && !booking) throw new WorkflowError(PIESA_BOOKING_MISSING);
  const asg = opts.assignee ? { user_id: opts.assignee.userId, profiles: { full_name: opts.assignee.fullName, email: opts.assignee.email } } : asgRow;
  if (!asg) throw new WorkflowError(`Assign an ${role} before creating the Mitti assessment.`);
  const m = scope.measurementRow;
  const existingAuditId = measureOnly ? (m?.external_source === "mitti" && m.status !== "complete" ? m.external_id : null) : a?.external_mitti_id ?? null;
  const prof = (asg as unknown as { profiles: { full_name: string | null; email: string | null } | null }).profiles;
  const address = formatPropertyAddress(prop);
  let r;
  // T3: atomic per-job/per-form claim ("mitti_audit_create_started" row with a deterministic primary key; see
  // mitti-create-claim.core.ts). Only the create POST is non-idempotent, so it is tracked: a failure before it
  // releases the claim; a failure during/after it without an audit id keeps the claim (outcome uncertain).
  const kind = measureOnly ? "ready_check" as const : "piesa" as const;
  const claims = await import("./mitti-create.server");
  const claimId = existingAuditId ? null : await claims.claimMittiCreate(jobId, kind, actorId,
    `Mitti ${measureOnly ? "measure-up" : "assessment"} creation started for ${prof?.email ?? "assigned trade"}`,
    { template_id: templateId, scope: scope.scope, assignee_email: prof?.email ?? null }, { officeOverride: opts.officeOverride === true });
  const base = mittiApi(await mittiCallFor(call, prof?.email));
  const seen = { createAttempted: false, createdId: null as string | null };
  const api: typeof base = { ...base, createAudit: async (body) => {
    seen.createAttempted = true;
    const out = await base.createAudit(body);
    const id = out?.audit_id ?? out?.id;
    seen.createdId = id ? String(id) : null;
    return out;
  } };
  try {
    r = await createOrReuseAudit(api, {
      businessUnit: job.business_unit, stage: job.stage, jobNumber: job.job_number, existingAuditId, channel: job.channel,
      electricianEmail: prof?.email ?? null, templateId, assigneeRole: role,
      prefill: {
        jobNumber: job.job_number, address, titleAddress: address, ownerName: owner?.full_name ?? "", ownerEmail: owner?.email ?? null, ownerPhone: owner?.phone ?? null,
        assessorName: prof?.full_name || prof?.email || "", assessmentAt: (measureOnly ? rcBooking?.scheduled_start : booking?.scheduled_start) ?? null,
        estimatedAreaM2: job.estimated_area_m2 != null ? Number(job.estimated_area_m2) : null,
        occupancy: prop?.occupancy ? prop.occupancy.replace("_", " ") : null, lifeSupport: job.life_support ? "Yes – life support recorded" : "None recorded by office",
        inspectionDate: measureOnly ? null : todayMelbourne(),
        lifeSupportDeclared: measureOnly ? null : job.life_support_status === "yes" ? "Yes" : job.life_support_status === "no" ? "No" : null,
        builtLast5Years: measureOnly ? builtLast5YearsOption((prop?.enrichment as Any)?.base44?.declared?.over_five_years ?? null) : null,
        propertyType: propertyTypeOption((prop?.enrichment as Any)?.base44?.declared?.property_type ?? null),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    if (claimId) {
      const { createOutcome } = await import("./mitti-create-claim.core");
      const outcome = createOutcome(seen);
      if (outcome === "not_created") await claims.releaseMittiCreate(jobId, kind, claimId, actorId, msg);
      else if (outcome === "created") {
        // Mitti made the form but a later step (share / owner) failed: store it so every retry REUSES it.
        if (measureOnly) {
          await pointMeasurementAtMitti(jobId, m, String(seen.createdId), actorId);
        } else if (a) await admin.from("assessments").update({ external_mitti_id: seen.createdId, mitti_template_id: templateId }).eq("id", a.id);
        else { await admin.from("assessments").insert({ job_id: jobId, assessor_id: asg.user_id, external_mitti_id: seen.createdId, mitti_template_id: templateId, mitti_last_error: msg, mitti_sync_status: "error", mitti_scope: scope.scope }); throw wrap(e); }
      } else {
        await claims.recordMittiCreateUncertain(jobId, kind, claimId, actorId, msg);
        if (!measureOnly) {
          if (a) await admin.from("assessments").update({ mitti_last_error: msg, mitti_sync_status: "error" }).eq("id", a.id);
          else await admin.from("assessments").insert({ job_id: jobId, assessor_id: asg.user_id, mitti_last_error: msg, mitti_sync_status: "error", mitti_scope: scope.scope });
        }
        throw new claims.MittiOutcomeUncertain();
      }
    }
    if (!measureOnly) {
      if (a) await admin.from("assessments").update({ mitti_last_error: msg, mitti_sync_status: "error" }).eq("id", a.id);
      else await admin.from("assessments").insert({ job_id: jobId, assessor_id: asg.user_id, mitti_last_error: msg, mitti_sync_status: "error", mitti_scope: scope.scope });
    }
    throw wrap(e);
  }
  const now = new Date().toISOString();
  if (measureOnly) {
    if (!r.reused) {
      await pointMeasurementAtMitti(jobId, m, r.auditId, actorId);
    }
  } else {
    const fields = {
      external_mitti_id: r.auditId, mitti_template_id: templateId, mitti_assignee_email: r.assigneeEmail, mitti_assignee_user_id: r.mittiUserId,
      mitti_last_error: null, mitti_sync_status: "pending" as const, mitti_scope: scope.scope,
      ...(r.reused ? {} : { mitti_created_at: r.createdAt ?? now, mitti_prefill_count: r.prefillCount }),
    };
    if (a) await admin.from("assessments").update(fields).eq("id", a.id);
    else await admin.from("assessments").insert({ ...fields, job_id: jobId, assessor_id: asg.user_id });
  }
  await logEvent(jobId, actorId, r.reused ? "mitti_audit_reshared" : "mitti_audit_created",
    r.reused ? `Mitti ${measureOnly ? "measure-up" : "assessment"} re-shared with ${r.assigneeEmail}` : `Mitti ${measureOnly ? "measure-up" : "assessment"} created and assigned to ${r.assigneeEmail} (${scope.label})`,
    { audit_id: r.auditId, template_id: templateId, prefill_count: r.prefillCount, scope: scope.scope, kind });
  return { auditId: r.auditId, reused: r.reused, scope: scope.scope };
}

type MeasurementPointer = { id: string; status: string | null; provenance?: string | null; external_source?: string | null; accepted_by?: string | null } | null | undefined;
/** Point the job's current measurement at a Mitti Ready Check form. An open record is adopted; an installer's
 *  provisional Add-job/bulk size is kept as history and replaced by a fresh record (Jo 24 Oct). */
export async function pointMeasurementAtMitti(jobId: string, m: MeasurementPointer, auditId: string, actorId: string | null) {
  const fresh = { job_id: jobId, status: "draft" as const, is_current: true, source_role: "installer" as const, created_by: actorId, external_source: "mitti", external_id: auditId };
  if (m && provisionalGivesWayToMitti(m)) {
    const { error: ue } = await admin.from("ceiling_measurements").update({ is_current: false }).eq("id", m.id).eq("is_current", true);
    if (ue) throw new WorkflowError(`The installer's provisional size could not be moved to history: ${ue.message}`);
    const { error: ie } = await admin.from("ceiling_measurements").insert(fresh);
    if (ie) throw new WorkflowError(`The Mitti Ready Check record could not be saved: ${ie.message}`);
    await logEvent(jobId, actorId, "mitti_provisional_superseded", "Installer's provisional size kept as history; the Mitti Ready Check form now supplies the measurements", { audit_id: auditId, provisional_measurement_id: m.id }, { internal: true });
  } else if (m && m.status !== "complete") await admin.from("ceiling_measurements").update({ external_source: "mitti", external_id: auditId }).eq("id", m.id);
  else await admin.from("ceiling_measurements").insert(fresh);
}

/** Apply measure-up values from Mitti through the central plan (never overwrites an accepted measurement).
 *  Decision 222 / 211: the per-area record (name, length × width, m², existing, removal) travels with the measurement row
 *  as `zones` (areas.v1 shape + install-day zone fields), read by jobUpgradeZones / rcAreasFromRecord for the A5 zone names.
 *  Mitti jobs have no portal Ready Check draft row, so the canonical `measure.areas_v1` observation stays the office record. */
async function applyMeasure(jobId: string, actorId: string | null, auditId: string, source: "electrician" | "installer", values: Record<string, unknown>, snapshot: unknown, zones: unknown[] | null = null) {
  const s = await jobScope(jobId);
  const plan = planMeasurementUpdate({ scope: s.scope, current: s.measurementRow as MeasurementLike | null, incoming: values, source, external: { source: "mitti", id: auditId } });
  if (plan.action === "create")
    await admin.from("ceiling_measurements").insert({ ...plan.values, job_id: jobId, status: "draft", is_current: true, source_role: plan.source, created_by: actorId, external_source: "mitti", external_id: auditId, raw_snapshot: snapshot as Json });
  else if (plan.action === "update") {
    const cur = s.measurementRow!;
    await admin.from("ceiling_measurements").update({
      ...plan.values, raw_snapshot: snapshot as Json,
      ...(plan.supplemented.length ? { supplemented_by: actorId, supplemented_at: new Date().toISOString(), supplemented_fields: [...new Set([...((cur.supplemented_fields as string[]) ?? []), ...plan.supplemented])] as unknown as Json } : {}),
    }).eq("id", plan.id).neq("status", "complete");
  }
  // The per-area record is a separate, fail-soft write: it never blocks the measurement sync (the caller reports it).
  let zonesIssue: string | null = null;
  if (zones && zones.length && plan.action !== "skip") {
    const { error } = await admin.from("ceiling_measurements").update({ zones: zones as unknown as Json }).eq("job_id", jobId).eq("external_source", "mitti").eq("external_id", auditId).eq("is_current", true).neq("status", "complete");
    if (error) zonesIssue = `Per-area record (names, length × width) not saved: ${error.message}`;
  }
  return { ...plan, zonesIssue };
}

/** Jo 23 Oct (pending approval): the A1 "Homeowner agrees to be contacted by Home Insulation Victoria" answer becomes an
 *  owner_contact_consents row, like Add job's installer tick, so a picked-up/bulk job's quote can be sent. Append-only:
 *  a row is added only when the answer differs from the job's latest consent (a later "No" withdraws it). Never marketing
 *  consent and never Gate A paperwork (own source, not "onsite_ready_check"). */
export const MITTI_CONSENT_SOURCE = "mitti_ready_check_form";
export const MITTI_CONSENT_TEXT = "Homeowner agrees to be contacted by Home Insulation Victoria";
export async function recordMittiContactConsent(jobId: string, ownerId: string | null, actorId: string | null, granted: boolean, auditId: string) {
  if (!ownerId) return;
  const { data: latest, error } = await admin.from("owner_contact_consents").select("consent_status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Owner consent could not be checked: ${error.message}`);
  const status = granted ? "granted" : "not_granted";
  if ((latest?.consent_status ?? null) === status || (!granted && !latest)) return;
  const now = new Date().toISOString();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(MITTI_CONSENT_TEXT)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { error: ie } = await admin.from("owner_contact_consents").insert({ job_id: jobId, owner_id: ownerId, source: MITTI_CONSENT_SOURCE, consent_key: `${auditId}:${status}:${now}`, consent_status: status, contact_consent: granted, consented_at: now, snapshot: { by: "installer", text: MITTI_CONSENT_TEXT, audit_id: auditId, recorded_by: actorId } as never, sha256 });
  if (ie) throw new Error(`Owner consent could not be saved: ${ie.message}`);
  await logEvent(jobId, actorId, "mitti_contact_consent_recorded", granted ? "Owner contact permission recorded from the Mitti Ready Check form" : "Owner contact permission withdrawn on the Mitti Ready Check form", { audit_id: auditId, status }, { internal: true });
}

/** Stage 3 (Jo 23 Oct): new A1 contact/permission/electrician answers, absent-safe. Fills blank owner
 *  contact fields, records the electrician choice only when the job has none, and logs the details for
 *  the office. The permission answer is recorded as contact consent (recordMittiContactConsent), never marketing consent. */
async function applyContactAnswers(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string) {
  const { contactAnswersFromEntries } = await import("./mitti.core");
  const a = contactAnswersFromEntries(entries);
  if (!a.phone && !a.email && a.contactPermission == null && !a.electricianChoice && !a.electricianPriceIncGst && !a.electricianName && !a.electricianLicence) return;
  const { data: job } = await admin.from("jobs").select("owner_id, electrician_choice").eq("id", jobId).maybeSingle();
  if (!job) return;
  const patch: { phone?: string; email?: string } = {};
  if (a.phone || a.email) {
    const { data: o } = await admin.from("owners").select("phone,email").eq("id", job.owner_id).maybeSingle();
    if (o) {
      if (a.phone && !String(o.phone ?? "").trim()) patch.phone = a.phone;
      if (a.email && !String(o.email ?? "").trim()) patch.email = a.email;
    }
  }
  if (Object.keys(patch).length) await admin.from("owners").update(patch).eq("id", job.owner_id);
  // New choices have a separate compliance/billing snapshot; never auto-assign or verify a nominated electrician.
  if ((a.electricianChoice === "own" || a.electricianChoice === "hivic") && !job.electrician_choice) await admin.from("jobs").update({ electrician_choice: a.electricianChoice === "own" ? "installer_own" : "hivic_organise" }).eq("id", jobId);
  if (a.contactPermission != null) await recordMittiContactConsent(jobId, job.owner_id, actorId, a.contactPermission, auditId);
  const details = { has_phone: !!a.phone, has_email: !!a.email, permission: a.contactPermission ?? null, electrician_choice: a.electricianChoice ?? null, electrician_price_inc_gst: a.electricianPriceIncGst ?? null, electrician_name: a.electricianName ?? null, electrician_licence: a.electricianLicence ?? null };
  // Jo 23 Oct (fix): only record when the answers changed — unchanged re-syncs every 15 minutes added a row each time.
  const { data: lastAns } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_contact_answers").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prev = (lastAns?.details ?? null) as Record<string, unknown> | null;
  if (prev && (Object.keys(details) as (keyof typeof details)[]).every((k) => (prev[k] ?? null) === details[k])) return;
  await logEvent(jobId, actorId, "mitti_contact_answers", `Ready Check form answers recorded (owner contact permission: ${a.contactPermission == null ? "not on form" : a.contactPermission ? "yes" : "no"})`, details, { internal: true });
}

/** Decision 222 question 10 "Who lives at the property?" (Activity Guide Appendix C premises type for the VEEC claim).
 *  The properties.occupancy enum (owner_occupied / rental) cannot hold public or community housing, so the answer is kept
 *  as the append-only `mitti_premises_type` workflow event (latest per job wins; a new row only when the answer changes).
 *  Absent on older forms → nothing recorded. */
export const PREMISES_TYPE_EVENT = "mitti_premises_type";
async function applyPremisesType(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string) {
  const { premisesTypeFromEntries } = await import("./ready-check-answers.core");
  const p = premisesTypeFromEntries(entries);
  if (!p.answer) return;
  const { data: last } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PREMISES_TYPE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prev = (last?.details ?? null) as { answer?: string | null; premises_type?: string | null } | null;
  if (prev && prev.answer === p.answer && (prev.premises_type ?? null) === p.code) return;
  await logEvent(jobId, actorId, PREMISES_TYPE_EVENT, `Ready Check: who lives at the property — ${p.answer}${p.code ? "" : " (wording not recognised – office to confirm the premises type)"}`, { audit_id: auditId, answer: p.answer, premises_type: p.code, question: "Who lives at the property?" }, { internal: true });
}

/** Save Mitti's finished PDF report to the job's private files, once per completed audit version. Never throws. */
export async function saveMittiReport(jobId: string, actorId: string | null, auditId: string, modifiedAt: string | null, label: string, call: MittiCall) {
  const key = `${auditId}:${modifiedAt ?? "completed"}`;
  try {
    const { data: ex } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
    if (ex) return;
    const api = mittiApi(call);
    const req = await api.requestReport(auditId);
    let url: string | null = null;
    for (let i = 0; i < 6 && !url; i++) {
      const r = await api.getReport(auditId, String(req?.messageId ?? ""));
      if (typeof r?.url === "string" && r.url.startsWith("https://")) url = r.url;
      else await new Promise((res) => setTimeout(res, 2000));
    }
    if (!url) throw new Error("report not ready");
    const res = await fetch(url, { signal: timeoutSignal(MITTI_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = await res.arrayBuffer();
    const stamp = (modifiedAt ?? new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14);
    const path = `${jobId}/mitti/${auditId}-${stamp}.pdf`;
    const up = await admin.storage.from("job-files").upload(path, buf, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error("storage upload failed");
    await admin.from("documents").insert({ job_id: jobId, kind: "mitti_report", title: `Mitti ${label} report`, storage_path: path, mime_type: "application/pdf", uploaded_by: actorId, source_system: "mitti", external_id: key, original_name: `${label}.pdf`, size_bytes: buf.byteLength });
    await logEvent(jobId, actorId, "mitti_report_saved", `Mitti ${label} report saved to job files`, { audit_id: auditId, path });
  } catch (e) {
    await logEvent(jobId, actorId, "mitti_report_failed", `Mitti ${label} report could not be saved – sync again to retry`, { audit_id: auditId, reason: e instanceof Error ? e.message : "error" });
  }
}

/** Decision 178: keep the four PIESA evidence files (switchboard, on-site ID, hazards, CES) with the job file for the
 *  AP record (6 years). One private copy per Mitti media id; a retry never duplicates. Never throws. */
async function savePiesaEvidenceFiles(jobId: string, actorId: string | null, auditId: string, snapshot: PiesaSnapshotEntry[], fetchMedia: MittiMediaFetch) {
  const files = piesaEvidenceFilesToStore(piesaMediaFromSnapshot(snapshot));
  if (!files.length) return;
  const saved: string[] = [];
  for (const { id, label, file } of files) {
    const key = `${auditId}:${file.mediaId}`;
    try {
      const { data: ex } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
      if (ex) continue;
      const { bytes, contentType } = await fetchMedia(auditId, file.mediaId);
      if (!bytes.length) throw new Error("empty media");
      const ext = contentType.includes("pdf") ? "pdf" : contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "bin";
      const path = `${jobId}/mitti/piesa-evidence/${auditId}-${id}-${file.mediaId}.${ext}`;
      const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
      if (up.error && !/exists/i.test(up.error.message)) throw new Error("storage upload failed");
      await admin.from("documents").insert({ job_id: jobId, kind: "piesa_evidence", title: `PIESA evidence – ${label}`, storage_path: path, mime_type: contentType, uploaded_by: actorId, source_system: "mitti", external_id: key, original_name: `${id}-${file.mediaId}.${ext}`, size_bytes: bytes.length });
      saved.push(path);
    } catch (e) {
      await logEvent(jobId, actorId, "piesa_evidence_file_failed", `PIESA evidence (${label}) could not be saved – sync again to retry`, { audit_id: auditId, media_id: file.mediaId, reason: e instanceof Error ? e.message : "error" }, { internal: true });
    }
  }
  if (saved.length) await logEvent(jobId, actorId, "piesa_evidence_saved", `${saved.length} PIESA evidence file(s) saved to job files (decision 178)`, { audit_id: auditId, paths: saved, captured: files.map((f) => ({ item: f.id, media_id: f.file.mediaId, captured_at: f.file.capturedAt, geotagged: f.file.lat != null && f.file.lng != null })) });
}

/** Decision 314 (Jo 25 Oct 2026): one office item per job while the latest completed A3 says the electrician must be on site
 *  at the start of the install day (Needs me via ready-check-chase.core RULES); cleared if a later sync no longer says so.
 *  Recorded only — nothing is sent. */
async function syncOnsiteStartItem(jobId: string, actorId: string | null, onsite: boolean) {
  const { data } = await admin.from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", [ONSITE_START_EVENT, ONSITE_START_CLEARED_EVENT]).order("created_at", { ascending: false }).limit(1);
  const open = data?.[0]?.event_type === ONSITE_START_EVENT;
  // Decision 327: a record only (no Needs me line) — the electrician is asked automatically once the install day is booked.
  if (onsite && !open) await logEvent(jobId, actorId, ONSITE_START_EVENT, ONSITE_START_HISTORY_TEXT, { rule: "decision 314 / 327" }, { internal: true });
  else if (!onsite && open) await logEvent(jobId, actorId, ONSITE_START_CLEARED_EVENT, "The safety check no longer says the electrician must be on site at the start of the install day", { rule: "decision 314" }, { internal: true });
}

/** Sync the STORED audit(s) only. Never completes a requirement. */
export async function syncMittiAssessment(jobId: string, actorId: string | null, call: MittiCall = realMittiCall, fetchMedia: MittiMediaFetch = realMittiMedia) {
  const { data: job } = await admin.from("jobs").select("job_number,business_unit,channel,stage,deleted_at,qa_archived_at").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for Home Insulation Victoria jobs.");
  // Cancelled / deleted / QA-archived: no sync, no events, no quote draft or hold.
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) return { locked: false, completed: false, issues: [] as string[] };
  const { data: a } = await admin.from("assessments").select("id,status,external_mitti_id,mitti_template_id,mitti_completed,mitti_modified_at,mitti_sync_status,no_rectification_confirmed").eq("job_id", jobId).maybeSingle();
  const s = await jobScope(jobId);
  const m = s.measurementRow;
  const measureAudit = m?.external_source === "mitti" && m.external_id && m.external_id !== a?.external_mitti_id && m.status !== "complete" ? m.external_id : null;
  if (!a?.external_mitti_id && !measureAudit) throw new WorkflowError("No Mitti assessment has been created for this job.");
  const api = mittiApi(call);
  let issues: string[] = [];
  let completed = false;
  let locked = false;

  if (a?.external_mitti_id) {
    if (a.status === "complete") locked = true;
    else {
      let plan;
      let audit: unknown = null;
      try {
        audit = await api.getAudit(a.external_mitti_id);
        plan = planSync(audit, { storedAuditId: a.external_mitti_id, jobNumber: job.job_number, assessmentStatus: a.status, templateId: a.mitti_template_id ?? MITTI_TEMPLATE_ID });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Mitti error";
        await admin.from("assessments").update({ mitti_last_error: msg, ...(e instanceof MittiError && /match|template|different/.test(msg) ? { mitti_sync_status: "error" as const } : {}) }).eq("id", a.id);
        throw wrap(e);
      }
      if (plan.locked) locked = true;
      else {
        const { electrical } = splitPatch(plan.patch);
        // Same PIESA date rule as the manual path. External data is not trusted: a future (or malformed)
        // Mitti date is dropped from the write and surfaced as a review issue instead of stretching the
        // 30-day install deadline. Everything else in the sync still lands.
        const refused = refuseFuturePiesaDate(electrical as Record<string, unknown>);
        const safeElectrical = refused.patch as typeof electrical;
        const now = new Date().toISOString();
        // Decision 178: the stored snapshot carries the evidence media metadata (id, capture time, lat/lng as Mitti
        // recorded them) so the completion gates re-run the same evidence rule from the stored facts.
        const snapshot = attachPiesaMedia(audit, (plan.snapshot ?? []) as PiesaSnapshotEntry[]);
        const shortAnswers = shortAnswersFromEntries("piesa", snapshot);
        const evidenceBlockers = piesaEvidenceBlockers(shortAnswers, piesaMediaFromSnapshot(snapshot));
        // Decisions 312/323: every completed A3 that has the "won't discuss prices" tick must have it ticked — an office item, never a blocker.
        const priceTalk = noPriceTalkIssue({ completed: plan.completed, entries: snapshot });
        // A PIESA marked complete in Mitti without its evidence is NOT complete here (stays pending, re-synced next tick).
        completed = plan.completed && evidenceBlockers.length === 0;
        await admin.from("assessments").update({
          ...safeElectrical, mitti_sync_status: completed ? "synced" : "pending", mitti_completed: completed, mitti_modified_at: plan.modifiedAt,
          mitti_raw_snapshot: snapshot as unknown as Json, mitti_validation_issues: [...plan.issues, ...refused.issues, ...evidenceBlockers.map((b) => `${PIESA_EVIDENCE_ISSUE_PREFIX}${b}`), ...(priceTalk ? [priceTalk] : [])] as unknown as Json, mitti_last_error: null,
          ...(completed ? { mitti_synced_at: now } : {}),
        }).eq("id", a.id).neq("status", "complete");
        const outcome = shortAnswers['rectificationOutcome'];
        if (outcome) {
          // Optional paired-form work never lets a dispatch outage fail the existing A3 sync.
          try { await (await import('./fixes-day.server')).syncRectificationCompanion(jobId, actorId, {
            noRectification: completed && outcome === RECTIFICATION_OUTCOMES[0],
            needsRectification: outcome !== RECTIFICATION_OUTCOMES[0], previouslyNotNeeded: a.no_rectification_confirmed === true,
          }, call); }
          catch (e) { console.error('In-house companion sync failed', e instanceof Error ? e.message : 'Mitti error'); }
        }
        // Printed PIESA rules, checked server-side on every sync (blockers stay as review issues; nothing is completed here).
        // The Mitti form is the short onsite version: answers are expanded into the official items first.
        // Decision 296: the owner block (o.*) comes from the owner's secure-link confirmation record, never from this form.
        const [prefillCtx, ownerConfirmation, ownerFixesConfirmation] = await Promise.all([officialPrefillContext(jobId, todayMelbourne(), null), (await import("./piesa-owner-confirm.server")).ownerConfirmationForExpand(jobId).catch(() => null), (await import("./piesa-fixes-confirm.server")).ownerFixesConfirmationForExpand(jobId).catch(() => null)]);
        const expanded = expandPiesa(shortAnswers, { lifeSupportDeclared: prefillCtx.lifeSupportDeclared, today: todayMelbourne(), ownerConfirmation, ownerFixesConfirmation });
        const ev = evaluatePiesa(expanded.answers);
        // The electrician's own life support answer on site: Yes marks the job (never cleared by a No), so the plan is needed before the install.
        await (await import("./job-records.server")).applyPiesaLifeSupport(jobId, actorId, shortAnswers["lifeSupportPresent"]);
        // Decision 314 / 327: a completed A3 with "Be on site at the start of the install day" ticked is recorded (history only).
        if (plan.completed) await syncOnsiteStartItem(jobId, actorId, shortAnswers["rectificationOutcome"] === RECTIFICATION_OUTCOMES[2]).catch(() => undefined);
        // A48 batch 1: a completed A3 that breaks the official rules → one event + one electrician message per form version
        // (read from the answers just stored); a later version that passes clears it. Never throws.
        if (plan.completed) await (await import("./piesa-rules-notice.server")).recheckPiesaRules(jobId, actorId);
        issues = [...plan.issues, ...refused.issues, ...evidenceBlockers.map((b) => `${PIESA_EVIDENCE_ISSUE_PREFIX}${b}`), ...(priceTalk ? [priceTalk] : []), ...expanded.flagged.map((f) => `Official form: ${f}`), ...ev.blockers.map((b) => `Official form: ${b.message}${b.confirmation ? ` [${b.confirmation}]` : ""}`)];
        for (const o of plan.others) {
          const { data: ex } = await admin.from("rectification_items").select("id,status").eq("job_id", jobId).eq("external_key", o.external_key).maybeSingle();
          const base = { description: o.description, quantity: o.quantity, explanation: o.explanation };
          if (ex) {
            if (ex.status === "removed") continue; // office decision wins
            await admin.from("rectification_items").update({ ...base, ...(o.unit_price_inc_gst != null ? { other_unit_price_inc_gst: o.unit_price_inc_gst, needs_office_pricing: false } : {}) }).eq("id", ex.id);
          } else {
            await admin.from("rectification_items").insert({ ...base, job_id: jobId, assessment_id: a.id, is_other: true, source: "mitti", external_key: o.external_key, other_unit_price_inc_gst: o.unit_price_inc_gst, needs_office_pricing: o.needs_office_pricing, added_by: actorId });
          }
        }
        if (plan.completed) {
          await saveMittiReport(jobId, actorId, a.external_mitti_id, plan.modifiedAt ?? null, "PIESA", call);
          // Decision 178: the evidence that IS on the form is kept with the job file even while other items are still missing.
          await savePiesaEvidenceFiles(jobId, actorId, a.external_mitti_id, snapshot, fetchMedia);
          // Decision 336: the electrician's ACTUAL A3 signature image (media id + its own timestamp) is kept with the job for
          // the official PIESA Part B3 (Word form + PDF). Never throws; a failure is one internal event.
          const { mittiSignatureByLabel } = await import("./fixes-day.core");
          const a4Sig = mittiSignatureByLabel(audit, "Electrician signature");
          await (await import("./official-signature.server")).savePiesaSignatureImage(jobId, actorId, "a4", a.external_mitti_id, a4Sig, fetchMedia);
          // A48 batch 1 task 5: after the evidence files and signature are kept, a same-visit repair's certificate (q45) is
          // read by the AI (time-limited; ticked, or one office row). Never throws.
          await (await import("./coes-check.server")).checkCurrentCoes(jobId, actorId);
        }
        // History only on change (Jo 23 Oct): an unchanged re-sync (same answers, same modified time,
        // same status) adds no new event row.
        const syncStatus = completed ? "synced" : "pending";
        const changed = syncStatus !== a.mitti_sync_status || completed !== (a.mitti_completed ?? false) || (plan.modifiedAt ?? null) !== (a.mitti_modified_at ?? null);
        if (changed) await logEvent(jobId, actorId, "mitti_synced", completed ? "Mitti assessment synced (completed in Mitti)" : plan.completed ? `Mitti PIESA marked complete but evidence is missing: ${evidenceBlockers.join("; ")}` : "Mitti partial data synced (audit not yet completed)",
          { audit_id: a.external_mitti_id, electrical_fields: Object.keys(electrical), measurement: "not_imported_from_piesa", measurement_fields: [], issues, other_items: plan.others.length, modified_at: plan.modifiedAt ?? null, evidence_blockers: evidenceBlockers });
        // Decision 315: PIESA completed + electrical fixes needed + no fixes times yet → ONE text to the assigned electrician
        // with the job-page link to pick 3–5 times (event recorded before any send; never throws; on-site-only needs none).
        if (completed) await (await import("./fixes-times-link.server")).textFixesTimesLink(jobId, { auditId: a.external_mitti_id, completedAt: plan.modifiedAt ?? now, short: shortAnswers });
        // Decision 354: A3 Complete → prepare the electrician-priced fixes quote and send it automatically when every
        // existing check passes (same release as the office Send); otherwise it stays on Needs me with the reason. Never throws.
        if (completed) await (await import("./auto-fixes-quote-send.server")).maybeAutoSendFixesQuote(jobId, { actorId, generate: true });
      }
    }
  }

  if (measureAudit) {
    try {
      const ids = await templateIds();
      const auditNow = await api.getAudit(measureAudit);
      // Jo 22 Oct 2026: a Ready Check done in Mitti may use either configured template (installer A1 or HIV A2);
      // pick the one the form actually uses (normalised id comparison). The channel variant stays the fallback.
      const auditTemplate = String((auditNow as Any)?.template_id ?? "");
      const tid = [ids.readyCheck, ids.readyCheckPriced].filter(Boolean).find((t) => sameMittiTemplateId(t, auditTemplate))
        ?? (readyCheckVariant(job.channel) === "ready_check_priced" ? ids.readyCheckPriced : ids.readyCheck);
      if (!tid) throw new WorkflowError(MEASUREUP_TEMPLATE_MISSING);
      const plan = planSync(auditNow, { storedAuditId: measureAudit, jobNumber: job.job_number, assessmentStatus: null, templateId: tid });
      if (!plan.locked) {
        const mp = await applyMeasure(jobId, actorId, measureAudit, "installer", splitPatch(plan.patch).measure, plan.snapshot, plan.areas ?? null);
        await applyContactAnswers(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], measureAudit);
        await applyPremisesType(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], measureAudit).catch(() => undefined);
        // Jo 23 Oct: draft for "Quotes to check" as soon as the basics are in — no need to wait for the whole form.
        const basics = await (await import("./ready-check-basics.server")).checkReadyCheckBasics(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], plan.completed, measureAudit).catch(() => null);
        const draftNow = plan.completed || !!basics?.ready;
        const mIssues = plan.issues.filter((i) => !/PIESA|Switchboard/.test(i));
        issues = [...issues, ...mIssues, ...(mp.action === "skip" ? [mp.reason] : []), ...(mp.zonesIssue ? [mp.zonesIssue] : [])];
        completed = completed || plan.completed;
        if (plan.completed) await saveMittiReport(jobId, actorId, measureAudit, plan.modifiedAt ?? null, "Ready Check", call);
        if (plan.completed) {
          // Decision 396: missing Ready Check photos are no longer carried to install day (the A5 asks the ruler photos).
          // Hard stops on our leads too (installer jobs record them in the quote step): no quote, office list.
          if (job.channel !== "installer_sourced") {
            const ra = await import("./ready-check-answers.core");
            const { data: w } = await admin.from("jobs").select("life_support_status, properties(enrichment)").eq("id", jobId).maybeSingle();
            const overFive = ((w?.properties as { enrichment?: Any } | null)?.enrichment as Any)?.base44?.declared?.over_five_years ?? null;
            const stops = [...ra.readyCheckStopReasons((plan.snapshot ?? []) as { label: string; value: string | null }[], { ownerAnsweredOnWebsite: true }),
              ...ra.websiteStopReasons({ lifeSupportStatus: (w?.life_support_status as string | null) ?? null, overFiveYears: overFive })];
            if (stops.length) await (await import("./ready-check-quote.server")).recordNeedsOffice(jobId, actorId, null, stops);
          }
        }
        // Our leads (Jo 22 Oct): record the installer's chosen product/R-value so the rate-card quote uses it.
        if (draftNow && job.channel !== "installer_sourced") {
          try { await (await import("./insulation-product.server")).mittiProductForJob(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], measureAudit); }
          catch (e) { issues = [...issues, `Insulation product not recorded: ${e instanceof Error ? e.message : "error"}`]; }
          try {
            const { draftHivReadyCheckQuote } = await import("./ready-check-quote.server");
            await draftHivReadyCheckQuote(jobId, actorId, measureAudit, plan.modifiedAt ?? null, (plan.snapshot ?? []) as { label: string; value: unknown }[]);
          } catch (e) { issues = [...issues, `Owner quote could not be drafted: ${e instanceof Error ? e.message : "error"}`]; }
        }
        // Installer-brought jobs: draft (never send) the co-branded owner quote from the installer's ticked price.
        if (draftNow && readyCheckVariant(job.channel) === "ready_check_priced") {
          try {
            const d = await draftInstallerQuoteFromReadyCheck(jobId, actorId, (plan.snapshot ?? []) as { label: string; value: string | null }[], measureAudit);
            if (d && !d.ready) issues = [...issues, ...d.blockers.map((b) => `Owner quote: ${b}`)];
            if (d?.ready) await applyCobrand(jobId);
          } catch (e) { issues = [...issues, `Owner quote could not be drafted: ${e instanceof Error ? e.message : "error"}`]; }
        }
        // Jo 24 Oct: installer marks the form Complete → measurements recorded, eligibility from the form answers, quote
        // stage, and the owner's quote goes out when every check passes (installer jobs and our leads); otherwise held
        // for the office with the reasons. A form changed after sending is flagged.
        try {
          const { finishMittiReadyCheck } = await import("./mitti-complete.server");
          const r = await finishMittiReadyCheck(jobId, { auditId: measureAudit, completed: plan.completed, modifiedAt: plan.modifiedAt ?? null,
            entries: (plan.snapshot ?? []) as { label: string; value: unknown }[], ourLead: readyCheckVariant(job.channel) !== "ready_check_priced" });
          if (r.done === "sent") issues = [...issues, "Owner quote sent automatically"];
        } catch (e) { issues = [...issues, `Ready Check completion step failed: ${e instanceof Error ? e.message : "error"}`]; }
        // Stage 7 (Jo 22 Oct): incomplete form → record what the installer must add (dormant text; office chase after 24h).
        await (await import("./ready-check-chase.server")).recordReadyCheckProgress({
          jobId, actorId, auditId: measureAudit, entries: (plan.snapshot ?? []) as { label: string; value: unknown }[],
          completed: plan.completed, modifiedAt: plan.modifiedAt ?? null, priced: readyCheckVariant(job.channel) === "ready_check_priced",
        }).catch(() => undefined);
        // History only on change (Jo 23 Oct): an unchanged re-sync (same answers, same modified time)
        // adds no new event row.
        // A later "synced" row is what clears an earlier failure / Mitti-access flag, so always record one after those.
        const { data: lastEv } = await admin.from("workflow_events").select("event_type, details").eq("job_id", jobId).in("event_type", ["mitti_measureup_synced", "mitti_measureup_sync_failed", "mitti_access_needed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        // Jo 23 Oct (fix): a partial form re-synced with the same answers used to add a row every 15 minutes, because the
        // measurement step reports "update" even when nothing changed. Compare a fingerprint of what was synced instead.
        const fingerprint = JSON.stringify({ m: mp.action === "skip" ? null : ("values" in mp ? mp.values : null), c: plan.completed, t: plan.modifiedAt ?? null, i: mIssues });
        const changed = lastEv?.event_type !== "mitti_measureup_synced" || (lastEv?.details as { fingerprint?: string } | null)?.fingerprint !== fingerprint;
        if (changed) await logEvent(jobId, actorId, "mitti_measureup_synced", plan.completed ? "Mitti Ready Check synced (completed in Mitti)" : "Mitti Ready Check partial data synced", { audit_id: measureAudit, measurement: mp.action, issues: mIssues, modified_at: plan.modifiedAt ?? null, fingerprint });
      }
    } catch (e) {
      // Recorded so the office can retry (never auto-retried in a loop); the rest of the sync still lands.
      const msg = e instanceof Error ? e.message : "Mitti error";
      await logEvent(jobId, actorId, "mitti_measureup_sync_failed", `Ready Check sync failed: ${msg}`, { audit_id: measureAudit, needs_office: true }, { internal: true }).catch(() => undefined);
      issues = [...issues, `Ready Check sync failed: ${msg}`];
    }
  }
  return { locked, completed, issues };
}

export async function syncPendingMitti(actorId: string | null, call: MittiCall = realMittiCall) {
  // Jo 23 Oct: cancelled/held/completed/archived jobs are never synced — their forms stay in Mitti untouched.
  // Same scope as the instant notice (mitti-sync-scope.core.ts).
  const { MITTI_SYNC_SCOPE_SELECT, inMittiSyncScope } = await import("./mitti-sync-scope.core");
  const [{ data: as }, { data: ms }] = await Promise.all([
    inMittiSyncScope(admin.from("assessments").select(MITTI_SYNC_SCOPE_SELECT).not("external_mitti_id", "is", null)),
    inMittiSyncScope(admin.from("ceiling_measurements").select(MITTI_SYNC_SCOPE_SELECT).eq("external_source", "mitti").eq("is_current", true)),
  ]);
  const ids = [...new Set([...(as ?? []), ...(ms ?? [])].map((r) => r.job_id))];
  const results: { jobId: string; ok: boolean; message: string }[] = [];
  for (const jobId of ids) {
    try {
      const r = await syncMittiAssessment(jobId, actorId, call);
      results.push({ jobId, ok: true, message: r.completed ? "synced" : "pending" });
    } catch (e) {
      results.push({ jobId, ok: false, message: e instanceof Error ? e.message : "error" });
    }
  }
  // Installer declarations signed inside the Mitti PIISA.
  const { data: pe } = await admin.from("workflow_events").select("job_id").eq("event_type", "mitti_piisa_audit_created");
  const { syncPiisaDeclaration } = await import("./piisa-declaration.server");
  const peIds = [...new Set((pe ?? []).map((e) => e.job_id as string).filter(Boolean))];
  // Same rule as the forms above (Jo 23 Oct): cancelled / deleted / QA-archived jobs are never synced.
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  const { data: peJobs } = peIds.length ? await admin.from("jobs").select("id,stage,deleted_at,qa_archived_at").in("id", peIds) : { data: [] };
  const closedIds = new Set((peJobs ?? []).filter((j) => isClosedOrArchivedJob(j)).map((j) => j.id));
  for (const jobId of peIds.filter((id) => !closedIds.has(id))) {
    try { const r = await syncPiisaDeclaration(jobId, actorId, call); if (r.status !== "already") results.push({ jobId, ok: r.status === "saved" || r.status === "pending", message: r.message }); }
    catch (e) { results.push({ jobId, ok: false, message: e instanceof Error ? e.message : "error" }); }
  }
  return results;
}

/** Sends the official PIISA to the assigned installer in Mitti with the LR-003 pre-fills (Installation Booked only).
 * Fails closed while the PIISA is locked or its Mitti form isn't configured. Reminders stay in the portal. */
export async function createPiisaMittiAudit(jobId: string, actorId: string | null, call: MittiCall = realMittiCall, opts: { officeOverride?: boolean } = {}) { // actorId null = the 15-minute tick (piisa-autosend.server.ts)
  const { buildOfficialPrefill, missingKnownFields, PIISA_A3_TEMPLATE_ID } = await import("./mitti.core");
  const a3 = await import("./piisa-a3.core");
  const { OFFICIAL_ITEMS } = await import("./official-forms.core");
  const { piisaPrefill } = await import("./official-prefill.core");
  const { officialPrefillContext } = await import("./official-forms.server");
  const block = officialFormUseBlocker("piisa");
  if (block) throw new WorkflowError(block);
  const { data: ws } = await admin.from("workflow_settings").select("mitti_piisa_template_id").eq("id", 1).maybeSingle();
  const MITTI_PIISA_TEMPLATE_ID = ws?.mitti_piisa_template_id?.trim() ?? "";
  if (!canonicalMittiTemplateId(MITTI_PIISA_TEMPLATE_ID)) throw new WorkflowError("PIISA Mitti form is not configured with a valid ID. Add the validated PIISA form before it can be sent.");
  const { data: job } = await admin.from("jobs").select("job_number,business_unit,stage").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Job not found.");
  if (job.business_unit !== "hivic") throw new WorkflowError("Mitti automation is only available for Home Insulation Victoria jobs.");
  if (job.stage !== "installation_booked") throw new WorkflowError("The installer safety form can only be sent once the installation is booked.");
  { const { requirePrestartClear } = await import("./prestart.server"); await requirePrestartClear(jobId); }
  // One PIISA per job, only after this same job's Ready Check is completed.
  { const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("to_stage", "ready_check_complete");
    if (!count) throw new WorkflowError("Complete this job's Ready Check before the installer safety form (PIISA) is sent."); }
  const { data: asg } = await admin.from("job_assignments").select("user_id, profiles:user_id(email)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const email = (asg as unknown as { profiles: { email: string | null } | null } | null)?.profiles?.email?.trim();
  if (!asg || !email) throw new WorkflowError("Assign an installer with an email address before sending the safety form.");
  const { data: prev, error: previousError } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (previousError) throw new WorkflowError("The existing PIISA audit could not be checked. Try again; no replacement form was created.");
  const prevId = (prev?.details as { audit_id?: string } | null)?.audit_id;
  // Atomic per-job claim (same guard as createAssignMittiAudit; see mitti-create-claim.core.ts). Only a NEW form is
  // claimed. Only the create POST is non-idempotent, so it is tracked: a failure before it releases the claim; a failure
  // during/after it without an audit id keeps the claim and records the outcome as uncertain (never auto-retried).
  const claims = await import("./mitti-create.server");
  const claimId = prevId ? null : await claims.claimMittiCreate(jobId, "install_day", actorId, `Install day form creation started for ${email}`,
    { template_id: MITTI_PIISA_TEMPLATE_ID, assignee_email: email }, { officeOverride: opts.officeOverride === true });
  const base = mittiApi(await mittiCallFor(call, email));
  const seen = { createAttempted: false, createdId: null as string | null };
  const api: typeof base = { ...base, createAudit: async (body) => {
    seen.createAttempted = true;
    const out = await base.createAudit(body);
    const id = out?.audit_id ?? out?.id;
    seen.createdId = id ? String(id) : null;
    return out;
  } };
  try { // (body below is not re-indented, to keep this diff small)
  const users = (await api.searchUsers(email)) as { users?: { id?: string; user_id?: string; email?: string }[] } | { id?: string; user_id?: string; email?: string }[];
  const list = Array.isArray(users) ? users : users?.users ?? [];
  const u = list.find((x) => String(x.email ?? "").toLowerCase() === email.toLowerCase());
  const userId = u?.id ?? u?.user_id;
  if (!userId) throw new WorkflowError(`The assigned installer (${email}) was not found in Mitti. Invite them with that exact email, then retry.`);
  if (prevId) {
    const previous = await api.getAudit(prevId);
    validateStoredMittiAudit(previous, { storedAuditId: prevId, jobNumber: job.job_number, templateId: MITTI_PIISA_TEMPLATE_ID });
    const { ensurePiisaAp } = await import("./piisa-ap.core");
    await ensurePiisaAp(previous, (items) => api.updateAuditText(prevId, items), () => api.getAudit(prevId));
    await api.shareAudit(prevId, String(userId)); await api.setAuditOwner(prevId, String(userId));
    await logEvent(jobId, actorId, "mitti_piisa_audit_reshared", `Installer safety form re-shared with ${email}`, { audit_id: prevId });
    return { auditId: prevId, reused: true, skipped: [] as string[] };
  }
  const piisaCtx = await officialPrefillContext(jobId, todayMelbourne(), asg.user_id);
  const hints = piisaPrefill(piisaCtx);
  const items = OFFICIAL_ITEMS.piisa;
  const isA3 = sameMittiTemplateId(MITTI_PIISA_TEMPLATE_ID, PIISA_A3_TEMPLATE_ID);
  type Pre = { itemId: string; label: string; kind: string; value: string; occurrence: number; row: number };
  const toPre = (itemId: string, value: string, row = 0): Pre => {
    const it = items.find((i) => i.id === itemId);
    if (!it) throw new WorkflowError(`Unknown official prefill field: ${itemId}`);
    const occurrence = isA3 ? a3.a3Occurrence(itemId, row) : items.filter((i) => i.label === it.label && items.indexOf(i) < items.indexOf(it)).length + row;
    return { itemId, label: it.label, kind: it.kind, value, occurrence, row };
  };
  const preMap = new Map<string, Pre>();
  for (const h of hints) if (h.mode === "prefill" && h.value != null) preMap.set(`${h.itemId}#0`, toPre(h.itemId, h.value));
  const prefillNotes: string[] = [];
  if (isA3) {
    // Verified crew chosen in the portal (native form has no live staff lookup), then same-job Ready Check facts.
    const { loadCrew, readyCheckAreas } = await import("./piisa-a3.server");
    const { staff, selection } = await loadCrew(jobId);
    if (!selection) throw new WorkflowError("Choose the install crew (lead installer and any additional installers) before sending the safety form.");
    const cp = a3.crewSelectionProblems(selection, staff);
    if (cp.problems.length) throw new WorkflowError(cp.problems.join(" • "));
    if (cp.needsVerification.length) throw new WorkflowError(`Verify before work: ${cp.needsVerification.join("; ")}`);
    // Crew goes to the native single-choice list (real option ids / Other branch), never as plain text.
    for (const k of [...preMap.keys()]) if (/^p2\.(lead|leadEec|addName|addEec)#/.test(k)) preMap.delete(k);
    for (const c of a3.crewPrefill(selection, staff)) if (c.itemId === "p8.name") preMap.set("p8.name#0", toPre("p8.name", c.value));
    const rc = a3.readyCheckPartPrefill(await readyCheckAreas(jobId));
    for (const [id, v] of Object.entries(rc.values)) if (!preMap.has(`${id}#0`)) preMap.set(`${id}#0`, toPre(id, v));
    prefillNotes.push(...rc.notes);
    for (const id of a3.A3_NOT_ON_NATIVE) preMap.delete(`${id}#0`);
  }
  const template = await api.getTemplateDefinition(MITTI_PIISA_TEMPLATE_ID);
  if (!sameMittiTemplateId(mittiTemplateIdentity(template).id, MITTI_PIISA_TEMPLATE_ID))
    throw new WorkflowError("Mitti returned an unexpected or unidentifiable PIISA template; office review is required.");
  // Decision 262: the "A5 – Install day" template (connected as the PIISA form) is prefilled by wording from job facts.
  {
    const id = await import("./install-day.core");
    if (id.isInstallDayDoc(template)) {
      const missingQs = id.installDayMissingQuestions(template);
      if (missingQs.length) throw new WorkflowError(`The Install day form is missing questions (exact wording), so it was not created: ${missingQs.join("; ")}`);
      const { loadCrew } = await import("./piisa-a3.server");
      const { staff, selection } = await loadCrew(jobId);
      if (!selection) throw new WorkflowError("Choose the install crew (lead installer and any additional installers) before sending the install day form.");
      const cp = a3.crewSelectionProblems(selection, staff);
      if (cp.problems.length) throw new WorkflowError(cp.problems.join(" • "));
      if (cp.needsVerification.length) throw new WorkflowError(`Verify before work: ${cp.needsVerification.join("; ")}`);
      const lead = staff.find((x) => x.workerId === a3.leadWorkerId(selection)) ?? null;
      const hv = (itemId: string) => hints.find((h) => h.itemId === itemId)?.value ?? null;
      const yes = (v: string | null) => (v == null ? null : /^\s*yes\b/i.test(v) ? true : /^\s*no\b/i.test(v) ? false : null);
      const { a3Ctx } = await import("./piisa-prestart.server");
      // Life support (Q18) and solar (Q23) from the PIESA: the signed official answers, else the stored A3 short answers.
      const { data: asmt } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
      const a3Entries = Array.isArray(asmt?.mitti_raw_snapshot) ? (asmt!.mitti_raw_snapshot as unknown as { label: string; value: string | null }[]) : [];
      const a3Short = a3Entries.length ? (await import("./official-short.core")).shortAnswersFromEntries("piesa", a3Entries) : null;
      const piesaFacts = id.installDayPiesaFacts({ piesaAnswers: piisaCtx.piesaAnswers as Record<string, unknown> | null, a3Short, lifeSupportDeclared: piisaCtx.lifeSupportDeclared });
      const facts = {
        jobNumber: job.job_number, address: hv("address"), installDate: hv("startDate"), apName: hv("p2.ap"), businessName: hv("p2.company"),
        leadName: lead?.name ?? null, leadCii: lead?.eecVerified ? lead.eec : null,
        // Decision 299: the rest of the crew pre-filled from the booking's crew picks (staff row, or an "Other" entry).
        ...(() => {
          const pick = (x: unknown): { name: string | null; cii: string | null } | null => {
            if (typeof x === "string") { const w = staff.find((o) => o.workerId === x); return w ? { name: w.name, cii: w.eecVerified ? w.eec : null } : null; }
            const o = (x as { other?: { name?: string; eec?: string } } | null)?.other; return o ? { name: o.name ?? null, cii: null } : null;
          };
          const [c2, c3] = (selection.additional ?? []).map(pick);
          return { secondName: c2?.name ?? null, secondCii: c2?.cii ?? null, thirdName: c3?.name ?? null, thirdCii: c3?.cii ?? null };
        })(),
        lifeSupport: piesaFacts.lifeSupport ?? yes(hv("lifeSupport")), solarPresent: piesaFacts.solarPresent ?? yes(hv("p4.present")), electricianAtStart: (await a3Ctx(jobId, template)).electricianRequiredAtStart,
      };
      const prefill = id.installDayPrefillItems(template, facts, (await import("./mitti.core")).choiceOption);
      const headerIds = new Set((await import("./mitti.core")).flatten(template).filter((e) => e.header).map((e) => String(e.id)));
      const header_items = prefill.filter((x) => headerIds.has(x.item_id)), items = prefill.filter((x) => !headerIds.has(x.item_id));
      const created = (await api.createAudit({ template_id: MITTI_PIISA_TEMPLATE_ID, header_items, items } as never)) as { audit_id?: string; id?: string };
      const newId = created?.audit_id ?? created?.id;
      if (!newId) throw new WorkflowError("Mitti did not return an audit ID.");
      await logEvent(jobId, actorId, "mitti_piisa_audit_created", "Install day form created; prefill verification pending", { audit_id: String(newId), template: MITTI_PIISA_TEMPLATE_ID, native_version: id.INSTALL_DAY_RULE });
      await api.shareAudit(String(newId), String(userId)); await api.setAuditOwner(String(newId), String(userId));
      await logEvent(jobId, actorId, "mitti_piisa_audit_created", `Install day form sent to ${email} with ${prefill.length} pre-filled answers`, { audit_id: String(newId), prefill_count: prefill.length, template: MITTI_PIISA_TEMPLATE_ID, native_version: id.INSTALL_DAY_RULE });
      return { auditId: String(newId), reused: false, skipped: [] as string[] };
    }
  }
  const native = await import("./piisa-native-version.core");
  const resolved = isA3 ? native.resolvePiisaNativeVersion(template) : null;
  if (resolved && (!resolved.active || !resolved.mapping)) throw new WorkflowError(`The PIISA mapping needs review: ${resolved.problems.join("; ")}`);
  const direct = resolved?.version === native.PIISA_DIRECT_VERSION;
  if (direct) for (const key of [...preMap.keys()]) if (/^(p7\.products|completionDate|p8\.name|p8\.date|p2\.lead|p2\.leadEec|p2\.addName|p2\.addEec)#/.test(key)) preMap.delete(key);
  const pre = [...preMap.values()];
  const p = buildOfficialPrefill(template, pre, resolved?.mapping ?? {});
  const ap = await import("./piisa-ap.core");
  if (isA3) {
    const apPayload = [...p.header_items, ...p.items].find((item) => item.item_id === ap.PIISA_AP_ID);
    if (!apPayload || JSON.stringify(apPayload.responses) !== JSON.stringify(ap.piisaApItem().responses)) throw new WorkflowError("Authoritative Accredited Person prefill is missing; form was not created.");
  }
  if (isA3) {
    const { loadCrew, assignedInstallerBusiness } = await import("./piisa-a3.server");
    const { staff, selection } = await loadCrew(jobId);
    const { data: biz } = await admin.from("businesses").select("name").eq("id", await assignedInstallerBusiness(jobId)).maybeSingle();
    const bname = biz?.name ?? "";
    if (!selection) throw new WorkflowError("Choose the install crew before sending the safety form.");
    const prepared = direct ? native.stagedDirectCrewPrefill(selection, staff) : null;
    const crew = prepared ? { items: prepared.items, problems: [...prepared.problems, ...prepared.needsVerification], notes: [] as string[] } : a3.a3CrewNativeItems(template, selection, staff, bname);
    if (crew.problems.length) throw new WorkflowError(`Crew could not be filled in on the Mitti form: ${crew.problems.join("; ")}`);
    p.items.push(...crew.items); p.count += crew.items.length;
    prefillNotes.push(...crew.notes);
    // Decision 210 e: zone names from the Ready Check ("Area N – name") — text items matched by exact wording; a
    // template without the question simply gets nothing for it. Decision 256: the SWMS has no prefilled items.
    {
      const ie = await import("./install-evidence.server");
      const ctx = await ie.installPrefillContext(jobId);
      const extra = (await import("./install-evidence.core")).installEvidencePrefillItems(template, ctx).filter((x) => !p.items.some((i: { item_id: string }) => i.item_id === x.item_id));
      p.items.push(...extra); p.count += extra.length;
    }
    const roster = direct ? { alert: null, missingOptions: [], staleOptions: [] } : a3.a3RosterStatus(template, staff, bname);
    if (roster.alert) { prefillNotes.push(roster.alert); await logEvent(jobId, actorId, "mitti_crew_shared_names", roster.alert, { missing: roster.missingOptions, stale_count: roster.staleOptions.length }, { internal: true }); }
  }
  for (const s of p.skipped) if (/single choice on the Mitti form/.test(s)) prefillNotes.push(`Removed and topped up are both recorded, but Mitti's question takes one answer — the installer chooses on site.`);
  const missing = missingKnownFields(p.skipped);
  if (missing.length) throw new WorkflowError(`The Mitti PIISA form is missing known fields, so it was not created: ${missing.join("; ")}`);
  // Validate returned prefill: every value we sent must be on the payload, at its own field.
  { const sent = new Set([...p.header_items, ...p.items].map((x: { item_id: string }) => x.item_id)); if (sent.size !== p.count) throw new WorkflowError("Two pre-fills resolved to the same Mitti field — not created."); }
  const audit = (await api.createAudit({ template_id: MITTI_PIISA_TEMPLATE_ID, header_items: p.header_items, items: p.items })) as { audit_id?: string; id?: string };
  const auditId = audit?.audit_id ?? audit?.id;
  if (!auditId) throw new WorkflowError("Mitti did not return an audit ID.");
  // Store identity before readback so a failed response check cannot cause duplicate creation on retry.
  await logEvent(jobId, actorId, "mitti_piisa_audit_created", "PIISA created; prefill verification pending", { audit_id: String(auditId), template: MITTI_PIISA_TEMPLATE_ID, native_version: resolved?.version ?? null });
  if (isA3) ap.assertPiisaAp(await api.getAudit(String(auditId)));
  await api.shareAudit(String(auditId), String(userId)); await api.setAuditOwner(String(auditId), String(userId));
  await logEvent(jobId, actorId, "mitti_piisa_audit_created", `Installer safety form sent to ${email} with ${p.count} pre-filled answers`, { audit_id: String(auditId), prefill_count: p.count, skipped: p.skipped, template: MITTI_PIISA_TEMPLATE_ID, prefill_notes: prefillNotes, native_version: resolved?.version ?? null });
  return { auditId: String(auditId), reused: false, skipped: p.skipped };
  } catch (e) {
    if (!claimId) throw e;
    const { createOutcome } = await import("./mitti-create-claim.core");
    const outcome = createOutcome(seen);
    // "created": Mitti made the form; its id is already stored in mitti_piisa_audit_created, so the next run reuses it.
    if (outcome === "not_created") await claims.releaseMittiCreate(jobId, "install_day", claimId, actorId, e instanceof Error ? e.message : "Mitti error");
    else if (outcome === "uncertain") {
      await claims.recordMittiCreateUncertain(jobId, "install_day", claimId, actorId, e instanceof Error ? e.message : "Mitti error");
      throw new claims.MittiOutcomeUncertain();
    }
    throw e;
  }
}

// ---------- visit allocation (decision 161, Jo 24 Oct 2026) ----------
/** Resolve the Mitti user a staff member's email belongs to (null = not in Mitti under the business → "Add them in Mitti first"). */
export async function findMittiUserByEmail(email: string, call: MittiCall = realMittiCall): Promise<string | null> {
  const e = email.trim();
  if (!e) return null;
  const u = pickUser(await mittiApi(await mittiCallFor(call, e)).searchUsers(e), e);
  const id = u?.id ?? u?.user_id;
  return id == null || id === "" ? null : String(id);
}

/**
 * Hand an EXISTING Mitti form to the allocated person: preflight the stored audit (same id, a configured template for
 * this visit kind), then the same share + set-owner calls every creation path uses. Never creates a form, never
 * touches the create claim (nothing non-idempotent happens here); repeating it is harmless.
 */
export async function reassignMittiFormTo(p: { jobId: string; auditId: string; kind: "ready_check" | "install"; mittiUserId: string; email: string; actorId: string | null }, call: MittiCall = realMittiCall) {
  const [{ data: job }, { data: ws }] = await Promise.all([
    admin.from("jobs").select("job_number").eq("id", p.jobId).single(),
    admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id,mitti_piisa_template_id").eq("id", 1).maybeSingle(),
  ]);
  if (!job) throw new WorkflowError("Job not found.");
  const allowed = (p.kind === "install" ? [ws?.mitti_piisa_template_id] : [ws?.mitti_ready_check_template_id, ws?.mitti_ready_check_priced_template_id]).filter((t): t is string => !!t?.trim());
  if (!allowed.length) throw new WorkflowError(p.kind === "install" ? PIESA_TEMPLATE_MISSING.replace("PIESA", "PIISA") : MEASUREUP_TEMPLATE_MISSING);
  const api = mittiApi(await mittiCallFor(call, p.email));
  let audit: Any;
  try { audit = await api.getAudit(p.auditId); } catch (e) { throw wrap(e); }
  const parsed = parseAudit(audit);
  const templateId = allowed.find((t) => sameMittiTemplateId(parsed.templateId, t));
  if (!templateId) throw new WorkflowError("This job's Mitti form is not one of the configured Home Insulation Victoria forms, so it was not handed over.");
  try {
    validateStoredMittiAudit(audit, { storedAuditId: p.auditId, jobNumber: job.job_number, templateId });
    await api.shareAudit(p.auditId, p.mittiUserId);
    await api.setAuditOwner(p.auditId, p.mittiUserId);
  } catch (e) { throw wrap(e); }
  await logEvent(p.jobId, p.actorId, p.kind === "install" ? "mitti_piisa_audit_reshared" : "mitti_audit_reshared",
    `${p.kind === "install" ? "Installer safety form" : "Mitti Ready Check form"} handed to ${p.email} (visit allocation)`, { audit_id: p.auditId, mitti_user_id: p.mittiUserId, reason: "visit_allocated", ...(p.kind === "install" ? {} : { kind: "ready_check" as const }) });
  return { auditId: p.auditId };
}
