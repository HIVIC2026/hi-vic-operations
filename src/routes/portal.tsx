import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readMyProfile, type ProfileClient } from "@/lib/my-profile";
import { SignInCard } from "@/components/portal/SignInCard";
import { NoAccess, RoleChooser } from "@/components/portal/NoAccess";
import { portalDestination } from "@/lib/set-password-link.core";
import { safeNextPath } from "@/lib/login.core";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Staff & trade sign-in – Home Insulation Victoria" },
    { name: "description", content: "Sign in to the Home Insulation Victoria portal for office staff, installers and electricians." },
    { property: "og:title", content: "Staff & trade sign-in – Home Insulation Victoria" },
    { property: "og:description", content: "Sign in to the Home Insulation Victoria portal for office staff, installers and electricians." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: Portal,
});

/** Signed in → the right place every time (deep link first, then by role). Signed out → the sign-in card. */
export function Portal() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal-me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
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
