import { melbourneToday } from "./melbourne-time.core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { OFFICE_STAGES, OFFICE_STATUSES, STATUS_KEYS, type StatusKey } from "./office-status.core";
import { nextMorning } from "./needs-me.core";

const testFlag = z.object({ includeTest: z.boolean().optional() });

/** Needs me — the office home list. */
export const getNeedsMe = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => testFlag.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOffice } = await import("./office.server");
    const o = await loadOffice(supabaseAdmin, { includeTest: data.includeTest ?? false });
    return { items: o.needs.items, onTrack: o.needs.onTrack, checkedAt: new Date(o.now).toISOString() };
  });

/** Pipeline counts per stage/status, plus the daily "nothing lost" count. */
export const getPipeline = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => testFlag.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOffice } = await import("./office.server");
    const o = await loadOffice(supabaseAdmin, { includeTest: data.includeTest ?? false });
    const counts = Object.fromEntries(STATUS_KEYS.map((k) => [k, { total: 0, late: 0 }])) as Record<StatusKey, { total: number; late: number }>;
    let unmapped = 0;
    for (const j of o.jobs) { if (!j.status) { unmapped++; continue; } counts[j.status.key].total++; if (j.status.late) counts[j.status.key].late++; }
    const stages = OFFICE_STAGES.map((st) => {
      const rows = STATUS_KEYS.filter((k) => OFFICE_STATUSES[k].stage === st.key).map((k) => ({ key: k, label: OFFICE_STATUSES[k].label, waitingOn: OFFICE_STATUSES[k].waiting, ...counts[k] }));
      return { ...st, total: rows.reduce((a, r) => a + r.total, 0), late: rows.reduce((a, r) => a + r.late, 0), rows };
    });
    const ended = STATUS_KEYS.filter((k) => OFFICE_STATUSES[k].stage === "ended").map((k) => ({ key: k, label: OFFICE_STATUSES[k].label, ...counts[k] }));
    const waitingList = STATUS_KEYS.filter((k) => OFFICE_STATUSES[k].stage === "waiting_list").map((k) => ({ key: k, label: OFFICE_STATUSES[k].label, total: counts[k].total }));
    return { stages, ended, waitingList, waitingListTotal: waitingList.reduce((a, r) => a + r.total, 0), live: stages.reduce((a, s) => a + s.total, 0), late: stages.reduce((a, s) => a + s.late, 0), unmapped, checkedAt: new Date(o.now).toISOString() };
  });

/** Filtered table behind a pipeline count. */
export const listByStatus = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ status: z.string().max(60).optional(), stage: z.string().max(30).optional(), lateOnly: z.boolean().optional(), includeTest: z.boolean().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOffice } = await import("./office.server");
    const o = await loadOffice(supabaseAdmin, { includeTest: data.includeTest ?? false });
    const rows = o.jobs.filter((j) => j.status && (!data.status || j.status.key === data.status) && (!data.stage || j.status.stage === data.stage) && (!data.lateOnly || j.status.late))
      .map((j) => ({ id: j.id, jobNumber: j.jobNumber, owner: j.owner, suburb: j.suburb, status: j.status!.label, detail: j.status!.detail, waitingOn: j.status!.waitingOn, daysIn: Math.floor((o.now - new Date(j.status!.since).getTime()) / 86_400_000), dueAt: j.status!.dueAt, late: j.status!.late }))
      .sort((a, b) => Number(b.late) - Number(a.late) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
    return { rows: rows.slice(0, 2000), total: rows.length, title: data.status ? OFFICE_STATUSES[data.status as StatusKey]?.label ?? data.status : data.stage ?? "All live jobs" };
  });


