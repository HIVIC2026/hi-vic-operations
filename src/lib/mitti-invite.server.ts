// Mitti auto-invite on partner-person approval (decision 188). Rules are pure in mitti-invite.core.ts; this file reads the
// person, runs the ONE real Mitti call the portal has for this (user search by email, via findMittiUserByEmail) and records
// the result as an append-only admin_config_events row (person-level: workflow_events needs a job). It never creates a
// Mitti user or group membership — those endpoints are not known (MITTI_INVITE_MISSING_ENDPOINTS) — and never sends anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { WorkflowError } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import {
  MITTI_AUTO_INVITE_ENABLED, MITTI_AUTO_INVITE_PROBE_DONE, MITTI_INVITE_EVENTS, MITTI_INVITE_MISSING_ENDPOINTS, MITTI_TEMPLATE_ACCESS_NOTE,
  mittiInviteStep, openInvites, priorInviteFor, type InvitePerson, type InviteRecord, type InviteSwitches, type MittiInviteEventType,
} from "./mitti-invite.core";

const EVENT_TYPES = Object.values(MITTI_INVITE_EVENTS);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

async function loadInviteRecords(workerId?: string): Promise<InviteRecord[]> {
  let q = admin.from("admin_config_events").select("event_type, created_at, details").in("event_type", EVENT_TYPES).order("created_at", { ascending: false }).limit(500);
  if (workerId) q = q.contains("details", { worker_id: workerId });
  const { data, error } = await q;
  if (error) throw new WorkflowError(`Mitti invite records could not be read: ${error.message}`);
  return (data ?? []).map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    return { workerId: s("worker_id") ?? "", type: r.event_type as MittiInviteEventType, at: r.created_at, email: s("email"), name: s("name"), business: s("business"), group: s("group"), mittiUserId: s("mitti_user_id") };
  }).filter((r) => r.workerId);
}

