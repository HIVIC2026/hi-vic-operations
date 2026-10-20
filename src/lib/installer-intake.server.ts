// Installer-supplied intake persistence/read model (Jo, 8 Oct 2026). Server-only; callers authorise first.
import { readRemoval, removalProblems, removalSummary, type RemovalQuote } from "./intake-quote-details.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { intakeScopeArea, staleQuoteAction, installerQuoteReadiness, installerQuoteReleaseBlockers, insulationQualifies, readyCheckOutstanding, type EvidenceItem, type ExistingInsulation } from "./installer-intake.core";

const INSULATION_EVENTS = ["installer_existing_insulation_declared", "installer_intake_corrected"];

/** Latest insulation value: an office correction overrides the installer's declaration. Missing = null (never assumed). */
async function latestInsulation(jobId: string): Promise<{ value: ExistingInsulation | null; source: string | null }> {
  const { data, error } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", INSULATION_EVENTS).order("created_at", { ascending: false }).limit(10);
  if (error) throw new WorkflowError("The latest insulation details could not load. Please retry.");
  for (const e of data ?? []) {
    const v = (e.details as { value?: unknown; insulation?: unknown } | null);
    const val = e.event_type === "installer_intake_corrected" ? v?.insulation : v?.value;
    if (val === "none" || val === "below_r2" || val === "unknown") return { value: val, source: e.event_type };
  }
  return { value: null, source: null };
}

/**
 * Route-specific office decision for installer-supplied jobs: owner/property eligibility checked by the office after
 * contact. Separate from the post-Ready-Check verified eligibility (which still needs full evidence). Any later
 * intake correction makes an earlier decision stale (unresolved) until the office decides again.
 */
