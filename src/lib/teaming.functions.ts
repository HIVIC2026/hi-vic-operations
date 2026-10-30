// Preferred-electrician invites. Public endpoints expose only first name + installer business name.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INVITE_DAYS, TEAM_STATUS_LABEL, inviteUsable, teamStatus } from "./teaming.core";

const token = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);
const uuid = z.string().uuid();
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function db() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
async function installerName(d: Awaited<ReturnType<typeof db>>, appId: string | null) {
  if (!appId) return "An Home Insulation Victoria installer";
  const { data } = await d.from("rec_onboarding_applications").select("data").eq("id", appId).maybeSingle();
  const x = (data?.data ?? {}) as { trading_name?: string; legal_entity_name?: string };
  return x.trading_name || x.legal_entity_name || "An Home Insulation Victoria installer";
}
async function byInvite(t: string) {
  const d = await db();
  const { data: n } = await d.from("electrician_nominations").select("*").eq("invite_token_hash", await sha256(t)).is("job_id", null).maybeSingle();
  if (!n) throw new Error("This invitation link isn't valid. Ask the installer or Home Insulation Victoria to send a new one.");
  return { d, n };
}

/** Public: what the invited electrician sees before signing up. */
export const loadTeamInvite = createServerFn({ method: "POST" })
  .inputValidator((x) => z.object({ invite: token }).parse(x))
  .handler(async ({ data }) => {
    const { d, n } = await byInvite(data.invite);
    const u = inviteUsable(n);
    if (u.ok && !n.opened_at) await d.from("electrician_nominations").update({ opened_at: new Date().toISOString(), status: n.accepted_at ? n.status : "opened" }).eq("id", n.id);
    return {
      firstName: n.contact_name.trim().split(/\s+/)[0] ?? "", installer: await installerName(d, n.installer_application_id),
      usable: u.ok, reason: u.reason ?? null, answered: n.accepted_at ? "accepted" as const : n.declined_at ? "declined" as const : null,
    };
  });

const recData = z.record(z.string(), z.unknown());
/** Public: electrician says yes/no. On yes, links their onboarding application (by its resume token) and pre-fills contact details. */
export const respondTeamInvite = createServerFn({ method: "POST" })
  .inputValidator((x) => z.object({ invite: token, accept: z.boolean(), recToken: token.optional() }).parse(x))
  .handler(async ({ data }) => {
    const { d, n } = await byInvite(data.invite);
    const u = inviteUsable(n);
    if (!u.ok) throw new Error(u.reason);
    const now = new Date().toISOString();
    if (!data.accept) {
      await d.from("electrician_nominations").update({ declined_at: now, status: "declined", updated_at: now }).eq("id", n.id);
      return { ok: true as const, accepted: false };
    }
    let appId = n.electrician_application_id;
    if (data.recToken) {
      const { data: app } = await d.from("rec_onboarding_applications").select("id, data, status").eq("resume_token_hash", await sha256(data.recToken)).eq("partner_type", "rec").maybeSingle();
      if (!app) throw new Error("Start your onboarding first, then accept.");
      appId = app.id;
      if (app.status === "draft") {
        const cur = recData.parse(app.data ?? {});
        const fill = { primary_contact_name: n.contact_name, business_email: n.email, business_phone: n.phone, trading_name: n.business_name };
        const merged: Record<string, unknown> = { ...cur };
        for (const [k, v] of Object.entries(fill)) if (v && !cur[k]) merged[k] = v;
        // Jo 26 Oct 2026: an installer that pays its own electricians (Reinsulate) — no safety check rate or bank details.
        const paysOwn = await (await import("./installer-paid-electricians.server")).readInstallerPaidElectricians((n as { nominating_business_id?: string | null }).nominating_business_id);
        if (paysOwn) { merged["paid_by_installer"] = true; merged["paid_by_installer_name"] = paysOwn.name; }
        await d.from("rec_onboarding_applications").update({ data: merged as never }).eq("id", app.id);
      }
    }
    await d.from("electrician_nominations").update({ accepted_at: n.accepted_at ?? now, electrician_application_id: appId, status: "accepted", updated_at: now }).eq("id", n.id);
    const { syncTeamUps } = await import("./teaming.server");
    await syncTeamUps(d as never, null);
    return { ok: true as const, accepted: true };
  });

