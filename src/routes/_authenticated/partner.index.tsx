import { createFileRoute, redirect } from "@tanstack/react-router";

// The old partner dashboard is merged into "My work".
export const Route = createFileRoute("/_authenticated/partner/")({
  beforeLoad: () => { throw redirect({ to: "/field" }); },
});
