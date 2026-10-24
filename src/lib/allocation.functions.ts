import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, requireJobRole, WorkflowError, logEvent } from "./workflow.server";

const uuid = z.string().uuid();

/** Office: start PIESA allocation (refuses until the PIESA gate is satisfied). */
export const startPiesaOffers = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, rateToConfirm: z.boolean().optional(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { startPiesaAllocation } = await import("./allocation.server");
    const { rateToConfirmReasonBlocker } = await import("./allocation.core");
    const reasonBlock = rateToConfirmReasonBlocker(!!data.rateToConfirm, data.reason);
    if (reasonBlock) throw new WorkflowError(reasonBlock);
    if (data.rateToConfirm) await logEvent(data.jobId, context.userId, "rec_offer_rate_to_confirm", "Office chose to offer the PIESA with the electrician rate to be confirmed", { reason: data.reason!.trim() }, { internal: true });
    return startPiesaAllocation(data.jobId, context.userId, "piesa", { rateToConfirm: !!data.rateToConfirm });
  });

/** Office: candidate RECs for a job with the reason each one is or isn't eligible. */
export const listRecCandidates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recCandidatesFor } = await import("./allocation.server");
    const { rankRecCandidates } = await import("./allocation.core");
    const r = await recCandidatesFor(data.jobId);
    const order = new Map(rankRecCandidates(r.candidates, { installerSourced: r.installerSourced }).map((c, i) => [c.business_id, i]));
    return r.candidates.map((c) => ({ id: c.business_id, name: c.name, blocker: c.blocker, rank: order.get(c.business_id) ?? null, preferred: !!c.preferred }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  });

/** Contacts for the caller's active visit only (owner sees trade; trade sees owner). */
export const getVisitContacts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["owner", "electrician", "installer"]);
    const { visitContacts } = await import("./allocation.server");
    return visitContacts(data.jobId, context.userId, role);
  });

/** Office: release installation contacts once electrical clearance is valid. */
export const releaseInstallContacts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { releaseInstallationContacts } = await import("./allocation.server");
    return releaseInstallationContacts(data.jobId, context.userId);
  });

/** Agreed installer cannot proceed: stops in Needs Home Insulation Victoria. Never substitutes. */
export const installerCannotProceed = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["installer", "admin"]);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { installerUnavailableOutcome } = await import("./allocation.core");
    const o = installerUnavailableOutcome({ reason: data.reason });
    const { data: a } = await admin.from("job_assignments").select("id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).maybeSingle();
    if (!a) throw new WorkflowError("No agreed installer is assigned.");
    await admin.from("job_assignments").update({ cannot_attend_at: new Date().toISOString() }).eq("id", a.id);
    await logEvent(data.jobId, context.userId, "installer_unavailable", o.why, { assignment_id: a.id, reason: data.reason, next: o.next }, { internal: true });
    await admin.from("jobs").update({ next_action: "Needs Home Insulation Victoria: agreed installer cannot proceed" }).eq("id", data.jobId);
    return { ok: true };
  });

/** Office: mark a draft rectification quote as reviewed (required before it can be sent). */
export const reviewRectificationQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: q } = await admin.from("quotes").select("id, job_id, kind, status").eq("id", data.quoteId).single();
    if (!q || q.kind !== "rectification" || q.status !== "draft") throw new WorkflowError("Only a draft electrical fixes quote can be reviewed.");
    const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("needs_office_pricing", true);
    if (count) throw new WorkflowError("Some electrical fixes items still need office pricing.");
    await admin.from("quotes").update({ office_reviewed_at: new Date().toISOString(), office_reviewed_by: context.userId }).eq("id", q.id);
    await logEvent(q.job_id, context.userId, "rectification_quote_reviewed", "Office reviewed the electrical fixes quote", { quote_id: q.id }, { internal: true });
    return { ok: true };
  });

/** ONE office exception queue. Admin only; every source read fails loudly. Also runs the offer/reminder sweeps. */
export const getNeedsHivic = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { sweepRecOffers, sweepCoordination } = await import("./allocation.server");
    await sweepRecOffers().catch((e) => console.error("rec offer sweep failed", (e as Error).message));
    await sweepCoordination().catch((e) => console.error("coordination sweep failed", (e as Error).message));
    const { loadNeedsHivic } = await import("./needs.server");
    return loadNeedsHivic();
  });

