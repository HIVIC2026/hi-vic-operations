import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SignInCard } from "@/components/portal/SignInCard";
import { NoAccess } from "@/components/portal/NoAccess";
import { portalDestination } from "@/lib/set-password-link.core";

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

function Portal() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal-me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("business_id").eq("id", u.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      return { email: u.user.email ?? "", roles: (roles ?? []).map((r) => String(r.role)), hasBusiness: !!profile?.business_id };
    },
  });
  if (isLoading) return null;
  if (!data) return <SignInCard />;
  const to = portalDestination(data);
  if (to === "no-access") return <NoAccess email={data.email} />;
  return <Navigate to={to} replace />;
}
