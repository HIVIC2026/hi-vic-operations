import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, logEvent } from "./workflow.server";
import { myBusinesses, requireMember } from "./pilot.server";
import { WORKER_COLS, isAdminCaller, jobBusinesses } from "./worker-links.server";
import { assignBlocker, certificationBlocker, firstName, hashToken, isTokenShape, linkExpiry, linkState, needsReapproval, newToken, senderLabel } from "./worker-links.core";

const uuid = z.string().uuid();
const workerInput = z.object({
  full_legal_name: z.string().trim().min(2).max(200),
  // Jo 28 Oct: email is optional — a person can be saved with just a name, trade role and (optional) mobile.
  email: z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), z.string().trim().toLowerCase().email().max(254).nullable().optional()),
  mobile: z.string().trim().min(8).max(30),
  trade_role: z.enum(["electrician", "installer"]),
  licence_number: z.string().trim().max(60).optional().nullable(),
  qualification: z.string().trim().max(200).optional().nullable(),
});

// ---------- Company: manage own workers ----------
export const listMyWorkers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const mine = await myBusinesses(context.userId);
    const bizId = [...mine.keys()][0];
    if (!bizId) return null;
    const [{ data: biz, error: e1 }, { data: workers, error: e2 }] = await Promise.all([
      admin.from("businesses").select("id, name, trading_name").eq("id", bizId).maybeSingle(),
      admin.from("partner_workers").select(WORKER_COLS).eq("business_id", bizId).is("removed_at", null).order("created_at"),
    ]);
    if (e1 || e2) throw new Error(`Could not load workers: ${(e1 ?? e2)!.message}`);
    return { business: biz, canManage: mine.get(bizId) === "business_admin", workers: workers ?? [] };
  });

export const saveWorker = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => workerInput.extend({ id: uuid.optional(), business_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const office = await isAdminCaller(context.supabase);
    if (!office) await requireMember(context.userId, data.business_id, true);
    if (data.trade_role === "electrician" && !data.licence_number) throw new Error("Add the electrician's licence number.");
    if (data.trade_role === "installer" && !data.qualification) throw new Error("Add the installer's qualification (e.g. Cert III or 'Experienced installer').");
    const { id, ...rest } = data;
    const fields = { ...rest, email: rest.email ?? null, licence_number: rest.licence_number ?? null, qualification: rest.qualification ?? null };
    if (id) {
      const { data: before, error } = await admin.from("partner_workers").select("*").eq("id", id).eq("business_id", data.business_id).maybeSingle();
      if (error || !before) throw new Error("Worker not found.");
      const reapprove = !office && needsReapproval(before as Record<string, unknown>, fields);
      const { error: ue } = await admin.from("partner_workers").update({ ...fields, ...(reapprove ? { approval_status: "pending", approved_at: null, approved_by: null } : {}) } as never).eq("id", id);
      if (ue) throw new Error(ue.message);
      return { ok: true, pending: reapprove || before.approval_status === "pending" };
    }
    const { error } = await admin.from("partner_workers").insert({ ...fields, added_by: context.userId, approval_status: office ? "approved" : "pending", ...(office ? { approved_by: context.userId, approved_at: new Date().toISOString() } : {}) } as never);
    if (error) throw new Error(error.code === "23505" ? "A worker with that email is already listed." : error.message);
    return { ok: true, pending: !office };
  });

export const removeWorker = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("id, business_id, profile_id").eq("id", data.id).maybeSingle();
    if (!w) throw new Error("Worker not found.");
    if (!(await isAdminCaller(context.supabase))) await requireMember(context.userId, w.business_id, true);
    if (w.profile_id && w.profile_id === context.userId) throw new Error("You can't remove yourself. Ask the office.");
    const now = new Date().toISOString();
    await admin.from("partner_workers").update({ removed_at: now }).eq("id", w.id);
    await admin.from("worker_job_links").update({ revoked_at: now, revoked_by: context.userId }).eq("worker_id", w.id).is("revoked_at", null);
    // Review D: removing a worker also switches off their business sign-in (never the boss's own row).
    if (w.profile_id) await admin.from("business_members").update({ active: false } as never).eq("business_id", w.business_id).eq("user_id", w.profile_id).neq("member_role", "business_admin");
    // Decision 331: removed person → deactivate the Mitti user the portal invited/linked (switch off = no-op). Never fails the removal.
    await import("./mitti-invite.server").then((m) => m.onPartnerPersonRemoved(w.id, context.userId)).catch((e) => console.error("Mitti deactivate skipped", (e as Error).message));
    return { ok: true };
  });

