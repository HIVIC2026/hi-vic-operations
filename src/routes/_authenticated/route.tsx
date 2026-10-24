import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { currentUser } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Same check as before (supabase.auth.getUser), remembered briefly per tab so each navigation is not a fresh auth round trip (decision 280).
    const { data, error } = await currentUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: location.href } } as never);
    return { user: data.user };
  },
  component: () => <Outlet />,
});
