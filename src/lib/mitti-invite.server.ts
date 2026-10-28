// Mitti access for partner people (decision 188; automatic since decision 331). Rules are pure in mitti-invite.core.ts;
// this file reads the person, makes the Mitti calls (search; and, once MITTI_USER_API_VERIFIED, create / add to the HIV
// trades group / deactivate) and records each outcome as ONE append-only admin_config_events row (person-level:
// workflow_events needs a job). A newly created person gets ONE message through the existing partner senders and guards.
// Callers never let it fail the approval/removal; Mitti failures become one office item (`mitti_access_failed`).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import {
  MITTI_AUTO_INVITE_ENV, MITTI_INVITE_EVENTS, MITTI_INVITE_MESSAGE, MITTI_INVITE_SUBJECT, renderMittiInviteEmail, MITTI_TEMPLATE_ACCESS_NOTE, MITTI_TRADES_GROUP_ENV, MITTI_USER_API, MITTI_USER_API_VERIFIED,
  addToGroupBody, autoInviteEnabled, createUserBody, createdUserId, groupPath, mittiInviteMessageKey, mittiInviteStep, mittiRemovalStep, openInvites, plainMittiReason,
  priorInviteFor, userPath, userStatusBody, type InvitePerson, type InviteRecord, type InviteSwitches, type MittiInviteEventType,
} from "./mitti-invite.core";

const EVENT_TYPES = Object.values(MITTI_INVITE_EVENTS);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

/** Live switches: env MITTI_AUTO_INVITE_ENABLED (default off), the verified-API constant, env MITTI_TRADES_GROUP_ID. */
export function currentInviteSwitches(): InviteSwitches {
  return { enabled: autoInviteEnabled(process.env[MITTI_AUTO_INVITE_ENV]), apiVerified: MITTI_USER_API_VERIFIED, groupId: process.env[MITTI_TRADES_GROUP_ENV]?.trim() || null };
}

async function loadInviteRecords(workerId?: string): Promise<InviteRecord[]> {
  let q = admin.from("admin_config_events").select("event_type, created_at, details").in("event_type", EVENT_TYPES).order("created_at", { ascending: false }).limit(500);
  if (workerId) q = q.contains("details", { worker_id: workerId });
  const { data, error } = await q;
  if (error) throw new WorkflowError(`Mitti invite records could not be read: ${error.message}`);
  return (data ?? []).map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    return { workerId: s("worker_id") ?? "", type: r.event_type as MittiInviteEventType, at: r.created_at, email: s("email"), name: s("name"), business: s("business"), group: s("group"), mittiUserId: s("mitti_user_id"), groupAdded: d["group_added"] === true, reason: s("reason") };
  }).filter((r) => r.workerId);
}

async function isTestPerson(email: string | null, biz: { name?: string | null; onboarding_notes?: string | null } | null) {
  const { isTestRecipient } = await import("./emailsafety.core");
  const { isTestPartner } = await import("./test-send.core");
  // isTestRecipient treats a blank email as "test"; a person with no email is stopped by eligibility anyway.
  return (!!email && isTestRecipient(email)) || isTestPartner(biz ?? {});
}