export async function commercialEligibility(jobId: string): Promise<"eligible" | "declined" | "unresolved"> {
  const { data, error } = await admin.from("workflow_events").select("event_type, details").eq("job_id", jobId).in("event_type", ["installer_commercial_eligibility", "installer_intake_corrected"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The office eligibility decision could not load. Please retry.");
  if (!data || data.event_type !== "installer_commercial_eligibility") return "unresolved";
  const o = (data.details as { outcome?: string } | null)?.outcome;
  return o === "eligible" ? "eligible" : o === "not_eligible" ? "declined" : "unresolved";
}

export async function recordCommercialEligibility(jobId: string, actorId: string, outcome: "eligible" | "not_eligible", reason: string) {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).single();
  if (job?.channel !== "installer_sourced") throw new WorkflowError("Only installer-supplied jobs use this check.");
  if (!reason.trim()) throw new WorkflowError("Add what was checked (owner, property, occupancy).");
  await logEvent(jobId, actorId, "installer_commercial_eligibility", outcome === "eligible" ? "Office checked owner and property eligibility for the installer quote" : "Office found the owner or property not eligible", { outcome, reason: reason.trim(), checked_at: new Date().toISOString(), note: "Owner quote eligibility only — Ready Check evidence and final AP verification still required" }, { internal: true });
}

async function latestProposedR(jobId: string): Promise<number | null> {
  const { data, error } = await admin.from("workflow_events").select("event_type, details").eq("job_id", jobId).in("event_type", ["installer_evidence_acknowledged", "installer_intake_corrected", "installer_intake_updated"]).order("created_at", { ascending: false }).limit(10);
  if (error) throw new WorkflowError("The proposed insulation details could not load. Please retry.");
  for (const e of data ?? []) { const d = e.details as { proposed_r_value?: unknown } | null; if (d && "proposed_r_value" in d) return typeof d.proposed_r_value === "number" ? d.proposed_r_value : null; }
  return null;
}

/** An accepted quote whose facts were materially corrected needs the owner to reconfirm; cleared only by a new acceptance. */
export async function reconfirmationOpen(jobId: string): Promise<boolean> {
  const { data, error } = await admin.from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", ["installer_quote_reconfirmation_required", "QUOTE_ACCEPTED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The quote reconfirmation history could not load. Please retry.");
  return data?.event_type === "installer_quote_reconfirmation_required";
}

/** True only for jobs that came through the approved single installer intake. */
export async function isIntakeJob(jobId: string): Promise<boolean> {
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_evidence_acknowledged");
  if (error || count == null) throw new WorkflowError("The installer intake history could not load. Please retry."); // fail closed: never "no blockers"
  return count > 0;
}

/** Every send/release/approve/accept path for an intake job re-checks readiness, consent, fee awareness and reconfirmation. [] for other jobs. */
export async function intakeSendBlockers(jobId: string): Promise<string[]> {
  if (!(await isIntakeJob(jobId))) return [];
  const st = await installerIntakeState(jobId);
  return [...st.readiness.blockers, ...st.releaseBlockers]; // reconfirmation is enforced as a stage blocker so a corrected quote can be re-sent and re-accepted
}

export const OWN_ELECTRICIAN_OFFICE_CHANGE = "To change your own electrician, email Home Insulation Victoria at info@homeinsulationvictoria.com.au — the office makes the change.";

export async function installerIntakeState(jobId: string) {
  const { data: co, error: coErr } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_coordination_chosen").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (coErr) throw new WorkflowError("The job coordination details could not load. Please retry.");
  const coordination = ((co?.details as { coordination?: string } | null)?.coordination ?? null) as "hivic_managed" | "self_managed" | null;
  const [{ data: job, error }, ins, { data: m, error: mErr }, decision, { data: consent, error: cErr }, { count: fee, data: feeRows, error: fErr }, { data: ev, error: evErr }, { data: est, error: estErr }] = await Promise.all([
    admin.from("jobs").select("channel, installer_quoted_price_inc_gst, installer_price_includes, electrician_choice, installer_site_check").eq("id", jobId).single(),
    latestInsulation(jobId),
    admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, supplied_area_m2, provenance, existing_r_value").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    commercialEligibility(jobId),
    admin.from("owner_contact_consents").select("consent_status").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("details, created_at, actor_id", { count: "exact" }).eq("job_id", jobId).eq("event_type", "installer_owner_fee_awareness").order("created_at", { ascending: false }).limit(1),
    admin.from("evidence_requirements").select("category, label, required, status, gate").eq("job_id", jobId).eq("gate", "assessment"), // Ready Check items only — later PIESA/install/AP evidence has its own lists
    admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).in("event_type", ["installer_attendance_answer", "installer_preliminary_estimate"]).order("created_at", { ascending: false }).limit(10),
  ]);
  if (error) throw new WorkflowError(error.message);
  // Fail closed: an unreadable measurement/consent/fee/evidence read is never treated as "nothing missing".
  if (mErr) throw new WorkflowError("The ceiling measurements could not load. Please retry.");
  if (cErr) throw new WorkflowError("The owner contact consent could not load. Please retry.");
  if (fErr || fee == null) throw new WorkflowError("The owner fee declarations could not load. Please retry.");
  if (evErr) throw new WorkflowError("The Ready Check evidence requirements could not load. Please retry.");
  if (estErr) throw new WorkflowError("The preliminary estimate history could not load. Please retry.");
  const scope = intakeScopeArea(m ?? null); const area = scope.areaM2;
  const measuredR = m?.existing_r_value == null ? null : Number(m.existing_r_value);
  const officeEligibility = decision;
  const attended = ((job as { installer_site_check?: string | null }).installer_site_check ?? null) as "yes" | "no" | null;
  const onsiteMeasured = !!(m && (m.verified_area_m2 != null || m.provenance !== "installer_supplied_provisional"));
  // Latest saved preliminary estimate (not attended): unverified, never a measurement; hidden once a measurement exists.
  const estRow = (est ?? []).find((e) => (e.details as Record<string, unknown> | null)?.["preliminary_area_m2"] !== undefined);
  const estV = (estRow?.details as { preliminary_area_m2?: unknown } | undefined)?.preliminary_area_m2;
  const preliminaryAreaM2 = area == null && typeof estV === "number" && estV > 0 ? estV : null;
  const readiness = installerQuoteReadiness({ onsite: { attended, onsiteMeasured }, channel: job.channel, officeEligibility, insulation: ins.value, measuredR, areaM2: area, installerQuoteIncGst: job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst), includes: job.installer_price_includes ?? null });
  const { payerFromChoice } = await import("./installer-intake.core");
  const electricianPayer = payerFromChoice(job.electrician_choice);
  const feeRow = (feeRows ?? [])[0]?.details as { payer?: "hivic" | "own" | "undecided" } | null | undefined;
  // A declaration made before the latest electrician-arrangement change no longer counts (material change).
  const { data: lastChange, error: payerChangeError } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "installer_electrician_payer_changed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (payerChangeError) throw new WorkflowError("The electrician arrangement history could not load. Please retry.");
  const feeAt = (feeRows ?? [])[0]?.created_at ?? null;
  const feeCurrent = (fee ?? 0) > 0 && !(lastChange && feeAt && feeAt < lastChange.created_at);
  // Office-reviewable record of the latest owner fee declaration (who/when/payer/exact wording/version/source).
  const feeLatest = (feeRows ?? [])[0] as { details: Record<string, unknown> | null; created_at: string; actor_id: string | null } | undefined;
  let feeRecord: null | { by: string; actorName: string | null; at: string; payer: "hivic" | "own" | null; wording: string | null; version: string | null; source: string | null; note: string | null; current: boolean; coversCurrentPayer: boolean } = null;
  if (feeLatest) {
    const d = feeLatest.details ?? {};
    const { data: who, error: actorError } = feeLatest.actor_id ? await admin.from("profiles").select("full_name, email").eq("id", feeLatest.actor_id).maybeSingle() : { data: null, error: null };
    if (actorError) throw new WorkflowError("The fee declaration actor details could not load. Please retry.");
    const fp = (d["payer"] === "hivic" || d["payer"] === "own") ? d["payer"] as "hivic" | "own" : null;
    feeRecord = { by: String(d["by"] ?? "unknown"), actorName: who?.full_name || who?.email || null, at: String(d["confirmed_at"] ?? feeLatest.created_at), payer: fp,
      wording: typeof d["wording"] === "string" ? d["wording"] : null, version: typeof d["version"] === "string" ? d["version"] : null, source: typeof d["source"] === "string" ? d["source"] : null,
      note: typeof d["note"] === "string" ? d["note"] : null, current: feeCurrent, coversCurrentPayer: (fp ?? "hivic") === electricianPayer };
  }
  const { data: removalEvent, error: removalError } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "installer_quote_removal_declared").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (removalError) throw new WorkflowError("The quote removal details could not load. Please retry.");
  const removalQuote = readRemoval((removalEvent?.details as { removal_quote?: unknown } | null)?.removal_quote);
  const release = installerQuoteReleaseBlockers({ consentStatus: consent?.consent_status ?? null, feeAwarenessRecorded: feeCurrent, feeAwarenessPayer: feeRow?.payer ?? null, electricianPayer });
  if (removalQuote) release.push(...(removalQuote.answer === "unknown" ? ["Confirm whether the installer quote includes removal before release"] : removalProblems(removalQuote, ins.value, area, job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst))));
  const rc = readyCheckOutstanding((ev ?? []).map((r) => ({ category: r.category, label: r.label, blocking: r.required, status: r.status })) as EvidenceItem[]);
  return {
    coordination, coordinationNext: (await import("./installer-intake.core")).coordinationNextAction(coordination),
    channel: job.channel, insulation: ins.value, insulationSource: ins.source, areaM2: area, areaProvenance: scope.provenance, preliminaryAreaM2, attended, onsiteMeasured,
    removalQuote, proposedR: await latestProposedR(jobId), reconfirmationRequired: await reconfirmationOpen(jobId), measuredR,
    quoteIncGst: job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst), includes: job.installer_price_includes,
    officeEligibility, readiness, releaseBlockers: release, electricianPayer, feeAwarenessPayer: feeRow?.payer ?? null, feeAwarenessRecorded: feeCurrent, feeRecord,
    readyCheck: { outstandingCount: rc.count, outstanding: rc.outstanding.map((i) => ({ label: i.label, status: i.status })) },
  };
}

