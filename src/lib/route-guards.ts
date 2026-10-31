// Client-side page guards for signed-in areas (UI only — every server function still checks access itself).
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { clearTradeCache } from "@/lib/trade-cache";
import { forgetHeadStarts } from "@/lib/trade-route-prefetch";

export type Access = { admin: boolean; qaOffice: boolean; installer: boolean; electrician: boolean; owner: boolean; businessAdmin: boolean; installerBusinessAdmin: boolean };

// Speed (decision 280): the signed-in area's `beforeLoad` runs on EVERY navigation and used to make three network
// round trips (auth user, roles, memberships) before any page data was asked for. These page guards are UI only —
// every server function still checks access itself — so the answers are remembered for a short while per tab and
// forgotten the moment the auth state changes (sign-in, sign-out, token refresh, user update).
const GUARD_MEMO_MS = 60_000;
type Memo<T> = { key: string; at: number; value: Promise<T> };
type UserAnswer = Awaited<ReturnType<typeof supabase.auth.getUser>>;
let userMemo: Memo<UserAnswer> | null = null;
let accessMemo: Memo<Access> | null = null;
// Set when the auth server refused a session this phone still holds (401/403): until the next auth change, the guard
// asks the auth server first again, exactly as before, so that person is sent to /auth.
let savedSessionRefused = false;
export function forgetGuardMemo() { userMemo = null; accessMemo = null; savedSessionRefused = false; }
if (typeof window !== "undefined") supabase.auth.onAuthStateChange((event) => { forgetGuardMemo(); if (event === "SIGNED_OUT") forgetHeadStarts(); });

function remember<T>(slot: Memo<T> | null, key: string, make: () => Promise<T>, store: (m: Memo<T> | null) => void): Promise<T> {
  if (slot && slot.key === key && Date.now() - slot.at < GUARD_MEMO_MS) return slot.value;
  const value = make();
  const m: Memo<T> = { key, at: Date.now(), value };
  store(m);
  value.catch(() => store(null)); // a failed read is never remembered
  return value;
}

/**
 * The signed-in user for page guards, remembered briefly per tab. Speed (installer screens towards 1 second): the
 * session saved on this phone answers first (no auth-server round trip before the page can start); with no saved
 * session it is `supabase.auth.getUser()` as before, so signed-out people still go to /auth. The auth server is still
 * asked, in the background, as often as before: if it says the saved session is gone, supabase-js drops it (SIGNED_OUT);
 * for any other 401/403 this phone signs out locally (SIGNED_OUT → /auth) and the next guard check asks the auth
 * server first. UI only — every server function still checks access itself.
 */
export function currentUser() {
  return remember(userMemo, "me", async () => {
    const saved = savedSessionRefused ? null : await savedSessionUser();
    if (saved) { checkSavedSession(); return saved; }
    const r = await supabase.auth.getUser();
    if (r.error || !r.data.user) userMemo = null; // only a signed-in answer is remembered
    return r;
  }, (m) => { userMemo = m; });
}

async function savedSessionUser(): Promise<UserAnswer | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    const user = data?.session?.user;
    return !error && user ? ({ data: { user }, error: null } as UserAnswer) : null;
  } catch { return null; }
}

/** The auth server's answer refuses the session (not a network failure). */
export function authServerRefused(r: { error: unknown }): boolean {
  const status = (r.error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

function checkSavedSession() {
  void supabase.auth.getUser().then((r) => {
    if (!authServerRefused(r)) return; // signed in, or the network failed: the saved answer stands
    // The auth server refuses this phone's session (deleted, banned, revoked): sign out on this phone now, as the old
    // up-front check would have. SIGNED_OUT → the root invalidates the router → the signed-in guard sends them to /auth.
    userMemo = null; accessMemo = null; savedSessionRefused = true;
    clearTradeCache(); forgetHeadStarts();
    void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }, () => undefined);
}

/** The auth server's own answer (used where a page guard depends on email details, not just who is signed in). */
function verifiedUser() {
  return supabase.auth.getUser();
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
  const qaRole = r.has("qa_office");
  const user = qaRole ? (await verifiedUser()).data.user : null; // the TEST office check reads the auth server, as before
  const qaOffice = qaRole && r.size === 1 && !!user?.email_confirmed_at && /^[^@\s]+@hivic-test\.example$/i.test(user?.email ?? "");
  return {
    admin: r.has("admin") && !qaRole, qaOffice, installer: r.has("installer"), electrician: r.has("electrician"), owner: r.has("owner"),
    businessAdmin: ids.length > 0,
    installerBusinessAdmin: ids.length > 0 && r.has("installer"),
  };
}

export function userIdOf(context: unknown): string {
  const id = (context as { user?: { id: string } }).user?.id;
  if (!id) throw redirect({ to: "/auth" });
  return id;
}

/** Which partner pages need the business boss, and which are installer-only. */
const BOSS_ONLY = ["/partner/payments", "/partner/profile", "/partner/workers"];
const INSTALLER_BOSS_ONLY = ["/partner/add"];
export function partnerPathAllowed(path: string, a: Access): boolean {
  if (a.admin) return true;
  const p = path.replace(/\/$/, "");
  if (INSTALLER_BOSS_ONLY.some((x) => p.startsWith(x))) return a.installerBusinessAdmin;
  // Add a job: installer staff may open it (they are told only the owner can add; saving stays owner-only on the server).
  if (p.startsWith("/partner/import")) return a.installer;
  if (BOSS_ONLY.some((x) => p.startsWith(x))) return a.businessAdmin;
  return a.installer || a.electrician;
}
