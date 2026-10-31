import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/route-guards";
import { readMyProfile, type ProfileClient } from "@/lib/my-profile";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { forgetHeadStarts } from "@/lib/trade-route-prefetch";

export type AppRole = "admin" | "qa_office" | "electrician" | "installer" | "owner" | "property_manager";

// Speed (decision 280): `currentUser()` is the same `supabase.auth.getUser()` answer the signed-in layout's guard already
// fetched, remembered briefly per tab and forgotten on any auth change — so a page's first paint no longer waits on
// the auth server a second (and third) time. UI only: every server function still checks access itself.
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await currentUser();
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
export function useAction<TIn, TOut>(fn: (opts: { data: TIn }) => Promise<TOut>, options?: { refresh?: boolean }) {
  const call = useServerFn(fn as never) as unknown as (opts: { data: TIn }) => Promise<TOut>;
  const qc = useQueryClient();
  return async (data: TIn, success?: string): Promise<TOut | undefined> => {
    try {
      const out = await call({ data });
      forgetHeadStarts(); // a screen call started before this action must not be shown after it (trade-route-prefetch)
      markOfficeChanged(); // decision 383: the office lists work themselves out fresh on their next read
      if (success) toast.success(success);
      if (options?.refresh !== false) await qc.invalidateQueries();
      return out;
    } catch (e) {
      forgetHeadStarts(); // a failed action may still have changed something: screens ask afresh
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
      const { data: u } = await currentUser();
      if (!u.user) return null;
      const { loadAccess } = await import("@/lib/route-guards");
      return loadAccess(u.user.id);
    },
    staleTime: 60_000, // the guard memo's own life; `useAction`'s invalidation still refreshes it after every action
  });
}