/** Route-specific commercial path: installer-supplied job may go to quote/PIESA with Ready Check evidence deferred. */
export async function installerIntakeQualified(jobId: string): Promise<boolean> {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
  if (job?.channel !== "installer_sourced") return false;
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_evidence_acknowledged");
  if (!count) return false; // only jobs that came through the approved intake
  const s = await installerIntakeState(jobId);
  return s.readiness.ready && insulationQualifies(s.insulation, s.measuredR);
}

/**
 * Office correction of intake facts (insulation, area, quote amount, inclusions, proposed product). Any change makes
 * the earlier eligibility decision stale; draft quotes are superseded, issued quotes withdrawn, and an ACCEPTED quote
 * is never repriced — it is flagged for owner reconfirmation instead.
 */
export async function correctInstallerIntake(jobId: string, actorId: string, p: { insulation?: ExistingInsulation | undefined; quoteIncGst?: number | null | undefined; includes?: string | null | undefined; areaM2?: number | undefined; proposedR?: number | null | undefined; reason: string }) {
  const { data: job } = await admin.from("jobs").select("channel").eq("id", jobId).single();
  if (job?.channel !== "installer_sourced") throw new WorkflowError("Only installer-supplied jobs use this correction.");
  if (!p.reason.trim()) throw new WorkflowError("Give a reason for the correction.");
  const upd: { installer_quoted_price_inc_gst?: number | null; installer_price_includes?: string | null } = {};
  if (p.quoteIncGst !== undefined) upd.installer_quoted_price_inc_gst = p.quoteIncGst;
  if (p.includes !== undefined) upd.installer_price_includes = p.includes;
  if (Object.keys(upd).length) { const { error } = await admin.from("jobs").update(upd).eq("id", jobId); if (error) throw new WorkflowError(error.message); }
  if (p.areaM2 !== undefined) {
    if (!(p.areaM2 > 0 && p.areaM2 <= 5000)) throw new WorkflowError("Check the ceiling area.");
    // Only the provisional installer-supplied figure is corrected; a measured/verified area is never overwritten here.
    const { data: m } = await admin.from("ceiling_measurements").select("id, provenance").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    if (!m || m.provenance !== "installer_supplied_provisional") throw new WorkflowError("The area has already been measured — change it through the measurement review.");
    const { error } = await admin.from("ceiling_measurements").update({ supplied_area_m2: p.areaM2 }).eq("id", m.id);
    if (error) throw new WorkflowError(error.message);
  }
  const { data: quotes } = await admin.from("quotes").select("id, status").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  const touched: { id: string; action: string }[] = [];
  for (const q of quotes ?? []) {
    const a = staleQuoteAction(q.status);
    if (a === "supersede" || a === "withdraw") {
      const { error } = await admin.from("quotes").update({ status: "superseded", release_state: "held", release_hold_reason: "Withdrawn: intake facts corrected" }).eq("id", q.id).eq("status", q.status);
      if (error) throw new WorkflowError(error.message);
    }
    if (a !== "keep") touched.push({ id: q.id, action: a });
  }
  await logEvent(jobId, actorId, "installer_intake_corrected", `Office corrected intake facts: ${p.reason.trim()}`, { insulation: p.insulation ?? null, quote_inc_gst: p.quoteIncGst ?? null, includes: p.includes ?? null, area_m2: p.areaM2 ?? null, ...(p.proposedR !== undefined ? { proposed_r_value: p.proposedR } : {}), quotes: touched }, { internal: true });
  if (touched.some((t) => t.action === "reconfirm")) await logEvent(jobId, actorId, "installer_quote_reconfirmation_required", "Accepted quote facts changed — the owner must reconfirm before work continues", { quotes: touched.filter((t) => t.action === "reconfirm").map((t) => t.id) }, { internal: true });
  return { superseded: touched.filter((t) => t.action !== "reconfirm").length, reconfirm: touched.some((t) => t.action === "reconfirm") };
}