// ---------- Lead / Crew (Jo 28 Oct 2026) ----------
/** HIV admins and the business's own business_admin switch an installer person between Lead and Crew. Applies straight
 *  away, records ONE admin_config_events row (who, person, from → to); to Lead runs the Mitti invite, Lead → Crew runs the
 *  Mitti deactivate (both never fail the switch). */
export const setWorkerRole = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, role: z.enum(["lead", "crew"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("id, business_id, full_legal_name, trade_role, worker_role, profile_id, removed_at").eq("id", data.id).maybeSingle();
    if (!w || w.removed_at) throw new Error("Worker not found.");
    if (w.trade_role !== "installer") throw new Error("Lead and Crew are for installers only.");
    if (!(await isAdminCaller(context.supabase))) await requireMember(context.userId, w.business_id, true);
    const { workerRolesFor } = await import("./mitti-invite.server");
    const from = (await workerRolesFor([w])).get(w.id) ?? "crew";
    const { WORKER_ROLE_CHANGED_EVENT, roleChangeSummary, roleSwitchMittiAction } = await import("./worker-role.core");
    if (from === data.role && w.worker_role === data.role) return { ok: true, changed: false, role: data.role };
    const { error } = await admin.from("partner_workers").update({ worker_role: data.role }).eq("id", w.id);
    if (error) throw new Error(error.message);
    if (from === data.role) return { ok: true, changed: false, role: data.role }; // stored the role that already applied; nothing changes
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: WORKER_ROLE_CHANGED_EVENT, summary: roleChangeSummary(w.full_legal_name, from, data.role), details: { worker_id: w.id, business_id: w.business_id, from, to: data.role, stored_before: w.worker_role ?? null } });
    const action = roleSwitchMittiAction(from, data.role);
    const m = await import("./mitti-invite.server");
    if (action === "invite") await m.onPartnerPersonApproved(w.id, context.userId).catch((e) => console.error("Mitti invite after Lead switch skipped", (e as Error).message));
    if (action === "deactivate") await m.onPartnerPersonDemoted(w.id, context.userId).catch((e) => console.error("Mitti deactivate after Crew switch skipped", (e as Error).message));
    return { ok: true, changed: true, role: data.role };
  });

// ---------- Office: approvals ----------
export const listWorkerApprovals = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await admin.from("partner_workers").select(`${WORKER_COLS}, businesses(name)`).is("removed_at", null).order("created_at", { ascending: false });
    if (error) throw new Error(`Could not load workers: ${error.message}`);
    return data ?? [];
  });

export const decideWorker = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, approve: z.boolean(), reason: z.string().trim().max(500).optional().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (!data.approve && !data.reason) throw new Error("Give a reason for rejecting this worker.");
    // Approve: the update, the worker_approved event and the Mitti auto-invite hook (decisions 188/331, never fails the approval)
    // live in one shared helper, also used when a business approval approves its verified people (decision 402).
    if (data.approve) {
      await (await import("./worker-approval.server")).approvePartnerWorker(data.id, context.userId, { kind: "office", reason: data.reason ?? null });
      return { ok: true };
    }
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { error } = await admin.from("partner_workers").update({ approval_status: "rejected", approved_by: context.userId, approved_at: now, rejection_reason: data.reason ?? null }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "worker_rejected", summary: `Worker rejected: ${data.reason}`, details: { worker_id: data.id, reason: data.reason ?? null } });
    await admin.from("worker_job_links").update({ revoked_at: now, revoked_by: context.userId }).eq("worker_id", data.id).is("revoked_at", null);
    // Decision 331: a rejected person's Mitti user (if the portal invited/linked one) is deactivated. Never fails the decision.
    await import("./mitti-invite.server").then((m) => m.onPartnerPersonRemoved(data.id, context.userId)).catch((e) => console.error("Mitti deactivate skipped", (e as Error).message));
    return { ok: true };
  });

// ---------- Job links ----------
export const jobWorkerLinks = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./worker-links.server")).workerLinksFor(context.supabase, context.userId, data.jobId));

