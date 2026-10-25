import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

// Admin-only: the auto-drafted owner quote from an installer's Ready Check, and the office "send" step.
export const getInstallerQuoteDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: job, error: je } = await admin.from("jobs").select("channel").eq("id", data.jobId).single();
    if (je) throw new Error(je.message);
    const [{ data: q, error }, { data: held, error: he }] = await Promise.all([
      admin.from("quotes").select("id, status, sent_at, option_code, release_state, release_hold_reason, discount_note, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, cobrand, created_at, quote_items(id, code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)")
        .eq("job_id", data.jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("workflow_events").select("details, created_at").eq("job_id", data.jobId).in("event_type", ["installer_quote_held", "ready_check_needs_office"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (he) throw new Error("Quote holds could not be checked.");
    const heldNewer = held && (!q || held.created_at > q.created_at);
    const reviewable = q ? (await import("./office-quote-review.core")).quoteNeedsOfficeReview(q) : false;
    const blockers = q && reviewable ? await (await import("./office-quote-review.server")).officeQuoteBlockers(data.jobId, q) : [];
    return {
      applies: true as const,
      quote: q ? { ...q, quote_items: [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort) } : null,
      heldBlockers: [...new Set([...blockers, ...(heldNewer ? (((held.details as { blockers?: string[]; reasons?: string[] } | null)?.blockers) ?? (held.details as { reasons?: string[] } | null)?.reasons ?? []) : [])])],
      channel: job.channel,
      reviewable,
    };
  });

export const sendInstallerQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-quote-review.server")).sendOfficeReviewedQuote(data.jobId, data.quoteId, context.userId);
  });

// ---- Approved installer intake (Jo, 8 Oct 2026): office review of the short intake. Admin only. ----
export const getInstallerIntake = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { installerIntakeState } = await import("./installer-intake.server");
    return installerIntakeState(data.jobId);
  });

export const officeIntakeAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.discriminatedUnion("action", [
    z.object({ action: z.literal("eligibility"), jobId: z.string().uuid(), outcome: z.enum(["eligible", "not_eligible"]), reason: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("correct"), jobId: z.string().uuid(), insulation: z.enum(["none", "below_r2", "unknown"]).optional(), quoteIncGst: z.number().positive().max(1_000_000).nullable().optional(), includes: z.string().trim().max(1000).nullable().optional(), areaM2: z.number().positive().max(5000).optional(), proposedR: z.number().positive().max(10).nullable().optional(), reason: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("fee_awareness"), jobId: z.string().uuid(), note: z.string().trim().min(1).max(1000) }),
    z.object({ action: z.literal("draft_quote"), jobId: z.string().uuid() }),
  ]).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const m = await import("./installer-intake.server");
    if (data.action === "eligibility") await m.recordCommercialEligibility(data.jobId, context.userId, data.outcome, data.reason);
    else if (data.action === "correct") await m.correctInstallerIntake(data.jobId, context.userId, { insulation: data.insulation, quoteIncGst: data.quoteIncGst, includes: data.includes, areaM2: data.areaM2, proposedR: data.proposedR, reason: data.reason });
    else if (data.action === "fee_awareness") await m.recordOfficeFeeAwareness(data.jobId, context.userId, data.note);
    else await m.draftQuoteFromIntake(data.jobId, context.userId);
    return m.installerIntakeState(data.jobId);
  });

// Installer's own job: the Ready Check outstanding list (business-scoped via job assignment).
export const getMyIntakeReadyCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { installerIntakeState } = await import("./installer-intake.server");
    const s = await installerIntakeState(data.jobId);
    const { loadRcDraft } = await import("./ready-check-draft.server");
    const d = await loadRcDraft(data.jobId);
    return { coordination: s.coordination, readyCheck: { outstandingCount: d.progress.outstandingCount, outstanding: [] as { label: string; status: string }[] }, quoteHeldFor: s.readiness.blockers.filter((b) => /insulation|eligib/i.test(b)) };
  });

// ---- Supplying installer: add/update what they know on their own received job (Jo, 8 Oct). ----
/** An installer who can access this job (assigned or supplying). Does NOT require the supplying business. */
async function requireJobInstaller(supabase: { rpc: (...a: never[]) => unknown }, userId: string, jobId: string) {
  const sb = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const { data: ok, error } = await sb.rpc("can_access_job", { _job: jobId });
  if (error || !ok) throw new Error("Not your job.");
  const { data: inst } = await sb.rpc("has_role", { _user_id: userId, _role: "installer" });
  if (!inst) throw new Error("Only installers can update this job.");
  return sb;
}