export async function recordOfficeFeeAwareness(jobId: string, actorId: string, note: string) {
  if (!note.trim()) throw new WorkflowError("Say how the owner was told about the fees.");
  // Explicit payer + exact wording for the CURRENT electrician arrangement (never a generic record that could clear
  // an own-electrician job with the HIV PIESA wording).
  const st = await installerIntakeState(jobId);
  const { feeAwarenessText, FEE_AWARENESS_VERSION } = await import("./installer-intake.core");
  const payer = st.electricianPayer;
  const wording = feeAwarenessText(payer);
  if (!wording || payer === "undecided") throw new WorkflowError("Record who arranges the electrician first — the owner's fees depend on it.");
  await logEvent(jobId, actorId, "installer_owner_fee_awareness", payer === "own" ? "Office recorded that the owner was advised of the $349 AP management fee and that their own electrician invoices them separately" : "Office recorded that the owner was advised of the $349 PIESA fee and $349 AP management fee", { by: "office", source: "office_job_page", payer, wording, version: FEE_AWARENESS_VERSION, note: note.trim(), confirmed_at: new Date().toISOString(), not_owner_paperwork: true }, { internal: true });
}

/** Office "Prepare owner quote" from the intake facts. Always a held draft; dedups on identical figures. */
export async function draftQuoteFromIntake(jobId: string, actorId: string) {
  const s = await installerIntakeState(jobId);
  if (!s.readiness.ready) throw new WorkflowError(s.readiness.blockers.join(" • "));
  const { draftInstallerQuoteFromReadyCheck } = await import("./installer-quote.server");
  return draftInstallerQuoteFromReadyCheck(jobId, actorId, [], `intake:${jobId}`, { totalIncGst: s.quoteIncGst!, includes: s.includes ?? "As quoted by the installer", areaM2: s.areaM2! });
}

