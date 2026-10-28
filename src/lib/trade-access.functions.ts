import { exactLike } from "./email-match";
// Office: give an approved trade worker their own sign-in, linked to the existing business, role and worker record.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError } from "./workflow.server";
import { grantedRole, memberRoleFor, TRADE_INVITE_DRAFT, TRADE_INVITE_EMAIL_APPROVED, tradeAccessBlocker } from "./trade-access.core";

export const tradeInviteDraft = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return { ...TRADE_INVITE_DRAFT, approved: TRADE_INVITE_EMAIL_APPROVED };
  });

/**
 * Creates (or finds) the worker's own account, links it, and returns a one-time set-password link.
 * `send` emails the invite only once Jo has approved the wording; otherwise the link is copied by the office.
 */
export const prepareTradeLogin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: z.string().uuid(), send: z.boolean().default(false), redirectTo: z.string().url().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.send && !TRADE_INVITE_EMAIL_APPROVED) throw new WorkflowError("Invite emails stay off until Jo approves the wording. Copy the link instead.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: w } = await admin.from("partner_workers").select("id, business_id, email, full_legal_name, approval_status, removed_at, trade_role, certification_status, licence_number, profile_id").eq("id", data.workerId).maybeSingle();
    if (!w) throw new WorkflowError("Staff member not found.");
    const { data: biz } = await admin.from("businesses").select("id, name, email, onboarding_status").eq("id", w.business_id).single();
    const block = tradeAccessBlocker(w, biz?.onboarding_status === "approved");
    if (block) throw new WorkflowError(block);
    const email = (w.email ?? "").trim().toLowerCase();
    const redirectTo = new URL("/reset-password", data.redirectTo).toString();

    // Existing account? keep it exactly as is, just link it.
    const { data: prof } = await admin.from("profiles").select("id, business_id").ilike("email", exactLike(email)).maybeSingle();
    if (prof?.business_id && prof.business_id !== w.business_id) throw new WorkflowError("This email already belongs to another business. Ask the person for a different email.");
    let link: string | null = null;
    let userId = prof?.id ?? null;
    if (data.send) {
      // Review I: invite emails obey the central communications master switch (fails closed when off or missing).
      const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled").eq("id", 1).maybeSingle();
      if (ws?.customer_comms_enabled !== true) throw new WorkflowError("Sending is switched off. Copy the link instead.");
      const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: w.full_legal_name } });
      if (error && !userId) throw new WorkflowError(`Invite could not be sent: ${error.message}`);
      userId = userId ?? inv?.user?.id ?? null;
    } else {
      const kind = userId ? "recovery" : "invite";
      const { data: gl, error } = await admin.auth.admin.generateLink({ type: kind, email, options: { redirectTo, ...(kind === "invite" ? { data: { full_name: w.full_legal_name } } : {}) } } as never);
      if (error) throw new WorkflowError(`Link could not be made: ${error.message}`);
      const g = gl as unknown as { user?: { id: string }; properties?: { hashed_token?: string } };
      userId = userId ?? g.user?.id ?? null;
      // Our own /reset-password link redeems the token itself, so it never falls back to the calculator home page.
      const { setPasswordLink } = await import("./set-password-link.core");
      link = g.properties?.hashed_token ? setPasswordLink(g.properties.hashed_token, "/portal", new URL(data.redirectTo).origin, kind) : null;
    }
    if (!userId) throw new WorkflowError("The account could not be created.");

    const role = grantedRole(w.trade_role);
    await admin.from("profiles").update({ business_id: w.business_id, ...(w.licence_number ? { licence_number: w.licence_number } : {}) }).eq("id", userId).is("business_id", null);
    await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
    const { data: existingMember } = await admin.from("business_members").select("member_role").eq("business_id", w.business_id).eq("user_id", userId).maybeSingle();
    await admin.from("business_members").upsert({ business_id: w.business_id, user_id: userId, member_role: existingMember?.member_role ?? memberRoleFor(email, biz?.email ?? null), active: true, added_by: context.userId }, { onConflict: "business_id,user_id" });
    await admin.from("partner_workers").update({ profile_id: userId, account_status: "linked", linked_by: context.userId, linked_at: new Date().toISOString() }).eq("id", w.id);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: data.send ? "trade_invite_sent" : "trade_login_link_prepared", summary: `${data.send ? "Invite emailed" : "Set-password link prepared"} for ${w.full_legal_name} (${biz?.name})`, details: { worker_id: w.id, business_id: w.business_id, user_id: userId, role } as Json });
    return { ok: true, link, sent: data.send };
  });