async function loadPerson(workerId: string) {
  const { data: w, error } = await admin.from("partner_workers").select("id, email, mobile, full_legal_name, trade_role, worker_role, approval_status, removed_at, profile_id, business_id").eq("id", workerId).maybeSingle();
  if (error) throw new WorkflowError(`This person could not be read: ${error.message}`);
  if (!w) throw new WorkflowError("Partner person not found.");
  const [{ data: b }, { data: p }, records] = await Promise.all([
    admin.from("businesses").select("name, email, onboarding_notes").eq("id", w.business_id).maybeSingle(),
    w.profile_id ? admin.from("profiles").select("email, mitti_user_id, mitti_checked_email, mitti_checked_at").eq("id", w.profile_id).maybeSingle() : Promise.resolve({ data: null }),
    loadInviteRecords(workerId),
  ]);
  const { workerEmailKey, effectiveWorkerRole, hasMittiAccessToday, mittiEmailFor, certOrFilter } = await import("./worker-role.core");
  const own = workerEmailKey(w.email) || null;
  const { mittiAccessOf } = await import("./mitti-membership.core");
  const mittiAccess = p ? mittiAccessOf(p) : null;
  // Jo 28 Oct: Lead / Crew. A null role counts as Crew unless the person already has Mitti access today.
  const role = effectiveWorkerRole({ tradeRole: w.trade_role, stored: (w as { worker_role?: string | null }).worker_role, hasMittiAccess: hasMittiAccessToday(records[0]?.type ?? null, mittiAccess === "member") });
  // A Lead with no email of their own is invited / linked with the business's own email.
  const target = w.trade_role === "installer" ? mittiEmailFor({ role, ownEmail: own, businessEmail: (b as { email?: string | null } | null)?.email }) : { email: own, source: own ? "own" as const : null };
  const email = target.email;
  // Decision 153: an installer counts once the office-verified CII check is recorded with level + unexpired expiry.
  let ciiCleared = false;
  if (w.trade_role === "installer") {
    const { data: certs } = await admin.from("partner_worker_certifications").select("id, status").or(certOrFilter([{ id: w.id, email: own }])).order("recorded_at", { ascending: false }).limit(1);
    const c = certs?.[0];
    const { data: lv } = c ? await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", c.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const { crewClearance } = await import("./worker-compliance.core");
    ciiCleared = crewClearance({ removed_at: w.removed_at, certStatus: c?.status ?? null, level: lv?.level ?? null, expiresOn: lv?.expires_on ?? null }, today()).cleared;
  }
  const person: InvitePerson = {
    workerId: w.id, tradeRole: w.trade_role, approvalStatus: w.approval_status, removedAt: w.removed_at, email, ciiCleared,
    mittiAccess, isTest: await isTestPerson(email, b ?? null), crew: role === "crew",
  };
  // The portal-login check only applies when the person's own email is used (a business email never matches their login).
  const profileMismatch = !!own && !!w.profile_id && (!p || p.email?.trim().toLowerCase() !== own);
  return { person, profileMismatch, name: w.full_legal_name as string | null, mobile: (w.mobile ?? null) as string | null, business: b?.name ?? null, businessId: w.business_id as string,
    profileId: target.source === "own" ? (w.profile_id as string | null) : null, emailSource: target.source };
}

/** Jo 28 Oct: effective Lead / Crew for installer people (null for others), for the Team pages and the role switch. */
export async function workerRolesFor(workers: { id: string; trade_role: string; worker_role?: string | null; profile_id: string | null }[]) {
  const out = new Map<string, "lead" | "crew" | null>();
  const installers = workers.filter((w) => w.trade_role === "installer");
  for (const w of workers) if (w.trade_role !== "installer") out.set(w.id, null);
  if (!installers.length) return out;
  const { effectiveWorkerRole, hasMittiAccessToday } = await import("./worker-role.core");
  const { mittiAccessOf } = await import("./mitti-membership.core");
  const needLookup = installers.filter((w) => w.worker_role !== "lead" && w.worker_role !== "crew");
  const profileIds = needLookup.map((w) => w.profile_id).filter((x): x is string => !!x);
  const [records, profiles] = needLookup.length ? await Promise.all([
    loadInviteRecords(),
    profileIds.length ? admin.from("profiles").select("id, email, mitti_user_id, mitti_checked_email, mitti_checked_at").in("id", profileIds).then((r) => r.data ?? []) : Promise.resolve([] as never[]),
  ]) : [[], []];
  for (const w of installers) {
    const latest = (records as InviteRecord[]).find((r) => r.workerId === w.id)?.type ?? null;
    const prof = (profiles as { id: string }[]).find((x) => x.id === w.profile_id);
    out.set(w.id, effectiveWorkerRole({ tradeRole: w.trade_role, stored: w.worker_role, hasMittiAccess: hasMittiAccessToday(latest, prof ? mittiAccessOf(prof as never) === "member" : false) }));
  }
  return out;
}

async function record(actorId: string | null, type: MittiInviteEventType, summary: string, details: Record<string, unknown>) {
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: type, summary, details: details as Json });
  if (error) throw new WorkflowError(`The Mitti record could not be saved: ${error.message}`);
}

