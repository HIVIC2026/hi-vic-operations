// Client-side page guards for signed-in areas (UI only — every server function still checks access itself).
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type Access = { admin: boolean; installer: boolean; electrician: boolean; owner: boolean; businessAdmin: boolean; installerBusinessAdmin: boolean };

export async function loadAccess(userId: string): Promise<Access> {
  const [{ data: roles }, { data: members }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("business_members").select("business_id").eq("user_id", userId).eq("member_role", "business_admin"),
  ]);
  const r = new Set((roles ?? []).map((x) => x.role as string));
  const ids = (members ?? []).map((x) => x.business_id as string);
  // Business type is not read here: trade reads of businesses currently fail (row rule), so the installer role decides.
  const m = ids.map(() => null);
  return {
    admin: r.has("admin"), installer: r.has("installer"), electrician: r.has("electrician"), owner: r.has("owner"),
    businessAdmin: m.length > 0,
    installerBusinessAdmin: m.length > 0 && r.has("installer"),
  };
}

export function userIdOf(context: unknown): string {
  const id = (context as { user?: { id: string } }).user?.id;
  if (!id) throw redirect({ to: "/auth" });
  return id;
}

/** Which partner pages need the business boss, and which are installer-only. */
const BOSS_ONLY = ["/partner/payments", "/partner/profile", "/partner/workers"];
const INSTALLER_BOSS_ONLY = ["/partner/add", "/partner/bulk-import", "/partner/import"];
/** Batch upload: office and installer business owners/admins only; everyone else uses single Add job. */
export function legacyBulkImportRedirect(a: Pick<Access, "admin" | "installerBusinessAdmin">): "/partner/import" | null {
  return a.admin || a.installerBusinessAdmin ? null : "/partner/import";
}
export function partnerPathAllowed(path: string, a: Access): boolean {
  if (a.admin) return true;
  const p = path.replace(/\/$/, "");
  if (INSTALLER_BOSS_ONLY.some((x) => p.startsWith(x))) return a.installerBusinessAdmin;
  if (BOSS_ONLY.some((x) => p.startsWith(x))) return a.businessAdmin;
  return a.installer || a.electrician;
}
