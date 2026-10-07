import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMe } from "@/hooks/use-me";
import { NoAccess } from "@/components/portal/NoAccess";
import { portalDestination } from "@/lib/set-password-link.core";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home – Home Insulation Victoria Portal" }, { name: "description", content: "Your Home Insulation Victoria portal home." }, { property: "og:title", content: "Home Insulation Victoria Portal" }, { property: "og:description", content: "Your Home Insulation Victoria portal home." }] }),
  component: Home,
});

function Home() {
  const { data: me, isLoading } = useMe();
  if (isLoading || !me) return null;
  const to = portalDestination({ roles: me.roles, hasBusiness: !!me.profile?.business_id });
  if (to === "no-access") return <NoAccess email={me.user.email ?? ""} />;
  return <Navigate to={to} replace />;
}