async function linkProfile(profileId: string | null, mittiUserId: string, email: string) {
  if (!profileId) return;
  // Same record the Check Mitti access button writes: who was found, for which email, when.
  const { data, error } = await admin.from("profiles").update({ mitti_user_id: mittiUserId, mitti_checked_email: email, mitti_checked_at: new Date().toISOString() }).eq("id", profileId).ilike("email", email).select("id");
  if (error) throw new WorkflowError(`Mitti user found, but the link could not be saved on the profile: ${error.message}`);
  if (data?.length !== 1) throw new WorkflowError("The person's email changed before their Mitti link was saved — the office must check their account.");
}

async function realCall(): Promise<MittiCall> { return (await import("./mitti.server")).realMittiCall; }

/** The one message to a newly invited person: a text when they have an Australian mobile, else an email. Existing partner
 *  senders only (sendRealSms type `mitti_invite` / sendOfficeEmail), so customer_comms_enabled, the type's own switch,
 *  quiet hours, STOP and business approval all apply. Never throws. */
export type InviteMessenger = (p: { workerId: string; businessId: string; to: { mobile: string | null; email: string }; name: string | null; at: string; actorId: string | null }) => Promise<string>;
export const realInviteMessenger: InviteMessenger = async (p) => {
  try {
    const { toAuE164 } = await import("./sms.core");
    const mobile = toAuE164(p.to.mobile);
    if (mobile) {
      const { sendRealSms } = await import("./sms.server");
      const r = await sendRealSms({ type: "mitti_invite", idempotencyKey: mittiInviteMessageKey(p.workerId), to: mobile, body: MITTI_INVITE_MESSAGE, businessId: p.businessId, event: { at: p.at, current: true } });
      return `text ${r.status}: ${r.detail}`;
    }
    const { sendOfficeEmail } = await import("./office-email.server");
    const mail = renderMittiInviteEmail({ name: p.name, test: false });
    const r = await sendOfficeEmail({ actorId: p.actorId, recipient: "partner", to: p.to.email, contactName: p.name, subject: MITTI_INVITE_SUBJECT, message: MITTI_INVITE_MESSAGE, html: mail.html, text: mail.text, label: mittiInviteMessageKey(p.workerId), record: { businessId: p.businessId } });
    return `email ${r.status}: ${r.detail}`;
  } catch (e) { return `message not sent — ${(e as Error).message}`; }
};

type Opts = { switches?: InviteSwitches; call?: MittiCall; message?: InviteMessenger; password?: () => string };

/**
 * Called after the office approves a partner person (worker approved, or an installer's CII verified). Switch OFF → returns
 * at once, nothing read or written. ON → at most one Mitti search, then link / create (+ HIV trades group, + one message) /
 * "invite needed", recorded once. Re-approval after a removal reactivates the same Mitti user.
 */
