import { createMiddleware } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { qaOfficeFunctionBlocker } from "./qa-office-policy.core";

// Global before-handler boundary, including functions that omitted their own office check.
// Bearer-less public requests retain their existing handler authorization.
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
  const { data: auth, error } = await sb.auth.getUser(token);
  if (error || !auth.user) throw new Error("Office sign-in required.");
  const { data: rows, error: roleError } = await sb.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (roleError) throw new Error("Office permissions could not be checked.");
  const blocker = qaOfficeFunctionBlocker({ roles: (rows ?? []).map(r => String(r.role)), email: auth.user.email ?? null, emailVerified: !!auth.user.email_confirmed_at }, serverFnMeta.filename, serverFnMeta.name);
  if (blocker) throw new Error(blocker);
  return next();
});