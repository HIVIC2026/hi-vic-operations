import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { intakeProgressApplies } from "./installer-progress.core";

// Admin-only: the auto-drafted owner quote from an installer's Ready Check, and the office "send" step.
export const getInstallerQuoteDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: job, error: je } = await admin.from("jobs").select("channel").eq("id", data.jobId).single();
    if (je) throw new Error(je.message);
    if (job.channel !== "installer_sourced") return { applies: false as const };
    const [{ data: q, error }, { data: held }] = await Promise.all([
      admin.from("quotes").select("id, status, option_code, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, cobrand, created_at, quote_items(code, description, explanation, line_total_inc_gst, sort)")
        .eq("job_id", data.jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("workflow_events").select("details, created_at").eq("job_id", data.jobId).eq("event_type", "installer_quote_held").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const heldNewer = held && (!q || held.created_at > q.created_at);
    return {
      applies: true as const,
      quote: q ? { ...q, quote_items: [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort) } : null,
      heldBlockers: heldNewer ? (((held.details as { blockers?: string[] } | null)?.blockers) ?? []) : [],
    };
  });

export const sendInstallerQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { WorkflowError, logEvent } = await import("./workflow.server");
    const { applyCobrand } = await import("./pilot.server");
    const { data: q } = await admin.from("quotes").select("id, status, option_code, job_id, release_state").eq("id", data.quoteId).eq("job_id", data.jobId).maybeSingle();
    if (!q || q.option_code !== "INSTALLER_A1") throw new WorkflowError("Quote not found.");
    if (q.status !== "draft") throw new WorkflowError("This quote has already been sent.");
    { // Approved intake jobs: readiness + a real consent row + fee awareness before release (event alone is not consent).
      const { intakeSendBlockers } = await import("./installer-intake.server");
      const b = await intakeSendBlockers(data.jobId);
      if (b.length) throw new WorkflowError(b.join(" • "));
      const bb = await (await import("./installer-quote.server")).quoteBillingBlocker(q.id);
      if (bb) throw new WorkflowError(bb);
    }
    await applyCobrand(data.jobId);
    const { customerDeliveryState } = await import("./comms.server");
    const delivery = await customerDeliveryState(data.jobId);
    // Office approval only QUEUES the quote. Release (sent_at) happens solely in releaseQueuedQuotes, which re-checks
    // the launch switches and, for intake jobs, readiness/consent/fees again. "ready_to_send" is not a send.
    const { data: upd, error } = await admin.from("quotes").update({ status: "issued", sent_at: null, release_state: "queued", release_hold_reason: null, office_reviewed_at: new Date().toISOString(), office_reviewed_by: context.userId }).eq("id", q.id).eq("status", "draft").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!upd) throw new WorkflowError("This quote has already been sent.");
    await logEvent(data.jobId, context.userId, "installer_quote_queued", "Office approved the co-branded owner quote — queued; it goes to the owner only when the launch switches allow", { quote_id: q.id, email_delivery: delivery });
    return { delivery, queued: true };
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
async function requireSupplyingInstaller(supabase: { rpc: (...a: never[]) => unknown }, userId: string, jobId: string): Promise<string> {
  const sb = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const { data: ok, error } = await sb.rpc("can_access_job", { _job: jobId });
  if (error || !ok) throw new Error("Not your job.");
  const { data: inst } = await sb.rpc("has_role", { _user_id: userId, _role: "installer" });
  if (!inst) throw new Error("Only installers can update this job.");
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
      admin.from("jobs").select("installer_quoted, electrician_choice").eq("id", data.jobId).single(),
    ]);
    const payerLock = await m.intakePayerLock(data.jobId, s.electricianPayer, context.userId, biz);
    const quoteAnswer = (await m.intakeQuoteAnswers([data.jobId])).get(data.jobId) ?? null;
    return { applies: true as const, businessId: biz, areaM2: s.areaM2, areaProvenance: s.areaProvenance, insulation: s.insulation, quoted: (job?.installer_quoted ?? null) as "yes" | "no" | null, quoteAnswer, quoteIncGst: s.quoteIncGst, includes: s.includes, proposedR: s.proposedR, removalQuote: s.removalQuote, files: ((imp?.files as { path: string; name: string; type: string }[] | null) ?? []), electricianChosen: s.electricianPayer !== "undecided", payerEditable: !payerLock, payerLockReason: payerLock ?? (s.electricianPayer === "own" ? "Your electrician is already chosen — ask the office to change it." : null), quoteHeld: [...s.readiness.blockers, ...s.releaseBlockers.filter((b) => !/contact consent/.test(b))], electricianPayer: s.electricianPayer, feeAwarenessCurrent: s.feeAwarenessRecorded && (s.feeAwarenessPayer ?? "hivic") === s.electricianPayer };
  });

export const saveMyIntakeJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), areaM2: z.number().positive().max(5000).nullable(), insulation: z.enum(["none", "below_r2", "unknown"]),
    quoteStatus: z.enum(["not_quoted", "have_quote"]), quoteIncGst: z.number().positive().max(1_000_000).nullable(), includes: z.string().trim().max(1000).nullable(), proposedR: z.number().positive().max(10).nullable(),
    files: z.array(z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100) })).max(20),
    electrician: z.object({ mode: z.literal("mine"), business_id: z.string().uuid().nullish(), nomination_id: z.string().uuid().nullish() }).optional(),
    electricianPayer: z.enum(["hivic", "own", "undecided"]).optional(),
    removalQuote: z.object({ answer: z.enum(["yes", "no", "unknown"]), areaM2: z.number().positive().max(5000).nullable(), chargeIncGst: z.number().min(0).max(1_000_000).nullable() }).optional(),
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
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: jobChannel } = await admin.from("jobs").select("channel, originating_installer_business_id").eq("id", data.jobId).maybeSingle();
    if (!intakeProgressApplies(jobChannel)) {
      return { applies: false as const };
    }
    await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);
    const m = await import("./installer-intake.server");
    if (!(await m.isIntakeJob(data.jobId))) return { applies: false as const };
    // `admin` is already imported at the top of this handler for the channel guard above.
    const id = data.jobId;
    const [s, { data: job }, { data: qs }, { data: pr }, { data: bks }, { data: ev }, { data: ap }, { data: veec }, { data: dl }] = await Promise.all([
      m.installerIntakeState(id),
      admin.from("jobs").select("stage, installer_quoted, installation_completed_at").eq("id", id).single(),
      admin.from("quotes").select("status, created_at, release_state, release_hold_reason, sent_at").eq("job_id", id).eq("kind", "installation"),
      admin.from("piesa_records").select("outcome, signed_off_by, created_at").eq("job_id", id).eq("is_current", true).limit(1).maybeSingle(),
      admin.from("bookings").select("kind, status, scheduled_start, created_at").eq("job_id", id).neq("status", "cancelled").order("created_at", { ascending: false }),
      admin.from("evidence_requirements").select("label, status, responsible_role, gate, verified_at").eq("job_id", id).eq("required", true),
      admin.from("workflow_events").select("created_at").eq("job_id", id).eq("event_type", "ap_approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("veec_lodgements").select("status").eq("job_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("job_piesa_deadlines").select("piesa_expired").eq("job_id", id).maybeSingle(),
    ]);
    const core = await import("./installer-progress.core");
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
    return { applies: true as const, ...core.installerProgress({
      coordination: s.coordination, quoted: answer === "have_quote" ? "yes" : answer === "not_quoted" ? "no" : null,
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
    }) };
  });
