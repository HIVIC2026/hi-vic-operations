import { createFileRoute, Navigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readMyProfile, type ProfileClient } from "@/lib/my-profile";
import { SignInCard } from "@/components/portal/SignInCard";
import { NoAccess, RoleChooser } from "@/components/portal/NoAccess";
import { portalDestination } from "@/lib/set-password-link.core";
import { safeNextPath } from "@/lib/login.core";
import { currentUser, loadAccess } from "@/lib/route-guards";
import { writeTradeCache } from "@/lib/trade-cache";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Staff & trade sign-in – Home Insulation Victoria" },
    { name: "description", content: "Sign in to the Home Insulation Victoria portal for office staff and installers." },
    { property: "og:title", content: "Staff & trade sign-in – Home Insulation Victoria" },
    { property: "og:description", content: "Sign in to the Home Insulation Victoria portal for office staff and installers." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: Portal,
});

/** Signed in → the right place every time (deep link first, then by role). Signed out → the sign-in card. */
export function Portal() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-me"],
    queryFn: async () => {
      // Speed: who is signed in comes from the session the sign-in just saved (currentUser, the same rule every page
      // guard uses; the auth server is still asked in the background). The old getUser() was one more trip before anything.
      const { data: u } = await currentUser();
      if (!u.user) return null;
      // Speed: the trade home's code downloads while the first-screen call runs, not after it. Code only (no loaders);
      // a failure just means the screen downloads its code as before.
      for (const id of ["/_authenticated", "/_authenticated/field", "/_authenticated/field/"] as const) {
        try { const r = (router.routesById as unknown as Record<string, unknown>)[id]; if (r) void Promise.resolve(router.loadRouteChunk(r as never)).catch(() => undefined); } catch { /* keep going */ }
      }
      // Portal speed step 2 (Task 6): ONE server call returns the same two facts (roles, business linked) AND the first
      // screen's data, handed to that screen's own cache entry so it draws without asking again; the trade/office area's
      // role check is read alongside (its memo), not after the navigation. If that call fails, the browser reads below run
      // exactly as before. Where the person lands is decided by the same rule (portalDestination) either way.
      const uid = u.user.id;
      const [first] = await Promise.all([
        import("@/lib/first-screen.functions").then((m) => m.getFirstScreen()).catch(() => null),
        loadAccess(uid).catch(() => null),
      ]);
      if (first) {
        if (first.home) { qc.setQueryData(["trade-home"], first.home.value); if (first.home.value) writeTradeCache(uid, "home", first.home.value); }
        if (first.needs) qc.setQueryData(["needs-me-v2", false], first.needs.value);
        return { email: u.user.email ?? "", roles: first.roles, hasBusiness: first.hasBusiness };
      }
      const [{ data: profile }, { data: roles }] = await Promise.all([
        readMyProfile(supabase as unknown as ProfileClient, u.user.id), // D-6: own row via get_my_profile()
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      return { email: u.user.email ?? "", roles: (roles ?? []).map((r) => String(r.role)), hasBusiness: !!profile?.business_id };
    },
  });
  if (isLoading) return <p role="status" className="p-6 text-center text-sm text-muted-foreground">Signing you in…</p>;
  if (!data) return <SignInCard />;
  const to = portalDestination(data);
  if (to === "no-access") return <NoAccess email={data.email} />;
  const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  if (next) { window.location.replace(next); return <p role="status" className="p-6 text-center text-sm">Opening…</p>; }
  if (to === "choose") return <RoleChooser email={data.email} />;
  return <Navigate to={to} replace />;
}