export const createWorkerJobLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("id, business_id, full_legal_name, trade_role, approval_status, certification_status, removed_at").eq("id", data.workerId).maybeSingle();
    if (!w) throw new Error("Worker not found.");
    if (!(await isAdminCaller(context.supabase))) await requireMember(context.userId, w.business_id);
    const block = assignBlocker(w, await jobBusinesses(data.jobId));
    if (block) throw new Error(block);
    const now = Date.now();
    await admin.from("worker_job_links").update({ revoked_at: new Date(now).toISOString(), revoked_by: context.userId }).eq("worker_id", w.id).eq("job_id", data.jobId).is("revoked_at", null);
    const token = newToken();
    const { error } = await admin.from("worker_job_links").insert({ worker_id: w.id, business_id: w.business_id, job_id: data.jobId, token_hash: await hashToken(token), created_by: context.userId, expires_at: linkExpiry(now) });
    if (error) throw new Error(error.message);
    await logEvent(data.jobId, context.userId, "worker_link_created", `Job link created for ${w.full_legal_name}`, { worker_id: w.id });
    const { autoAssignReadyCheckForm } = await import("./mitti-autoassign.server");
    const mitti = await autoAssignReadyCheckForm(data.jobId, w.id, context.userId);
    // Token is returned once; only its hash is stored. Nothing is sent until communications are switched on.
    return { token, path: `/w/${token}`, mitti };
  });

export const revokeWorkerJobLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ linkId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: l } = await admin.from("worker_job_links").select("id, business_id, job_id").eq("id", data.linkId).maybeSingle();
    if (!l) throw new Error("Link not found.");
    if (!(await isAdminCaller(context.supabase))) await requireMember(context.userId, l.business_id);
    await admin.from("worker_job_links").update({ revoked_at: new Date().toISOString(), revoked_by: context.userId }).eq("id", l.id).is("revoked_at", null);
    await logEvent(l.job_id, context.userId, "worker_link_revoked", "Worker job link revoked", { link_id: l.id });
    return { ok: true };
  });

// ---------- Public: the worker's job page (token is the only credential) ----------
async function resolveLink(token: string) {
  if (!isTokenShape(token)) throw new Error("This link isn't valid.");
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("worker_job_links").select("id, job_id, worker_id, business_id, expires_at, revoked_at, open_count").eq("token_hash", await hashToken(token)).maybeSingle();
  if (!l) throw new Error("This link isn't valid.");
  const st = linkState(l, Date.now());
  if (st !== "active") throw new Error(st === "revoked" ? "This link has been switched off. Ask your company for a new one." : "This link has expired. Ask your company for a new one.");
  const [{ data: w }, { data: b }] = await Promise.all([
    admin.from("partner_workers").select("full_legal_name, trade_role, approval_status, certification_status, removed_at").eq("id", l.worker_id).maybeSingle(),
    admin.from("businesses").select("name, trading_name").eq("id", l.business_id).maybeSingle(),
  ]);
  if (!w || w.removed_at || w.approval_status !== "approved" || certificationBlocker(w)) throw new Error("This link has been switched off. Ask your company for a new one.");
  if (!(await jobBusinesses(l.job_id)).includes(l.business_id)) throw new Error("Your company is no longer on this job.");
  return { admin, l, w, bizName: b?.trading_name || b?.name || null };
}

export const getWorkerJobView = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l, w, bizName } = await resolveLink(data.token);
    await admin.from("worker_job_links").update({ last_opened_at: new Date().toISOString(), open_count: (l.open_count ?? 0) + 1 }).eq("id", l.id);
    // Speed (decision 280): every read here depends only on the link — one round trip, not three (this page polls every 20s).
    const [{ data: j }, { data: events }, { data: msgs }, { data: a }, { data: m }, { data: books }, { data: mb }, { data: rels }, { visitIsCurrent }] = await Promise.all([
      admin.from("job_overview").select("job_number, stage, next_action, property_address, owner_name, piesa_date, install_deadline, days_remaining, life_support").eq("id", l.job_id).maybeSingle(),
      admin.from("workflow_events").select("summary, created_at").eq("job_id", l.job_id).eq("internal", false).order("created_at", { ascending: false }).limit(15),
      admin.from("messages").select("id, body, created_at, sender_label, worker_id, sender_id, profiles(full_name)").eq("job_id", l.job_id).eq("internal", false).order("created_at"),
      admin.from("assessments").select("external_mitti_id").eq("job_id", l.job_id).maybeSingle(),
      admin.from("ceiling_measurements").select("external_id, external_source").eq("job_id", l.job_id).eq("is_current", true).maybeSingle(),
      admin.from("bookings").select("kind, scheduled_start, status").eq("job_id", l.job_id).in("status", ["proposed", "confirmed"]).order("scheduled_start"),
      admin.from("businesses").select("mitti_account_invited").eq("id", l.business_id).maybeSingle(),
      // Approved direct-contact rule: owner name, phone and email for the active visit only.
      admin.from("contact_releases").select("visit_kind, job_assignments!inner(business_id, active)").eq("job_id", l.job_id).is("revoked_at", null).eq("job_assignments.business_id", l.business_id),
      import("./allocation.core"),
    ]);
    if (!j) throw new Error("This job is no longer available.");
    const mittiId = mb?.mitti_account_invited !== true ? null : w.trade_role === "electrician" ? a?.external_mitti_id : (m?.external_source === "mitti" ? m.external_id : null) ?? a?.external_mitti_id;
    const released = (rels ?? []).some((r) => (r.job_assignments as { active: boolean }).active && visitIsCurrent(r.visit_kind, j.stage ?? ""));
    const { data: oc } = released ? await admin.from("job_overview").select("owner_name, owner_phone, owner_email").eq("id", l.job_id).maybeSingle() : { data: null };
    return {
      worker: { name: w.full_legal_name, firstName: firstName(w.full_legal_name), role: w.trade_role, business: bizName },
      job: { ...j, owner_first_name: firstName(j.owner_name), owner_name: undefined },
      ownerContact: oc ? { name: oc.owner_name, phone: oc.owner_phone, email: oc.owner_email } : null,
      mittiUrl: mittiId ? (await import("./mitti-link.core")).mittiFormUrl(mittiId) : null,
      bookings: books ?? [],
      timeline: events ?? [],
      messages: (msgs ?? []).map((x) => ({ id: x.id, body: x.body, created_at: x.created_at, mine: x.worker_id === l.worker_id, from: x.sender_label ?? (x.profiles as { full_name: string | null } | null)?.full_name ?? "Home Insulation Victoria" })),
    };
  });

