import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readMyProfile, type ProfileClient } from "@/lib/my-profile";

export type AppRole = "admin" | "electrician" | "installer" | "owner" | "property_manager";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        readMyProfile(supabase as unknown as ProfileClient, u.user.id), // D-6: own row via get_my_profile()
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      return { user: u.user, profile, roles: (roles ?? []).map((r) => r.role as AppRole) };
    },
  });
}

/** Run a server action with toast feedback and refresh all data. */
export function useAction<TIn, TOut>(fn: (opts: { data: TIn }) => Promise<TOut>) {
  const call = useServerFn(fn as never) as unknown as (opts: { data: TIn }) => Promise<TOut>;
  const qc = useQueryClient();
  return async (data: TIn, success?: string): Promise<TOut | undefined> => {
    try {
      const out = await call({ data });
      if (success) toast.success(success);
      await qc.invalidateQueries();
      return out;
    } catch (e) {
      // Blocked/failed actions are expected (workflow gates): show them, never crash the page.
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    }
  };
}

/** What this signed-in person can open (menus hide what the page guards would bounce). */
export function useAccess() {
  return useQuery({
    queryKey: ["me-access"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { loadAccess } = await import("@/lib/route-guards");
      return loadAccess(u.user.id);
    },
  });
}
