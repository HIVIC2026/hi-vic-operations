// Client-side page guards for signed-in areas (UI only — every server function still checks access itself).
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
export { INSTALLER_BULK_UPLOAD_ENABLED };

export type Access = { admin: boolean; qaOffice: boolean; installer: boolean; electrician: boolean; owner: boolean; businessAdmin: boolean; installerBusinessAdmin: boolean };

// Speed (decision 280): the signed-in area's `beforeLoad` runs on EVERY navigation and used to make three network
// round trips (auth user, roles, memberships) before any page data was asked for. These page guards are UI only —
// every server function still checks access itself — so the answers are remembered for a short while per tab and
// forgotten the moment the auth state changes (sign-in, sign-out, token refresh, user update).
const GUARD_MEMO_MS = 60_000;
type Memo<T> = { key: string; at: number; value: Promise<T> };
let userMemo: Memo<Awaited<ReturnType<typeof supabase.auth.getUser>>> | null = null;
let accessMemo: Memo<Access> | null = null;
export function forgetGuardMemo() { userMemo = null; accessMemo = null; }
if (typeof window !== "undefined") supabase.auth.onAuthStateChange(() => forgetGuardMemo());

function remember<T>(slot: Memo<T> | null, key: string, make: () => Promise<T>, store: (m: Memo<T> | null) => void): Promise<T> {
  if (slot && slot.key === key && Date.now() - slot.at < GUARD_MEMO_MS) return slot.value;
  const value = make();
  const m: Memo<T> = { key, at: Date.now(), value };
  store(m);
  value.catch(() => store(null)); // a failed read is never remembered
  return value;
}

/** The signed-in user for page guards (same answer as `supabase.auth.getUser()`, remembered briefly per tab). */
export function currentUser() {
  return remember(userMemo, "me", async () => {
    const r = await supabase.auth.getUser();
    if (r.error || !r.data.user) userMemo = null; // only a signed-in answer is remembered
    return r;
  }, (m) => { userMemo = m; });
}

export function loadAccess(userId: string): Promise<Access> {
  return remember(accessMemo, userId, () => loadAccessFresh(userId), (m) => { accessMemo = m; });
}

async function loadAccessFresh(userId: string): Promise<Access> {
  const [{ data: roles }, { data: members }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("business_members").select("business_id").eq("user_id", userId).eq("member_role", "business_admin"),
  ]);
  const r = new Set((roles ?? []).map((x) => x.role as string));
  const ids = (members ?? []).map((x) => x.business_id as string);
  // Business type is not read here: trade reads of businesses currently fail (row rule), so the installer role decides.
  const m = ids.map(() => null);
  const qaRole = r.has("qa_office");
  const user = qaRole ? (await currentUser()).data.user : null;
  const qaOffice = qaRole && r.size === 1 && !!user?.email_confirmed_at && /^[^@\s]+@hivic-test\.example$/i.test(user?.email ?? "");
  return {
    admin: r.has("admin") && !qaRole, qaOffice, installer: r.has("installer"), electrician: r.has("electrician"), owner: r.has("owner"),
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
const INSTALLER_BOSS_ONLY = ["/partner/add", "/partner/import"];
export function partnerPathAllowed(path: string, a: Access): boolean {
  if (a.admin) return true;
  const p = path.replace(/\/$/, "");
  if (INSTALLER_BOSS_ONLY.some((x) => p.startsWith(x))) return a.installerBusinessAdmin;
  if (BOSS_ONLY.some((x) => p.startsWith(x))) return a.businessAdmin;
  return a.installer || a.electrician;
}
