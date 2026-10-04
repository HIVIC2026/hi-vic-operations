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
    if (!q || q.kind !== "rectification" || q.status !== "draft") throw new WorkflowError("Only a draft rectification quote can be reviewed.");
    const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("needs_office_pricing", true);
    if (count) throw new WorkflowError("Some rectification items still need office pricing.");
    await admin.from("quotes").update({ office_reviewed_at: new Date().toISOString(), office_reviewed_by: context.userId }).eq("id", q.id);
    await logEvent(q.job_id, context.userId, "rectification_quote_reviewed", "Office reviewed the rectification quote", { quote_id: q.id }, { internal: true });
    return { ok: true };
  });

/** ONE office exception queue. Admin only; every source read fails loudly. Also runs the offer/reminder sweeps. */
export const getNeedsHivic = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { sweepRecOffers, sweepCoordination } = await import("./allocation.server");
    await sweepRecOffers().catch((e) => console.error("rec offer sweep failed", (e as Error).message));
    await sweepCoordination().catch((e) => console.error("coordination sweep failed", (e as Error).message));
    const ok = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
      if (r.error) throw new Error(`Could not load ${what}: ${r.error.message}`);
      return (r.data ?? []) as T;
    };
    const [jobs, exh, elec, rel, comms, rq, rp, unav, timing, esc, ev, veec, unappr, rsent] = await Promise.all([
      admin.from("jobs").select("id, job_number, source, stage, properties(suburb, postcode)").not("stage", "in", "(complete,cancelled)"),
      admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "rec_coverage_exhausted").order("created_at", { ascending: false }),
      admin.from("job_assignments").select("job_id").eq("role", "electrician").eq("active", true),
      admin.from("contact_releases").select("job_id, visit_kind, released_at, job_assignments!inner(active, booking_confirmed_at)").is("revoked_at", null),
      admin.from("job_communications").select("job_id, created_at").in("delivery_status", ["failed", "undelivered"]),
      admin.from("quotes").select("job_id, created_at").eq("kind", "rectification").eq("status", "declined"),
      admin.from("quotes").select("job_id, created_at").eq("kind", "rectification").eq("status", "draft").is("office_reviewed_at", null),
      admin.from("job_assignments").select("job_id, cannot_attend_at").eq("role", "installer").eq("active", true).not("cannot_attend_at", "is", null),
      admin.from("job_piesa_deadlines").select("job_id, urgency, piesa_expired, days_remaining"),
      admin.from("esc_notifications").select("job_id, created_at, due_by, last_error").is("sent_at", null),
      admin.from("evidence_requirements").select("job_id, verified_at").eq("status", "rejected"),
      admin.from("veec_lodgements").select("job_id, status, updated_at, query_received_at, reply_sent_at").in("status", ["query", "rejected"]),
      admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "rec_no_longer_approved"),
      admin.from("quotes").select("job_id, sent_at").eq("kind", "rectification").eq("status", "issued").not("sent_at", "is", null),
    ]);
    const { data: instEv } = await admin.from("workflow_events").select("job_id, event_type, created_at, details").in("event_type", ["install_ten_days_left", "install_days_declined"]).order("created_at", { ascending: false });
    const { data: rcEv } = await admin.from("workflow_events").select("job_id, created_at").eq("event_type", "ready_check_no_taker").order("created_at", { ascending: false });
    const { data: rcInst } = await admin.from("job_assignments").select("job_id").eq("role", "installer").eq("active", true);
    const withInst = new Set((rcInst ?? []).map((a) => a.job_id));
    const jobRows = ok(jobs, "jobs").filter((j) => j.source !== "qa_test");
    const withElec = new Set(ok(elec, "assignments").map((a) => a.job_id));
    const seen = new Set<string>();
    const coverage = ok(exh, "allocation events").filter((e) => !withElec.has(e.job_id) && !seen.has(e.job_id) && seen.add(e.job_id))
      .map((e) => ({ job_id: e.job_id, created_at: e.created_at, detail: (e.details as { reason?: string } | null)?.reason === "owner_times" ? "No electrician could take the owner's times." : undefined }));
    // Still-relevant "no longer approved" events: the flagged business is still the active electrician.
    const { data: activeElec } = await admin.from("job_assignments").select("job_id, business_id").eq("role", "electrician").eq("active", true);
    const activeKey = new Set((activeElec ?? []).map((a) => `${a.job_id}:${a.business_id}`));
    const recNoLongerApproved = ok(unappr, "electrician approval events")
      .filter((e) => activeKey.has(`${e.job_id}:${(e.details as { business_id?: string } | null)?.business_id}`))
      .map((e) => ({ job_id: e.job_id, since: e.created_at }));
    const now = new Date();
    const { buildNeedsHivic } = await import("./allocation.core");
    const items = buildNeedsHivic({
      recNoLongerApproved,
      now, jobs: jobRows.map((j) => { const p = j.properties as { suburb: string | null; postcode: string | null } | null; return { id: j.id, job_number: j.job_number, stage: j.stage, suburb: p ? [p.suburb, p.postcode].filter(Boolean).join(" ") : null }; }),
      coverageExhausted: coverage,
      releases: ok(rel, "contact releases").filter((r) => (r.job_assignments as { active: boolean }).active).map((r) => ({ job_id: r.job_id, visit_kind: r.visit_kind as never, released_at: r.released_at, confirmed_at: (r.job_assignments as { booking_confirmed_at: string | null }).booking_confirmed_at })),
      failedComms: ok(comms, "communications"),
      rectDeclined: ok(rq, "rectification quotes"),
      rectPricing: ok(rp, "rectification drafts"),
      installerUnavailable: ok(unav, "installer assignments").map((a) => ({ job_id: a.job_id, at: a.cannot_attend_at!, reason: null })),
      piesaTiming: ok(timing, "PIESA timing").filter((t): t is typeof t & { job_id: string } => !!t.job_id),
      escTiming: ok(esc, "ESC notices").filter((e) => e.last_error || (e.due_by && Date.parse(e.due_by) < now.getTime())),
      evidenceRejected: ok(ev, "evidence").map((e) => ({ job_id: e.job_id, created_at: e.verified_at })),
      registryQueries: ok(veec, "VEEC lodgements"),
      officeOverdue: [],
      rectUnanswered: ok(rsent, "rectification quotes sent"),
      prestart: await (await import("./prestart.server")).prestartNeeds(now).catch((e) => { console.error("pre-start needs failed", (e as Error).message); return undefined; }),
      readyCheckNoTaker: (rcEv ?? []).filter((e): e is { job_id: string; created_at: string } => !!e.job_id && !withInst.has(e.job_id)),
      installFlags: (instEv ?? []).filter((e) => !!e.job_id).map((e) => ({ job_id: e.job_id!, code: e.event_type as "install_ten_days_left" | "install_days_declined", created_at: e.created_at, detail: e.event_type === "install_ten_days_left" ? `Last day ${(e.details as { deadline?: string } | null)?.deadline ?? "?"}.` : undefined })),
    });
    return { items, checkedAt: now.toISOString() };
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
    await logEvent(q.job_id, context.userId, "rectification_quote_issued", "Office sent the reviewed rectification quote to the owner for approval", { quote_id: q.id });
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

/** Owner: choose 3–5 PIESA times (morning or afternoon windows) on at least 3 different days. */
export const chooseOwnerPiesaWindows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, picks: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["morning", "afternoon"]) })).min(1).max(5) }).parse(d))
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

// ---------- Owner install days + quoted installer one-tap booking ----------
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

export const chooseOwnerInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(5) }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    const { submitOwnerInstallDays } = await import("./install-days.server");
    return submitOwnerInstallDays(data.jobId, context.userId, data.days);
  });

export const ownerNoneInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    const { ownerNoInstallDays } = await import("./install-days.server");
    return ownerNoInstallDays(data.jobId, context.userId);
  });

export const installerTakeInstallDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerTakeDay } = await import("./install-days.server");
    return installerTakeDay(data.jobId, data.proposalId, context.userId);
  });

export const installerDeclineInstallDays = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().max(500).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerDeclineDays } = await import("./install-days.server");
    return installerDeclineDays(data.jobId, context.userId, data.reason || null);
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