export const getWorkerApprovedRectificationRates = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l, w } = await resolveLink(data.token);
    if (w.trade_role !== "electrician") return [];
    const { data: card } = await admin.from("rate_cards").select("id").eq("business_id", l.business_id).eq("kind", "electrical").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!card) return [];
    const { data: rates, error } = await admin.from("rate_card_items").select("code,description,unit,display_unit").eq("rate_card_id", card.id).eq("category", "electrical").like("code", "CUSTOM_%").order("sort");
    if (error) throw new Error("Your approved electrical fixes rates could not be loaded.");
    return rates ?? [];
  });

export const addWorkerApprovedRectificationItem = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100), rateCode: z.string().regex(/^CUSTOM_[A-Z0-9]{1,33}$/), quantity: z.number().positive().max(1000), explanation: z.string().trim().max(2000).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l, w } = await resolveLink(data.token);
    if (w.trade_role !== "electrician") throw new Error("Only approved electrician staff can add electrical fixes items.");
    const { data: job } = await admin.from("jobs").select("stage").eq("id", l.job_id).maybeSingle();
    if (!job || !["piesa_scheduled", "assessment_booked", "assessment_booking", "assessment_complete", "rectification_required"].includes(job.stage)) throw new Error("Approved items can only be added before the electrical fixes quote is issued for owner approval.");
    const { data: cards } = await admin.from("rate_cards").select("id,rate_card_items(code,description)").eq("business_id", l.business_id).eq("kind", "electrical").eq("is_active", true).order("version", { ascending: false }).limit(1);
    const approved = (cards?.[0]?.rate_card_items as { code: string; description: string }[] | undefined)?.find((item) => item.code === data.rateCode);
    if (!approved) throw new Error("That item is not on your REC business's approved rate card.");
    const { error } = await admin.from("rectification_items").insert({ job_id: l.job_id, rate_code: approved.code, description: approved.description, quantity: data.quantity, is_other: false, explanation: data.explanation ?? null, added_by: null });
    if (error) throw new Error("The approved electrical fixes item could not be added.");
    await logEvent(l.job_id, null, "rectification_approved_item_added", `Approved electrical fixes item added by ${w.full_legal_name}: ${approved.description}`, { rate_code: approved.code, quantity: data.quantity, worker_id: l.worker_id });
    return { ok: true };
  });

export const postWorkerMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(100), body: z.string().trim().min(1).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { admin, l, w, bizName } = await resolveLink(data.token);
    const { maskContactDetails } = await import("./messaging.core");
    const { error } = await admin.from("messages").insert({ job_id: l.job_id, sender_id: null, worker_id: l.worker_id, sender_label: senderLabel(w.full_legal_name, bizName), body: maskContactDetails(data.body).body, internal: false, channel: "portal" });
    if (error) throw new Error("Couldn't send your message. Try again.");
    await admin.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", l.job_id);
    return { ok: true };
  });