async function requireSupplyingInstaller(supabase: { rpc: (...a: never[]) => unknown }, userId: string, jobId: string): Promise<string> {
  const sb = await requireJobInstaller(supabase, userId, jobId);
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: job } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
  const biz = job?.originating_installer_business_id;
  if (!biz) throw new Error("Only the installer who supplied this job can update it.");
  const { data: mem } = await sb.rpc("is_business_member", { _biz: biz });
  if (!mem) throw new Error("Only the installer who supplied this job can update it.");
  return biz;
}

export const getMyIntakeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const biz = await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);
    const m = await import("./installer-intake.server");
    if (!(await m.isIntakeJob(data.jobId))) return { applies: false as const };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [s, { data: imp }, { data: job }] = await Promise.all([
      m.installerIntakeState(data.jobId),
      admin.from("job_imports").select("files").eq("job_id", data.jobId).eq("business_id", biz).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      admin.from("jobs").select("installer_quoted, electrician_choice, installer_site_check, installer_site_check_date").eq("id", data.jobId).single(),
    ]);
    // The SAVED own-electrician selection, so the editor preselects it instead of a blank chooser.
    const { data: nom } = await admin.from("electrician_nominations").select("business_id, contact_name").eq("job_id", data.jobId).is("ended_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const currentElectrician = s.electricianPayer === "own" && nom ? { businessId: (nom.business_id as string | null) ?? null, name: (nom.contact_name as string | null) ?? "Your electrician" } : null;
    const payerLock = await m.intakePayerLock(data.jobId, s.electricianPayer, context.userId, biz);
    const quoteAnswer = (await m.intakeQuoteAnswers([data.jobId])).get(data.jobId) ?? null;
    return { applies: true as const, businessId: biz, areaM2: s.areaM2, preliminaryAreaM2: s.preliminaryAreaM2, areaProvenance: s.areaProvenance, insulation: s.insulation, quoted: (job?.installer_quoted ?? null) as "yes" | "no" | null, quoteAnswer, attended: (await import("./installer-intake.core")).attendanceFromSiteCheck(job?.installer_site_check as string | null), attendedOn: (job?.installer_site_check_date as string | null) ?? null, quoteIncGst: s.quoteIncGst, includes: s.includes, proposedR: s.proposedR, removalQuote: s.removalQuote, commercial: s.commercial, removalText: s.removalText, files: ((imp?.files as { path: string; name: string; type: string; purpose?: unknown }[] | null) ?? []).map((f) => ({ path: f.path, name: f.name, type: f.type, purpose: f.purpose === "quote" || f.purpose === "supporting" ? f.purpose : null })), electricianChosen: s.electricianPayer !== "undecided", payerEditable: !payerLock, payerLockReason: payerLock, currentElectrician, quoteHeld: [...s.readiness.blockers, ...s.releaseBlockers.filter((b) => !/contact consent/.test(b))], electricianPayer: s.electricianPayer, feeAwarenessCurrent: s.feeAwarenessRecorded && (s.feeAwarenessPayer ?? "hivic") === s.electricianPayer };
  });

export const saveMyIntakeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), areaM2: z.number().positive().max(5000).nullable(), insulation: z.enum(["none", "below_r2", "unknown"]),
    quoteStatus: z.enum(["not_quoted", "have_quote"]), quoteIncGst: z.number().positive().max(1_000_000).nullable(), includes: z.string().trim().max(1000).nullable(), proposedR: z.number().positive().max(10).nullable(),
    attended: z.enum(["attended", "not_attended"]).nullish(), attendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    files: z.array(z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100), purpose: z.enum(["quote", "supporting"]).optional() })).max(20),
    electrician: z.object({ mode: z.literal("mine"), business_id: z.string().uuid().nullish(), nomination_id: z.string().uuid().nullish() }).optional(),
    electricianPayer: z.enum(["hivic", "own", "undecided"]).optional(),
    removalQuote: z.object({ answer: z.enum(["yes", "no", "unknown"]), areaM2: z.number().positive().max(5000).nullable(), chargeIncGst: z.number().min(0).max(1_000_000).nullable() }).optional(),
    commercial: z.object({ basis: z.enum(["before_discount", "after_discount", "unsure"]).nullable(), gst: z.enum(["inc_gst", "ex_gst", "unsure"]).nullable(), inclusions: z.string().trim().max(1000).nullable(), exclusions: z.string().trim().max(1000).nullable(), originalStatus: z.enum(["prepared", "sent", "accepted_by_customer"]).nullable(), removalPricing: z.enum(["included", "additional", "not_priced"]).nullable(), removalAmountIncGst: z.number().min(0).max(1_000_000).nullable(), extras: z.array(z.object({ description: z.string().trim().min(1).max(300), pricing: z.enum(["included", "additional", "not_priced"]), amountIncGst: z.number().min(0).max(1_000_000).nullable() })).max(20) }).optional(),
    feeAwareness: z.object({ payer: z.enum(["hivic", "own"]), text: z.string().max(400) }).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const biz = await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);
    const { installerUpdateIntake } = await import("./installer-intake.server");
    const { jobId, ...p } = data;
    try { const r = await installerUpdateIntake(jobId, context.userId, biz, p as never); return { changed: r.changed, quoteHeld: [...r.state.readiness.blockers, ...r.state.releaseBlockers.filter((b) => !/contact consent/.test(b))] }; }
    catch (e) { throw new Error(e instanceof Error ? e.message : "Couldn't save."); }
  });