/** Office: send an office-reviewed rectification quote to the owner (status draft -> issued). */
export const sendRectificationQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { rectificationSendBlocker } = await import("./allocation.core");
    const { data: q } = await admin.from("quotes").select("id, job_id, kind, status, office_reviewed_at").eq("id", data.quoteId).single();
    if (!q) throw new WorkflowError("Quote not found.");
    const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("needs_office_pricing", true);
    const b = rectificationSendBlocker({ kind: q.kind, status: q.status, office_reviewed_at: q.office_reviewed_at, has_unpriced_items: !!count }, true);
    if (b) throw new WorkflowError(b);
    const { data: u } = await admin.from("quotes").update({ status: "issued", sent_at: new Date().toISOString() }).eq("id", q.id).eq("status", "draft").select("id").maybeSingle();
    if (!u) throw new WorkflowError("This quote is no longer a draft.");
    await logEvent(q.job_id, context.userId, "rectification_quote_issued", "Office sent the reviewed electrical fixes quote to the owner for approval", { quote_id: q.id });
    return { ok: true };
  });

/** Owner: their PIESA time picker state (own job only). */
export const getOwnerPiesaWindows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    const { ownerPiesaWindowState } = await import("./allocation.server");
    return ownerPiesaWindowState(data.jobId);
  });

/** Owner: choose 3–5 PIESA times (2-hour windows) on at least 3 different days. */
export const chooseOwnerPiesaWindows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, picks: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).min(1).max(5) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner"]);
    const { data: isOwner } = await context.supabase.rpc("is_job_owner", { _job: data.jobId, _user: context.userId });
    if (!isOwner) throw new WorkflowError("Only the owner can choose PIESA times.");
    const { submitOwnerPiesaWindows } = await import("./allocation.server");
    return submitOwnerPiesaWindows(data.jobId, context.userId, data.picks);
  });

/** Owner/office: the electrician's rectification windows the owner may still pick (24h+ away), plus estimated hours. */
export const getRectificationWindows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { pickableRectWindows } = await import("./rectification.core");
    const [{ data: ws }, { data: q }] = await Promise.all([
      admin.from("appointment_proposals").select("id, starts_at, ends_at, status").eq("job_id", data.jobId).eq("kind", "rectification").eq("electrician_window", true),
      admin.from("quotes").select("rect_estimated_hours").eq("job_id", data.jobId).eq("kind", "rectification").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const all = (ws ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      hasWindows: all.length > 0,
      pickable: pickableRectWindows(all).map((w) => ({ id: w.id, starts_at: w.starts_at, ends_at: w.ends_at })),
      all: all.map((w) => ({ id: w.id, starts_at: w.starts_at, ends_at: w.ends_at, status: w.status })),
      hours: q?.rect_estimated_hours ?? null,
    };
  });

/** Office: the job's install hold (a capacity reservation only — never a booking). */
export const getInstallHold = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { getActiveHold } = await import("./install-holds.server");
    return (await getActiveHold(data.jobId)) ?? null;
  });

// ---------- Install days: installer offers 3, owner takes one or suggests days, back and forth (Jo 24 Oct) ----------
const ymdList = (max: number) => z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(max);
const ownerOnly = async (supabase: Parameters<typeof requireJobRole>[0], jobId: string, userId: string) => {
  await requireJobRole(supabase, jobId, ["owner"]);
  const { data: isOwner } = await supabase.rpc("is_job_owner", { _job: jobId, _user: userId });
  if (!isOwner) throw new WorkflowError("Only the owner can choose install days.");
};

export const getOwnerInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    const { ownerInstallDayState } = await import("./install-days.server");
    return ownerInstallDayState(data.jobId);
  });

export const ownerTakeInstallDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    const { ownerTakeDay } = await import("./install-days.server");
    return ownerTakeDay(data.jobId, data.proposalId, context.userId);
  });

export const ownerSuggestInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, days: ymdList(5) }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    const { ownerSuggestDays } = await import("./install-days.server");
    return ownerSuggestDays(data.jobId, context.userId, data.days);
  });

export const getInstallerInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerInstallDayState } = await import("./install-days.server");
    return installerInstallDayState(data.jobId, context.userId);
  });

export const installerOfferInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, days: ymdList(3) }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerOfferDays } = await import("./install-days.server");
    return installerOfferDays(data.jobId, context.userId, data.days);
  });

export const installerTakeInstallDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerTakeDay } = await import("./install-days.server");
    return installerTakeDay(data.jobId, data.proposalId, context.userId);
  });

// ---------- Step 10: ESC AP task + pre-start check ----------
export const getPrestartSummary = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { prestartSummary } = await import("./prestart.server");
    return (await prestartSummary(data.jobId)) ?? null;
  });

export const rerunPrestart = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { runPrestart } = await import("./prestart.server");
    return (await runPrestart(data.jobId, "office")) ?? { passed: null, failures: [], changed: false };
  });
