import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { currentUser } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Who is signed in: the session saved on this phone first, the auth server when there is none (currentUser), remembered
    // briefly per tab (decision 280). No session = /auth, as before. Screen-only: every server function still checks access.
    const { data, error } = await currentUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: location.href } } as never);
    return { user: data.user };
  },
  component: () => <Outlet />,
});