/** Installer job page progress (intake jobs only). Supplying-installer scoped; read-only. */
export const getMyIntakeProgress = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // D-1: any installer with access may learn "not an intake job" (Home Insulation Victoria-sourced jobs then show the
    // normal status card); the supplying-installer restriction applies only to installer-sourced (intake) jobs.
    await requireJobInstaller(context.supabase as never, context.userId, data.jobId);
    const m = await import("./installer-intake.server");
    if (!(await m.isIntakeJob(data.jobId))) return { applies: false as const };
    await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const id = data.jobId;
    const [s, jobR, qsR, prR, bksR, evR, apR, veecR, dlR] = await Promise.all([
      m.installerIntakeState(id),
      admin.from("jobs").select("stage, installer_quoted, installer_site_check, installation_completed_at").eq("id", id).single(),
      admin.from("quotes").select("status, created_at, release_state, release_hold_reason, sent_at").eq("job_id", id).eq("kind", "installation"),
      admin.from("piesa_records").select("outcome, signed_off_by, created_at").eq("job_id", id).eq("is_current", true).limit(1).maybeSingle(),
      admin.from("bookings").select("kind, status, scheduled_start, created_at").eq("job_id", id).neq("status", "cancelled").order("created_at", { ascending: false }),
      admin.from("evidence_requirements").select("label, status, responsible_role, gate, verified_at, category").eq("job_id", id).eq("required", true),
      admin.from("workflow_events").select("created_at").eq("job_id", id).eq("event_type", "ap_approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("veec_lodgements").select("status").eq("job_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("job_piesa_deadlines").select("piesa_expired").eq("job_id", id).maybeSingle(),
    ]);
    const core = await import("./installer-progress.core");
    const job = core.requireJobRead(jobR);
    core.requireReads([qsR, prR, bksR, evR, apR, veecR, dlR]);
    const { data: qs } = qsR, { data: pr } = prR, { data: bks } = bksR, { data: evAll } = evR, { data: ap } = apR, { data: veec } = veecR, { data: dl } = dlR;
    // Decision 396: rows the retired install-day photo chase created are not missing evidence.
    const ev = (await import("./ready-check-chase.core")).withoutRetiredInstallDayPhotos(evAll ?? []);
    const { evidenceApplicability } = await import("./operations-preview.core");
    const stage = job?.stage ?? "";
    const book = (k: string) => (bks ?? []).find((b) => b.kind === k) ?? null;
    const inst = book("installation"); const installedAt = job?.installation_completed_at ?? (bks ?? []).find((b) => b.kind === "installation" && b.status === "completed")?.scheduled_start ?? null;
    const piesaDone = pr?.outcome === "pass" && !!pr.signed_off_by;
    const facts = { id, stage, createdAt: "", lastActivityAt: null, enteredStageAt: null, installedAt, installBookingAt: inst?.scheduled_start ?? null,
      elecBookingAt: book("assessment")?.scheduled_start ?? null, rcBookingAt: book("ready_check")?.scheduled_start ?? null,
      piesa: pr ? { completedAt: piesaDone ? pr.created_at : null, passed: pr.outcome === "pass", sectionCAt: null } : null } as never;
    const now = Date.now();
    const evidence = (ev ?? []).map((e) => ({ label: e.label, status: e.status, role: e.responsible_role, applicability: evidenceApplicability(e.gate, facts, now) }));
    const lastVerifiedAt = (ev ?? []).map((e) => e.verified_at).filter(Boolean).sort().pop() ?? null;
    const q = core.currentQuote(qs ?? []);
    const installBlockers = inst && inst.status === "confirmed" ? (await (await import("./esc.server")).installReadiness(id).catch(() => ({ blockers: ["Installation readiness could not be checked"] }))).blockers : [];
    const answer = (await m.intakeQuoteAnswers([id])).get(id) ?? null;
    const prog = core.installerProgress({
      coordination: s.coordination, quoted: answer === "have_quote" ? "yes" : answer === "not_quoted" ? "no" : null,
      attended: ((job as { installer_site_check?: string | null } | null)?.installer_site_check ?? null) as "yes" | "no" | null,
      quoteAmountKnown: s.quoteIncGst != null,
      eligibility: await m.commercialEligibility(id),
      quoteHeld: [...s.readiness.blockers, ...s.releaseBlockers.filter((b: string) => !/contact consent/.test(b))],
      quoteStatus: q.status, quoteDelivery: q.delivery, quoteHoldReason: q.row?.release_hold_reason ?? null,
      reconfirmationRequired: !!s.reconfirmationRequired, electricianPayer: s.electricianPayer,
      electricalCleared: piesaDone, electricalExpired: !!dl?.piesa_expired,
      rectificationOpen: ["rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked", "electrical_variation_pending"].includes(stage),
      installBooking: inst ? { status: inst.status, start: inst.scheduled_start } : null, installBlockers,
      installationCompleted: !!installedAt, evidence,
      evidenceApprovedAt: core.apApprovalCurrent({ stage, approvedAt: ap?.created_at ?? null, evidence, lastVerifiedAt }) ? ap!.created_at : null,
      veecStatus: veec?.status ?? null, stage, now,
    });
    // Open "Site conditions differ" hold outranks every other next action until the office reviews it.
    const next = s.siteHold.open ? { who: "Home Insulation Victoria" as const, text: `Site conditions differ — the office is reviewing${s.siteHold.note ? ` (${s.siteHold.note})` : ""}. The quote and works are on hold until then.` } : prog.next;
    const { missingTasks } = await import("./installer-missing-tasks.core");
    const { SITE_HOLD_BLOCKER } = await import("./site-conditions.core");
    const worksBlockers = await (await import("./ready-check-draft.server")).rcWorksBlockers(id); // throws on read failure (fail closed)
    const missing = missingTasks({ quoteBlockers: [...s.readiness.blockers, ...s.releaseBlockers.filter((b: string) => !/contact consent/.test(b))], worksBlockers,
      siteHoldBlocker: s.siteHold.open ? (s.siteHold.note ? `${SITE_HOLD_BLOCKER}: ${s.siteHold.note}` : SITE_HOLD_BLOCKER) : null,
      evidence: (ev ?? []).map((e) => ({ label: e.label, status: e.status, gate: e.gate })) });
    return { applies: true as const, ...prog, next, siteHold: s.siteHold, missing };
  });