/** Search by job number, owner name, email, phone or address. */
export const searchOffice = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().trim().min(2).max(80) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const q = data.q.replace(/[%,()]/g, " ").trim();
    const { data: rows, error } = await context.supabase.from("job_overview").select("id, job_number, owner_name, property_address, stage, source")
      .or(`job_number.ilike.%${q}%,owner_name.ilike.%${q}%,property_address.ilike.%${q}%,owner_email.ilike.%${q}%,owner_phone.ilike.%${q}%`).limit(12);
    if (error) throw new Error(`Search failed: ${error.message}`);
    return rows ?? [];
  });

/** "Later": hide until next morning. A second Later on the same item needs a reason. */
export const snoozeNeedsItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), ruleKey: z.string().max(40), reason: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { data: prev, error: e1 } = await context.supabase.from("office_snoozes").select("id, snooze_count").eq("job_id", data.jobId).eq("rule_key", data.ruleKey).maybeSingle();
    if (e1) throw new Error(e1.message);
    const until = nextMorning(Date.now());
    if (prev) {
      if (!data.reason || data.reason.length < 3) throw new Error("This was already put off once — add a short reason to put it off again.");
      const { error } = await context.supabase.from("office_snoozes").update({ snooze_count: prev.snooze_count + 1, reason: data.reason, snoozed_until: until, snoozed_by: context.userId, updated_at: new Date().toISOString() }).eq("id", prev.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("office_snoozes").insert({ job_id: data.jobId, rule_key: data.ruleKey, snoozed_until: until, snoozed_by: context.userId, reason: data.reason ?? null });
      if (error) throw new Error(error.message);
    }
    const { logEvent } = await import("./workflow.server");
    await logEvent(data.jobId, context.userId, "office_snoozed", `Put off until tomorrow morning${data.reason ? `: ${data.reason}` : ""}`, { rule: data.ruleKey, until }, { internal: true });
    return { until };
  });

/** Office records that a trade has been paid (no money moves automatically). */
export const markPayoutPaid = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reference: z.string().trim().min(2).max(120), kind: z.enum(["assessment", "rectification", "installation"]).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    if (data.kind === "assessment" || data.kind === "rectification") {
      const [{ data: j }, { data: qs }] = await Promise.all([
        admin.from("jobs").select("channel, electrician_choice").eq("id", data.jobId).single(),
        admin.from("quotes").select("kind, quote_items(code, description)").eq("job_id", data.jobId).eq("status", "accepted"),
      ]);
      const items = (qs ?? []).flatMap((q) => ((q.quote_items as { code: string | null; description: string | null }[] | null) ?? []).map((i) => ({ ...i, qk: q.kind })));
      const committed = qs?.length ? (data.kind === "assessment" ? items.some((i) => i.code === "PIESA") : items.some((i) => i.qk === "rectification" || (i.description ?? "").startsWith("Electrical rectification:"))) : null;
      const { electricalBillingSource } = await import("./installer-led.core");
      if (electricalBillingSource({ channel: j?.channel ?? null, choice: j?.electrician_choice ?? null, committedLineOnAcceptedQuote: committed, hivPaidAt: null }) === "owner_direct")
        throw new Error("This electrician invoices the owner directly — Home Insulation Victoria doesn't pay this work.");
    }
    const { logEvent } = await import("./workflow.server");
    await logEvent(data.jobId, context.userId, "payout_marked_paid", `Payout marked paid (${data.reference})`, { reference: data.reference, ...(data.kind ? { kind: data.kind } : {}) }, { internal: true });
    return { ok: true };
  });