/** Draft quotes superseded, issued withdrawn, accepted flagged for owner reconfirmation (never repriced). */
async function staleIntakeQuotes(jobId: string, actorId: string) {
  const { data: quotes } = await admin.from("quotes").select("id, status").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  const touched: { id: string; action: string }[] = [];
  for (const q of quotes ?? []) {
    const a = staleQuoteAction(q.status);
    if (a === "supersede" || a === "withdraw") {
      const { error } = await admin.from("quotes").update({ status: "superseded", release_state: "held", release_hold_reason: "Withdrawn: installer updated job details" }).eq("id", q.id).eq("status", q.status);
      if (error) throw new WorkflowError(error.message);
    }
    if (a !== "keep") touched.push({ id: q.id, action: a });
  }
  if (touched.some((t) => t.action === "reconfirm")) await logEvent(jobId, actorId, "installer_quote_reconfirmation_required", "Accepted quote facts changed — the owner must reconfirm before work continues", { quotes: touched.filter((t) => t.action === "reconfirm").map((t) => t.id) }, { internal: true });
  return touched;
}

export type InstallerIntakeUpdate = {
  areaM2: number | null; insulation: ExistingInsulation; quoteStatus: "not_quoted" | "have_quote";
  quoteIncGst: number | null; includes: string | null; proposedR: number | null;
  /** Explicit attendance answer; omitted/null = unchanged (never inferred from price, area or files). */
  attended?: "attended" | "not_attended" | null | undefined; attendedOn?: string | null | undefined;
  removalQuote?: RemovalQuote;
  files: { path: string; name: string; type: string }[];
  electrician?: { mode: "mine"; business_id?: string | null; nomination_id?: string | null } | undefined;
  /** Who arranges/pays the electrician: HIV ($349 on quote) / own (direct billing, needs `electrician`) / to be arranged. */
  electricianPayer?: "hivic" | "own" | "undecided" | undefined;
  /** Installer declares (later, on the same job) the owner was advised of the fees for the CURRENT electrician payer. */
  feeAwareness?: { payer: "hivic" | "own"; text: string } | undefined;
};

/**
 * The SUPPLYING installer adds/updates what they know on their own received job (area, quote, product, insulation,
 * electrician, quote files). Same job, canonical records: provisional installer area (never accepted/verified),
 * jobs quote facts, appended original files. Saved partial info is NOT an accepted measurement or Ready Check approval.
 * Only actual material changes stale quotes; only an insulation change reopens the office eligibility decision.
 */