async function requireAdminCtx(sb: unknown) { const { requireAdmin } = await import("./workflow.server"); await requireAdmin(sb as never); }

/** Admin: every installer-level nomination with its live status. */
export const listTeamNominations = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminCtx(context.supabase);
    const d = await db();
    const { data: rows, error } = await d.from("electrician_nominations").select("*").is("job_id", null).order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error("Could not load electrician invites.");
    const appIds = [...new Set((rows ?? []).flatMap((r) => [r.installer_application_id, r.electrician_application_id]).filter(Boolean) as string[])];
    const { data: apps } = appIds.length ? await d.from("rec_onboarding_applications").select("id, status, data").in("id", appIds) : { data: [] };
    const app = new Map((apps ?? []).map((a) => [a.id, a]));
    return (rows ?? []).map((r) => {
      const ia = app.get(r.installer_application_id ?? "")?.data as { trading_name?: string; legal_entity_name?: string } | undefined;
      const s = teamStatus(r, app.get(r.electrician_application_id ?? "")?.status === "submitted");
      return { id: r.id, name: r.contact_name, email: r.email, phone: r.phone, business: r.business_name, isPrimary: r.is_primary, installer: ia?.trading_name || ia?.legal_entity_name || "Installer", status: s, statusLabel: TEAM_STATUS_LABEL[s], expiresAt: r.invite_expires_at, createdAt: r.created_at };
    });
  });

/** Admin: issue (or re-issue) a 14-day personal link. The previous link stops working. Nothing is sent. */
export const issueTeamInviteLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((x) => z.object({ id: uuid }).parse(x))
  .handler(async ({ data, context }) => {
    await requireAdminCtx(context.supabase);
    const d = await db();
    const { data: n } = await d.from("electrician_nominations").select("id, declined_at, teamed_at, ended_at, job_id").eq("id", data.id).maybeSingle();
    if (!n || n.job_id) throw new Error("Invite not found.");
    if (n.teamed_at || n.ended_at || n.declined_at) throw new Error("This invite is already closed.");
    const t = newToken();
    const now = new Date();
    const exp = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
    const { error } = await d.from("electrician_nominations").update({ invite_token_hash: await sha256(t), invite_expires_at: exp, invite_link_issued_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", n.id);
    if (error) throw new Error("Could not create the link.");
    return { path: `/electrician-onboarding?invite=${t}`, expiresAt: exp };
  });

/** Admin: record that staff sent the invite by hand (comms are locked, so the portal never sends it). */
export const markTeamInviteSent = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((x) => z.object({ id: uuid }).parse(x))
  .handler(async ({ data, context }) => {
    await requireAdminCtx(context.supabase);
    const d = await db();
    const now = new Date().toISOString();
    const { error } = await d.from("electrician_nominations").update({ invite_sent_at: now, status: "invite_sent", updated_at: now }).eq("id", data.id).is("job_id", null).not("invite_token_hash", "is", null);
    if (error) throw new Error("Could not update the invite.");
    return { ok: true };
  });

/** Admin: end a team-up. Existing jobs keep their electrician; only new jobs change. */
export const endTeamUp = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((x) => z.object({ id: uuid }).parse(x))
  .handler(async ({ data, context }) => {
    await requireAdminCtx(context.supabase);
    const d = await db();
    const { data: n } = await d.from("electrician_nominations").select("business_id, nominating_business_id").eq("id", data.id).maybeSingle();
    const now = new Date().toISOString();
    await d.from("electrician_nominations").update({ ended_at: now, status: "ended", updated_at: now }).eq("id", data.id);
    if (n?.business_id && n.nominating_business_id) await d.from("partner_relationships").update({ active: false, is_primary: false }).eq("installer_business_id", n.nominating_business_id).eq("electrician_business_id", n.business_id);
    return { ok: true };
  });
