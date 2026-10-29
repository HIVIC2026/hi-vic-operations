// RPC for Add a job: electrician choices, adding an electrician, and AI reading of an uploaded file.
// Bulk upload itself is gone (Jo, 28 Oct); the old batch create/review/confirm functions are removed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { requireMember } from "./pilot.server";
import { WorkflowError } from "./workflow.server";
import { partnerWorkBlocker, type BusinessLike, type Credential } from "./pilot.core";
import { hashToken, newToken } from "./worker-links.core";

const uuid = z.string().uuid();

function checkedBulk<T>(result: { data: T; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new WorkflowError(`${operation}: ${result.error.message}`);
  return result.data;
}

/** Read access requires a current Office role or active business-admin membership. Work also rechecks approval. */
async function bulkBusinessAccess(actorId: string, businessId: string, work = false) {
  const isAdmin = checkedBulk(await admin.rpc("has_role", { _user_id: actorId, _role: "admin" }), "Could not verify Office access") === true;
  if (!isAdmin) {
    const member = checkedBulk(await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("user_id", actorId).eq("active", true).eq("member_role", "business_admin").maybeSingle(), "Could not verify business-admin access");
    if (!member) throw new WorkflowError("Only an active business admin can manage this upload.");
  }
  if (work) {
    const business = checkedBulk(await admin.from("businesses").select("*").eq("id", businessId).maybeSingle(), "Could not check the current partner approval");
    const credentialsRead = await admin.from("business_credentials").select("kind,label,expires_at,critical,verification", { count: "exact" }).eq("business_id", businessId);
    const credentials = checkedBulk(credentialsRead, "Could not check the current partner credentials") ?? [];
    if (credentialsRead.count == null || credentialsRead.count !== credentials.length) throw new WorkflowError("The complete partner credential check was not available. Please try again.");
    const blocker = partnerWorkBlocker(business as BusinessLike | null, credentials as Credential[]);
    if (blocker) throw new WorkflowError(blocker);
    if (business?.business_type !== "eec_installer") throw new WorkflowError("Bulk uploads are available only for an approved installer business.");
  }
  return { isAdmin };
}

async function canUseBulkImport(userId: string, businessId: string, onBehalf: boolean) {
  const { isAdmin } = await bulkBusinessAccess(userId,businessId,true);
  if (!isAdmin) throw new WorkflowError("Uploading multiple jobs is switched off. Start each job's Ready Check in Mitti and it will appear here automatically.");
  if (onBehalf) {
    if (!isAdmin) throw new WorkflowError("Only the office can upload on behalf of an installer.");
  } else {
    await requireMember(userId, businessId, true); // boss only (matches route-guards INSTALLER_BOSS_ONLY)
  }
  return !!isAdmin;
}

export const bulkElectricianChoices = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, data.businessId, true);
    const [{ data: rels }, { data: nominations }] = await Promise.all([
      admin.from("partner_relationships").select("electrician_business_id,is_primary,businesses!partner_relationships_electrician_business_id_fkey(name,trading_name,onboarding_status)").eq("installer_business_id", data.businessId).eq("active", true),
      admin.from("electrician_nominations").select("id,contact_name,business_name,status,business_id").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null).order("created_at", { ascending: false }),
    ]);
    return { approved: (rels ?? []).map((r) => ({ businessId: r.electrician_business_id, primary: r.is_primary, name: (r.businesses as { trading_name?: string | null; name?: string } | null)?.trading_name || (r.businesses as { name?: string } | null)?.name || "Your electrician", status: "Already signed up ✓" })), pending: (nominations ?? []).filter((n) => !n.business_id).map((n) => ({ nominationId: n.id, name: n.contact_name, business: n.business_name, status: n.status })) };
  });

