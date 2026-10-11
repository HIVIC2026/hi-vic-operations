// D-6: the signed-in user's OWN profile, read through get_my_profile() (staged migration
// docs/pending-migrations/0150_profiles_least_privilege.sql). After 0150, the browser role can no
// longer select profiles.email/phone/business_id/licence_number/mitti_* directly, for anyone's row;
// the SECURITY DEFINER function returns only the caller's own row.
//
// Until 0150 is applied the function does not exist (PostgREST PGRST202 / Postgres 42883). Only in
// that case does this fall back to the existing own-row select, which the pre-0150 grants allow — so
// the app behaves exactly as today before the migration and uses the RPC after it. Any other RPC
// error returns no profile (fail closed); there is no fallback that could widen access.
import type { Database } from "@/integrations/supabase/types";

export type MyProfile = Database["public"]["Tables"]["profiles"]["Row"];
type Err = { code?: string; message: string } | null;
type Res = { data: MyProfile | null; error: Err };
/** The minimal slice of the Supabase browser client this needs (structural, so tests can pass a fake). */
export type ProfileClient = {
  rpc: (fn: "get_my_profile") => { maybeSingle: () => PromiseLike<{ data: unknown; error: Err }> };
  from: (t: "profiles") => { select: (c: "*") => { eq: (k: "id", v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: Err }> } } };
};

export const GET_MY_PROFILE_NOT_DEPLOYED = new Set(["PGRST202", "42883"]);

export async function readMyProfile(client: ProfileClient, userId: string): Promise<Res> {
  const r = await client.rpc("get_my_profile").maybeSingle();
  if (r.error) {
    if (!GET_MY_PROFILE_NOT_DEPLOYED.has(r.error.code ?? "")) return { data: null, error: r.error };
    const old = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
    return { data: own(old.data, userId), error: old.error };
  }
  return { data: own(r.data, userId), error: null };
}

/** Only ever accept the caller's own row (an all-null composite for "no row" becomes null too). */
function own(row: unknown, userId: string): MyProfile | null {
  const p = row as MyProfile | null;
  return p && p.id === userId ? p : null;
}
