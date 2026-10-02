import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";
import { hashToken, isTokenShape, newToken } from "./worker-links.core";
import { INVITE_STATE_MESSAGE, WORKER_DECLARATIONS_VERSION, inviteExpiry, inviteState, workerDeclarations, workerSubmissionErrors } from "./worker-invite.core";

const uuid = z.string().uuid();
const trade = z.enum(["electrician", "installer"]);

// ---------- Business owner: create / list / cancel invites ----------
export const listWorkerInvites = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("partner_worker_invites")
      .select("id, invitee_name, invitee_contact, trade_role, expires_at, used_at, revoked_at, created_at")
      .eq("business_id", data.businessId).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(`Could not load invites: ${error.message}`);
    const now = Date.now();
    return (rows ?? []).map((r) => ({ ...r, state: inviteState(r, now) }));
  });

export const createWorkerInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, name: z.string().trim().min(2).max(200), contact: z.string().trim().max(254).optional().nullable(), trade }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireMember } = await import("./pilot.server");
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) await requireMember(context.userId, data.businessId, true);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const token = newToken();
    const { error } = await admin.from("partner_worker_invites").insert({
      business_id: data.businessId, created_by: context.userId, invitee_name: data.name, invitee_contact: data.contact ?? null,
      trade_role: data.trade, token_hash: await hashToken(token), expires_at: inviteExpiry(Date.now()),
    });
    if (error) throw new Error(`Could not create invite: ${error.message}`);
    return { token };
  });

export const revokeWorkerInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites").select("id, business_id").eq("id", data.id).maybeSingle();
    if (!inv) throw new Error("Invite not found.");
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) { const { requireMember } = await import("./pilot.server"); await requireMember(context.userId, inv.business_id, true); }
    const { error } = await admin.from("partner_worker_invites").update({ revoked_at: new Date().toISOString() }).eq("id", inv.id).is("used_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Worker: public, token-verified ----------
export const getWorkerInvite = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ data }) => {
    if (!isTokenShape(data.token)) return { ok: false as const, message: "This invite link isn't valid. Check you copied the whole link." };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites")
      .select("id, invitee_name, trade_role, expires_at, used_at, revoked_at, businesses(name, trading_name)")
      .eq("token_hash", await hashToken(data.token)).maybeSingle();
    if (!inv) return { ok: false as const, message: "This invite link isn't valid. Check you copied the whole link." };
    const st = inviteState(inv, Date.now());
    if (st !== "active") return { ok: false as const, message: INVITE_STATE_MESSAGE[st] };
    const biz = inv.businesses as { name: string; trading_name: string | null } | null;
    const businessName = biz?.trading_name || biz?.name || "your business";
    const t = inv.trade_role as "electrician" | "installer";
    return { ok: true as const, inviteeName: inv.invitee_name, trade: t, businessName, declarations: workerDeclarations(t, businessName) };
  });

export const submitWorkerInvite = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({
    token: z.string(),
    full_legal_name: z.string().trim().max(200), mobile: z.string().trim().max(30), email: z.string().trim().toLowerCase().max(254),
    licence_number: z.string().trim().max(60).optional(), qualification: z.string().trim().max(200).optional(),
    accepted: z.array(z.string().max(40)).max(20), signed_name: z.string().trim().max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!isTokenShape(data.token)) return { ok: false as const, errors: ["This invite link isn't valid."] };
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await admin.from("partner_worker_invites")
      .select("id, business_id, trade_role, expires_at, used_at, revoked_at, created_by, businesses(name, trading_name)")
      .eq("token_hash", await hashToken(data.token)).maybeSingle();
    if (!inv) return { ok: false as const, errors: ["This invite link isn't valid."] };
    const st = inviteState(inv, Date.now());
    if (st !== "active") return { ok: false as const, errors: [INVITE_STATE_MESSAGE[st]] };
    const t = inv.trade_role as "electrician" | "installer";
    const biz = inv.businesses as { name: string; trading_name: string | null } | null;
    const decls = workerDeclarations(t, biz?.trading_name || biz?.name || "your business");
    const errors = workerSubmissionErrors(t, data, decls.map((x) => x.key));
    if (errors.length) return { ok: false as const, errors };
    const now = new Date().toISOString();
    // Claim the invite first so it can only ever be used once.
    const { data: claimed } = await admin.from("partner_worker_invites").update({ used_at: now }).eq("id", inv.id).is("used_at", null).is("revoked_at", null).select("id");
    if (!claimed?.length) return { ok: false as const, errors: ["This invite link has already been used."] };
    const { data: w, error } = await admin.from("partner_workers").insert({
      business_id: inv.business_id, full_legal_name: data.full_legal_name, email: data.email, mobile: data.mobile, trade_role: t,
      licence_number: t === "electrician" ? data.licence_number ?? null : null, qualification: t === "installer" ? data.qualification ?? null : null,
      added_by: inv.created_by, approval_status: "pending",
    }).select("id").single();
    if (error) {
      await admin.from("partner_worker_invites").update({ used_at: null }).eq("id", inv.id);
      return { ok: false as const, errors: [error.code === "23505" ? "Someone with that email is already registered under this business." : "We couldn't save your details. Please try again."] };
    }
    await admin.from("partner_worker_invites").update({
      worker_id: w.id, signed_name: data.signed_name, signed_ip: context.ip, signed_user_agent: context.userAgent,
      declarations: { version: WORKER_DECLARATIONS_VERSION, accepted: decls, signed_at: now },
    }).eq("id", inv.id);
    return { ok: true as const };
  });