export async function installerUpdateIntake(jobId: string, actorId: string, businessId: string, p: InstallerIntakeUpdate) {
  const { pickIntakeChanges } = await import("./installer-intake.core");
  const { data: job, error } = await admin.from("jobs").select("channel, originating_installer_business_id, installer_site_check, installer_site_check_date, installer_quoted, installer_quoted_price_inc_gst, installer_price_includes, electrician_choice").eq("id", jobId).single();
  if (error || !job) throw new WorkflowError("Job not found.");
  if (job.channel !== "installer_sourced" || job.originating_installer_business_id !== businessId) throw new WorkflowError("Only the installer who supplied this job can update it.");
  if (!(await isIntakeJob(jobId))) throw new WorkflowError("This job wasn't added through Add job.");
  for (const f of p.files) if (!f.path.startsWith(`partners/${businessId}/`)) throw new WorkflowError("That file isn't one of your uploads.");
  const st = await installerIntakeState(jobId);
  const ic0 = await import("./installer-intake.core");
  const curAttended = ic0.attendanceFromSiteCheck(job.installer_site_check as string | null);
  const nextAttended = p.attended ?? curAttended;
  { const dp = p.attended === "attended" ? ic0.visitDateProblem(p.attendedOn ?? null, ic0.melbourneToday()) : null; if (dp) throw new WorkflowError(dp); } // never silently drop an entered date
  // Removal facts are site facts: kept on "quote not yet" when the property was attended; only the charge is commercial.
  const nextRemoval = p.removalQuote === undefined ? st.removalQuote : p.quoteStatus === "not_quoted" ? (nextAttended === "attended" ? ((r) => r ? { ...r, chargeIncGst: null } : null)(readRemoval(p.removalQuote)) : { answer: "unknown" as const, areaM2: null, chargeIncGst: null }) : readRemoval(p.removalQuote);
  if (nextRemoval) { const problems = removalProblems(nextRemoval, p.insulation, p.areaM2 ?? st.areaM2, p.quoteIncGst, p.quoteStatus === "have_quote"); if (problems.length) throw new WorkflowError(problems.join(" • ")); }
  const removalChanged = p.removalQuote !== undefined && JSON.stringify(nextRemoval) !== JSON.stringify(st.removalQuote);
  // ---- Validate the electrician/payer change and fee declaration BEFORE any write (no misleading partial saves). ----
  const { planPayerChange } = await import("./installer-intake.core");
  const requestedPayer = p.electricianPayer ?? (p.electrician && (p.electrician.business_id || p.electrician.nomination_id) && st.electricianPayer !== "own" ? "own" : undefined);
  const { count: elAccepted, error: elErr } = await admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  if (elErr) throw new WorkflowError("The electrician arrangement could not be checked. Please retry.");
  const pc = planPayerChange({ currentPayer: st.electricianPayer, requested: requestedPayer, electricianAccepted: (elAccepted ?? 0) > 0, fee: p.feeAwareness });
  if (!pc.ok) throw new WorkflowError(pc.error);
  if (pc.change) {
    if (pc.nextPayer === "own") {
      const e = p.electrician;
      if (!e || !(e.business_id || e.nomination_id)) throw new WorkflowError("Choose your electrician.");
      if (e.business_id) { const { data: rel } = await admin.from("partner_relationships").select("electrician_business_id").eq("installer_business_id", businessId).eq("electrician_business_id", e.business_id).eq("active", true).maybeSingle(); if (!rel) throw new WorkflowError("That electrician isn't one of your approved electricians."); }
      else { const { data: n } = await admin.from("electrician_nominations").select("id").eq("id", e.nomination_id!).eq("nominating_business_id", businessId).maybeSingle(); if (!n) throw new WorkflowError("That electrician couldn't be found. Add them again."); }
    }
    const lock = await intakePayerLock(jobId, st.electricianPayer, actorId, businessId);
    if (lock) throw new WorkflowError(lock);
  }
  // Own -> a different own electrician has no atomic swap yet: refused (never silently "Saved"); Office changes it.
  if (!pc.change && st.electricianPayer === "own" && p.electrician && (p.electrician.business_id || p.electrician.nomination_id))
    throw new WorkflowError(OWN_ELECTRICIAN_OFFICE_CHANGE);
  const { data: m, error: mErr } = await admin.from("ceiling_measurements").select("id, provenance, supplied_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (mErr) throw new WorkflowError("The current measurement could not load. Please retry.");
  // Not attended and no measurement: an entered area is a PRELIMINARY estimate (event only), never a measure-up.
  const estimateMode = nextAttended !== "attended" && !m;
  const ch = pickIntakeChanges({
    areaM2: estimateMode ? st.preliminaryAreaM2 : m?.supplied_area_m2 == null ? (st.areaM2 ?? null) : Number(m.supplied_area_m2), insulation: st.insulation, quoted: (job.installer_quoted ?? null) as "yes" | "no" | null,
    quoteIncGst: job.installer_quoted_price_inc_gst == null ? null : Number(job.installer_quoted_price_inc_gst), includes: job.installer_price_includes ?? null, proposedR: st.proposedR,
  }, p);
  let estimateChanged = false;
  if (ch.area !== undefined && estimateMode) {
    await logEvent(jobId, actorId, "installer_preliminary_estimate", `Installer saved a preliminary ceiling estimate of ${ch.area} m² (not visited, unverified)`, { preliminary_area_m2: ch.area, previous: st.preliminaryAreaM2, verified: false, source: "installer_edit" }, { internal: true });
    estimateChanged = true; delete ch.area;
  }
  if (ch.area !== undefined) {
    if (m && m.provenance !== "installer_supplied_provisional") throw new WorkflowError("The ceiling has already been measured — the office changes it through the measurement review.");
    if (m) { const { error: e } = await admin.from("ceiling_measurements").update({ supplied_area_m2: ch.area }).eq("id", m.id); if (e) throw new WorkflowError(e.message); }
    else {
      const { planImportedMeasurement } = await import("./pilot.core");
      const plan = planImportedMeasurement({ measured_area_m2: ch.area, measurement_method: "Installer supplied (unverified)" } as never, `installer_edit:${jobId}:${Date.now()}`, { businessId, standardApproved: false })!;
      const { error: e } = await admin.from("ceiling_measurements").insert({ ...plan, supplied_snapshot: plan.supplied_snapshot as never, review_flags: plan.review_flags as never, job_id: jobId, is_current: true, created_by: actorId, raw_snapshot: { source: "installer_edit" } as never });
      if (e) throw new WorkflowError(`Measurement: ${e.message}`);
      await admin.from("jobs").update({ measure_up_responsibility: "installer" }).eq("id", jobId);
    }
    await admin.from("jobs").update({ estimated_area_m2: ch.area, estimated_area_unknown: false }).eq("id", jobId);
  }
  if ((p.attended && p.attended !== curAttended) || (p.attended === "attended" && p.attendedOn !== undefined && ic0.attendedOnDate("attended", p.attendedOn, ic0.melbourneToday()) !== (job.installer_site_check_date ?? null))) {
    const on = ic0.attendedOnDate(p.attended, p.attendedOn ?? (p.attended === curAttended ? job.installer_site_check_date as string | null : null), ic0.melbourneToday());
    const { error: e } = await admin.from("jobs").update({ installer_site_check: ic0.siteCheckFromAttendance(p.attended), installer_site_check_date: on }).eq("id", jobId);
    if (e) throw new WorkflowError(e.message);
    await logEvent(jobId, actorId, "installer_attendance_answer", p.attended === "attended" ? "Installer answered: attended and assessed the property" : "Installer answered: not attended yet — Ready Check required", { answer: p.attended, previous: curAttended, attended_on: on, reported_by: actorId, source: "installer_edit" }, { internal: true });
  }
  { const prev = (await intakeQuoteAnswers([jobId])).get(jobId) ?? null;
    if (prev !== p.quoteStatus) await logEvent(jobId, actorId, "installer_quote_answer", p.quoteStatus === "have_quote" ? "Installer answered: quote prepared" : "Installer answered: quote not prepared yet", { answer: p.quoteStatus, previous: prev, source: "installer_edit" }, { internal: true }); }
  if (ch.quote) { const { error: e } = await admin.from("jobs").update({ installer_quoted: ch.quote.quoted, installer_quoted_price_inc_gst: ch.quote.quoteIncGst, installer_price_includes: ch.quote.includes }).eq("id", jobId); if (e) throw new WorkflowError(e.message); }
  if (p.files.length) {
    const { data: imp } = await admin.from("job_imports").select("id, files").eq("job_id", jobId).eq("business_id", businessId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!imp) throw new WorkflowError("The original job record couldn't be found to attach the file.");
    const have = (imp.files as { path: string }[] | null) ?? [];
    const add = p.files.filter((f) => !have.some((h) => h.path === f.path));
    if (add.length) { const { error: e } = await admin.from("job_imports").update({ files: [...have, ...add] as never }).eq("id", imp.id); if (e) throw new WorkflowError(e.message); }
    if (add.length) await logEvent(jobId, actorId, "installer_quote_file_added", `Installer added ${add.length} file${add.length === 1 ? "" : "s"} (originals kept)`, { files: add }, { internal: true });
  }
  let electrician: string | null = null;
  if (pc.change) {
    const now = new Date().toISOString();
    if (pc.nextPayer === "own") electrician = (await (await import("./job-electrician.server")).recordJobElectricianChoice(jobId, businessId, p.electrician as never, actorId)).choice ?? null;
    else if (pc.nextPayer === "hivic") { await (await import("./job-electrician.server")).applyHivicArrangement(jobId, actorId); electrician = "hivic_organise"; }
    else {
      await admin.from("electrician_nominations").update({ ended_at: now, updated_at: now }).eq("job_id", jobId).is("ended_at", null);
      const { error: e } = await admin.from("jobs").update({ electrician_choice: null, next_action: "Electrician to be arranged" }).eq("id", jobId);
      if (e) throw new WorkflowError(e.message);
      electrician = "undecided";
    }
    await logEvent(jobId, actorId, "installer_electrician_payer_changed", `Installer changed the electrician arrangement: ${st.electricianPayer} → ${pc.nextPayer}`, { from: st.electricianPayer, to: pc.nextPayer, choice: electrician }, { internal: true });
    if (st.feeAwarenessRecorded && !p.feeAwareness) await logEvent(jobId, actorId, "installer_owner_fee_awareness_invalidated", "Earlier owner fee declaration no longer covers the new electrician arrangement — a new declaration is needed", { previous_payer: st.feeAwarenessPayer, new_payer: pc.nextPayer }, { internal: true });
  }
  let feeRecorded = false;
  if (p.feeAwareness) {
    const { FEE_AWARENESS_VERSION } = await import("./installer-intake.core");
    const payer = pc.nextPayer;
    await logEvent(jobId, actorId, "installer_owner_fee_awareness", payer === "own" ? "Installer declared the owner was advised of the $349 AP management fee and that their own electrician invoices them separately" : "Installer declared the owner was advised of the $349 PIESA fee and $349 AP management fee", { by: "installer", source: "installer_job_page", payer, wording: p.feeAwareness.text, version: FEE_AWARENESS_VERSION, confirmed_at: new Date().toISOString(), not_owner_paperwork: true }, { internal: true });
    feeRecorded = true;
  }
  if (removalChanged && nextRemoval) await logEvent(jobId, actorId, "installer_quote_removal_declared", removalSummary(nextRemoval), { removal_quote: nextRemoval, source: "installer_edit", verified: false, included_in_total: true }, { internal: true });
  // A payer change is material: it changes the owner quote's lines (HIV PIESA line on/off).
  const attendanceChanged = nextAttended !== curAttended;
  const material = attendanceChanged || estimateChanged || ch.area !== undefined || !!ch.quote || ch.proposedR !== undefined || ch.insulation !== undefined || pc.change || removalChanged;
  let quotes: { id: string; action: string }[] = [];
  if (material) {
    quotes = await staleIntakeQuotes(jobId, actorId);
    const details = { by: "installer", area_m2: ch.area ?? null, quote: ch.quote ?? null, ...(ch.proposedR !== undefined ? { proposed_r_value: ch.proposedR } : {}), quotes, partial: true, note: "Saved details only — not an accepted measurement or Ready Check approval" };
    if (ch.insulation !== undefined) await logEvent(jobId, actorId, "installer_intake_corrected", `Installer updated existing insulation to ${ch.insulation === "none" ? "none" : ch.insulation === "below_r2" ? "confirmed below R2.0" : "not yet confirmed"}`, { ...details, insulation: ch.insulation }, { internal: true });
    else await logEvent(jobId, actorId, "installer_intake_updated", "Installer updated job details", details, { internal: true });
  }
  // Payer change: prepare a fresh held draft at the current lines when the commercial facts are ready (never sent here).
  if (pc.change) { const s2 = await installerIntakeState(jobId); if (s2.readiness.ready && pc.nextPayer !== "undecided") await draftQuoteFromIntake(jobId, actorId).catch(() => null); }
  return { changed: material || p.files.length > 0 || !!electrician || feeRecorded, quotes: quotes.length, state: await installerIntakeState(jobId) };
}

/** Canonical explicit quote answer per job (see resolveQuoteAnswer). */
export async function intakeQuoteAnswers(jobIds: string[]): Promise<Map<string, "have_quote" | "not_quoted" | null>> {
  const out = new Map<string, "have_quote" | "not_quoted" | null>();
  if (!jobIds.length) return out;
  const { resolveQuoteAnswer } = await import("./installer-intake.core");
  const [{ data: ev, error: answerError }, { data: jobs, error: jobsError }] = await Promise.all([
    admin.from("workflow_events").select("job_id, created_at, details").in("job_id", jobIds).eq("event_type", "installer_quote_answer"),
    admin.from("jobs").select("id, installer_quoted").in("id", jobIds),
  ]);
  if (answerError || jobsError) throw new WorkflowError("The installer quote answers could not load. Please retry.");
  for (const j of jobs ?? []) out.set(j.id, resolveQuoteAnswer((ev ?? []).filter((e) => e.job_id === j.id).map((e) => ({ answer: (e.details as { answer?: unknown } | null)?.answer, at: e.created_at })), j.installer_quoted));
  return out;
}

/**
 * The one lock for an Add job electrician arrangement (editor DTO and save both use it). Shared payerChangeBlocker
 * (accepted electrician / raised invoice) plus: an own-electrician choice stays committed once the owner has accepted
 * a quote, and only the business admin may correct an own choice. Current payer alone is never a lock.
 */
export async function intakePayerLock(jobId: string, currentPayer: string, userId: string, businessId: string): Promise<string | null> {
  const base = await (await import("./job-electrician.server")).payerChangeBlocker(jobId);
  if (base) return base;
  if (currentPayer !== "own") return null;
  const { count: acc } = await admin.from("quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted");
  if (acc) return "The owner has accepted a quote with your own electrician. To change it, email Home Insulation Victoria at info@homeinsulationvictoria.com.au.";
  const { data: mem } = await admin.from("business_members").select("member_role").eq("business_id", businessId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (mem?.member_role !== "business_admin") return "Only your business owner can change your own electrician.";
  return null;
}