export async function onPartnerPersonApproved(workerId: string, actorId: string | null, opts: Opts = {}) {
  const sw = opts.switches ?? currentInviteSwitches();
  if (!sw.enabled) return { action: "skip" as const, reason: "Mitti auto-invite is switched off." };
  const { person, profileMismatch, name, mobile, business, businessId, profileId, emailSource } = await loadPerson(workerId);
  if (profileMismatch && !person.isTest) {
    const reason = "The worker's email does not match their linked portal login — the office must correct the person link before Mitti access is changed.";
    await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { worker_id: workerId, email: person.email, reason });
    return { action: "fail" as const, reason };
  }
  const prior = priorInviteFor(workerId, await loadInviteRecords(workerId));
  const call = opts.call ?? await realCall();
  const base = { worker_id: workerId, email: person.email, name, business, trade_role: person.tradeRole, ...(emailSource === "business" ? { email_source: "business" } : {}) };
  let step = mittiInviteStep(person, prior, sw);
  if (step.action === "lookup") {
    const looking = step;
    try {
      const { findMittiUserByEmail } = await import("./mitti.server");
      step = mittiInviteStep(person, prior, sw, { mittiUserId: await findMittiUserByEmail(person.email!, call) });
    } catch (e) {
      const reason = plainMittiReason(e, `Mitti could not be searched for ${person.email}`);
      await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { ...base, key: looking.key, group: looking.group, seat: looking.seat, reason, mitti_user_id: null });
      return { action: "fail" as const, reason };
    }
  }
  if (step.action === "skip" || step.action === "lookup") return step;
  const details = { ...base, key: step.key, group: step.group, seat: step.seat };
  const addGroup = async (mittiUserId: string, groupId: string | null) => {
    if (!groupId) return { added: false, note: "no group ID configured (MITTI_TRADES_GROUP_ID) or Mitti user calls not verified" };
    try { await call("POST", groupPath(groupId), addToGroupBody(mittiUserId)); return { added: true, note: null }; }
    catch (e) { return { added: false, note: plainMittiReason(e, "Group add failed") }; }
  };

  if (step.action === "fail") {
    await record(actorId, MITTI_INVITE_EVENTS.failed, step.reason, { ...details, reason: step.reason, mitti_user_id: prior?.mittiUserId ?? null });
    return step;
  }
  if (step.action === "record_needed") {
    await record(actorId, MITTI_INVITE_EVENTS.needed, `Mitti invite needed for ${person.email} (${step.seat} seat, ${step.group} group) — the portal's Mitti user calls are not verified yet`, { ...details, mitti_user_id: null, group_added: false, template_access: MITTI_TEMPLATE_ACCESS_NOTE });
    return step;
  }
  if (step.action === "record_linked") {
    await linkProfile(profileId, step.mittiUserId, person.email!);
    const g = await addGroup(step.mittiUserId, step.addToGroup);
    await record(actorId, MITTI_INVITE_EVENTS.userLinked, `Mitti user found for ${person.email} and linked${g.added ? ` — added to ${step.group}` : ""}`, { ...details, mitti_user_id: step.mittiUserId, group_added: g.added, group_note: g.note });
    return step;
  }
  if (step.action === "reactivate") {
    try { await call("PUT", userPath(step.mittiUserId), userStatusBody("active")); }
    catch (e) {
      const reason = plainMittiReason(e, `Reactivate ${person.email} in Mitti by hand`);
      await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { ...details, reason, mitti_user_id: step.mittiUserId });
      return { action: "fail" as const, reason };
    }
    await linkProfile(profileId, step.mittiUserId, person.email!);
    await record(actorId, MITTI_INVITE_EVENTS.reactivated, `Mitti user for ${person.email} reactivated (approved again)`, { ...details, mitti_user_id: step.mittiUserId, group_added: true });
    return step;
  }
  // create: the throwaway password is never stored or logged.
  let mittiUserId: string | null = null;
  try {
    const password = opts.password ? opts.password() : `${crypto.randomUUID()}Aa1!`;
    mittiUserId = createdUserId(await call(MITTI_USER_API.create.method, MITTI_USER_API.create.path, createUserBody({ fullName: name, email: person.email!, seat: step.seat, password })));
    if (!mittiUserId) throw new Error("Mitti did not return the new user's ID.");
  } catch (e) {
    const reason = plainMittiReason(e, `Mitti could not create a user for ${person.email} — invite them in Mitti by hand (${step.seat} seat, ${step.group} group)`);
    await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { ...details, reason, mitti_user_id: mittiUserId });
    return { action: "fail" as const, reason };
  }
  await linkProfile(profileId, mittiUserId, person.email ?? "");
  const g = await addGroup(mittiUserId, step.addToGroup);
  const at = new Date().toISOString();
  // Recorded BEFORE the message, so a second approval finds it and never invites or messages again.
  await record(actorId, MITTI_INVITE_EVENTS.invited, `Mitti user created for ${person.email} (${step.seat} seat${g.added ? `, ${step.group} group` : ""})`, { ...details, mitti_user_id: mittiUserId, group_added: g.added, group_note: g.note, message_key: mittiInviteMessageKey(workerId) });
  const message = await (opts.message ?? realInviteMessenger)({ workerId, businessId, to: { mobile, email: person.email! }, name, at, actorId });
  return { ...step, mittiUserId, groupAdded: g.added, message };
}

/**
 * Called after a partner person is removed from the business or rejected by the office. Switch OFF → nothing. ON → the
 * Mitti user the portal invited or linked is deactivated once (so the seat can be released), unless the same email is
 * still an active trade elsewhere. Deactivation frees the seat; reducing the licence count stays a Mitti admin step.
 */
