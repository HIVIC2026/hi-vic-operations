import { createFileRoute, redirect } from "@tanstack/react-router";

// REMOVED (office audit; decisions 157/171/173): the installer's usual electrician replaced the team-up invite flow.
// Legacy bookmark kept valid: it redirects.
export const Route = createFileRoute("/_authenticated/admin/team-ups")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/partners", search: { tab: "people" }, replace: true });
  },
  component: () => null,
});