/** Money overview: margin this month, VEECs lodged, owners owe us, we owe trades. */
export const getMoneyOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const start = new Date((await import("./melbourne-time.core")).melbourneMonthStart()); // Melbourne month, not server time
    const [inv, veec, internals, jobs, paidEv] = await Promise.all([
      admin.from("invoice_status").select("job_id, total_inc_gst, total_paid, effective_status"),
      admin.from("veec_lodgements").select("job_id, quantity, status, submitted_date"),
      admin.from("quote_internals").select("quote_id, ap_margin_ex_gst, ap_fee_ex_gst, quotes!inner(job_id, status, accepted_at)").gte("quotes.accepted_at", start.toISOString()),
      admin.from("jobs").select("id, job_number, stage, source, channel, owners(full_name), properties(suburb)").in("stage", ["ready_for_veec", "complete"]).neq("source", "qa_test"),
      admin.from("workflow_events").select("job_id, summary, created_at").eq("event_type", "payout_marked_paid"),
    ]);
    for (const r of [inv, veec, jobs, paidEv]) if (r.error) throw new Error(`Could not load money figures: ${r.error.message}`);
    const owed = (inv.data ?? []).reduce((a, v) => a + Math.max(0, Number(v.total_inc_gst ?? 0) - Number(v.total_paid ?? 0)), 0);
    const margin = internals.error ? null : (internals.data ?? []).reduce((a, q) => a + (Number(q.ap_margin_ex_gst ?? 0) + Number(q.ap_fee_ex_gst ?? 0)) * 1.1, 0);
    const lodged = (veec.data ?? []).filter((v) => v.submitted_date && v.submitted_date >= melbourneToday(start)).reduce((a, v) => a + Number(v.quantity ?? 0), 0);
    const paid = new Map((paidEv.data ?? []).map((e) => [e.job_id, e]));
    const { data: ap } = await admin.from("workflow_events").select("job_id, created_at").eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec");
    const apAt = new Map((ap ?? []).map((e) => [e.job_id, e.created_at]));
    const payouts = (jobs.data ?? []).map((j) => {
      const at = apAt.get(j.id);
      const p = paid.get(j.id);
      return { jobId: j.id, jobNumber: j.job_number, owner: (j.owners as { full_name?: string } | null)?.full_name ?? null, suburb: (j.properties as { suburb?: string } | null)?.suburb ?? null, route: j.channel === "installer_sourced" ? "Installer-supplied (after AP approval and owner paid in full)" : "Our lead (after AP approval)", dueAt: at ? new Date(new Date(at).getTime() + 7 * 86_400_000).toISOString() : null, paidAt: p?.created_at ?? null, paidNote: p?.summary ?? null };
    });
    const weOwe = payouts.filter((p) => !p.paidAt).length;
    return { margin, marginError: internals.error?.message ?? null, lodged, owed, weOwe, payouts };
  });

/** Partner cards: live jobs, on-time %, reply time, status. */
export const getPartnersOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [biz, asg, offers, rates, apps] = await Promise.all([
      admin.from("businesses").select("id, name, business_type, onboarding_status, is_active, onboarding_notes").neq("business_type", "property_manager").neq("onboarding_status", "suspended"),
      admin.from("job_assignments").select("business_id, job_id, assigned_at, first_response_at, active, jobs!inner(stage, source)").eq("active", true),
      admin.from("partner_offers").select("business_id, offered_at, responded_at, status"),
      admin.from("electrician_rates").select("business_id, status"),
      admin.from("partner_enquiries").select("id", { count: "exact", head: true }).in("status", ["new", "submitted"]),
    ]);
    for (const r of [biz, asg, offers, rates]) if (r.error) throw new Error(`Could not load partners: ${r.error.message}`);
    const cards = (biz.data ?? []).filter((b) => !/^TEST/i.test(b.name) && !(b.onboarding_notes ?? "").includes("[TEST PARTNER]")).map((b) => {
      const mine = (asg.data ?? []).filter((a) => a.business_id === b.id && (a.jobs as { source?: string }).source !== "qa_test");
      const liveJobs = mine.filter((a) => !["complete", "cancelled"].includes(String((a.jobs as { stage?: string }).stage))).length;
      const replies = [...mine.filter((a) => a.first_response_at).map((a) => new Date(a.first_response_at!).getTime() - new Date(a.assigned_at).getTime()), ...(offers.data ?? []).filter((o) => o.business_id === b.id && o.responded_at).map((o) => new Date(o.responded_at!).getTime() - new Date(o.offered_at).getTime())];
      const onTime = replies.length ? Math.round((replies.filter((ms) => ms <= 4 * 3_600_000).length / replies.length) * 100) : null;
      const avgHrs = replies.length ? Math.round(replies.reduce((a, x) => a + x, 0) / replies.length / 3_600_000 * 10) / 10 : null;
      const isElec = b.business_type === "rec";
      const hasRate = (rates.data ?? []).some((r) => r.business_id === b.id && r.status === "active");
      const status = b.onboarding_status !== "approved" && !b.is_active ? "Applying" : isElec && !hasRate ? "No rate" : "Active";
      return { id: b.id, name: b.name, kind: isElec ? "Electrician" : "Installer", liveJobs, onTime, avgHrs, status };
    }).sort((a, b) => b.liveJobs - a.liveJobs || a.name.localeCompare(b.name));
    return { cards, applications: apps.count ?? 0 };
  });

