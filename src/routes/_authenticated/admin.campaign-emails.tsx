import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired campaign copy test page (removed 21 Oct, Jo). Old links land on Templates › Email.
export const Route = createFileRoute("/_authenticated/admin/campaign-emails")({
  beforeLoad: () => { throw redirect({ to: "/admin/templates", search: { cat: "owner" }, replace: true }); },
  component: () => null,
});