/** Supplying installer flags "Site conditions differ". Holds quote release/acceptance and start of works until office review. */
export const raiseSiteConditionsHold = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), note: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);
    const { logEvent } = await import("./workflow.server");
    const { SITE_HOLD_RAISED } = await import("./site-conditions.core");
    const { siteConditionsHoldFor } = await import("./installer-intake.server");
    if ((await siteConditionsHoldFor(data.jobId)).open) return { ok: true as const, alreadyOpen: true }; // retry/double-click: no duplicate
    await logEvent(data.jobId, context.userId, SITE_HOLD_RAISED, "Site conditions differ — office review required", { note: data.note, source: "installer" }, { internal: true });
    return { ok: true as const, alreadyOpen: false };
  });

/** Office clears the hold after review (who/when/reason kept permanently). Never changes an accepted amount. */
export const clearSiteConditionsHold = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase as never);
    const { logEvent } = await import("./workflow.server");
    const { SITE_HOLD_CLEARED } = await import("./site-conditions.core");
    const { siteConditionsHoldFor } = await import("./installer-intake.server");
    if (!(await siteConditionsHoldFor(data.jobId)).open) return { ok: true as const, wasOpen: false };
    await logEvent(data.jobId, context.userId, SITE_HOLD_CLEARED, "Site conditions review completed", { reason: data.reason, source: "office" }, { internal: true });
    return { ok: true as const, wasOpen: true };
  });
