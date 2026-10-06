import { createFileRoute, redirect } from "@tanstack/react-router";

// Quick setup moved into the approved first-login flow.
export const Route = createFileRoute("/_authenticated/field/setup")({
  beforeLoad: () => { throw redirect({ to: "/field/welcome" }); },
});