export async function onPartnerPersonRemoved(workerId: string, actorId: string | null, opts: Pick<Opts, "switches" | "call"> = {}) {
  const sw = opts.switches ?? currentInviteSwitches();
  if (!sw.enabled) return { action: "skip" as const, reason: "Mitti auto-invite is switched off." };
  const { data: w, error } = await admin.from("partner_workers").select("id, email, full_legal_name, approval_status, removed_at, profile_id, business_id").eq("id", workerId).maybeSingle();
  if (error || !w) throw new WorkflowError("Partner person not found.");
  const prior = priorInviteFor(workerId, await loadInviteRecords(workerId));
  // Jo 28 Oct: a Lead with no email of their own was invited with the business's email (recorded on the invite).
  const email = w.email?.trim().toLowerCase() || prior?.email?.trim().toLowerCase() || null;
  const [{ data: b }, { data: others, error: othersError }] = await Promise.all([
    admin.from("businesses").select("name, onboarding_notes").eq("id", w.business_id).maybeSingle(),
    email ? admin.from("partner_workers").select("id, approval_status, removed_at").ilike("email", email) : Promise.resolve({ data: [] as { id: string; approval_status: string; removed_at: string | null }[], error: null }),
  ]);
  if (othersError) throw new WorkflowError("Other active memberships could not be checked — Mitti access was not removed.");
  const stillActiveElsewhere = (others ?? []).some((o) => o.id !== w.id && !o.removed_at && o.approval_status === "approved");
  const step = mittiRemovalStep({ workerId, email, isTest: await isTestPerson(email, b ?? null), removedAt: w.removed_at, approvalStatus: w.approval_status, stillActiveElsewhere }, prior, sw);
  if (step.action === "skip") return step;
  const details = { worker_id: workerId, email, name: w.full_legal_name, business: b?.name ?? null, mitti_user_id: step.mittiUserId };
  if (step.action === "fail") { await record(actorId, MITTI_INVITE_EVENTS.failed, step.reason, { ...details, reason: step.reason }); return step; }
  try { await (opts.call ?? await realCall())("PUT", userPath(step.mittiUserId), userStatusBody("inactive")); }
  catch (e) {
    const reason = plainMittiReason(e, `Deactivate ${email ?? "this person"} in Mitti by hand so the seat can be released`);
    await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { ...details, reason });
    return { action: "fail" as const, reason, mittiUserId: step.mittiUserId };
  }
  await record(actorId, MITTI_INVITE_EVENTS.deactivated, `Mitti user for ${email} deactivated (removed in the portal) — reduce the licence count in Mitti if the seat is not reused`, details);
  return step;
}

/**
 * Jo 28 Oct: a person switched from Lead to Crew. Same deactivate path and record as onPartnerPersonRemoved, while they
 * stay active in the portal; kept when the same Mitti email still belongs to another active Lead. Switch OFF → nothing.
 */