/** Office admin "Delete job": recoverable soft delete for any job. Signed, financial and audit records are kept. */
export const deleteJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logEvent } = await import("./workflow.server");
    const now = new Date().toISOString();
    const { data: row, error } = await supabaseAdmin.from("jobs").update({ deleted_at: now, deleted_by: context.userId, deleted_reason: data.reason }).eq("id", data.jobId).is("deleted_at", null).select("id, job_number, stage").maybeSingle();
    if (error) throw new Error(`Job could not be deleted: ${error.message}`);
    if (!row) throw new Error("Job not found or already deleted");
    await logEvent(data.jobId, context.userId, "job_deleted", `Job deleted by office: ${data.reason}`, { reason: data.reason, stage_at_delete: row.stage, deleted_at: now }, { internal: true });
    return { ok: true, jobNumber: row.job_number };
  });

/** Office admin "Restore job": undoes a soft delete. */
export const restoreJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logEvent } = await import("./workflow.server");
    const { data: row, error } = await supabaseAdmin.from("jobs").update({ deleted_at: null, deleted_by: null, deleted_reason: null }).eq("id", data.jobId).not("deleted_at", "is", null).select("id").maybeSingle();
    if (error) throw new Error(`Job could not be restored: ${error.message}`);
    if (!row) throw new Error("Job not found or not deleted");
    await logEvent(data.jobId, context.userId, "job_restored", `Job restored by office: ${data.reason}`, { reason: data.reason }, { internal: true });
    return { ok: true };
  });

/** Deleted jobs (office only). */
export const listDeletedJobs = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("jobs").select("id, job_number, deleted_at, deleted_reason, owners(full_name), properties(suburb)").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(500);
    if (error) throw new Error(`Deleted jobs could not be loaded: ${error.message}`);
    return (data ?? []).map((j) => ({ id: j.id, jobNumber: j.job_number, deletedAt: j.deleted_at, reason: j.deleted_reason, owner: (j.owners as { full_name: string | null } | null)?.full_name ?? null, suburb: (j.properties as { suburb: string | null } | null)?.suburb ?? null }));
  });

/** Whether one job is deleted (office only). */
export const getJobDeleteState = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: j, error } = await supabaseAdmin.from("jobs").select("deleted_at, deleted_reason").eq("id", data.jobId).maybeSingle();
    if (error || !j) throw new Error("Job delete state could not be loaded");
    return { deletedAt: j.deleted_at, reason: j.deleted_reason };
  });

/** Board columns (Jo 9 Oct): the facts-based office stage for every job, so no job sits in Ready Check without real Ready Check facts. */
export const getBoardStages = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => testFlag.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOffice } = await import("./office.server");
    const o = await loadOffice(supabaseAdmin, { includeTest: data.includeTest ?? false });
    return Object.fromEntries(o.jobs.map((j) => [j.id, j.status?.stage ?? null])) as Record<string, string | null>;
  });