async function loadPerson(workerId: string) {
  const { data: w, error } = await admin.from("partner_workers").select("id, email, full_legal_name, trade_role, approval_status, removed_at, profile_id, business_id").eq("id", workerId).maybeSingle();
  if (error) throw new WorkflowError(`This person could not be read: ${error.message}`);
  if (!w) throw new WorkflowError("Partner person not found.");
  const [{ data: b }, { data: p }] = await Promise.all([
    admin.from("businesses").select("name, onboarding_notes").eq("id", w.business_id).maybeSingle(),
    w.profile_id ? admin.from("profiles").select("email, mitti_user_id, mitti_checked_email, mitti_checked_at").eq("id", w.profile_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const email = w.email?.trim().toLowerCase() ?? null;
  // Decision 153: an installer counts once the office-verified CII check is recorded with level + unexpired expiry.
  let ciiCleared = false;
  if (w.trade_role === "installer" && email) {
    const { data: certs } = await admin.from("partner_worker_certifications").select("id, status").or(`worker_id.eq.${w.id},worker_email.eq.${email}`).order("recorded_at", { ascending: false }).limit(1);
    const c = certs?.[0];
    const { data: lv } = c ? await admin.from("worker_certification_levels").select("level, expires_on").eq("certification_id", c.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const { crewClearance } = await import("./worker-compliance.core");
    ciiCleared = crewClearance({ removed_at: w.removed_at, certStatus: c?.status ?? null, level: lv?.level ?? null, expiresOn: lv?.expires_on ?? null }, today()).cleared;
  }
  const { mittiAccessOf } = await import("./mitti-membership.core");
  const { isTestRecipient } = await import("./emailsafety.core");
  const { isTestPartner } = await import("./test-send.core");
  const person: InvitePerson = {
    workerId: w.id, tradeRole: w.trade_role, approvalStatus: w.approval_status, removedAt: w.removed_at, email, ciiCleared,
    mittiAccess: p ? mittiAccessOf(p) : null,
    // isTestRecipient treats a blank email as "test"; a person with no email is stopped by eligibility first anyway.
    isTest: (!!email && isTestRecipient(email)) || isTestPartner(b ?? null),
  };
  return { person, name: w.full_legal_name, business: b?.name ?? null, profileId: w.profile_id };
}

/**
 * Called after the office approves a partner person (worker approved, or an installer's CII verified). Switch OFF → returns
 * at once, nothing read or written. ON → at most one Mitti user search per person, ever; the outcome is recorded once
 * (linked existing user / invite needed) and shown on Staff approvals for the office to finish in Mitti.
 */
export async function onPartnerPersonApproved(workerId: string, actorId: string | null, opts: { switches?: InviteSwitches; call?: MittiCall } = {}) {
  const sw = opts.switches ?? { enabled: MITTI_AUTO_INVITE_ENABLED, probeDone: MITTI_AUTO_INVITE_PROBE_DONE };
  if (!sw.enabled) return { action: "skip" as const, reason: "Mitti auto-invite is switched off." };
  const { person, name, business, profileId } = await loadPerson(workerId);
  const prior = priorInviteFor(workerId, await loadInviteRecords(workerId));
  let step = mittiInviteStep(person, prior, sw);
  if (step.action === "lookup") {
    const { findMittiUserByEmail } = await import("./mitti.server");
    const mittiUserId = opts.call ? await findMittiUserByEmail(person.email!, opts.call) : await findMittiUserByEmail(person.email!);
    step = mittiInviteStep(person, prior, sw, { mittiUserId });
  }
  if (step.action === "skip" || step.action === "lookup") return step;
  const now = new Date().toISOString();
  if (step.action === "record_linked" && profileId) {
    // Same record the Check Mitti access button writes: who was found, for which email, when.
    const { error } = await admin.from("profiles").update({ mitti_user_id: step.mittiUserId, mitti_checked_email: person.email, mitti_checked_at: now }).eq("id", profileId);
    if (error) throw new WorkflowError(`Mitti found this person, but the link could not be saved: ${error.message}`);
  }
  const type = step.action === "record_linked" ? MITTI_INVITE_EVENTS.linked : MITTI_INVITE_EVENTS.needed;
  const summary = step.action === "record_linked"
    ? `Mitti user found for ${person.email} and linked — add them to the ${step.group} group in Mitti (template access stays manual)`
    : `Mitti invite needed for ${person.email} (${step.seat} seat, ${step.group} group) — the portal cannot create Mitti users`;
  const { error } = await admin.from("admin_config_events").insert({
    actor_id: actorId, event_type: type, summary,
    details: { worker_id: workerId, key: step.key, email: person.email, name, business, trade_role: person.tradeRole, group: step.group, seat: step.seat, mitti_user_id: step.action === "record_linked" ? step.mittiUserId : null, is_test: person.isTest, missing_endpoints: [...MITTI_INVITE_MISSING_ENDPOINTS], template_access: MITTI_TEMPLATE_ACCESS_NOTE } as Json,
  });
  if (error) throw new WorkflowError(`The Mitti invite record could not be saved: ${error.message}`);
  return step;
}

/** Staff approvals (People): people the office still has to finish in Mitti. */
export async function listOpenMittiInvites() {
  return { enabled: MITTI_AUTO_INVITE_ENABLED, probeDone: MITTI_AUTO_INVITE_PROBE_DONE, missingEndpoints: [...MITTI_INVITE_MISSING_ENDPOINTS], invites: openInvites(await loadInviteRecords()) };
}

/** Office confirms (per person) the Mitti invite, group and template access were done in Mitti. If the person has a portal
 *  login, the real Mitti search then re-checks and stores their membership. Append-only; never invites. */
export async function confirmMittiInviteDone(workerId: string, actorId: string, call?: MittiCall) {
  const open = openInvites(await loadInviteRecords(workerId))[0];
  if (!open) throw new WorkflowError("There is no open Mitti invite for this person.");
  const { error } = await admin.from("admin_config_events").insert({
    actor_id: actorId, event_type: MITTI_INVITE_EVENTS.done, summary: `Office confirmed ${open.email ?? "this person"} is set up in Mitti (invite, ${open.group ?? ""} group, templates)`,
    details: { worker_id: workerId, email: open.email, name: open.name, business: open.business, group: open.group, mitti_user_id: open.mittiUserId } as Json,
  });
  if (error) throw new WorkflowError(`Could not record that: ${error.message}`);
  const { data: w } = await admin.from("partner_workers").select("profile_id").eq("id", workerId).maybeSingle();
  if (w?.profile_id) {
    const { verifyMittiMember } = await import("./mitti-membership.server");
    return { ok: true, access: (call ? await verifyMittiMember(w.profile_id, actorId, call) : await verifyMittiMember(w.profile_id, actorId)).access };
  }
  return { ok: true, access: null };
}
