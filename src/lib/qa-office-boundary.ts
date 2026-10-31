import { createMiddleware } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { qaOfficeFunctionBlocker } from "./qa-office-policy.core";

// Global before-handler boundary, including functions that omitted their own office check.
// Bearer-less public requests retain their existing handler authorization.
// Every bearer gets both checks: getUser (Auth's record; refuses signed-out sessions) and the persisted
// user_roles (qa_office on any email). getClaims verifies the token locally first so its `sub` lets the
// two reads run in one parallel round instead of two sequential ones; the decision is unchanged.
export const testOfficeBoundary = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const authorization = getRequest().headers.get("authorization");
  if (!authorization) return next();
  const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || !authorization.startsWith("Bearer ")) throw new Error("Office permissions could not be checked.");
  const token = authorization.slice(7);
  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization }, fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    } },
  });
  const { data: verified, error: claimsError } = await sb.auth.getClaims(token);
  const sub = verified?.claims?.sub;
  if (claimsError || typeof sub !== "string" || !sub) throw new Error("Office sign-in required.");
  const [{ data: auth, error }, { data: rows, error: roleError }] = await Promise.all([
    sb.auth.getUser(token),
    sb.from("user_roles").select("role").eq("user_id", sub),
  ]);
  if (error || !auth.user || auth.user.id !== sub) throw new Error("Office sign-in required.");
  if (roleError) throw new Error("Office permissions could not be checked.");
  const blocker = qaOfficeFunctionBlocker({ roles: (rows ?? []).map(r => String(r.role)), email: auth.user.email ?? null, emailVerified: !!auth.user.email_confirmed_at }, serverFnMeta.filename, serverFnMeta.name);
  if (blocker) throw new Error(blocker);
  return next();
});
