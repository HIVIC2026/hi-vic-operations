// Jo 5 Nov 2026: the Electricians section (office Partners › business, and the installer's own My business). Anyone on the
// business may see it (as before); the office (admin) or the business owner may change it. Writes live in
// installer-electricians.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** Office admin → true. Otherwise the person must be on the business (`editor`: its business admin) — throws if not. */
async function requireAccess(userId: string, businessId: string, editor: boolean): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return true;
  const role = await (await import("./pilot.server")).requireMember(userId, businessId, editor);
  return role === "business_admin";
}

export const getInstallerElectricians = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const canEdit = await requireAccess(context.userId, data.businessId, false);
    const s = await import("./installer-electricians.server");
    const list = await s.electriciansForInstaller(data.businessId);
    // The Add picker is only for people who can change the list (one list read, shared).
    const options = canEdit ? await s.electricianBusinessesToAdd(data.businessId, list) : [];
    return { list, options, canEdit };
  });

export const addInstallerElectricianFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, electricianBusinessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAccess(context.userId, data.businessId, true);
    await (await import("./installer-electricians.server")).addInstallerElectrician(context.userId, data.businessId, data.electricianBusinessId);
    return { ok: true };
  });

export const removeInstallerElectricianFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, electricianBusinessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAccess(context.userId, data.businessId, true);
    await (await import("./installer-electricians.server")).removeInstallerElectrician(context.userId, data.businessId, data.electricianBusinessId);
    return { ok: true };
  });

export const setMainInstallerElectricianFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, key: z.string().regex(/^(business|team):[0-9a-f-]{36}$/i) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAccess(context.userId, data.businessId, true);
    await (await import("./installer-electricians.server")).setMainInstallerElectrician(context.userId, data.businessId, data.key);
    return { ok: true };
  });