export async function onPartnerPersonDemoted(workerId: string, actorId: string | null, opts: Pick<Opts, "switches" | "call"> = {}) {
  const sw = opts.switches ?? currentInviteSwitches();
  if (!sw.enabled) return { action: "skip" as const, reason: "Mitti auto-invite is switched off." };
  const { data: w, error } = await admin.from("partner_workers").select("id, email, full_legal_name, trade_role, approval_status, removed_at, business_id").eq("id", workerId).maybeSingle();
  if (error || !w) throw new WorkflowError("Partner person not found.");
  const { workerEmailKey, emailStillUsedByAnotherLead } = await import("./worker-role.core");
  const prior = priorInviteFor(workerId, await loadInviteRecords(workerId));
  const { data: b } = await admin.from("businesses").select("name, email, onboarding_notes").eq("id", w.business_id).maybeSingle();
  // The Mitti email the portal used: their own, else the one recorded on their invite (a Lead with no email uses the business's).
  const email = workerEmailKey(w.email) || workerEmailKey(prior?.email) || null;
  let stillUsed = false;
  if (email) {
    const [{ data: sameEmail, error: e1 }, { data: sameBiz, error: e2 }] = await Promise.all([
      admin.from("partner_workers").select("id, email, trade_role, worker_role, approval_status, removed_at, business_id, profile_id").ilike("email", email),
      admin.from("partner_workers").select("id, email, trade_role, worker_role, approval_status, removed_at, business_id, profile_id").eq("business_id", w.business_id),
    ]);
    if (e1 || e2) throw new WorkflowError("Other active Leads could not be checked — Mitti access was not removed.");
    const bizEmail = workerEmailKey((b as { email?: string | null } | null)?.email);
    const rows = new Map<string, Record<string, unknown>>();
    for (const r of [...(sameEmail ?? []), ...(sameBiz ?? [])] as Record<string, unknown>[]) rows.set(r["id"] as string, r);
    // Others' roles as they apply today (a null role is Lead only when that person already has Mitti access).
    const roles = await workerRolesFor([...rows.values()].filter((r) => r["id"] !== w.id) as never);
    const others = [...rows.values()].map((r) => ({ id: r["id"] as string, tradeRole: r["trade_role"] as string, workerRole: roles.get(r["id"] as string) ?? null, removedAt: (r["removed_at"] as string | null) ?? null, approvalStatus: r["approval_status"] as string,
      mittiEmail: workerEmailKey(r["email"] as string | null) || (r["business_id"] === w.business_id ? bizEmail || null : null) }));
    stillUsed = emailStillUsedByAnotherLead(w.id, email, others);
  }
  const step = mittiRemovalStep({ workerId, email, isTest: await isTestPerson(email, b ?? null), removedAt: w.removed_at, approvalStatus: w.approval_status, stillActiveElsewhere: stillUsed, demoted: true }, prior, sw);
  if (step.action === "skip") return step;
  const details = { worker_id: workerId, email, name: w.full_legal_name, business: b?.name ?? null, mitti_user_id: step.mittiUserId, reason_kind: "switched_to_crew" };
  if (step.action === "fail") { await record(actorId, MITTI_INVITE_EVENTS.failed, step.reason, { ...details, reason: step.reason }); return step; }
  try { await (opts.call ?? await realCall())("PUT", userPath(step.mittiUserId), userStatusBody("inactive")); }
  catch (e) {
    const reason = plainMittiReason(e, `Deactivate ${email ?? "this person"} in Mitti by hand so the seat can be released`);
    await record(actorId, MITTI_INVITE_EVENTS.failed, reason, { ...details, reason });
    return { action: "fail" as const, reason, mittiUserId: step.mittiUserId };
  }
  await record(actorId, MITTI_INVITE_EVENTS.deactivated, `Mitti user for ${email} deactivated (switched to Crew in the portal) — reduce the licence count in Mitti if the seat is not reused`, details);
  return step;
}

/** Staff approvals (People): people the office still has to finish in Mitti. */
export async function listOpenMittiInvites() {
  const sw = currentInviteSwitches();
  return { enabled: sw.enabled, apiVerified: !!sw.apiVerified, invites: openInvites(await loadInviteRecords()) };
}

/** Office confirms (per person) the Mitti step was done by hand. If the person has a portal login, the real Mitti search
 *  then re-checks and stores their membership. Append-only; never invites. */
export async function confirmMittiInviteDone(workerId: string, actorId: string, call?: MittiCall) {
  const open = openInvites(await loadInviteRecords(workerId))[0];
  if (!open) throw new WorkflowError("There is no open Mitti invite for this person.");
  await record(actorId, MITTI_INVITE_EVENTS.done, `Office confirmed ${open.email ?? "this person"} is set up in Mitti`, { worker_id: workerId, email: open.email, name: open.name, business: open.business, group: open.group, mitti_user_id: open.mittiUserId });
  const { data: w } = await admin.from("partner_workers").select("profile_id").eq("id", workerId).maybeSingle();
  if (w?.profile_id) {
    const { verifyMittiMember } = await import("./mitti-membership.server");
    return { ok: true, access: (call ? await verifyMittiMember(w.profile_id, actorId, call) : await verifyMittiMember(w.profile_id, actorId)).access };
  }
  return { ok: true, access: null };
}