export const addBulkElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, name: z.string().trim().min(2).max(200), mobile: z.string().trim().min(8).max(40), email: z.string().trim().email("Add their email").max(320), business: z.string().trim().min(2, "Add their business").max(200), dryRun: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.businessId, true);
    const mobile = data.mobile.replace(/\D/g, "");
    let ownQuery = admin.from("electrician_nominations").select("id,contact_name,business_id,status,invite_sent_at,invite_link_issued_at,email").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null);
    ownQuery = data.email ? ownQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : ownQuery.eq("phone", mobile);
    const { data: own, error: ownError } = await ownQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ownError) throw new WorkflowError("Couldn't check the electrician. Your details are still here; please try again.");
    if (own) {
      if (own.business_id) return { nominationId: own.id, businessId: own.business_id, name: own.contact_name, status: "Already signed up ✓" };
      const { data: attempts, error: attemptError } = await admin.from("admin_config_events").select("id").eq("event_type", "office_manual_email").contains("details", { nominationId: own.id, label: "electrician_invite" }).limit(1);
      if (attemptError) throw new WorkflowError("Invitation delivery could not be checked. Nothing was sent.");
      const { existingElectricianInviteBlocker } = await import("./job-electrician.core");
      const blocked = existingElectricianInviteBlocker({ status: own.status, sentAt: own.invite_sent_at, issuedAt: own.invite_link_issued_at, attempted: !!attempts?.length });
      if (blocked) throw new WorkflowError(blocked);
      if (own.email?.trim().toLowerCase() !== data.email.trim().toLowerCase()) throw new WorkflowError("This mobile is already linked to different electrician details. Ask the office to check them; nothing was sent.");
      const invite = newToken();
      const { data: claimed, error: claimError } = await admin.from("electrician_nominations").update({ invite_link_issued_at: new Date().toISOString(), invite_token_hash: await hashToken(invite), invite_expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString() }).eq("id", own.id).eq("nominating_business_id", data.businessId).eq("status", "invite_pending_comms").is("invite_sent_at", null).is("invite_link_issued_at", null).select("id").maybeSingle();
      if (claimError || !claimed) throw new WorkflowError("Invitation is being checked or sent. Ask the office to check delivery before trying again.");
      const sent = await (await import("./job-electrician-invite.server")).sendElectricianInvite({ actorId: context.userId, nominationId: own.id, installerBusinessId: data.businessId, inviteToken: invite, to: data.email, name: own.contact_name, dryRun: data.dryRun === true });
      return { nominationId: own.id, businessId: null, name: own.contact_name, status: sent.status === "sent" ? "Electrician invited – waiting to onboard" : "Electrician added – invitation delivery not confirmed", invite: { status: sent.status, to: sent.to } };
    }
    let matchQuery = admin.from("businesses").select("id").eq("onboarding_status", "approved");
    matchQuery = data.email ? matchQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : matchQuery.eq("phone", mobile);
    const { data: matched } = await matchQuery.limit(1).maybeSingle();
    const invite = newToken();
    const { data: nomination, error } = await admin.from("electrician_nominations").insert({
      contact_name: data.name, phone: mobile, email: data.email ?? null, business_name: data.business ?? null,
      nominating_business_id: data.businessId, nominated_by: context.userId, nominated_for: "installer",
      business_id: matched?.id ?? null, status: matched?.id ? "approved" : "invite_pending_comms", invite_link_issued_at: matched?.id ? null : new Date().toISOString(),
      invite_token_hash: matched?.id ? null : await hashToken(invite), invite_expires_at: matched?.id ? null : new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }).select("id").single();
    if (error || !nomination) throw new WorkflowError("That electrician could not be added.");
    // Jo (7 Oct): email them the electrician application link straight away (manual partner email rule).
    const sent = matched?.id ? null : await (await import("./job-electrician-invite.server")).sendElectricianInvite({ actorId: context.userId, nominationId: nomination.id, installerBusinessId: data.businessId, inviteToken: invite, to: data.email, name: data.name, dryRun: data.dryRun === true });
    return { nominationId: nomination.id, businessId: matched?.id ?? null, name: data.name, status: matched?.id ? "Already signed up ✓" : sent?.status === "sent" ? "Electrician invited – waiting to onboard" : "Electrician added – invitation delivery not confirmed", invite: sent ? { status: sent.status, to: sent.to } : null };
  });

export const readBulkFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, onBehalf: z.boolean().default(false), name: z.string().min(1).max(1000),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(1).max(14_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { aiReadMedia } = await import("./bulk-read-media.server");
    const text = await aiReadMedia(data.name, data.mime, data.base64);
    return { text: /^NONE\b/i.test(text) ? "" : text, description: /^NONE\b/i.test(text) ? text.replace(/^NONE\W*/i, "").slice(0, 120) : "" };
  });
